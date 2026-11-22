# Linting

`samaritan validate` answers **"can this operation run?"**: the schema, the
variables, the step references. `samaritan lint` answers **"should it be
written this way?"**. It checks each operation against named rules, each with
a severity your team can change and a tier that says how sure the rule is.

```bash
samaritan lint ops/release.yaml               # one file
samaritan lint ops/*.yaml --max-warnings 0    # CI: fail on any finding
samaritan lint ops/release.yaml --strict      # the strict profile
samaritan lint ops/release.yaml --format json # for tooling
samaritan lint --list-rules                   # every rule, its levels and tier
```

```text
ops/release.yaml
  19:7                  error    shell/exit-verbs    step "Clean up" (line 2): `exit` ends the operation shell; fail with a non-zero command (`false`) or move the logic into a `script:`
  43:14                 warning  git/protected-push  step "Push release": `git push` targets protected branch 'main'
  common/steps.yaml:6:5 error    aws/no-pager        step "Describe": `aws cloudformation describe-stacks` without `--no-cli-pager` opens a pager in the pane and waits for `q`

✖ 3 problems (2 errors, 1 warning)
```

Each finding has a position: `line:column` in the operation file, or
`file:line:column` when the step comes from a `uses:` file (a remote one
included: the copy the parser fetched is used, never fetched again). A step expanded
from `foreach` / `matrix` points at the entry you wrote.

## Exit codes

| Exit | Meaning |
| --- | --- |
| `0` | No error-severity findings. Warnings may be present. |
| `1` | At least one error-severity finding, or more warnings than `--max-warnings`. |
| `2` | A file could not be linted: not found, does not parse, its lint config is invalid, or a rule crashed on it (`rule <id> failed: …`). The other files are still linted and reported. Bad usage (`--format xml`, `--max-warnings -1`, no file) also exits `2`. |

When `shell/shellcheck` is on but shellcheck is not installed, the file gets a
`notice` and the rule is skipped; the exit code does not change.

`--format json` follows
[`src/schemas/lint-report.schema.json`](https://github.com/eric4545/samaritan/blob/main/src/schemas/lint-report.schema.json):
keys are added, never removed or renamed.

## What the rules look at

There are three families of rules, a check on instruction prose, plus the
checks `validate` already did, now under rule ids. The full list, generated from the code, is on
[Lint rules](/reference/lint-rules).

| Family | Looks at | Examples |
| --- | --- | --- |
| The command itself | One step's `command`, parsed | `shell/exit-verbs`, `shell/errexit`, `tmux/kill-commands`, `git/protected-push`, `aws/no-pager`, `cmd/banned` |
| Between steps | The steps in run order, per environment | `flow/forward-var`, `flow/unproduced-capture`, `flow/session-undeclared`, `flow/mutate-without-verify` |
| `expect` vs the command | The check against the output the command declares | `expect/json-shape`, `expect/contains-vs-matches`, `expect/multiline-contains` |
| The instruction prose | Each step's `instruction` text, line by line | `instruction/vague-decision` |
| Existing checks | What `validate` reported before `lint` existed | `expect/invalid-regex`, `deps/cycle`, `steps/duplicate-id`, `vars/undefined` |
| Fields that do nothing | Keys the parser accepts but nothing reads | `schema/unknown-key`, `compat/unused-field`, `compat/discarded-verify`, `compat/common-variables` (opt-in) |

Rules read the steps, sub-steps, each step's `variants.<env>` (its command
and its rollback list, reported as `<step> [variants.<env>]`), each step's
`rollback` and the operation's `rollback.steps`. A `script:` file runs in a child shell, so `exit` or
`set -e` there is normal error handling: scripts go to shellcheck
(`validate --lint`, or the `shell/shellcheck` rule), not to the command rules.

`schema/unknown-key` warns about a top-level key samaritan does not read:
a typo such as `rolback:` or `variabels:` used to pass `validate` and silently
drop the rollback plan or the variables. It suggests the key you probably
meant (`did you mean \`rollback\`?`). Keys starting with `x-` are allowed, for
a block that only holds YAML anchors or notes (`x-anchors:`).

