import { dirname, resolve } from 'node:path';
import type { Operation } from '../../models/operation';
import {
  findDiscardedVerifyKeysInFile,
  formatDiscardedVerifyFinding,
} from '../deprecated-verify';
import { lintEvidenceResults } from '../evidence-lint';
import {
  formatExpectMatchFinding,
  formatExpectShellVarFinding,
  lintExpectMatches,
  lintExpectShellVars,
} from '../expect-lint';
import { formatRegexFinding, lintOperationRegex } from '../regex-lint';
import {
  formatFinding as formatShellcheckFinding,
  isShellcheckAvailable,
  lintOperationCommands,
} from '../shell-lint';
import { validateStepDeps } from '../step-deps';
import { duplicateStepIds, formatDuplicateStepId } from '../step-walk';
import {
  compilePattern,
  hasOption,
  matchesPattern,
  type NormalizedCommand,
  normalizeCommand,
} from './command-model';
import type { LintConfig, RuleSetting } from './config';
import { parseShell } from './shell-lexer';

/**
 * Claim strength of a rule (see docs/linting.md):
 * 1 = exact match of a shape in the procedure text,
 * 2 = reliable signal from an analysis with known gaps,
 * 3 = presence heuristic, a review tripwire.
 */
export type Tier = 1 | 2 | 3;

export interface RuleHit {
  message: string;
}

/** Everything a command rule sees for one step's `command`. */
export interface CommandRuleContext {
  stepName: string;
  text: string;
  commands: NormalizedCommand[];
  unsupported: string[];
  config: LintConfig;
  /** Names SAMARITAN substitutes as `${NAME}` for this step. */
  declaredVariables: ReadonlySet<string>;
}

export interface OperationRuleContext {
  operationFile: string;
  config: LintConfig;
}

interface RuleBase {
  id: string;
  tier: Tier;
  defaultSeverity: RuleSetting;
  description: string;
  /** Part of `validate`'s output already; `samaritan lint` names it. */
  inValidate?: 'already' | 'warning';
}

export interface CommandRule extends RuleBase {
  kind: 'command';
  check(ctx: CommandRuleContext): RuleHit[];
}

export interface OperationRule extends RuleBase {
  kind: 'operation';
  check(operation: Operation, ctx: OperationRuleContext): RuleHit[];
}

export type Rule = CommandRule | OperationRule;

const at = (ctx: CommandRuleContext, cmd: NormalizedCommand): string =>
  ctx.text.includes('\n')
    ? `step "${ctx.stepName}" (line ${cmd.line})`
    : `step "${ctx.stepName}"`;

// ── Family A: the command itself ───────────────────────────────────────────

const exitVerbs: CommandRule = {
  kind: 'command',
  id: 'shell/exit-verbs',
  tier: 1,
  defaultSeverity: 'error',
  inValidate: 'warning',
  description:
    '`exit`, `logout` or `exec <cmd>` in an inline command ends the operation shell (the pane the operator works in). Scripts run in a child shell and are not checked.',
  check(ctx) {
    const hits: RuleHit[] = [];
    for (const cmd of ctx.commands) {
      if (cmd.context !== 'top') continue;
      if (cmd.executable === 'exit' || cmd.executable === 'logout') {
        hits.push({
          message: `${at(ctx, cmd)}: \`${cmd.executable}\` ends the operation shell; fail with a non-zero command (\`false\`) or move the logic into a \`script:\``,
        });
      } else if (cmd.wrappers.includes('exec') && cmd.executable) {
        hits.push({
          message: `${at(ctx, cmd)}: \`exec ${cmd.executable}\` replaces the operation shell; when it ends, the pane's shell is gone`,
        });
      }
    }
    return hits;
  },
};

