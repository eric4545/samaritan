import type { CaptureRule, Step } from '../../models/operation';
import { stepDisplayName } from '../step-walk';
import { baseName, describeCommand, isBackup, mentionsAny } from './classify';
import { hasOption, type NormalizedCommand } from './command-model';
import {
  type AnyStep,
  commandHit,
  expectChecks,
  expectStrings,
  fieldIn,
  type OperationRule,
  type OperationRuleContext,
  type RuleHit,
  runsIn,
  type StepInfo,
  sessionOf,
  stepAt,
  templateRefs,
} from './rule-types';
import { awsOperation } from './tools/aws';

// ── helpers ─────────────────────────────────────────────────────────────────

/** Capture name → forward steps that capture it. */
function producers(ctx: OperationRuleContext): Map<string, StepInfo[]> {
  const map = new Map<string, StepInfo[]>();
  for (const info of ctx.all) {
    for (const name of Object.keys((info.step as Step).capture ?? {})) {
      map.set(name, [...(map.get(name) ?? []), info]);
    }
  }
  return map;
}

/** `${NAME}` references a step makes (command, instruction, expect). */
function referencedNames(step: AnyStep): Set<string> {
  return new Set([
    ...templateRefs(step.command),
    ...templateRefs(step.instruction),
    ...expectStrings(step.expect).flatMap(templateRefs),
  ]);
}

/** Names read through `expect.equals_captured`. */
function equalsCaptured(step: AnyStep): string[] {
  return expectChecks(step.expect)
    .map((c) => c.equals_captured)
    .filter((v): v is string => typeof v === 'string');
}

const hit = (info: StepInfo, message: string, field?: string): RuleHit => ({
  message: `${stepAt(info)}: ${message}`,
  step: info.step,
  field,
});

/** The order a rollback entry runs after: its owner's; global rollback: last. */
function effectiveOrder(info: StepInfo, ctx: OperationRuleContext): number {
  if (!info.rollback) return info.order;
  if (info.owner) {
    return ctx.forward.find((f) => f.step === info.owner)?.order ?? Infinity;
  }
  return Infinity;
}

// ── captures and variables ──────────────────────────────────────────────────

const forwardVar: OperationRule = {
  kind: 'operation',
  id: 'flow/forward-var',
  tier: 1,
  defaultSeverity: 'error',
  inValidate: 'warning',
  description:
    'A `${NAME}` used before the step that captures it (`capture:`) has run. At run time the reference fails: the value does not exist yet.',
  check(ctx) {
    const byName = producers(ctx);
    const hits: RuleHit[] = [];
    for (const info of ctx.all) {
      const at = effectiveOrder(info, ctx);
      if (at === Infinity) continue;
      const expectRefs = new Set(
        expectStrings(info.step.expect).flatMap(templateRefs),
      );
      for (const name of referencedNames(info.step)) {
        if (info.declaredVariables.has(name)) continue;
        const from = (byName.get(name) ?? []).filter((p) => !p.rollback);
        if (from.length === 0) continue;
        const ready = from.some(
          (p) =>
            p.order < at ||
            (p.step === info.step && expectRefs.has(name)) ||
            (info.rollback && p.order === at),
        );
        if (ready) continue;
        hits.push(
          hit(
            info,
            `\`\${${name}}\` is used before step "${from[0].stepName}" captures it`,
          ),
        );
      }
    }
    return hits;
  },
};

const unproducedCapture: OperationRule = {
  kind: 'operation',
  id: 'flow/unproduced-capture',
  tier: 1,
  defaultSeverity: 'error',
  inValidate: 'warning',
  description:
    'A capture that is read but never produced: `expect.equals_captured` naming no `capture:`, or a `${NAME}` whose only capturing steps do not run in an environment where the reading step does ("producer may not execute").',
  check(ctx) {
    const byName = producers(ctx);
    const hits: RuleHit[] = [];
    for (const info of ctx.all) {
      for (const name of equalsCaptured(info.step)) {
        if (!byName.has(name)) {
          hits.push(
            hit(
              info,
              `\`equals_captured: ${name}\` reads a capture no step produces`,
              'expect',
            ),
          );
        }
      }
      const names = new Set([
        ...equalsCaptured(info.step),
        ...[...referencedNames(info.step)].filter(
          (n) => !info.declaredVariables.has(n),
        ),
      ]);
      for (const name of names) {
        const from = byName.get(name);
        if (!from) continue;
        const missing = ctx.environments.filter(
          (env) =>
            runsIn(info, env) &&
            !from.some((p) => {
              const capture = fieldIn(p, 'capture', env) as
                | Record<string, unknown>
                | undefined;
              return capture !== undefined && name in capture;
            }),
        );
        if (missing.length === 0) continue;
        hits.push(
          hit(
            info,
            `\`${name}\` is captured only by step${from.length > 1 ? 's' : ''} ${from.map((p) => `"${p.stepName}"`).join(', ')}, which may not execute in ${missing.map((e) => `'${e}'`).join(', ')} (\`when:\`)`,
          ),
        );
      }
    }
    return hits;
  },
};

