import { awsOperation, shellVarsIn } from './classify';
import {
  compilePattern,
  hasOption,
  matchesPattern,
  type NormalizedCommand,
  normalizeCommand,
} from './command-model';
import {
  type CommandRule,
  type CommandRuleContext,
  commandHit,
  type RuleHit,
  stepAt,
} from './rule-types';
import { parseShell } from './shell-lexer';

// ── shell ───────────────────────────────────────────────────────────────────

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
        hits.push(
          commandHit(
            ctx,
            cmd,
            `\`${cmd.executable}\` ends the operation shell; fail with a non-zero command (\`false\`) or move the logic into a \`script:\``,
          ),
        );
      } else if (cmd.wrappers.includes('exec') && cmd.executable) {
        hits.push(
          commandHit(
            ctx,
            cmd,
            `\`exec ${cmd.executable}\` replaces the operation shell; when it ends, the pane's shell is gone`,
          ),
        );
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
        const on = new Set<string>();
        for (const o of cmd.options) {
          if (o.name === '-e') on.add('-e');
          if (o.name === '-u') on.add('-u');
          if (
            o.name === '-o' &&
            (o.value === 'errexit' || o.value === 'nounset')
          )
            on.add(`-o ${o.value}`);
        }
        if (on.size > 0) {
          hits.push(
            commandHit(
              ctx,
              cmd,
              `\`set ${[...on].join(' ')}\` stays on in the operation shell; with errexit a failing command in a later step closes it. Check the status in the command (\`cmd || …\`) or use a \`script:\``,
            ),
          );
        }
      }
      if (
        cmd.executable === 'trap' &&
        cmd.operands[0] !== '-' &&
        cmd.operands.slice(1).some((s) => ['EXIT', '0', 'SIGEXIT'].includes(s))
      ) {
        hits.push(
          commandHit(
            ctx,
            cmd,
            '`trap … EXIT` stays set in the operation shell and runs when that shell exits, not when this step ends',
          ),
        );
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
    'A password on the command line (`--password=<value>`, `mysql -p<value>`). A bare `-p` / `--password` prompts and does not fire.',
  check(ctx) {
    const hits: RuleHit[] = [];
    for (const cmd of ctx.commands) {
      const shown = cmd.options.find(
        (o) =>
          (o.name === '--password' && o.value) ||
          (o.name === '-p' && o.value && MYSQL_FAMILY.has(cmd.executable)),
      );
      if (!shown) continue;
      const form = shown.name === '-p' ? '-p<value>' : '--password=<value>';
      hits.push(
        commandHit(
          ctx,
          cmd,
          `\`${cmd.executable} ${form}\` puts the password in the process list, shell history and the run's captured output; let the tool prompt or read it from a file`,
        ),
      );
    }
    return hits;
  },
};

const envEcho: CommandRule = {
  kind: 'command',
  id: 'shell/env-echo',
  tier: 2,
  defaultSeverity: 'off',
  presetSeverity: 'warning',
  inValidate: 'warning',
  description:
    '`env`, `printenv`, `set` or `export -p` printing every variable (secrets included) into the pane and the run evidence.',
  check(ctx) {
    const hits: RuleHit[] = [];
    for (const cmd of ctx.commands) {
      const all =
        (cmd.executable === 'env' &&
          cmd.operands.length === 0 &&
          cmd.assignments.length === 0) ||
        (cmd.executable === 'printenv' && cmd.operands.length === 0) ||
        (cmd.executable === 'set' &&
          cmd.options.length === 0 &&
          cmd.operands.length === 0) ||
        (cmd.executable === 'export' && hasOption(cmd, '-p')) ||
        (cmd.executable === 'declare' && hasOption(cmd, '-x'));
      // `env` alone is unwrapped as a wrapper with nothing after it.
      const bareEnv =
        cmd.executable === '' &&
        cmd.wrappers[cmd.wrappers.length - 1] === 'env' &&
        cmd.assignments.length === 0;
      if (!all && !bareEnv) continue;
      hits.push(
        commandHit(
          ctx,
          cmd,
          `\`${cmd.executable || 'env'}${cmd.options[0] ? ` ${cmd.options[0].name}` : ''}\` prints every variable, secrets included, into the pane and the captured evidence; print the one you need`,
        ),
      );
    }
    return hits;
  },
};