const errexit: CommandRule = {
  kind: 'command',
  id: 'shell/errexit',
  tier: 1,
  defaultSeverity: 'error',
  inValidate: 'warning',
  description:
    '`set -e` / `set -u` / `set -o errexit|nounset` / `trap … EXIT` in an inline command stay on in the operation shell for every later step.',
  check(ctx) {
    const hits: RuleHit[] = [];
    for (const cmd of ctx.commands) {
      if (cmd.context !== 'top') continue;
      if (cmd.executable === 'set') {
        const turnedOn = new Set<string>();
        for (const o of cmd.options) {
          if (o.name === '-e') turnedOn.add('-e');
          if (o.name === '-u') turnedOn.add('-u');
          if (
            o.name === '-o' &&
            (o.value === 'errexit' || o.value === 'nounset')
          )
            turnedOn.add(`-o ${o.value}`);
        }
        if (turnedOn.size > 0) {
          hits.push({
            message: `${at(ctx, cmd)}: \`set ${[...turnedOn].join(' ')}\` stays on in the operation shell; with errexit a failing command in a later step closes it. Check the status in the command (\`cmd || …\`) or use a \`script:\``,
          });
        }
      }
      if (
        cmd.executable === 'trap' &&
        cmd.operands[0] !== '-' &&
        cmd.operands.slice(1).some((s) => ['EXIT', '0', 'SIGEXIT'].includes(s))
      ) {
        hits.push({
          message: `${at(ctx, cmd)}: \`trap … EXIT\` stays set in the operation shell and runs when that shell exits, not when this step ends`,
        });
      }
    }
    return hits;
  },
};

const MYSQL_FAMILY = new Set(['mysql', 'mariadb', 'mysqldump', 'mysqladmin']);

const passwordOnCmdline: CommandRule = {
  kind: 'command',
  id: 'shell/password-on-cmdline',
  tier: 1,
  defaultSeverity: 'error',
  inValidate: 'warning',
  description:
    'A password given on the command line (`--password=<value>`, `mysql -p<value>`). A bare `-p` / `--password` prompts and does not fire.',
  check(ctx) {
    const hits: RuleHit[] = [];
    for (const cmd of ctx.commands) {
      const shown = cmd.options.find(
        (o) =>
          (o.name === '--password' && o.value) ||
          (o.name === '-p' && o.value && MYSQL_FAMILY.has(cmd.executable)),
      );
      if (shown) {
        const form = shown.name === '-p' ? '-p<value>' : '--password=<value>';
        hits.push({
          message: `${at(ctx, cmd)}: \`${cmd.executable} ${form}\` puts the password in the process list, shell history and the run's captured output; let the tool prompt or read it from a file`,
        });
      }
    }
    return hits;
  },
};

/** tmux commands sharing a first letter with the kill commands. */
const TMUX_COMMANDS = [
  'kill-pane',
  'kill-server',
  'kill-session',
  'kill-window',
  'delete-buffer',
  'detach-client',
  'display-menu',
  'display-message',
  'display-panes',
  'display-popup',
];
const TMUX_ALIASES: Record<string, string> = {
  killp: 'kill-pane',
  killw: 'kill-window',
  detach: 'detach-client',
  deleteb: 'delete-buffer',
  display: 'display-message',
  displayp: 'display-panes',
  menu: 'display-menu',
  popup: 'display-popup',
};
const TMUX_KILL = new Set([
  'kill-pane',
  'kill-server',
  'kill-session',
  'kill-window',
  'detach-client',
]);

/** Resolve a tmux command word: alias, exact name, or unique prefix. */
export function resolveTmuxCommand(word: string): string | undefined {
  if (TMUX_ALIASES[word]) return TMUX_ALIASES[word];
  if (TMUX_COMMANDS.includes(word)) return word;
  const matches = TMUX_COMMANDS.filter((c) => c.startsWith(word));
  return matches.length === 1 ? matches[0] : undefined;
}

const tmuxKill: CommandRule = {
  kind: 'command',
  id: 'tmux/kill-commands',
  tier: 1,
  defaultSeverity: 'error',
  inValidate: 'warning',
  description:
    "`tmux kill-server|kill-session|kill-window|kill-pane|detach-client`, their aliases (`killp`, `killw`, `detach`) and unique abbreviations can close the operator's own pane or session.",
  check(ctx) {
    const hits: RuleHit[] = [];
    for (const cmd of ctx.commands) {
      if (cmd.executable !== 'tmux') continue;
      // `tmux a \; b`: every word after a `;` starts another tmux command.
      const heads = [cmd.operands[0]];
      cmd.operands.forEach((w, k) => {
        if (w === ';' && cmd.operands[k + 1]) heads.push(cmd.operands[k + 1]);
      });
      for (const head of heads) {
        const resolved = head ? resolveTmuxCommand(head) : undefined;
        if (resolved && TMUX_KILL.has(resolved)) {
          const written = resolved === head ? '' : ` (written \`${head}\`)`;
          hits.push({
            message: `${at(ctx, cmd)}: \`tmux ${resolved}\`${written} can close the operator's own pane or session`,
          });
        }
      }
    }
    return hits;
  },
};