/** Number of capture groups in a pattern, or undefined if it does not compile. */
export function captureGroupCount(pattern: string): number | undefined {
  try {
    return (new RegExp(`(?:${pattern})|`).exec('')?.length ?? 1) - 1;
  } catch {
    return undefined;
  }
}

const captureGroupOob: OperationRule = {
  kind: 'operation',
  id: 'flow/capture-group-oob',
  tier: 1,
  defaultSeverity: 'error',
  inValidate: 'warning',
  description:
    "A `capture:` rule that can never set its variable: `group` beyond the pattern's groups, a pattern that does not compile, or neither `pattern` nor `line`.",
  check(ctx) {
    const hits: RuleHit[] = [];
    for (const info of ctx.all) {
      const capture = (info.step as Step).capture ?? {};
      for (const [name, rule] of Object.entries(capture) as [
        string,
        CaptureRule,
      ][]) {
        if (rule?.pattern === undefined) {
          if (rule?.line !== 'first' && rule?.line !== 'last') {
            hits.push(
              hit(
                info,
                `capture \`${name}\` has neither \`pattern\` nor \`line\`; it is never set`,
                'capture',
              ),
            );
          }
          continue;
        }
        const groups = captureGroupCount(rule.pattern);
        const group = rule.group ?? 1;
        if (groups === undefined) {
          hits.push(
            hit(
              info,
              `capture \`${name}\`: pattern \`${rule.pattern}\` does not compile; it is never set`,
              'capture',
            ),
          );
        } else if (group > groups) {
          hits.push(
            hit(
              info,
              `capture \`${name}\` takes group ${group}, but \`${rule.pattern}\` has ${groups} group${groups === 1 ? '' : 's'}; it is never set`,
              'capture',
            ),
          );
        }
      }
    }
    return hits;
  },
};

const sessionUndeclared: OperationRule = {
  kind: 'operation',
  id: 'flow/session-undeclared',
  tier: 1,
  defaultSeverity: 'error',
  inValidate: 'warning',
  description:
    'A step `session:` (after `${VAR}` resolution per environment) that names no entry under `sessions:`.',
  check(ctx) {
    const declared = new Set(Object.keys(ctx.operation.sessions ?? {}));
    const hits: RuleHit[] = [];
    for (const info of ctx.all) {
      const bad = new Map<string, string[]>();
      for (const env of ctx.environments) {
        const raw = fieldIn(info, 'session', env);
        if (!raw) continue;
        const vars: Record<string, unknown> = {
          ...(ctx.operation.common_variables ?? {}),
          ...(ctx.operation.variables?.[env] ?? {}),
          ...((info.step as Step).variables ?? {}),
        };
        const value = raw.replace(/\$\{(\w+)\}/g, (m, n) =>
          vars[n] === undefined ? m : String(vars[n]),
        );
        if (value.includes('${') || declared.has(value)) continue;
        bad.set(value, [...(bad.get(value) ?? []), env]);
      }
      for (const [value, envs] of bad) {
        const where =
          envs.length === ctx.environments.length && info.onlyEnv === undefined
            ? ''
            : ` in ${envs.map((e) => `'${e}'`).join(', ')}`;
        hits.push(
          hit(
            info,
            `session \`${value}\`${where} is not declared under \`sessions:\`${declared.size ? ` (declared: ${[...declared].join(', ')})` : ''}`,
            'session',
          ),
        );
      }
    }
    return hits;
  },
};

// ── state changes ───────────────────────────────────────────────────────────