const unguardedRmRf: CommandRule = {
  kind: 'command',
  id: 'shell/unguarded-rm-rf',
  tier: 2,
  defaultSeverity: 'off',
  presetSeverity: 'warning',
  inValidate: 'warning',
  description:
    '`rm -rf` on a path built from a shell variable with no guard: no `${VAR:?}` and no `[ -n "$VAR" ] &&` (or `test -n`, `[ -d … ]`) right before it.',
  check(ctx) {
    const hits: RuleHit[] = [];
    ctx.commands.forEach((cmd, k) => {
      if (cmd.executable !== 'rm') return;
      const recursive =
        hasOption(cmd, '-r') ||
        hasOption(cmd, '-R') ||
        hasOption(cmd, '--recursive');
      const force = hasOption(cmd, '-f') || hasOption(cmd, '--force');
      if (!recursive || !force) return;
      const prev = ctx.commands[k - 1];
      for (const operand of cmd.operands) {
        if (/\$\{\w+:\?/.test(operand)) continue;
        for (const name of shellVarsIn(operand, ctx.declaredVariables)) {
          const guarded =
            cmd.prefix === '&&' &&
            prev !== undefined &&
            ['[', '[[', 'test'].includes(prev.executable) &&
            [...prev.operands, ...prev.options.map((o) => o.value ?? '')].some(
              (w) => w.includes(name),
            );
          if (guarded) continue;
          hits.push(
            commandHit(
              ctx,
              cmd,
              `\`rm -rf ${operand}\`: if \`${name}\` is empty or unset this deletes from the wrong place; guard it (\`\${${name}:?}\` or \`[ -n "$${name}" ] &&\`)`,
            ),
          );
        }
      }
    });
    return hits;
  },
};

// ── tmux ────────────────────────────────────────────────────────────────────

/** tmux commands sharing a first letter with the commands rules look for. */
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
  'send-keys',
  'send-prefix',
  'server-access',
  'set-buffer',
  'set-environment',
  'set-hook',
  'set-option',
  'set-window-option',
  'show-buffer',
  'show-environment',
  'show-hooks',
  'show-messages',
  'show-options',
  'show-prompt-history',
  'show-window-options',
  'source-file',
  'split-window',
  'start-server',
  'suspend-client',
  'swap-pane',
  'swap-window',
  'switch-client',
  'paste-buffer',
  'pipe-pane',
  'previous-layout',
  'previous-window',
  'list-buffers',
  'list-clients',
  'list-commands',
  'list-keys',
  'list-panes',
  'list-sessions',
  'list-windows',
  'load-buffer',
  'lock-client',
  'lock-server',
  'lock-session',
  'last-pane',
  'last-window',
  'link-window',
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
  send: 'send-keys',
  setb: 'set-buffer',
  pasteb: 'paste-buffer',
  loadb: 'load-buffer',
  pipep: 'pipe-pane',
  splitw: 'split-window',
  switchc: 'switch-client',
  lsp: 'list-panes',
  ls: 'list-sessions',
};
const TMUX_KILL = new Set([
  'kill-pane',
  'kill-server',
  'kill-session',
  'kill-window',
  'detach-client',
]);
const TMUX_INPUT = new Set([
  'send-keys',
  'set-buffer',
  'paste-buffer',
  'load-buffer',
]);

/** Resolve a tmux command word: alias, exact name, or unique prefix. */
export function resolveTmuxCommand(word: string): string | undefined {
  if (TMUX_ALIASES[word]) return TMUX_ALIASES[word];
  if (TMUX_COMMANDS.includes(word)) return word;
  const matches = TMUX_COMMANDS.filter((c) => c.startsWith(word));
  return matches.length === 1 ? matches[0] : undefined;
}

/** Every tmux command in one invocation (`tmux a \; b`). */
function tmuxCommands(
  cmd: NormalizedCommand,
): { written: string; resolved: string }[] {
  if (cmd.executable !== 'tmux') return [];
  const heads = [cmd.operands[0]];
  cmd.operands.forEach((w, k) => {
    if (w === ';' && cmd.operands[k + 1]) heads.push(cmd.operands[k + 1]);
  });
  return heads.flatMap((head) => {
    const resolved = head ? resolveTmuxCommand(head) : undefined;
    return resolved ? [{ written: head, resolved }] : [];
  });
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
    return ctx.commands.flatMap((cmd) =>
      tmuxCommands(cmd)
        .filter((c) => TMUX_KILL.has(c.resolved))
        .map((c) =>
          commandHit(
            ctx,
            cmd,
            `\`tmux ${c.resolved}\`${c.written === c.resolved ? '' : ` (written \`${c.written}\`)`} can close the operator's own pane or session`,
          ),
        ),
    );
  },
};