/** Commands whose quoted argument is itself a command, checked one level deep. */
function nestedCommandText(cmd: NormalizedCommand): string | undefined {
  if (['bash', 'sh', 'zsh', 'dash'].includes(cmd.executable)) {
    return cmd.options.find((o) => o.name === '-c')?.value;
  }
  if (cmd.executable === 'ssh' && cmd.operands.length > 1) {
    return cmd.operands.slice(1).join(' ');
  }
  if (cmd.executable === 'eval') return cmd.operands.join(' ');
  return undefined;
}

/** Protected branches a `git push` would update, or [] when none. */
export function protectedPushTargets(
  cmd: NormalizedCommand,
  protectedBranches: readonly string[],
): string[] {
  if (cmd.executable !== 'git' || cmd.operands[0] !== 'push') return [];
  if (hasOption(cmd, '--all') || hasOption(cmd, '--mirror')) {
    return [...protectedBranches];
  }
  // operands: push <remote> <refspec>…; one operand alone is the remote.
  const refspecs = cmd.operands.slice(2);
  const hits: string[] = [];
  for (const raw of refspecs) {
    const spec = raw.startsWith('+') ? raw.slice(1) : raw;
    const colon = spec.lastIndexOf(':');
    let dst = colon === -1 ? spec : spec.slice(colon + 1);
    if (dst.includes('$')) continue; // interpolated: not resolved by design
    if (dst.startsWith('refs/heads/')) dst = dst.slice('refs/heads/'.length);
    else if (dst.startsWith('refs/')) continue;
    if (protectedBranches.includes(dst)) hits.push(dst);
  }
  return hits;
}

const protectedPush: CommandRule = {
  kind: 'command',
  id: 'git/protected-push',
  tier: 3,
  defaultSeverity: 'warning',
  inValidate: 'warning',
  description:
    'A `git push` whose refspec destination is a protected branch (`lint.protected_branches`, default main/master), or `--all` / `--mirror`. Also checked one level inside `bash -c`, `ssh host …` and `eval`. Interpolated destinations (`HEAD:${TARGET}`) are not resolved.',
  check(ctx) {
    const hits: RuleHit[] = [];
    const branches = ctx.config.protected_branches;
    const visit = (cmd: NormalizedCommand, via?: string) => {
      const targets = protectedPushTargets(cmd, branches);
      if (targets.length === 0) return;
      const how =
        hasOption(cmd, '--all') || hasOption(cmd, '--mirror')
          ? `\`git push ${hasOption(cmd, '--all') ? '--all' : '--mirror'}\` also pushes protected branches (${targets.join(', ')})`
          : `\`git push\` targets protected branch${targets.length > 1 ? 'es' : ''} ${targets.map((t) => `'${t}'`).join(', ')}`;
      hits.push({
        message: `${at(ctx, cmd)}: ${how}${via ? ` (inside \`${via}\`)` : ''}`,
      });
    };
    for (const cmd of ctx.commands) {
      visit(cmd);
      const inner = nestedCommandText(cmd);
      if (inner) {
        for (const nested of parseShell(inner).commands) {
          visit(
            { ...normalizeCommand(nested), line: cmd.line },
            cmd.executable,
          );
        }
      }
    }
    return hits;
  },
};

const awsNoPager: CommandRule = {
  kind: 'command',
  id: 'aws/no-pager',
  tier: 1,
  defaultSeverity: 'error',
  inValidate: 'warning',
  description:
    'An `aws` command without `--no-cli-pager` (and no `AWS_PAGER=` assignment) opens a pager in the pane and waits for a key.',
  check(ctx) {
    const hits: RuleHit[] = [];
    for (const cmd of ctx.commands) {
      if (cmd.executable !== 'aws' || cmd.operands.length === 0) continue;
      if (['configure', 'help'].includes(cmd.operands[0])) continue;
      if (hasOption(cmd, '--no-cli-pager')) continue;
      if (cmd.assignments.some((a) => a.name === 'AWS_PAGER' && a.value === ''))
        continue;
      hits.push({
        message: `${at(ctx, cmd)}: \`aws ${cmd.operands.slice(0, 2).join(' ')}\` without \`--no-cli-pager\` opens a pager in the pane and waits for \`q\``,
      });
    }
    return hits;
  },
};