const verifies = (info: StepInfo | undefined): boolean =>
  !!info &&
  (info.step.expect !== undefined ||
    info.step.confirm !== undefined ||
    !!info.step.evidence?.required);

const mutateWithoutVerify: OperationRule = {
  kind: 'operation',
  id: 'flow/mutate-without-verify',
  tier: 3,
  defaultSeverity: 'warning',
  inValidate: 'warning',
  description:
    'A step that changes state (kubectl apply, aws create-/delete-, git push, systemctl restart, …) with no `expect`, `confirm` or required evidence on it or on the next step.',
  check(ctx) {
    const steps = ctx.forward.filter((f) => f.text || verifies(f));
    const hits: RuleHit[] = [];
    steps.forEach((info, k) => {
      const mutation = info.commands.find((c) => ctx.tools.isMutating(c));
      if (!mutation || verifies(info) || verifies(steps[k + 1])) return;
      hits.push(
        commandHit(
          info,
          mutation,
          `\`${describeCommand(mutation, ctx.tools)}\` changes state, and neither this step nor the next checks the result (\`expect\`, \`confirm\`, required evidence)`,
        ),
      );
    });
    return hits;
  },
};

const noRollbackOnMutate: OperationRule = {
  kind: 'operation',
  id: 'flow/no-rollback-on-mutate',
  tier: 3,
  defaultSeverity: 'warning',
  inValidate: 'warning',
  description:
    'A step that changes state with no `rollback` on it or its parent, in an operation without a `rollback:` plan.',
  check(ctx) {
    if ((ctx.operation.rollback?.steps ?? []).length > 0) return [];
    const hits: RuleHit[] = [];
    for (const info of ctx.forward) {
      const mutation = info.commands.find((c) => ctx.tools.isMutating(c));
      if (!mutation) continue;
      const covered = [...info.ancestors, info.step].some(
        (s) => ((s as Step).rollback ?? []).length > 0,
      );
      if (covered) continue;
      hits.push(
        commandHit(
          info,
          mutation,
          `\`${describeCommand(mutation, ctx.tools)}\` changes state and there is no rollback for it (step \`rollback:\` or an operation \`rollback:\` plan)`,
        ),
      );
    }
    return hits;
  },
};

// ── ordering heuristics (opt-in) ────────────────────────────────────────────

/** Every command of the forward steps, in run order. */
function forwardCommands(
  ctx: OperationRuleContext,
): { info: StepInfo; cmd: NormalizedCommand }[] {
  return ctx.forward.flatMap((info) =>
    info.commands.map((cmd) => ({ info, cmd })),
  );
}

const isStsCheck = (cmd: NormalizedCommand) =>
  cmd.executable === 'aws' &&
  cmd.operands[0] === 'sts' &&
  cmd.operands[1] === 'get-caller-identity';

const stsBeforeMutate: OperationRule = {
  kind: 'operation',
  id: 'flow/sts-before-mutate',
  tier: 3,
  defaultSeverity: 'off',
  presetSeverity: 'warning',
  inValidate: 'warning',
  description:
    'A state-changing `aws` command with no earlier `aws sts get-caller-identity` (the account/role check). Reports "no check found" and "the check may not execute in <env>" separately.',
  check(ctx) {
    const all = forwardCommands(ctx);
    const hits: RuleHit[] = [];
    const reported = new Set<AnyStep>();
    all.forEach(({ info, cmd }, k) => {
      if (
        cmd.executable !== 'aws' ||
        !ctx.tools.isMutating(cmd) ||
        reported.has(info.step)
      )
        return;
      const session = sessionOf(info) ?? '(default)';
      const anywhere = all.slice(0, k).filter((e) => isStsCheck(e.cmd));
      const checks = anywhere.filter(
        (e) => (sessionOf(e.info) ?? '(default)') === session,
      );
      if (anywhere.length > 0 && checks.length === 0) {
        reported.add(info.step);
        hits.push(
          commandHit(
            info,
            cmd,
            `the identity check in step "${anywhere[0].info.stepName}" ran in session \`${sessionOf(anywhere[0].info) ?? '(default)'}\`, not \`${session}\` where this state-changing aws command runs`,
          ),
        );
        return;
      }
      if (checks.length === 0) {
        reported.add(info.step);
        hits.push(
          commandHit(
            info,
            cmd,
            `\`aws ${awsOperation(cmd) ? `${cmd.operands[0]} ${awsOperation(cmd)}` : cmd.operands[0]}\` changes state with no earlier \`aws sts get-caller-identity\` (no relevant prerequisite found)`,
          ),
        );
        return;
      }
      const missing = ctx.environments.filter(
        (env) => runsIn(info, env) && !checks.some((c) => runsIn(c.info, env)),
      );
      if (missing.length > 0) {
        reported.add(info.step);
        hits.push(
          commandHit(
            info,
            cmd,
            `the identity check in step "${checks[0].info.stepName}" may not execute in ${missing.map((e) => `'${e}'`).join(', ')} (\`when:\`) before this state-changing aws command`,
          ),
        );
      }
    });
    return hits;
  },
};