const tmuxInput: CommandRule = {
  kind: 'command',
  id: 'tmux/input-injection',
  tier: 1,
  defaultSeverity: 'off',
  presetSeverity: 'error',
  inValidate: 'warning',
  description:
    '`tmux send-keys|set-buffer|paste-buffer|load-buffer` (and aliases): typing into panes from a step bypasses the sidecar, which is the only input path the run records.',
  check(ctx) {
    return ctx.commands.flatMap((cmd) =>
      tmuxCommands(cmd)
        .filter((c) => TMUX_INPUT.has(c.resolved))
        .map((c) =>
          commandHit(
            ctx,
            cmd,
            `\`tmux ${c.resolved}\` types into a pane outside the sidecar; the run does not record it. Let the operator paste with [p]`,
          ),
        ),
    );
  },
};

// ── ssh / curl ──────────────────────────────────────────────────────────────

const sshOneShot: CommandRule = {
  kind: 'command',
  id: 'ssh/one-shot',
  tier: 2,
  defaultSeverity: 'off',
  presetSeverity: 'warning',
  inValidate: 'warning',
  description:
    "`ssh host 'cmd'`: the remote command runs outside the operation's sessions, so its pane, capture and evidence are not the session's. Declare a `sessions:` entry with `host:` instead.",
  check(ctx) {
    return ctx.commands
      .filter((cmd) => cmd.executable === 'ssh' && cmd.operands.length > 1)
      .map((cmd) =>
        commandHit(
          ctx,
          cmd,
          `\`ssh ${cmd.operands[0]} '…'\` runs a one-shot remote command outside the declared sessions; use a \`sessions:\` entry with \`host:\` and \`session:\` on the step`,
        ),
      );
  },
};

const curlFail: CommandRule = {
  kind: 'command',
  id: 'curl/require-fail',
  tier: 2,
  defaultSeverity: 'off',
  presetSeverity: 'warning',
  inValidate: 'warning',
  description:
    '`curl` without `-f` / `--fail` / `--fail-with-body` exits 0 on an HTTP 4xx/5xx, so the step looks fine.',
  check(ctx) {
    return ctx.commands
      .filter(
        (cmd) =>
          cmd.executable === 'curl' &&
          !['-f', '--fail', '--fail-with-body'].some((f) => hasOption(cmd, f)),
      )
      .map((cmd) =>
        commandHit(
          ctx,
          cmd,
          '`curl` without `--fail` exits 0 on HTTP errors (404, 500); the step passes on an error page',
        ),
      );
  },
};

// ── git ─────────────────────────────────────────────────────────────────────

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
  // push <remote> <refspec>…; one operand alone is the remote.
  const hits: string[] = [];
  for (const raw of cmd.operands.slice(2)) {
    const spec = raw.startsWith('+') ? raw.slice(1) : raw;
    const colon = spec.lastIndexOf(':');
    let dst = colon === -1 ? spec : spec.slice(colon + 1);
    if (dst.includes('$')) continue; // interpolated: not resolved, by design
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
    const visit = (cmd: NormalizedCommand, line: number, via?: string) => {
      const targets = protectedPushTargets(cmd, branches);
      if (targets.length === 0) return;
      const flag = hasOption(cmd, '--all')
        ? '--all'
        : hasOption(cmd, '--mirror')
          ? '--mirror'
          : undefined;
      const how = flag
        ? `\`git push ${flag}\` also pushes protected branches (${targets.join(', ')})`
        : `\`git push\` targets protected branch${targets.length > 1 ? 'es' : ''} ${targets.map((t) => `'${t}'`).join(', ')}`;
      hits.push(
        commandHit(ctx, { line }, `${how}${via ? ` (inside \`${via}\`)` : ''}`),
      );
    };
    for (const cmd of ctx.commands) {
      visit(cmd, cmd.line);
      const inner = nestedCommandText(cmd);
      if (!inner) continue;
      for (const nested of parseShell(inner).commands) {
        visit(normalizeCommand(nested), cmd.line, cmd.executable);
      }
    }
    return hits;
  },
};

const explicitStaging: CommandRule = {
  kind: 'command',
  id: 'git/explicit-staging',
  tier: 1,
  defaultSeverity: 'off',
  presetSeverity: 'error',
  inValidate: 'warning',
  description:
    '`git add -A` / `--all` / `.` / `<dir>/`: stages everything under it, including files nobody meant to commit.',
  check(ctx) {
    const hits: RuleHit[] = [];
    for (const cmd of ctx.commands) {
      if (cmd.executable !== 'git' || cmd.operands[0] !== 'add') continue;
      const broad = [
        ...(hasOption(cmd, '-A') ? ['-A'] : []),
        ...(hasOption(cmd, '--all') ? ['--all'] : []),
        ...cmd.operands
          .slice(1)
          .filter((w) => w === '.' || w === '*' || w.endsWith('/')),
      ];
      if (broad.length === 0) continue;
      hits.push(
        commandHit(
          ctx,
          cmd,
          `\`git add ${broad.join(' ')}\` stages everything under it; name the files`,
        ),
      );
    }
    return hits;
  },
};