const COLON_EXPANSION = /\$\{([A-Za-z_][A-Za-z0-9_]*):[?\-=+]/g;

const colonUnresolved: CommandRule = {
  kind: 'command',
  id: 'var/colon-unresolved',
  tier: 2,
  defaultSeverity: 'warning',
  inValidate: 'warning',
  description:
    '`${VAR:?}`, `${VAR:-x}`, `${VAR:=x}` or `${VAR:+x}` on a variable the operation declares. SAMARITAN only substitutes `${VAR}`, so the shell reads its own (usually unset) `VAR`.',
  check(ctx) {
    const seen = new Set<string>();
    const hits: RuleHit[] = [];
    for (const m of ctx.text.matchAll(COLON_EXPANSION)) {
      const name = m[1];
      if (!ctx.declaredVariables.has(name) || seen.has(name)) continue;
      seen.add(name);
      hits.push({
        message: `step "${ctx.stepName}": \`${m[0]}…}\` is not substituted: ${name} is an operation variable, but SAMARITAN only replaces \`\${${name}}\`; the shell reads its own ${name}`,
      });
    }
    return hits;
  },
};

const unsupported: CommandRule = {
  kind: 'command',
  id: 'analysis/unsupported',
  tier: 2,
  defaultSeverity: 'warning',
  inValidate: 'warning',
  description:
    'The command uses syntax the lint parser does not analyse (heredoc, process substitution, backticks, `case`, function definitions). Never skipped silently: results for that command are incomplete.',
  check(ctx) {
    if (ctx.unsupported.length === 0) return [];
    const notes = ctx.unsupported.map((u) =>
      u === 'heredoc' ? 'heredoc (lines after `<<` are skipped)' : u,
    );
    return [
      {
        message: `step "${ctx.stepName}": not fully analysed: ${notes.join(', ')}`,
      },
    ];
  },
};

const banned: CommandRule = {
  kind: 'command',
  id: 'cmd/banned',
  tier: 1,
  defaultSeverity: 'error',
  inValidate: 'warning',
  description:
    'A command matching a `lint.banned` pattern (whole-token match over the parsed command; `*` is a whole-token wildcard).',
  check(ctx) {
    const hits: RuleHit[] = [];
    for (const entry of ctx.config.banned) {
      const pattern = compilePattern(entry.pattern);
      for (const cmd of ctx.commands) {
        if (!matchesPattern(pattern, cmd)) continue;
        hits.push({
          message: `${at(ctx, cmd)}: matches banned \`${entry.pattern}\`${entry.message ? `: ${entry.message}` : ''}`,
        });
      }
    }
    return hits;
  },
};

const requiredFlags: CommandRule = {
  kind: 'command',
  id: 'cmd/required-flag',
  tier: 1,
  defaultSeverity: 'error',
  inValidate: 'warning',
  description:
    'A command matching a `lint.required` pattern but missing one of its `flags`.',
  check(ctx) {
    const hits: RuleHit[] = [];
    for (const entry of ctx.config.required) {
      const pattern = compilePattern(entry.pattern);
      for (const cmd of ctx.commands) {
        if (!matchesPattern(pattern, cmd)) continue;
        const missing = entry.flags.filter((f) => !hasOption(cmd, f));
        if (missing.length === 0) continue;
        hits.push({
          message: `${at(ctx, cmd)}: missing ${missing.join(', ')} (required for \`${entry.pattern}\`)${entry.message ? `: ${entry.message}` : ''}`,
        });
      }
    }
    return hits;
  },
};

// ── Existing checks, named ─────────────────────────────────────────────────

const existing = (
  id: string,
  tier: Tier,
  defaultSeverity: RuleSetting,
  description: string,
  check: OperationRule['check'],
): OperationRule => ({
  kind: 'operation',
  id,
  tier,
  defaultSeverity,
  description,
  inValidate: 'already',
  check,
});

const depsRule = (
  kind: string,
  tier: Tier,
  severity: RuleSetting,
  what: string,
) =>
  existing(`deps/${kind}`, tier, severity, what, (op) =>
    validateStepDeps(op.steps)
      .filter((i) => i.kind === kind)
      .map((i) => ({ message: i.message })),
  );

const existingRules: OperationRule[] = [
  existing(
    'steps/duplicate-id',
    1,
    'error',
    'Two top-level steps share an `id`.',
    (op) =>
      duplicateStepIds(op.steps).map((d) => ({
        message: formatDuplicateStepId(d),
      })),
  ),
  existing(
    'expect/invalid-regex',
    1,
    'error',
    'An `expect` regex field that does not compile, so the check can never pass.',
    (op) =>
      lintOperationRegex(op)
        .filter((f) => f.level === 'error')
        .map((f) => ({ message: formatRegexFinding(f) })),
  ),
  existing(
    'expect/redos-prone',
    2,
    'warning',
    'An `expect` regex with nested unbounded quantifiers (`(a+)+`).',
    (op) =>
      lintOperationRegex(op)
        .filter((f) => f.level !== 'error')
        .map((f) => ({ message: formatRegexFinding(f) })),
  ),
  existing(
    'expect/shell-var-never-resolves',
    2,
    'warning',
    'A bare `$NAME` in `expect` that is not an operation variable is compared literally.',
    (op) =>
      lintExpectShellVars(op).map((f) => ({
        message: formatExpectShellVarFinding(f),
      })),
  ),
  existing(
    'expect/token-from-command',
    2,
    'warning',
    'An `expect` substring that also appears in the command can pass on the echoed command line.',
    (op) =>
      lintExpectMatches(op)
        .filter((f) => f.kind === 'self-match')
        .map((f) => ({ message: formatExpectMatchFinding(f) })),
  ),
  existing(
    'expect/bare-number',
    2,
    'warning',
    'A bare number in `contains` also matches longer numbers (`2` matches `12`).',
    (op) =>
      lintExpectMatches(op)
        .filter((f) => f.kind === 'bare-number')
        .map((f) => ({ message: formatExpectMatchFinding(f) })),
  ),
  depsRule('cycle', 1, 'error', 'Steps whose `needs` form a cycle.'),
  depsRule('self-ref', 1, 'error', 'A step that `needs` itself.'),
  depsRule('forward-ref', 1, 'error', 'A step that `needs` a later step.'),
  depsRule('unknown-ref', 2, 'warning', 'A `needs` entry that names no step.'),
  depsRule(
    'ambiguous-ref',
    2,
    'warning',
    'A `needs` entry that matches several steps.',
  ),
  depsRule(
    'sub-step-needs',
    2,
    'warning',
    '`needs` on a sub-step (only top-level `needs` are honoured).',
  ),
  existing(
    'compat/discarded-verify',
    2,
    'warning',
    'Keys under a deprecated `verify:` that the parser discards.',
    (_op, ctx) =>
      findDiscardedVerifyKeysInFile(ctx.operationFile).map((f) => ({
        message: formatDiscardedVerifyFinding(f),
      })),
  ),
  existing(
    'evidence/results',
    2,
    'warning',
    '`evidence.results` entries for an unknown environment, a missing file or a mismatched type.',
    (op, ctx) =>
      lintEvidenceResults(op, dirname(resolve(ctx.operationFile))).map(
        (message) => ({ message }),
      ),
  ),
  existing(
    'shell/shellcheck',
    2,
    'off',
    'shellcheck over every `command` and `script` (off by default; needs shellcheck on PATH, skipped otherwise).',
    (op, ctx) =>
      isShellcheckAvailable()
        ? lintOperationCommands(op, ctx.operationFile).map((f) => ({
            message: formatShellcheckFinding(f),
          }))
        : [],
  ),
];

/** The canonical rule registry: the single source of rule IDs. */
export const RULES: readonly Rule[] = [
  exitVerbs,
  errexit,
  passwordOnCmdline,
  tmuxKill,
  protectedPush,
  awsNoPager,
  colonUnresolved,
  banned,
  requiredFlags,
  unsupported,
  ...existingRules,
];

export const RULE_IDS: ReadonlySet<string> = new Set(RULES.map((r) => r.id));