const CFN_ASYNC = new Set(['create-stack', 'update-stack', 'delete-stack']);
const CFN_READ = /^describe-stack|^list-stack-resources$/;

const waitAfterAsync: OperationRule = {
  kind: 'operation',
  id: 'flow/wait-after-async',
  tier: 3,
  defaultSeverity: 'off',
  presetSeverity: 'warning',
  inValidate: 'warning',
  description:
    '`aws cloudformation create-stack` / `update-stack` / `delete-stack` followed by a `describe-stack…` with no `aws cloudformation wait stack-*-complete` in between: the read sees an in-progress stack.',
  check(ctx) {
    const all = forwardCommands(ctx);
    const hits: RuleHit[] = [];
    all.forEach(({ info, cmd }, k) => {
      if (
        cmd.operands[0] !== 'cloudformation' ||
        !CFN_ASYNC.has(awsOperation(cmd))
      )
        return;
      const stack = ctx.tools.resourceIds(cmd);
      const sameStack = (c: NormalizedCommand) => {
        const other = ctx.tools.resourceIds(c);
        return (
          stack.length === 0 || other.length === 0 || mentionsAny(c, stack)
        );
      };
      for (const later of all.slice(k + 1)) {
        if (later.cmd.operands[0] !== 'cloudformation') continue;
        if (!sameStack(later.cmd)) continue;
        const op = awsOperation(later.cmd);
        if (op === 'wait') return;
        if (CFN_READ.test(op)) {
          hits.push(
            commandHit(
              later.info,
              later.cmd,
              `\`${op}\` reads the stack while \`${awsOperation(cmd)}\` (step "${info.stepName}") may still be in progress; wait with \`aws cloudformation wait stack-…-complete\` first`,
            ),
          );
          return;
        }
      }
    });
    return hits;
  },
};

const backupBeforeDelete: OperationRule = {
  kind: 'operation',
  id: 'flow/backup-before-delete',
  tier: 3,
  defaultSeverity: 'off',
  presetSeverity: 'warning',
  inValidate: 'warning',
  description:
    'A data deletion (volume, database, stack, table, PVC, `DROP`) with no earlier snapshot or backup command.',
  check(ctx) {
    const all = forwardCommands(ctx);
    const hits: RuleHit[] = [];
    all.forEach(({ info, cmd }, k) => {
      if (!ctx.tools.isDataDeletion(cmd)) return;
      const ids = ctx.tools.resourceIds(cmd);
      const backups = all.slice(0, k).filter((e) => isBackup(e.cmd, ctx.tools));
      const forThis = backups.filter(
        (e) => ids.length === 0 || mentionsAny(e.cmd, ids),
      );
      if (forThis.length > 0) return;
      hits.push(
        commandHit(
          info,
          cmd,
          backups.length > 0
            ? `\`${describeCommand(cmd, ctx.tools)}\` deletes ${ids.map((i) => `\`${i}\``).join(', ')}; the earlier backup in step "${backups[0].info.stepName}" names another resource`
            : `\`${describeCommand(cmd, ctx.tools)}\` deletes data with no earlier snapshot or backup step`,
        ),
      );
    });
    return hits;
  },
};

