# SAMARITAN CLI Reference

**The authoritative command and flag list is GENERATED from the Commander tree**
(`src/cli/program.ts`) by `scripts/gen-docs`. Build it with `npm run docs:gen` and
read `docs/reference/cli.md`, or browse
<https://eric4545.github.io/samaritan/reference/cli>. Ad-hoc: `samaritan <command>
--help` (locally `npm start -- <command>`).

Do **not** re-add a hand-maintained command table here. One existed for a long
time and drifted — it documented `generate confluence`, which has never been a
command — and that error was copied into three other files. This page now covers
only the *behavioural* notes that cannot be derived from the command tree.

`tests/docs/prose-lint.test.ts` fails the build if any prose in this repo names a
subcommand or flag that does not exist, so keep examples here real.

## Commands at a glance

`init`, `operation`, `validate`, `generate` (`manual` | `docs` | `postmortem` |
`schedule`), `run`, `resume`, `sessions`, `schema`, `diff`, `report`
(+ `report merge`), `postmortem` (`init` | `from-run`), `qrh`
(`search` | `list` | `show` | `run`).

Two traps worth stating explicitly:

- **There is no `generate confluence`.** Confluence and ADF are *formats*:
  `generate manual -f confluence|adf`. `--gantt` is a `generate manual` flag;
  `generate docs` does not accept it.
- **Scaffolding is `samaritan operation`, not `create operation`.** `project.ts`
  chains `.command('operation')` off a `create` parent, and the chain returns the
  *subcommand*, so only `operation` is ever registered. It takes `--template
  <name>` only — no positional name, no `--env`.

**QRH** is implemented as a set of commands that read operations from a local
`./qrh/` directory. There is no bundled or hosted QRH *database*, and no `qrh/`
directory or example ships with this repo today.

## Key flags

### lint
- `samaritan lint <file...>` — named rules (registry `src/lib/lint/rules.ts`;
  `--list-rules` prints it with default / `samaritan:strict` / `samaritan:all`
  levels and tier). Families: the command itself (`shell/*`, `tmux/*`, `git/*`,
  `aws/*`, `kubectl/delete-ns`, `curl/require-fail`, `ssh/one-shot`,
  `var/colon-unresolved`, `cmd/*`, `analysis/unsupported`), between steps
  (`flow/*`: forward-var, unproduced-capture (per env, "may not execute"),
  capture-group-oob, session-undeclared, mutate-without-verify,
  no-rollback-on-mutate, + opt-in ordering heuristics), expect vs command
  (`expect/contains-vs-matches`, `json-shape`, `multiline-contains`),
  instruction prose (`instruction/vague-decision`: "consider pausing",
  "surface them", "as needed"/"as appropriate"/"if necessary" next to an
  action verb; `instruction` only, fences and inline code skipped; warning,
  error under strict/all; team phrases in `lint.vague_phrases`), and the
  existing validate checks under ids (`expect/*`, `deps/*`,
  `steps/duplicate-id`, `vars/*`, `evidence/*`, `rollback/empty`, `style/*`,
  `compat/discarded-verify`, `shell/shellcheck`), plus fields that do
  nothing: `schema/unknown-key` (a top-level key samaritan does not read,
  with a did-you-mean; `x-…` keys allowed; warning, shown by `validate`),
  `compat/unused-field` (step `retry`, `manual_override`,
  `manual_instructions`, `approval` keys but `required`, and the top-level
  `tags`/`matrix`/`reporting`/`last_executed`; warning, shown by
  `validate`) and opt-in `compat/common-variables` (strict/all).
- Exit `0` = no error-severity findings, `1` = errors or more warnings than
  `--max-warnings <n>`, `2` = a file or its config could not be read.
  `--format json` (stable: `files[].findings[] = {ruleId, severity, tier,
  message, location: {file, line, column} | null}`), `--strict` (applies the
  `samaritan:strict` profile under the config).
- Findings carry `line:col` (from per-step provenance the parser stamps:
  `src/operations/step-source.ts`); steps from `uses:` files point into that
  file, `foreach` copies at the authored entry.
- Suppression comments: `# samaritan-lint-disable-next-line <rule…>` above
  the field key, `# samaritan-lint-disable <rule…>` above a step (step +
  sub-steps; top of file = whole file), `# samaritan-lint-disable-line <rule…>`
  trailing. `-- reason` ignored; no rule = all; a `#` line inside a block
  scalar is shell, not a directive; unknown rule → `lint/invalid-directive`.
- Config: `lint:` in the nearest `samaritan.config.yaml` above the file, or the
  global `--config <path>` when given: `extends` (`samaritan:recommended|strict|all`
  or a local file, relative), `rules` (`off|warning|error`), `banned`
  (`{pattern, message}`), `required` (`{pattern, flags, message}`),
  `protected_branches`, `identities`, `known_binaries`, `aws_sessions`,
  `aws_create_allowlist`, `vague_phrases` (adds up across `extends`). Unknown keys / rule ids / presets, extends cycles →
  exit 2.
- Patterns are parsed like commands: same program, every option anywhere
  (combined short flags expand, `--x=v` splits), assignments by name
  (`AWS_PAGER=`), other words as an ordered prefix; `*` = one whole word.
- Walks steps, sub-steps, `variants.<env>` (command + rollback list, named
  `<step> [variants.<env>]`), step `rollback`, `rollback.steps`.
- Tier-3 ordering rules match identifiers where written: a backup counts for
  the resource it names, a `wait` for its stack, an sts check in the same
  session.
- `--format json` follows `src/schemas/lint-report.schema.json`.
- A crashing rule: `lint` → file `fatal: rule <id> failed: …` (exit 2);
  `validate` → warning `lint skipped: …`, never an error. `shell/shellcheck`
  on without shellcheck installed → `notice` (JSON `notices`), exit unchanged.
- Opt-in by design (default `off`, level from `samaritan:all` or a team
  preset): team-policy rules (`git/explicit-staging`, `git/no-verify`,
  `tmux/input-injection`, `aws/region-required`, `shell/env-echo`,
  `ssh/one-shot`, `curl/require-fail`, …) and the tier-3 ordering
  heuristics (`flow/sts-before-mutate`, `flow/backup-before-delete`, …).
  `samaritan:recommended` = the defaults. The list is locked in
  `tests/lib/lint-conformance.test.ts`.
- Tool profiles (`src/lib/lint/tools/`): per-program data (option spec,
  `mutating` / `backup` / `deletes_data` verbs, `dry_run` (invocations that only
  preview, e.g. kubectl `--dry-run` built in), `resource_options`,
  `output_options`). Teams add/extend with `lint.tools` (`binaries`,
  `value_options`, `verb_depth`, …); verbs: words vs operands, `*` in a word,
  `a|b`, lone `*` = a word, `''` = any; or `{verb, option, matches,
  any_operand, redirect}`. Same-program profiles merge (lists add). No JS
  plugins (configs never run code).
- `script:` files are not command-linted (child shell; shellcheck covers them).
  shellcheck (`validate --lint`, `shell/shellcheck`) sees SAMARITAN `${NAME}`
  masked as `_` and skips SC1091/SC2050/SC2194/SC2154/SC2157/SC2043 on
  inline commands.

### validate
- Also prints the lint rules it did not already have as warnings
  (`lint [<rule id>] (line:col): …`); they never fail validate or change its
  exit code, even under `--strict`. A rule set `off` in the config, and a
  suppression comment, apply here too.
- `--lint` — run shellcheck over `command`/`script` of every step, sub-step,
  step `rollback` and operation `rollback.steps` (warnings by default).
- `--strict` — promote lint warnings and schema warnings to errors.
- Always runs a built-in regex-lint over `expect` regex fields (`matches`,
  `all_lines_match`, `any_line_matches`, `no_line_matches`, `retry.while`) on
  every step, sub-step and rollback step (step-level and `rollback.steps`):
  uncompilable patterns are errors; ReDoS-prone ones (e.g. `(a+)+`) are warnings
  (errors under `--strict`). No flag needed — regex compilation is built-in.
- Duplicate top-level step `id`s are an error, one line per repeated ID:
  `Duplicate step ID: deploy (steps 1, 3)`.

### groups (`--group`)
- An operation that declares `groups:` needs `-g, --group <name>` on
  `generate manual|docs|schedule`, `diff` and `run`; without it they exit with
  an error listing the groups. `resume` reads the group from the session.
- `run --group <name>` walks only that group's steps and rollback entries in
  every mode; step and rollback names show with the variables resolved.
- A run records its group: `sessions` lists `Group: <name>`, and `report.md`
  has `- Operation:`, `- Environment:` and `- Group:` summary lines.
- `report merge` exits with an error when the sessions are from different
  groups or environments (steps are merged by index; each group has its own
  step list). Merge one group's sessions at a time.
- `validate` without `--group` validates every group and prefixes
  group-specific findings with `[group <name>]`.
- `generate manual --all-groups --output-dir <dir>` writes
  `<dir>/<group>/<base>.md`; add `--all-envs` for
  `<dir>/<group>/<base>_<env>.md`.

### generate manual / confluence
- `--env <name>` — single-environment heading format. Omitting it produces the
  multi-environment table format. These are two distinct rendering paths.
- `--output <path>` — write to file (defaults to stdout for Markdown).
- `--resolve-vars` — substitute `${VAR}` against the selected env's variables at
  generation time.

### generate postmortem / postmortem from-run
- `generate postmortem <file>` renders a **postmortem / incident report (RCA)** —
  a separate document type from operations (its own schema
  `src/schemas/postmortem.schema.json`; see `reference/postmortem-yaml.md`).
- `-f, --format markdown|confluence|adf` (default `markdown`); `-o` writes to a
  file, otherwise stdout. Confluence output wraps the Mermaid timeline in the
  `{markdown}` macro (same pattern as the operation Gantt).
- `--timezone <tz>` — render every timestamp in this IANA zone (default `UTC`);
  an unknown zone is an error.
- `postmortem from-run <session-id|events.jsonl>` seeds a postmortem YAML from a
  captured run record: timeline, participants, incident window, and
  `operation`/`run` back-references are auto-filled; narrative fields are `TODO`.
- `postmortem init` writes a blank template. This is a documentation feature —
  it does NOT execute anything.

### run
- Default mode is **sidecar**: SAMARITAN displays each resolved command but does
  NOT send it to tmux — the operator runs it, then presses `[v]` to verify
  `step.expect`.
- Other modes: `manual`, `automatic` (tmux-backed send/verify), `hybrid`.
- `--mock` — replay each step's `expect` against `evidence.results[<env>]` output;
  prints PASS/FAIL/SKIP, exits non-zero on failure. No tmux/execution. An
  unreadable evidence `file` skips the step (reason names the file).
  `--fail-on-skipped` (CI gate) also exits 1 when any step was skipped or
  nothing was evaluated; `--min-evaluated <n>` exits 1 below `n` evaluated.
- `--dry-run` — runs and sends nothing. Prints each step's command with variables resolved (`[dry-run] Would execute: …`), its session and any unresolved `${NAME}`, then the `validate --env <env>` findings (lint included) and what it did / did not check. Exit 1 only on a `validate` error; exit 0 does not mean the commands or `expect` values are right. A dry run is not saved (`sessions`/`resume` never see it).
- Spawned `sessions:` (no `--attach`): one tmux session `samaritan-<id>`, one window per entry named after it; a step's `session:` (or, for a sub-step without one, its nearest ancestor's) picks the pane for `[p]`/`[y]`/`[v]`. Each session's `env` is exported in its pane after the `ssh` connect (` export NAME='value'`, literal, single-quoted; an invalid name stops the bootstrap); with `--attach` it is not set and samaritan says which names it skipped. Panes are addressed by tmux pane id (works with `base-index 1`). The view hint is `tmux attach -t …` outside tmux and, inside tmux, `tmux split-window -h "TMUX= tmux attach -t …"` or `tmux switch-client -t …` (`attachHintLines`)
- `--attach <tmux-target>` — attach to an existing tmux pane instead of spawning. It wins over `sessions:`: named sessions are not spawned and every step (whatever its `session:`) captures from / pastes into this one pane; `[t]` switches the pane mid-run; `resume` re-attaches it the same way. One samaritan run per pane: tmux allows one `pipe-pane`, so a second run on the same pane takes it over (warned); the first run detects that at its next step/`[v]`, re-attaches, and verifies from the pane scrollback (from the `[p]` paste line when there was one).
- `--from-step <step>` — start at that step: its number in the manual (`2.7`; also the multi-env manual's `2g`), its `id`, or its name (several matches: error lists them), NOT the flat position (`--from-step 2` is Step 2 even when it is the 32nd step); earlier steps are recorded as **skipped**
  (distinct from `resume --from-step`: there, steps it jumps over that have no
  record count as completed; steps the run recorded keep their status).
- `--report <dir>` — write an extra copy of the run report (`samaritan-<id>-report.md`).
- `--report-format <markdown|html>` — format of that `--report` copy (`html` → `samaritan-<id>-report.html`, one self-contained file with screenshot/photo evidence embedded as `data:` URIs). Needs `--report` (error otherwise). The always-on `report.md` stays Markdown. Not on `resume` (it has no `--report`): render a resumed run with `report <events.jsonl> --format html`.
- `--auto-approve` — note: `automatic` context marks steps complete WITHOUT
  running commands (non-interactive execution is a roadmap item, not real).
- `--no-require-evidence` — disable the evidence-required gate (see below);
  also available on `resume`.
- `--pic [name]` — **focus mode** (multi-operator). Focus on steps whose `pic`
  matches `name` (case-insensitive); bare `--pic` defaults to `$USER`. Steps
  assigned to a *different* PIC are **auto-skipped and recorded** as skipped;
  steps with **no `pic` are shared** and shown to everyone. The focused PIC also
  becomes the session's operator (so `report merge` attributes each step). Not
  persisted — re-supply on `resume`. Absent flag = focus off (every step shown).
- `--no-skip-others` — in `--pic` focus mode, keep other operators' steps
  visible/runnable (annotated "assigned elsewhere") instead of auto-skipping.

### report merge
- `report merge <sessionA> <sessionB> [...]` — combine several saved run
  sessions of the **same operation** (typically one per operator, each run with
  `--pic`) into one consolidated Markdown report. For each step the
  most-complete record wins (completed > failed > skipped) and is attributed to
  the operator who ran it (`**Operator**:` line + a summary `- Operators:` list).
  `-o, --output <file>` writes to a file (default: stdout). Errors if the
  sessions are from different operations, groups or environments.
  `-f, --format <markdown|html>` as for `report`.

### report
- `report <events.jsonl>` — render a run's report from its event log;
  `-o, --output <file>` (default: stdout). `-f, --format <markdown|html>`
  (default `markdown`): `html` is ONE self-contained file — the same
  Markdown structure and headings, screenshot/photo evidence embedded as
  `data:image/…;base64` (type sniffed from the bytes: PNG, JPEG, GIF, WebP),
  every other file still a relative link, an image that is missing or not an
  image a link marked `(not embedded: file missing or not an image)`. All
  text HTML-escaped; no external resources. No PDF (print the HTML).

## Interactive run loop actions

Per manual/sidecar step:
- `[n]` note — free text; a multi-line paste is one note
- `[e]` evidence — ONE prompt (`Evidence > `), kind worked out from the answer: `↵` alone captures pane output since step start (cleaned), or the pane screen when nothing was printed since (a "record the result" step); an existing file path (dragged in or typed) is copied to `<run-dir>/evidence/` (`screenshot`/`video`/`file` by extension); `Ctrl+V` on the empty prompt (or `v`) saves the IMAGE on the OS clipboard as a `screenshot` (macOS `pngpaste`, then `osascript -l JavaScript` over AppKit (PNG, or TIFF converted), then AppleScript `«class PNGf»`; Linux `wl-paste`/`xclip`; not over SSH — the clipboard is on the operator's machine). A helper that FAILS is quoted (`could not read the clipboard (osascript: …)`), never reported as an empty clipboard. Because a Mac terminal sends NOTHING for `⌘V` with an image/file on the clipboard, the run probes the clipboard at step start, at `[e]` and at `↵` (`probeClipboard`; macOS `changeCount` via JXA, Linux `TARGETS`): an image or file copied since the step started is what `↵ alone` attaches (`📋 On your clipboard: …`; pane capture moves to `capture`), once; `Ctrl+V` with a copied FILE attaches the file, not its icon; on macOS the empty-clipboard message names `Cmd+Ctrl+Shift+4` and the prompt says `Ctrl, not Cmd` (`⌘V` sends no keystroke for an image); a lone `http(s)` URL is a `link` (chat message, CI build, dashboard); anything else is `text`. A multi-line paste is one answer. `Esc` cancels; a missing path or an empty answer records nothing. `f`/`t`/`l` still open the old path/text/URL sub-prompt. Shown in the bar while `evidence.required` is unmet; the step header prints `Evidence : required — <types>`
- `[x]` remove evidence — only shown once evidence exists
- `[v]` verify — run `step.expect` against captured pane output (after a `[p]`, only output from that paste on — an earlier attempt's output is never judged). A PASS never completes the step: `↵` does. On a TTY, keys typed in the same burst as an action key are discarded (`v⏎` = verify only), and a second bare `↵` within 400 ms of an acted-on one (no other key between) is ignored (`Enter ignored: pressed twice`), so a double press never completes the next step
- **Compact step bar** (`src/lib/step-actions.ts` `stepActionHints`): shows `y` (armed) · `↵` · `p` · `v` · `e` (only while required evidence is missing) · `t` (only while no pane is attached) · `s` · `r` · `?` more; `?` prints the rest (`c`, `n`, `e`, `x`, `t` attach another pane, `b`, `j`, `g`, `abort`). Hidden keys still work without `?`. With a pane attached the command header reads `Command — [p] pastes it into <pane>:` (`runCommandHeader`), else `Run this command in your terminal ([t] attaches a pane for [p]/[v]):`
- `[t]` attach pane — (sidecar) attach/swap a tmux capture backend mid-run. Picker lists `session:windowName.pane` for named windows (index form while tmux auto-renames), with the pane id; answer by number, name or target, `r` re-lists. The answer is checked against a fresh `list-panes`: a number picks the pane by id, a closed pane re-lists with a warning. The attached capture is pinned to the pane id for the whole run (closing another pane cannot redirect `[p]`)
- `[p]` send to pane — (sidecar) paste the resolved command into the attached pane WITHOUT Enter (operator reviews + runs it), using **bracketed paste** (`paste-buffer -p`) so multi-line commands land as one atomic block instead of executing line-by-line; only when the step has a command (or a `script:`, whose `bash <path>` invocation is pasted) and a pane is attached. Re-run during verify = `[p]` then `[v]`. Before pasting, CRLF/CR becomes LF and trailing newlines are stripped (tmux LF→CR would otherwise turn a stray `\r` into a blank line that breaks `\` continuations). Multi-line commands paste with no confirmation prompt (bracketed paste lands them as one un-run block in bash ≥ 4.4 / zsh ≥ 5.1); shells without bracketed paste (sh/dash) would run each line as it arrives. While a paste is still un-run on the pane's input line (cursor line ends with it), `[p]` is refused until it is run or cleared (Ctrl+U), and `↵` on that step asks `Mark done anyway? [y / n=go back]` (`y` → `paste_not_run` event + ⚠️ report note); same for rollback `p`/`↵`
- Step headings read `[Step 10.2 · 34/46]`: the single-env manual number (`generate manual --env`, dotted sub-steps) plus the progress position (`34/46`, progress only; `[b]`/`[j]`/`--from-step`, all messages, `sessions` and `report.md` use the manual number `10.2`), followed by `Section :` (the parent) and `Next : … (N remaining)` lines
- `[!]` paste + run — (sidecar, pane attached, forward bar) `[p]` + `[y]` in one key: paste, the same guarded Enter, wait, verify. Its own key, never `y`, so a stray `y` from a y/n prompt cannot start a command. With `run.advance_on_pass: true` in the operation a verify PASS (from `[!]`, `[y]` or `[v]`) completes the step; a step with no `expect`, a failed verify, missing required evidence or a `confirm:` gate still waits.
- `[y]` run it — (sidecar, only right after a `[p]` paste, forward or rollback) samaritan presses Enter in that pane (`send-keys -t <%pane_id> Enter`) ONLY while the pane is exactly as the paste left it: same live pane, not in copy/view mode, `synchronize-panes` off, input not disabled, same `pane_current_command`, and NO pane output / cursor / prompt-row change since the post-paste snapshot (so an edited or already-run command is never sent). Refusals print `🛑 Enter NOT sent: <reason>`, send nothing and keep `[y]` armed. After Enter it waits (`⏳ Running…`) until the pane is back at its pre-paste prompt (digits normalized) and quiet 0.3s — or 3s quiet with the shell in front when the prompt changed — then auto-runs `[v]` (step or rollback-entry `expect`); a different foreground program (silent `kubectl`) keeps it waiting; any key stops waiting. Not carried across steps. Logged `user_input`/`enter_sent`; report shows `⏎ Enter sent from samaritan [y]`. No flag/config
- A **script-only step** (`script:` with no inline `command`) displays `Script: <path>`, the embedded script content, and a `bash <path>` runnable; `[c]` copy and `[p]` send-to-pane act on that `bash <path>` invocation
- `[b]`/`[j]` pickers (and the completion-screen rollback picker) list one number per row, the manual's, plus an aligned `id` column when a listed step has an `id` (`2.7  deploy-api  deploy  (completed)`), and accept that number, the multi-env manual's number for the same step (`2g`), `Step 2.7:` copied from a heading, the step `id` (case-insensitive), the step name, or a part of the name or id (`resolveStepPick`). Several matches NARROW the list to them and ask again (`🔎 2 steps match "scale":`); a miss asks again; Enter cancels (re-asking is TTY-only; piped stdin gets one answer). A plain integer is a step number, never a row position
- A key that does not apply (`[v]` without `expect`, `[p]` without a command, `[x]` without evidence, `[b]` on the first step…) prints why and stays on the bar — it never marks the step done (`unavailableKeyMessage`)
- Sidecar `↵` with a command, no `[p]` this step and NO pane output since step start asks `Mark done anyway? [y / n=go back]` (stray-Enter guard; `y` → `done_without_run` event + ⚠️ report note)
- Failed verify prompt is single-key; in sidecar with a pane it offers `y=re-run` first: paste the same command again + guarded Enter + wait + re-verify (one key instead of Enter → `[p]` → `[y]`). Enter = back to the step bar (never ends the run); the non-sidecar `automatic` prompt stops the run only on `q`. When the pane is not back at the prompt of this step's `[p]` (`paneLooksBusy`), the prompt reads `⏳ Command may still be running — output not final yet.` with `v=re-verify` first and no `y=re-run`; `[y]`'s quiet fallback prints `⏸ … may still be running` instead of `✔ Finished.`
- First sidecar bar with `[p]` and a pane prints a one-time `ℹ️  Flow: p … → y … → ↵ …` legend (`sidecarFlowLegend`)
- `[b]` back — go back to an earlier step and re-run from there (resets it + later steps to pending; audit log keeps the prior attempt); not offered on the first step. With steps in between, it first asks `Re-run only "<picked>", then come back to "<current>"? [y / n=rewind]`: `y` resets only the picked step and returns to the current one after it, leaving the in-between steps' status untouched (events `rerun` / `rerun_return`); `n` = the rewind
- `[j]` jump — jump **forward** to a later step; the current step through the target are recorded as **skipped** (⏭) in the report, execution resumes at the target; not offered on the last step. Startup equivalent: `run --from-step <step>`
- `[r]` rollback — run *this step's* `rollback`, stay on the step. Sidecar/manual rollback is operator-driven per entry: `↵` done — I ran it · `p` paste into pane (no Enter) · `c` copy · `v` verify its `expect` · `s` skip · `a` abort rollback; commands are `${VAR}`-resolved and the report records completed / partial / NOT executed (never an assumed success). Only non-sidecar spawn-own `sessions:` runs send rollback commands via tmux. When this step has no rollback of its own, offers the **nearest upstream** step's rollback instead (needs chain first, else document order; only completed steps qualify).
- `[g]` global rollback — only when the operation declares a top-level `rollback:`. Previews + runs the consolidated recovery (explicit `rollback.steps` + every **completed** step's rollback in reverse step order — each step's own entries in authored order — when `aggregate_step_rollbacks: true`; ordered by reverse-topological order when `needs` are present) after a single-key `y`, then aborts the operation. After the last step an **All steps done** screen still offers `r`/`g` before the run exits
- `q` / `quit` / `Ctrl+C` — **aborts** the operation, persists session as `paused` (resumable) and prints a resume hint (`Ctrl+C` saves too — it no longer hard-quits without saving)

## Evidence-required gate

When a step has `evidence: { required: true }`, completing it (`manual`/sidecar
`Enter`, or `approval`'s `approve`) is **blocked** by default until `[e]`
records at least one evidence item of ANY kind (file, link, text; `evidence.types`
is a hint shown to the operator, not a filter — recording another kind prints a
note and still counts). There is no separate gate menu — trying to complete with
nothing recorded just prints a one-line warning **on the same action bar**
(`⚠️  This step requires evidence (<types>) — press [e] …  [s] skips.`) and keeps
you there. `[s]` skips the step (recorded as skipped, not completed). Disable with
`--no-require-evidence`. Does NOT gate plain (non-sidecar) `type: automatic`
steps.

## Confirm gate (`confirm:`)

A step (or operator-driven rollback entry) with `confirm:` shows `☑️  Confirm
before done: <prompt>` above the bar. `↵` then asks `Confirmed? [y / n=not
yet]`: `y` asks for the result (`result: required` refuses an empty one, asking
once more first), logs `user_input`/`confirmed_out_of_band` `{prompt, result}`
and completes; `n` logs `confirm_declined` and stays on the bar. `report.md`
renders `**Confirmation (out of band)**: ✅ CONFIRMED by <op> at <time>` +
`Asked:` / `Result:`, a `Confirmed out of band: Step N` summary line, and
`☑️ confirmed` in the "Steps at a glance" table. Not asked on `approval` steps
or in non-sidecar `automatic` runs.

**Forward gating (`needs`):** before a step whose `needs` aren't all completed (e.g. a dependency was skipped by `[j]` jump or `--from-step`), the run loop warns (`⚠️ This step needs: …`) and prompts `Start anyway? [y=proceed / Enter=go back]`. `y` proceeds (logging a `needs_override` audit event); Enter rewinds to the first unmet dependency. Skipped ≠ completed.

## Run artifacts

Each `run`/`resume` writes a black box beside the operation at
`<op-dir>/.samaritan-runs/<id>/`:
- `events.jsonl` — append-only event stream
- `report.md` — always-on (always Markdown; HTML via `run --report-format html` or `report --format html`) per-step verification ledger + approval trail; terminal-escape noise is cleaned from captured output and operator-local path prefixes (home `→ ~`, run dir, operation dir) are stripped so it's safe to share. Counts only genuinely completed steps (`Steps completed: N/total`, where total leaves out steps whose `when:` names other environments); an aborted/cancelled run flags where it stopped — an `Aborted at step N: <name>` summary line plus a `🛑 (aborted here — in progress)` marker on the in-progress step's heading

`.samaritan-runs/` is gitignored (force-add to commit a run). Sessions also
persist to `~/.samaritan/sessions/<id>.json` for `resume`, which takes the
full id or any unique leading part of it (`resolveSessionIdPrefix`; ambiguous
→ error listing them); `sessions` prints the shortest unique part, at least 8
characters (`shortSessionId`, unique against ALL saved sessions). A sidecar session
saves its attached pane (`--attach`/`[t]`) as the stable pane id (`%3`) in
`attach_target`; `resume` re-attaches it (warns if the pane is gone), and
`resume --attach <pane>` overrides it. Samaritan never attaches to its own pane.

**Resume never resumes blind** (`src/lib/resume-state.ts`, from `events.jsonl`):
- Earlier steps keep the status they ended with (skipped stays skipped, so
  `needs` still gates; rolled back stays pending), not all "completed".
- `session_start` records the flat step list (`steps: [{label, name}]`).
  `resume` refuses (exit 1) when a recorded step, or the step it resumes at,
  is no longer at the same position (a step added/removed/reordered at or
  before it), lists them and prints a `run … --from-step "<step>"` to start
  over. Changes to steps not reached yet, or to commands, are accepted.
  `report merge` refuses runs of two step lists for the same reason.
- The step the run stopped on prints a recap (`↻ This step was started
  before the run stopped`: pasted / Enter sent from samaritan / verify) and
  records it as a step note (`user_input` `resumed_after_abort`).
- Sidecar, when samaritan had pasted or sent its command and the step has
  `expect`: the output left in the re-attached pane's scrollback (last echo
  of the command) is verified like `[v]`; PASS → `↻ It already ran and
  passed`, and `↵` completes the step without running it again (no
  "Mark done anyway?"). FAIL or no output → the normal step.