`compat/unused-field` warns about step fields that are accepted but change
nothing: `retry:` on a step (samaritan never re-runs a command; to poll until a
check passes, use `expect.retry`), `manual_override`, `manual_instructions`,
and every `approval` key other than `required` (`approvers`, `timeout`, …;
name the approver in `reviewer:`), plus the top-level `tags`, `matrix`,
`reporting` and `last_executed`, which the parser stores and nothing uses (to
repeat steps per region, use a step `foreach: { matrix: … }`). Your file stays valid; the warning says
what to write instead. `compat/common-variables` (off unless you use
`samaritan:strict` or `samaritan:all`) suggests renaming `common_variables:` to
`variables:`, the same thing under one name.

### How a command is read

The command is parsed, not searched as text:

- `&&`, `||`, `|`, `;` and each new line start a new command; a `\` at the end
  of a line continues it. `# comments` are dropped.
- Commands inside `$( … )` are checked too, also inside double quotes.
- Leading `NAME=value` assignments, redirects (`2>&1`), and wrappers (`sudo`,
  `env`, `exec`, `timeout`, …) are separated from the command they apply to.
- `--flag=value` is split, and for tools that allow it `-Av` means `-A -v`.
  Global options are skipped with their values (`git -C dir push`).
- Nothing is expanded: `$VAR`, `${VAR}` and `${VAR:?msg}` stay literal, so
  the result is the same on every machine and in every directory.

Syntax the parser cannot analyse is reported as `analysis/unsupported`
(heredoc, process substitution `<( )`, backticks, `case`, function
definitions), never skipped silently. Lines after a heredoc's `<<` are not
checked. `echo git push origin HEAD:main` is an `echo`, not a push.

### Instructions that leave the decision to the operator

`instruction/vague-decision` (tier 3, a warning by default, an error under
`--strict` and `samaritan:all`) reads each step's `instruction`, line by line,
for wording that hands the operator a run-time decision with no condition and
no action: the manual reads as if a check exists, but nothing says when or
what to do.

| Flagged | Why |
| --- | --- |
| `consider pausing` / `consider stopping` / `consider aborting` | No condition that decides it. |
| `surface them` | No destination. `surface them to <channel>` names one and passes. |
| `as needed` / `as appropriate` / `if necessary` | Only on a line that also names an action (`retry`, `re-run`, `restart`, `roll back`, `scale`, `escalate`, …): `retry as needed` says neither how often nor when to stop. |

Write the condition and the action instead:

```yaml
instruction: |
  If 5xx responses exceed 1% after the switch, ask the web-server owners to redeploy.
  STOP if 5xx continues for 5 minutes.
```

Only `instruction` is read: `description`, `command` and `expect` are not.
Lines inside a ``` or `~~~` fence (text the operator pastes as written) and
`inline code` are skipped. Each `variants.<env>` instruction, sub-step and
rollback step is checked like any step. Add your team's phrases with
`lint.vague_phrases` (literal, case-insensitive, whole words). Silence one
finding with `# samaritan-lint-disable-next-line instruction/vague-decision`
above `instruction:`.

### Between steps

These rules walk the steps in the order a run takes them (a parent before its
sub-steps) and, where it matters, once per environment, using `when:`:

- `flow/forward-var`: a `${NAME}` used before the step whose `capture:` sets it.
- `flow/unproduced-capture`: `expect.equals_captured` naming a capture no step
  makes, or a capture whose only producer does not run in an environment where
  the reader does (reported as "may not execute in 'production'").
- `flow/capture-group-oob`: a `capture:` that can never set its variable
  (`group: 2` on a pattern with one group, a pattern that does not compile).
- `flow/session-undeclared`: a `session:` (after `${VAR}` resolution per
  environment) that is not under `sessions:`.
- `flow/mutate-without-verify` and `flow/no-rollback-on-mutate` (tier 3): a
  step that changes state (`kubectl apply`, `aws … create-`, `git push`,
  `systemctl restart`, …) with no check on it or the next step, or with no
  rollback anywhere.

The opt-in ordering rules match identifiers where the command writes them: a
snapshot counts as the backup only for the resource it names
(`--db-instance-identifier web-db`), a `wait` only for its `--stack-name`, an
`aws sts get-caller-identity` only in the same `session:`. Where a command
names no identifier, any matching step counts.

## Tiers: how sure a rule is

Config can change a rule's severity, never its tier.

| Tier | Claim | Examples |
| --- | --- | --- |
| 1 | The shape is in the procedure, exactly. Whether that is a defect may be team policy. | `shell/exit-verbs`, `flow/capture-group-oob`, `cmd/banned` |
| 2 | A reliable signal from an analysis with known gaps. | `var/colon-unresolved`, `analysis/unsupported`, `vars/undefined` |
| 3 | A heuristic: the pattern is present. A review tripwire, not a verdict. | `git/protected-push`, `flow/mutate-without-verify`, `expect/json-shape` |