const crontabMutation: OperationRule = {
  kind: 'operation',
  id: 'shell/crontab-mutation',
  tier: 2,
  defaultSeverity: 'off',
  presetSeverity: 'warning',
  inValidate: 'warning',
  description:
    '`crontab -r` or `crontab <file>` / `crontab -` (replace) with no earlier `crontab -l > <file>` backup.',
  check(ctx) {
    const all = forwardCommands(ctx);
    const hits: RuleHit[] = [];
    all.forEach(({ info, cmd }, k) => {
      if (cmd.executable !== 'crontab') return;
      const replaces =
        hasOption(cmd, '-r') ||
        (cmd.operands.length > 0 &&
          !hasOption(cmd, '-l') &&
          !hasOption(cmd, '-e'));
      if (!replaces) return;
      const backedUp = all
        .slice(0, k)
        .some(
          (e) =>
            e.cmd.executable === 'crontab' &&
            hasOption(e.cmd, '-l') &&
            e.cmd.redirects.some((r) => /^\d*>>?$/.test(r.op)),
        );
      if (backedUp) return;
      hits.push(
        commandHit(
          info,
          cmd,
          `\`crontab ${hasOption(cmd, '-r') ? '-r' : cmd.operands[0]}\` replaces the crontab with no earlier \`crontab -l > <file>\` backup`,
        ),
      );
    });
    return hits;
  },
};

const sedTarget = (cmd: NormalizedCommand): string | undefined =>
  cmd.executable === 'sed' &&
  (hasOption(cmd, '-i') || hasOption(cmd, '--in-place'))
    ? cmd.operands[cmd.operands.length - 1]
    : undefined;

const restoreAfterSed: OperationRule = {
  kind: 'operation',
  id: 'flow/restore-after-sed',
  tier: 3,
  defaultSeverity: 'off',
  presetSeverity: 'warning',
  inValidate: 'warning',
  description:
    '`sed -i` on a repository-relative file with no later `git restore` / `git checkout --` / `git stash` (in a later step or the rollback).',
  check(ctx) {
    const hits: RuleHit[] = [];
    const all = [
      ...forwardCommands(ctx),
      ...ctx.all
        .filter((i) => i.rollback)
        .flatMap((info) => info.commands.map((cmd) => ({ info, cmd }))),
    ];
    all.forEach(({ info, cmd }, k) => {
      const file = sedTarget(cmd);
      if (!file || file.startsWith('/') || file.startsWith('$')) return;
      const restored = all
        .slice(k + 1)
        .some(
          ({ cmd: c }) =>
            c.executable === 'git' &&
            (c.operands[0] === 'stash' ||
              ((c.operands[0] === 'restore' || c.operands[0] === 'checkout') &&
                c.operands
                  .slice(1)
                  .some(
                    (w) =>
                      w === '.' || w === file || baseName(w) === baseName(file),
                  ))),
        );
      if (restored) return;
      hits.push(
        commandHit(
          info,
          cmd,
          `\`sed -i\` edits \`${file}\` and no later step restores it (\`git restore ${file}\`)`,
        ),
      );
    });
    return hits;
  },
};

const CREDENTIAL_FILE =
  /(\.pem|\.key|\.p12|\.pfx|\.jks|credentials|\.netrc|id_rsa|id_ed25519|id_ecdsa|kubeconfig|token|secret)/i;
const PRIVATE_MODE = /^(0?[46]00|go-rwx|og-rwx|u=rw?,go=|u=rw?,g=,o=)$/;

/** Files a command writes: redirects, tee, cp/mv/install destination, -o/--output. */
function writtenFiles(cmd: NormalizedCommand): string[] {
  const files = cmd.redirects
    .filter((r) => /^\d*>>?$|^&>>?$|^>\|$/.test(r.op) && r.target)
    .map((r) => r.target);
  if (cmd.executable === 'tee') files.push(...cmd.operands);
  if (
    ['cp', 'mv', 'install'].includes(cmd.executable) &&
    cmd.operands.length > 1
  ) {
    files.push(cmd.operands[cmd.operands.length - 1]);
  }
  for (const o of cmd.options) {
    if (
      ['-o', '--output', '-out', '-O', '--output-document'].includes(o.name) &&
      o.value
    ) {
      files.push(o.value);
    }
  }
  return files.filter((f) => !f.startsWith('/dev/'));
}