const noVerify: CommandRule = {
  kind: 'command',
  id: 'git/no-verify',
  tier: 1,
  defaultSeverity: 'off',
  presetSeverity: 'error',
  inValidate: 'warning',
  description:
    '`git … --no-verify` (or `git commit -n`) skips the repository hooks (secret scanning, lint).',
  check(ctx) {
    return ctx.commands
      .filter(
        (cmd) =>
          cmd.executable === 'git' &&
          (hasOption(cmd, '--no-verify') ||
            (cmd.operands[0] === 'commit' && hasOption(cmd, '-n'))),
      )
      .map((cmd) =>
        commandHit(
          ctx,
          cmd,
          `\`git ${cmd.operands[0]} --no-verify\` skips the repository's hooks`,
        ),
      );
  },
};

// ── aws / kubectl ───────────────────────────────────────────────────────────

const awsNoPager: CommandRule = {
  kind: 'command',
  id: 'aws/no-pager',
  tier: 1,
  defaultSeverity: 'error',
  inValidate: 'warning',
  description:
    'An `aws` command without `--no-cli-pager` (and no `AWS_PAGER=""`) opens a pager in the pane and waits for a key.',
  check(ctx) {
    const hits: RuleHit[] = [];
    for (const cmd of ctx.commands) {
      if (cmd.executable !== 'aws' || cmd.operands.length === 0) continue;
      if (['configure', 'help'].includes(cmd.operands[0])) continue;
      if (hasOption(cmd, '--no-cli-pager')) continue;
      if (cmd.assignments.some((a) => a.name === 'AWS_PAGER' && a.value === ''))
        continue;
      hits.push(
        commandHit(
          ctx,
          cmd,
          `\`aws ${cmd.operands.slice(0, 2).join(' ')}\` without \`--no-cli-pager\` opens a pager in the pane and waits for \`q\``,
        ),
      );
    }
    return hits;
  },
};

const awsMaxResults: CommandRule = {
  kind: 'command',
  id: 'aws/max-results',
  tier: 1,
  defaultSeverity: 'error',
  inValidate: 'warning',
  description:
    '`aws … --max-results` returns one page: the step sees only the first N items and the check passes on a partial list.',
  check(ctx) {
    return ctx.commands
      .filter(
        (cmd) => cmd.executable === 'aws' && hasOption(cmd, '--max-results'),
      )
      .map((cmd) =>
        commandHit(
          ctx,
          cmd,
          '`--max-results` returns one page only; the step sees a partial list',
        ),
      );
  },
};

const awsRegion: CommandRule = {
  kind: 'command',
  id: 'aws/region-required',
  tier: 1,
  defaultSeverity: 'off',
  presetSeverity: 'error',
  inValidate: 'warning',
  description:
    'An `aws` command without `--region` (or an `AWS_REGION=` / `AWS_DEFAULT_REGION=` assignment) runs in whatever region the shell has configured.',
  check(ctx) {
    return ctx.commands
      .filter(
        (cmd) =>
          cmd.executable === 'aws' &&
          cmd.operands.length > 0 &&
          !['configure', 'help'].includes(cmd.operands[0]) &&
          !hasOption(cmd, '--region') &&
          !cmd.assignments.some((a) =>
            ['AWS_REGION', 'AWS_DEFAULT_REGION'].includes(a.name),
          ),
      )
      .map((cmd) =>
        commandHit(
          ctx,
          cmd,
          `\`aws ${cmd.operands.slice(0, 2).join(' ')}\` without \`--region\` uses the shell's configured region`,
        ),
      );
  },
};

