# Linting

`samaritan validate` answers **"can this operation run?"**: the schema, the
variables, the step references. `samaritan lint` answers **"should it be
written this way?"**. It checks each step's command against named rules, with a
severity your team can change per rule.

```bash
samaritan lint ops/release.yaml               # one file
samaritan lint ops/*.yaml --max-warnings 0    # CI: fail on any finding
samaritan lint ops/release.yaml --format json # for tooling
samaritan lint --list-rules                   # every rule, default severity, tier
```

```text
ops/release.yaml
  error    shell/exit-verbs    step "Clean up" (line 2): `exit` ends the operation shell; fail with a non-zero command (`false`) or move the logic into a `script:`
  warning  git/protected-push  step "Push release": `git push` targets protected branch 'main'

✖ 2 problems (1 error, 1 warning)
```

## Exit codes

| Exit | Meaning |
| --- | --- |
| `0` | No error-severity findings. Warnings may be present. |
| `1` | At least one error-severity finding, or more warnings than `--max-warnings`. |
| `2` | A file could not be linted: not found, does not parse, or its lint config is invalid. The other files are still linted and reported. |

## What `validate` shows

`validate` runs the same **command** rules and prints their findings as
warnings, prefixed `lint [<rule id>]:`. They never fail `validate` and never
change its exit code, even under `--strict`. Rules your config turns `off`
stay off there too. A broken `lint:` section is reported as
`lint config ignored: …` and the defaults are used.

The other rules `samaritan lint` lists (`expect/*`, `deps/*`,
`steps/duplicate-id`, …) are the checks `validate` already ran before
`lint` existed. `lint` gives them a rule id and a severity; `validate`
reports them exactly as before.

## What the rules look at

Each rule reads the step's inline `command:` (forward steps, sub-steps, a
step's `rollback`, and the operation's `rollback.steps`). A `script:` file runs
in a child shell, so `exit` or `set -e` there is normal error handling: scripts
go to shellcheck (`validate --lint`, or the `shell/shellcheck` rule), not to
the command rules.

The command is parsed, not searched as text:

- `&&`, `||`, `|`, `;` and each new line start a new command; a `\` at the end
  of a line continues it. `# comments` are dropped.
- Commands inside `$( … )` are checked too, also inside double quotes.
- Leading `NAME=value` assignments, redirects (`2>&1`), and wrappers (`sudo`,
  `env`, `exec`, `timeout`, …) are separated from the command they apply to.
- `--flag=value` is split, and for tools that allow it `-Av` means `-A -v`.
- Nothing is expanded: `$VAR`, `${VAR}` and `${VAR:?msg}` stay literal, so
  the result is the same on every machine and in every directory.

Syntax the parser cannot analyse is reported as `analysis/unsupported`
(heredoc, process substitution `<( )`, backticks, `case`, function
definitions), never skipped silently. Lines after a heredoc's `<<` are not
checked.

`echo git push origin HEAD:main` is an `echo`, not a push: only the command a
line actually runs is matched.

## Tiers: how sure a rule is

Each rule has a tier. Config can change a rule's severity, never its tier.

| Tier | Claim | Examples |
| --- | --- | --- |
| 1 | The shape is in the command, exactly. Whether that is a defect may be team policy. | `shell/exit-verbs`, `shell/errexit`, `tmux/kill-commands`, `cmd/banned` |
| 2 | A reliable signal from an analysis with known gaps. | `var/colon-unresolved`, `analysis/unsupported`, `expect/token-from-command` |
| 3 | A heuristic: the pattern is present. A review tripwire, not a verdict. | `git/protected-push` |

A clean `lint` means no finding from the enabled rules. It does not mean the
operation cannot fail.

The full list, generated from the code, is on [Lint rules](/reference/lint-rules).

## Team config: `samaritan.config.yaml`

`lint` and `validate` read the nearest `samaritan.config.yaml` at or above the
operation file. The global `--config <path>` option, when you give it, is used
instead. Only the `lint:` section matters here:

```yaml
lint:
  rules:                         # off | warning | error, per rule id
    git/protected-push: error
    analysis/unsupported: off

  protected_branches: [main, release]   # for git/protected-push (default: main, master)

  banned:                        # → cmd/banned
    - pattern: 'git add -A'
      message: stage explicit paths
    - pattern: 'AWS_PAGER='      # matches the assignment, any value
      message: use --no-cli-pager instead

  required:                      # → cmd/required-flag
    - pattern: 'kubectl *'
      flags: ['--context']
      message: name the cluster explicitly
```

An unknown key, an unknown rule id, a severity other than `off` / `warning` /
`error`, or a pattern that is not a single command is a config error (`lint`
exits `2`).

### How a pattern matches

A pattern is parsed like a command. A command matches when it has:

- the same program (after wrappers such as `sudo`),
- every assignment in the pattern (`AWS_PAGER=` matches any value),
- every option in the pattern, anywhere in the command (`-A` matches
  `git add -Av` and `git add file -A`; `--max-results` matches
  `--max-results=1`),
- the pattern's other words, in order, at the start of the command's
  (`kubectl delete namespace` matches `kubectl delete namespace web -n x`).

`*` stands for exactly one word, never part of one: `aws *` matches any `aws`
command with a subcommand, `aws s3*` matches nothing.

## `git/protected-push` in detail

It reads the destination of each refspec: `HEAD:main`, `+HEAD:main`,
`HEAD:refs/heads/main`, `:main` (delete) and `--delete origin main` all target
`main`. `--all` and `--mirror` push every branch, so they always fire. With a
single word after `push` that word is the remote (`git push main` pushes to a
remote named `main`). Global options are skipped with their values
(`git -C main push origin feature` does not fire). It also looks one level
inside `bash -c '…'`, `ssh host '…'` and `eval`.

It does not resolve variables: `git push origin HEAD:${TARGET}` is not
flagged.

## Not implemented yet

- `line:col` positions in findings, and `# samaritan-lint-disable` comments.
  Until then, turn a rule `off` in the config.
- Rules across steps (a variable used before the step that captures it, a
  mutating step without verification) and rules comparing `expect` with the
  command's output format.
- Shared presets (`extends:`).

See the [ROADMAP](https://github.com/eric4545/samaritan/blob/main/ROADMAP.md).