const privateModeAfterWrite: OperationRule = {
  kind: 'operation',
  id: 'flow/chmod-600-credentials',
  tier: 3,
  defaultSeverity: 'off',
  presetSeverity: 'warning',
  inValidate: 'warning',
  description:
    'A credential-like file (key, `.pem`, kubeconfig, token, credentials, `.netrc`) written with no `chmod 600`/`400` on it afterwards (or `umask 077` before).',
  check(ctx) {
    const all = forwardCommands(ctx);
    const hits: RuleHit[] = [];
    all.forEach(({ info, cmd }, k) => {
      for (const file of writtenFiles(cmd)) {
        if (!CREDENTIAL_FILE.test(baseName(file))) continue;
        const before = all
          .slice(0, k)
          .some(
            (e) =>
              e.cmd.executable === 'umask' &&
              /^0?077$/.test(e.cmd.operands[0] ?? ''),
          );
        const after = all
          .slice(k)
          .some(
            ({ cmd: c }) =>
              (c.executable === 'chmod' &&
                PRIVATE_MODE.test(c.operands[0] ?? '') &&
                c.operands
                  .slice(1)
                  .some((w) => baseName(w) === baseName(file))) ||
              (c.executable === 'install' &&
                c.options.some(
                  (o) => o.name === '-m' && /^0?[46]00$/.test(o.value ?? ''),
                )),
          );
        if (before || after) continue;
        hits.push(
          commandHit(
            info,
            cmd,
            `\`${file}\` looks like a credential and is written with the default mode; \`chmod 600 ${file}\` after writing it`,
          ),
        );
      }
    });
    return hits;
  },
};