A clean `lint` means no finding from the enabled rules. It does not mean the
operation cannot fail.

## Suppressing a finding

Put a comment above the field (or the step) in the YAML:

```yaml
steps:
  - name: Fast-forward the release branch
    type: manual
    # samaritan-lint-disable-next-line git/protected-push -- approved release path
    command: git push origin v1.4.0:refs/heads/release

  # samaritan-lint-disable shell/exit-verbs
  - name: Legacy cleanup            # the whole step, its sub-steps included
    type: manual
    command: exit 0

  - name: One line
    type: manual
    command: aws s3 ls # samaritan-lint-disable-line aws/no-pager
```

| Comment | Applies to |
| --- | --- |
| `# samaritan-lint-disable-next-line <rule> …` | The next line: put it above the field's key (`command:`, `expect:`, …). |
| `# samaritan-lint-disable <rule> …` | The YAML block below it: above a step's `-`, that step with its sub-steps and rollback. At the top of the file, the whole file. |
| `# samaritan-lint-disable-line <rule> …` | Its own line (a comment at the end of the line). |

- Several rules: separate them with spaces or commas. No rule: every rule.
- Text after `--` is a reason for reviewers and is ignored.
- A `#` line inside a `command: |` block is shell, not a directive: put the
  comment above `command:`.
- A comment in a `uses:` file applies to findings in that file.
- A directive naming a rule that does not exist is reported as
  `lint/invalid-directive`.

`validate` honours the same comments.

## shellcheck and SAMARITAN placeholders

`validate --lint` (and the `shell/shellcheck` rule) run shellcheck on each
inline command with SAMARITAN's `${NAME}` placeholders replaced by
underscores of the same length: SAMARITAN substitutes them before the shell
sees the command, so `rm -rf ${DIR}` is not an unquoted variable. Shell
syntax (`$X`, `${X:?}`, `${X%.txt}`) is kept. For inline commands these
codes are not reported: SC2154 (a variable set by an earlier step runs in the
same shell), SC2050, SC2194, SC2157, SC2043 (a masked placeholder reads as a
constant) and SC1091. `script:` files are checked as they are.

## What `validate` shows

`validate` runs every enabled rule that it did not already have, and prints
the findings as warnings, prefixed `lint [<rule id>] (line:col):`. They never
fail `validate` and never change its exit code, even under `--strict`. Rules
your config turns `off` stay off there too. A broken `lint:` section is
reported as `lint config ignored: …` and the defaults are used. A rule that crashes is reported as
`lint skipped: rule <id> failed: …`, a warning, never an error.

## Team config: `samaritan.config.yaml`

`lint` and `validate` read the nearest `samaritan.config.yaml` at or above the
operation file. The global `--config <path>` option, when you give it, is used
instead. Only the `lint:` section matters here:

```yaml
lint:
  extends: [samaritan:recommended, ./presets/ops-team.yaml]

  rules:                         # off | warning | error, per rule id
    git/protected-push: error
    analysis/unsupported: off

  protected_branches: [main, release]   # git/protected-push (default: main, master)

  banned:                        # → cmd/banned
    - pattern: 'git add -A'
      message: stage explicit paths
    - pattern: 'AWS_PAGER='      # matches the assignment, any value
      message: use --no-cli-pager instead

  required:                      # → cmd/required-flag
    - pattern: 'kubectl *'
      flags: ['--context']
      message: name the cluster explicitly

  identities: [alice, bob]       # style/hardcoded-identity
  known_binaries: [web-ctl]      # cmd/unknown-binary
  aws_sessions: [ops]            # flow/aws-local-session
  aws_create_allowlist: [create-topic]   # aws/cli-create-managed
  vague_phrases: [use your judgement]    # instruction/vague-decision
```

An unknown key, an unknown rule id or preset, a severity other than `off` /
`warning` / `error`, an `extends` cycle, or a pattern that is not a single
command is a config error (`lint` exits `2`).

### Presets and `extends`

`extends` applies presets in order, then the file's own keys. A preset is:

| Preset | What it sets |
| --- | --- |
| `samaritan:recommended` | The defaults: what you get without `extends`. |
| `samaritan:strict` | What `validate --strict` tightens, as severities (`deps/unknown-ref` → error, `style/hardcoded-env` on, …). `samaritan lint --strict` applies it before your config. |
| `samaritan:all` | Every rule on, the opt-in ones included, at their preset level. |
| `./path/to/preset.yaml` | A local file, relative to the file naming it: a `lint:` section (or the section itself), which may `extends` further. |