/** `aws <svc> create-*` operations that are operational actions, not resources. */
export const AWS_CREATE_ALLOWLIST = [
  'create-snapshot',
  'create-snapshots',
  'create-db-snapshot',
  'create-db-cluster-snapshot',
  'create-cluster-snapshot',
  'create-backup',
  'create-tags',
  'create-application-version',
  'create-user',
  'create-login-profile',
  'create-invalidation',
  'create-image',
];

const awsCreateManaged: CommandRule = {
  kind: 'command',
  id: 'aws/cli-create-managed',
  tier: 1,
  defaultSeverity: 'error',
  inValidate: 'warning',
  description:
    '`aws <service> create-*` outside the operational-action allowlist (snapshots, tags, backups, application versions, human IAM users; `lint.aws_create_allowlist` adds more). CloudFormation itself is exempt. Whether the resource belongs in infrastructure code is a review call.',
  check(ctx) {
    const allow = new Set([
      ...AWS_CREATE_ALLOWLIST,
      ...ctx.config.aws_create_allowlist,
    ]);
    return ctx.commands
      .filter((cmd) => {
        const op = awsOperation(cmd);
        return (
          op.startsWith('create-') &&
          cmd.operands[0] !== 'cloudformation' &&
          !allow.has(op)
        );
      })
      .map((cmd) =>
        commandHit(
          ctx,
          cmd,
          `\`aws ${cmd.operands[0]} ${awsOperation(cmd)}\` creates a resource by hand, outside infrastructure code; allowlisted operational creates are listed in \`lint.aws_create_allowlist\``,
        ),
      );
  },
};

const CLUSTER_SCOPED = new Set([
  'ns',
  'namespace',
  'namespaces',
  'pv',
  'persistentvolume',
  'persistentvolumes',
  'no',
  'node',
  'nodes',
  'clusterrole',
  'clusterroles',
  'clusterrolebinding',
  'clusterrolebindings',
  'crd',
  'crds',
  'customresourcedefinition',
  'customresourcedefinitions',
  'sc',
  'storageclass',
  'storageclasses',
]);

const kubectlDeleteClusterScoped: CommandRule = {
  kind: 'command',
  id: 'kubectl/delete-ns',
  tier: 3,
  defaultSeverity: 'warning',
  inValidate: 'warning',
  description:
    '`kubectl delete` of a cluster-scoped kind (namespace, persistent volume, node, cluster role, CRD, storage class): it takes everything under it along.',
  check(ctx) {
    const hits: RuleHit[] = [];
    for (const cmd of ctx.commands) {
      if (
        !['kubectl', 'oc'].includes(cmd.executable) ||
        cmd.operands[0] !== 'delete'
      )
        continue;
      const kinds = (cmd.operands[1] ?? '')
        .split(',')
        .map((k) => k.split('/')[0].split('.')[0].toLowerCase());
      const hit = kinds.find((k) => CLUSTER_SCOPED.has(k));
      if (!hit) continue;
      hits.push(
        commandHit(
          ctx,
          cmd,
          `\`kubectl delete ${cmd.operands[1]}\` deletes a cluster-scoped object and everything that depends on it`,
        ),
      );
    }
    return hits;
  },
};

// ── variables, style, data lists ────────────────────────────────────────────

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
      const line = ctx.text.slice(0, m.index).split('\n').length;
      hits.push(
        commandHit(
          ctx,
          { line },
          `\`${m[0]}…}\` is not substituted: ${name} is an operation variable, but SAMARITAN only replaces \`\${${name}}\`; the shell reads its own ${name}`,
        ),
      );
    }
    return hits;
  },
};