/** Files a command downloads (curl -o/-O, wget -O/URL, curl … > file). */
function downloadedFiles(cmd: NormalizedCommand): string[] {
  const url = cmd.operands.find((w) => /^https?:\/\//.test(w));
  if (cmd.executable === 'curl') {
    const out = cmd.options.find(
      (o) => o.name === '-o' || o.name === '--output',
    );
    if (out?.value) return [out.value];
    if ((hasOption(cmd, '-O') || hasOption(cmd, '--remote-name')) && url)
      return [baseName(url)];
    return cmd.redirects.filter((r) => /^>>?$/.test(r.op)).map((r) => r.target);
  }
  if (cmd.executable === 'wget') {
    const out = cmd.options.find(
      (o) => o.name === '-O' || o.name === '--output-document',
    );
    if (out?.value && out.value !== '-') return [out.value];
    return url ? [baseName(url)] : [];
  }
  return [];
}

const INTERPRETERS = new Set([
  'bash',
  'sh',
  'zsh',
  'dash',
  'source',
  '.',
  'python',
  'python3',
]);
const VERIFIERS = new Set([
  'sha256sum',
  'sha512sum',
  'shasum',
  'gpg',
  'cosign',
  'sha256',
]);

function executes(cmd: NormalizedCommand, file: string): boolean {
  const name = baseName(file);
  if (cmd.executable === name && cmd.executable !== '') return true;
  return (
    INTERPRETERS.has(cmd.executable) &&
    cmd.operands.some((w) => baseName(w) === name)
  );
}

const checksumBeforeExec: OperationRule = {
  kind: 'operation',
  id: 'flow/checksum-before-exec',
  tier: 3,
  defaultSeverity: 'off',
  presetSeverity: 'warning',
  inValidate: 'warning',
  description:
    'A downloaded file (curl -o/-O, wget) executed with no checksum or signature check (`sha256sum`, `shasum -a 256`, `gpg --verify`, `cosign verify`) in between.',
  check(ctx) {
    const all = forwardCommands(ctx);
    const hits: RuleHit[] = [];
    all.forEach(({ cmd }, k) => {
      for (const file of downloadedFiles(cmd)) {
        const rest = all.slice(k + 1);
        const run = rest.findIndex((e) => executes(e.cmd, file));
        if (run === -1) continue;
        const verified = rest
          .slice(0, run)
          .some(
            ({ cmd: c }) =>
              VERIFIERS.has(c.executable) &&
              (hasOption(c, '-c') ||
                hasOption(c, '--check') ||
                c.operands.some(
                  (w) => baseName(w) === baseName(file) || w === 'verify',
                )),
          );
        if (verified) continue;
        const target = rest[run];
        hits.push(
          commandHit(
            target.info,
            target.cmd,
            `runs downloaded \`${baseName(file)}\` without a checksum or signature check after the download`,
          ),
        );
      }
    });
    return hits;
  },
};

const cwdLost: OperationRule = {
  kind: 'operation',
  id: 'flow/cwd-lost',
  tier: 3,
  defaultSeverity: 'off',
  presetSeverity: 'warning',
  inValidate: 'warning',
  description:
    'A relative path (`./…`, `../…`) in a step running in a different `session:` from the step that `cd`-ed: the `cd` did not happen in this pane.',
  check(ctx) {
    const cdIn = new Map<string, StepInfo>();
    const hits: RuleHit[] = [];
    for (const info of ctx.forward) {
      const session = sessionOf(info) ?? '(default)';
      for (const cmd of info.commands) {
        if (cmd.context === 'top' && cmd.executable === 'cd') {
          cdIn.set(session, info);
          continue;
        }
        const relative = [cmd.program, ...cmd.operands].find(
          (w) => w.startsWith('./') || w.startsWith('../'),
        );
        if (!relative || cdIn.has(session)) continue;
        const other = [...cdIn.entries()].find(([s]) => s !== session);
        if (!other) continue;
        hits.push(
          commandHit(
            info,
            cmd,
            `\`${relative}\` is relative, but the \`cd\` in step "${other[1].stepName}" ran in session \`${other[0]}\`, not \`${session}\``,
          ),
        );
      }
    }
    return hits;
  },
};

const awsLocalSession: OperationRule = {
  kind: 'operation',
  id: 'flow/aws-local-session',
  tier: 3,
  defaultSeverity: 'off',
  presetSeverity: 'warning',
  inValidate: 'warning',
  description:
    'An `aws` command in a step whose session is not one of `lint.aws_sessions`; without that list, in a local session (no `host:`) while the operation declares a remote one.',
  check(ctx) {
    const sessions = ctx.operation.sessions ?? {};
    const allowed = ctx.config.aws_sessions;
    const remote = Object.entries(sessions)
      .filter(([, s]) => s?.host)
      .map(([n]) => n);
    if (allowed.length === 0 && remote.length === 0) return [];
    const hits: RuleHit[] = [];
    for (const info of ctx.all) {
      const aws = info.commands.find((c) => c.executable === 'aws');
      if (!aws) continue;
      const session = sessionOf(info);
      const ok =
        allowed.length > 0
          ? session !== undefined && allowed.includes(session)
          : session !== undefined && !!sessions[session]?.host;
      if (ok) continue;
      hits.push(
        commandHit(
          info,
          aws,
          `\`aws\` runs in ${session ? `session \`${session}\`` : 'the default (local) session'}; expected ${allowed.length > 0 ? allowed.join(' or ') : `a remote session (${remote.join(', ')})`}`,
        ),
      );
    }
    return hits;
  },
};

const inheritedSession: OperationRule = {
  kind: 'operation',
  id: 'compat/inherited-session',
  tier: 3,
  defaultSeverity: 'off',
  presetSeverity: 'warning',
  description:
    'A step with a command and no `session:` that now runs in a session it inherits (a sub-step from its nearest ancestor, a rollback entry from the step it undoes). Before sessions were inherited it ran in the default pane. An opt-in migration check: turn it on once to review every such step.',
  check(ctx) {
    const hits: RuleHit[] = [];
    for (const info of ctx.all) {
      if (info.onlyEnv !== undefined || info.step.session !== undefined) {
        continue;
      }
      const session = info.inheritedSession;
      if (session === undefined || !(info.text || info.step.script)) continue;
      const declaring = [...info.ancestors]
        .reverse()
        .find((a) => a.session !== undefined);
      const from = declaring
        ? `step "${stepDisplayName(declaring)}"`
        : info.owner
          ? `step "${stepDisplayName(info.owner)}", the step it rolls back`
          : 'an ancestor';
      hits.push(
        hit(
          info,
          `runs in session \`${session}\`, inherited from ${from}; before sessions were inherited it ran in the default pane. Check \`${session}\` is right, then write \`session: ${session}\` on it (or keep it inherited and turn this rule off)`,
        ),
      );
    }
    return hits;
  },
};

export const FLOW_RULES: OperationRule[] = [
  forwardVar,
  unproducedCapture,
  captureGroupOob,
  sessionUndeclared,
  mutateWithoutVerify,
  noRollbackOnMutate,
  stsBeforeMutate,
  waitAfterAsync,
  backupBeforeDelete,
  crontabMutation,
  restoreAfterSed,
  privateModeAfterWrite,
  checksumBeforeExec,
  cwdLost,
  awsLocalSession,
  inheritedSession,
];