`rules` merge (later wins), `banned`, `required` and `vague_phrases` add up, and the other lists
(`protected_branches`, `identities`, …) are replaced by the later one. Remote
presets are not supported.

Some rules are off until a preset or your config turns them on: team policy
(`git/explicit-staging`, `git/no-verify`, `tmux/input-injection`,
`aws/region-required`) and ordering heuristics (`flow/sts-before-mutate`,
`flow/backup-before-delete`, `flow/checksum-before-exec`, …). They ship off
on purpose: the defaults apply to every SAMARITAN user, team policy belongs
to the team that sets it, and most of the ordering heuristics are tier 3,
which would bury the exact findings under review tripwires. `extends:
[samaritan:all]` turns them all on at their preset level; a team preset can
pick some. `--list-rules` shows each rule's level by default, under
`samaritan:strict` and under `samaritan:all`.

### Teaching lint about a tool (`tools`)

Everything lint knows about a program is a **tool profile**: how its options
parse, which of its verbs change state, take a backup or delete data, which
options name a resource, and how it declares its output format. `aws`,
`kubectl`, `git`, `helm`, `psql`, `systemctl`, `terraform`, `docker`,
`crontab`, `sed`, `curl` and others come built in. Add your own tool, or
extend a built-in one, under `lint.tools`:

```yaml
lint:
  tools:
    - binaries: [web-ctl]
      value_options: [--cluster]      # `--cluster prod` is one option, not an operand
      verb_depth: 2                   # messages say `web-ctl app purge`
      mutating: ['deploy|rollback|scale']
      backup: ['snapshot create']
      deletes_data: ['app purge']
      resource_options: [--app]       # `--app web-server` names the resource
    - binaries: [git]                 # extends the built-in git profile
      mutating: [tag]
```

Then `web-ctl deploy` counts as a state change (`flow/mutate-without-verify`,
`flow/no-rollback-on-mutate`), `web-ctl app purge --app web-server` needs an
earlier `web-ctl snapshot create --app web-server` (`flow/backup-before-delete`,
matched by `--app`), `web-ctl` is a known program, and `banned:` /
`required:` patterns parse it with its options.

| Key | Meaning |
| --- | --- |
| `binaries` | Program names the profile applies to (required). |
| `value_options` / `boolean_options` / `long_options_take_value` / `combine_short` | How options parse. |
| `verb_depth` | How many words name the action in messages (default 1). |
| `mutating` / `backup` / `deletes_data` | Verbs, see below. |
| `dry_run` | Verbs (usually an option, `{ option: --plan }`) that make a mutating invocation a preview: lint then does not count it as a change. Built in for `kubectl --dry-run` (any value but `none`). |
| `resource_options` / `resource_operand` | Options (they take a value) or the operand index that name a resource. |
| `output_options` | Option whose value is the output format (`expect/json-shape`). |

A verb is words matched against the start of the operands: `*` inside a word
is any text, `|` separates alternatives, a lone `*` is any one word, `''` is
any invocation. Or an object: `{ verb, option, matches, any_operand, redirect }`,
all of which must hold, e.g. `{ option: -c, matches: '\bdrop\b' }`.

A profile for a program that already has one extends it: verb lists and
option lists add up, and only the settings you give change. Profiles in a
preset (`extends:`) and in your file add up too.

There are no JavaScript plugins: a `samaritan.config.yaml` in a repository you
clone never runs code, and lint stays deterministic. Rules are built in; tool
knowledge is data you can share.

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
remote named `main`). It also looks one level inside `bash -c '…'`,
`ssh host '…'` and `eval`.

It does not resolve variables: `git push origin HEAD:${TARGET}` is not
flagged.

## Lint and mock runs in CI

Two offline gates, each proving something different:

```bash
samaritan lint ops/*.yaml
samaritan run ops/release.yaml --env staging --mock --fail-on-skipped
```

`lint` checks how the procedure is written. A mock run replays each
`expect` against recorded evidence; `--fail-on-skipped` makes a run that
skipped a step, or checked nothing, fail. Passing both means no violation
within those checks and those recordings, not that the operation cannot fail.
See [Running an operation](/running#mock-run-mock-replay-expect-against-captured-evidence).