/** Shell builtins and common tools for `cmd/unknown-binary`. */
const KNOWN_BINARIES = new Set(
  `[ [[ . : alias bg cd command declare echo eval exec exit export false fg getopts hash jobs kill let local logout popd printf pushd pwd read readonly return set shift shopt source test time times trap true type typeset ulimit umask unalias unset wait
ls cat grep egrep fgrep sed awk cut tr sort uniq head tail wc tee xargs find mkdir rm rmdir cp mv ln chmod chown chgrp touch date env sudo doas ssh scp sftp rsync curl wget jq yq git kubectl oc helm docker podman aws gcloud gsutil az terraform tofu tmux psql pg_dump pg_dumpall pg_restore mysql mysqldump mariadb redis-cli mongosh mongodump nc ncat telnet ping traceroute dig nslookup host openssl tar gzip gunzip zip unzip bzip2 xz base64 sha256sum sha1sum shasum md5sum diff patch make python python3 pip pip3 node npm npx yarn pnpm java go cargo bash sh zsh dash systemctl journalctl service ps pgrep pkill killall top htop df du free uptime hostname whoami id stat file less more vi vim nano watch timeout nohup nice basename dirname realpath readlink seq yes printenv sleep tput clear crontab at logger lsof netstat ss ip ifconfig route iptables mount umount lsblk blkid fdisk mkfs dmesg uname which whereis tree column paste join comm split strings od xxd hexdump iconv envsubst gpg cosign velero kubectx kubens k9s stern eksctl kustomize skaffold argocd vault consul nomad packer ansible ansible-playbook samaritan`.split(
    /\s+/,
  ),
);

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return dp[b.length];
}

const unknownBinary: CommandRule = {
  kind: 'command',
  id: 'cmd/unknown-binary',
  tier: 2,
  defaultSeverity: 'off',
  presetSeverity: 'warning',
  inValidate: 'warning',
  description:
    'A program that is neither a shell builtin, a common tool, nor listed in `lint.known_binaries` (catches typos such as `kubeclt`). Paths and `$VAR` programs are skipped.',
  check(ctx) {
    const known = new Set([...KNOWN_BINARIES, ...ctx.config.known_binaries]);
    const hits: RuleHit[] = [];
    for (const cmd of ctx.commands) {
      const exe = cmd.executable;
      if (!exe || known.has(exe) || exe.includes('$') || exe.includes('…'))
        continue;
      if (cmd.program.includes('/')) continue;
      const near = [...known].find(
        (k) => k.length > 2 && editDistance(k, exe) <= 2,
      );
      hits.push(
        commandHit(
          ctx,
          cmd,
          `unknown program \`${exe}\`${near ? ` (did you mean \`${near}\`?)` : ''}; add it to \`lint.known_binaries\` if it is right`,
        ),
      );
    }
    return hits;
  },
};

const fullWidthSpace: CommandRule = {
  kind: 'command',
  id: 'style/full-width-space',
  tier: 3,
  defaultSeverity: 'off',
  presetSeverity: 'warning',
  inValidate: 'warning',
  description:
    'A full-width space (U+3000) in a command: the shell reads it as part of a word, not as a separator.',
  check(ctx) {
    const hits: RuleHit[] = [];
    ctx.text.split('\n').forEach((line, k) => {
      if (line.includes('　')) {
        hits.push(
          commandHit(
            ctx,
            { line: k + 1 },
            'full-width space (U+3000) in the command; the shell does not split on it',
          ),
        );
      }
    });
    return hits;
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
        hits.push(
          commandHit(
            ctx,
            cmd,
            `matches banned \`${entry.pattern}\`${entry.message ? `: ${entry.message}` : ''}`,
          ),
        );
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
        hits.push(
          commandHit(
            ctx,
            cmd,
            `missing ${missing.join(', ')} (required for \`${entry.pattern}\`)${entry.message ? `: ${entry.message}` : ''}`,
          ),
        );
      }
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
  check(ctx: CommandRuleContext) {
    if (ctx.unsupported.length === 0) return [];
    const notes = ctx.unsupported.map((u) =>
      u === 'heredoc' ? 'heredoc (lines after `<<` are skipped)' : u,
    );
    return [
      {
        message: `${stepAt(ctx)}: not fully analysed: ${notes.join(', ')}`,
        step: ctx.step,
        field: 'command',
      },
    ];
  },
};

export const COMMAND_RULES: CommandRule[] = [
  exitVerbs,
  errexit,
  passwordOnCmdline,
  envEcho,
  unguardedRmRf,
  tmuxKill,
  tmuxInput,
  sshOneShot,
  curlFail,
  protectedPush,
  explicitStaging,
  noVerify,
  awsNoPager,
  awsMaxResults,
  awsRegion,
  awsCreateManaged,
  kubectlDeleteClusterScoped,
  colonUnresolved,
  unknownBinary,
  fullWidthSpace,
  banned,
  requiredFlags,
  unsupported,
];
