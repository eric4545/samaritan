# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Pick a step by its `id`, and find it by typing part of it.** The `[b]`
  back, `[j]` jump and completion-screen rollback pickers list each step's
  `id` in its own column (`2.1  scale-down  Scale down old  (completed)`) and
  take the id as an answer, so you no longer read `2.3.1` off the list. Part
  of a name or id narrows the list to the steps it matches and asks again
  (`🔎 2 steps match "scale":`); a typo asks again too, Enter cancels. Before,
  an ambiguous or unknown answer dropped you back to the step bar.
  `--from-step` (on `run` and `resume`) takes the id as well.
- **`resume` takes a short session id**, any unique leading part of it, the
  way git takes a short hash: `samaritan resume 3f2a9c1e`. `samaritan
  sessions` prints the shortest unique one in its `Resume:` line.
- **Evidence report as one self-contained HTML file (`--format html`).** A
  Markdown report with screenshots is a directory: move `report.md` without
  `evidence/` and the images break, and ticket tools do not render images
  embedded in Markdown. `samaritan report <events.jsonl> --format html -o
  report.html` (also `report merge --format html`, and `run --report <dir>
  --report-format html` for the `--report` copy) writes the same report, same
  headings and sections, with screenshot/photo evidence embedded as `data:`
  URIs. Other files stay links; an image that is missing is named, not shown
  broken. Offline, no new dependency, every text HTML-escaped. Markdown stays
  the default and `report.md` beside the operation is unchanged. No PDF:
  print the HTML from a browser. See `docs/evidence-and-reports.md`.

- **Lint flags instructions that leave the decision to the operator
  (`instruction/vague-decision`).** "consider pausing", "surface them", and
  "as needed" / "as appropriate" / "if necessary" next to an action ("retry
  as needed") in a step's `instruction` read like a check but give no
  condition and no action. Only `instruction` is read (not `description`,
  `command` or `expect`); fenced paste blocks and inline code are skipped;
  variants, sub-steps and rollback steps are checked. A warning by default
  (`validate` prints it), an error under `--strict` / `samaritan:all`. Teams
  add phrases with `lint.vague_phrases`. See `docs/linting.md`.

- **Teach lint about your own tools (`lint.tools`).** What lint knows about
  a program (how its options parse, which verbs change state, take a backup
  or delete data, which options name a resource, its output format) is now a
  tool profile. The built-in ones cover `aws`, `kubectl`, `git`, `helm`,
  `psql`, `systemctl`, `terraform`, `docker`, `crontab`, `sed`, `curl` and
  more; a team adds its in-house CLI, or extends a built-in profile, in
  `samaritan.config.yaml` and shares it through presets. See
  `docs/linting.md` and `examples/lint/presets/ops-team.yaml`.
- **`samaritan lint`: named rules for how an operation is written.** Three
  families, each rule with a stable id, a tier (how sure it is) and a
  severity: the command itself (each step's command is parsed: `&&`, `|`,
  new lines, `$( )`, assignments, redirects, `sudo`/`env`/`exec`), checks
  between steps (a `${NAME}` used before the step that captures it, a
  capture whose producer does not run in an environment, a `capture:` group
  that does not exist, an undeclared `session:`, a state change with no check
  or rollback), and `expect` against the command's output format. The checks
  `validate` already ran have rule ids too. Syntax the parser cannot read
  (heredoc, backticks, …) is reported, never skipped. Exit `0`/`1`/`2`,
  `--max-warnings`, `--strict`, `--format json`, `--list-rules`.
- **Lint findings have a position, and comments suppress them.** Each finding
  carries `line:col`, also inside `uses:` files and for `foreach` copies.
  `# samaritan-lint-disable-next-line <rule>` above a field,
  `# samaritan-lint-disable <rule>` above a step (or the file), and
  `# samaritan-lint-disable-line <rule>` at the end of a line; `-- reason`
  is allowed.
- **Team lint policy in `samaritan.config.yaml`.** A `lint:` section sets a
  severity per rule, bans commands (`banned: - pattern: 'git add -A'`),
  requires flags (`required: - pattern: 'kubectl *'  flags: [--context]`),
  names protected branches, and `extends` presets: `samaritan:recommended`,
  `samaritan:strict`, `samaritan:all`, or a local file. The nearest file
  above the operation is used. See `docs/linting.md` and `examples/lint/`.
- **`run --mock --fail-on-skipped`** fails a mock run that skipped a step or
  evaluated nothing, so it can gate CI; `--min-evaluated <n>` fails below
  `n` evaluated steps. An evidence `file` that cannot be read
  now skips the step (the reason names the file) instead of replaying the
  part that could be read.
- **`validate` shows the new lint rules as warnings**
  (`lint [<rule id>] (line:col): …`). They never fail `validate` or change
  its exit code; a rule turned off, or a suppression comment, applies there
  too.
- **`[!]` runs a sidecar step in one key**: it pastes the command into the
  attached pane and presses the same guarded Enter as `[p]` then `[y]`, waits
  and verifies. `[p]` and `[y]` work as before, for looking at the command on
  the pane's input line before it runs.
- **`run.advance_on_pass: true`** in the operation completes a step when its
  `expect` verify passes, without waiting for Enter. A step with no `expect`,
  a failed verify, missing required evidence or a `confirm:` gate still waits.
  Off by default.
- **`confirm:` — a gate you check outside the terminal** (a dashboard, a
  browser, another operator). `samaritan run` asks the question before the
  step can be marked done, and records who confirmed, when, and the result
  they typed (`result: required` refuses an empty one). `report.md` shows
  `Confirmation (out of band): ✅ CONFIRMED by … at …` with the question and
  the result, so a checked gate no longer looks like a step that was simply
  passed. Works on steps, rollback steps and `variants`; every manual format
  prints it as a checkbox line. Example: `examples/confirm-out-of-band.yaml`.
- **`report.md` opens with a "Steps at a glance" table**: one row per step
  with its outcome, how it was checked (verify, confirmation, approval), the
  evidence count and the duration.
- **A URL is evidence too.** At `[e]`, paste the link to a chat message, a CI
  build or a dashboard and it is recorded as `link` evidence; `report.md`
  shows it as a clickable link. In the operation YAML, `type: link` with the
  URL in `content` works in `evidence.types` and `evidence.results`, and every
  manual format (Markdown, Confluence, ADF) renders it as a link. Typed or
  pasted text is recorded as the new `text` type instead of being labelled
  `command_output`.
- **`Ctrl+V` at the evidence prompt takes the screenshot on your clipboard.**
  The image is saved beside the report as a `screenshot`. It needs a helper
  on the machine where SAMARITAN runs: built in on macOS, `wl-paste` or
  `xclip` on Linux. On a host reached over SSH the clipboard is not
  available; give a file path or a link instead.
- **`generate postmortem --timezone <tz>`** shows every timestamp in one IANA
  time zone (default `UTC`), e.g. `--timezone Asia/Tokyo`.
- **A postmortem timeline entry can be a range**: add `until` (same form as
  `at`). It renders as `14:35:00 – 14:58:00 UTC (23m)` in the table and
  `14:35–14:58` in the chart.
- **A postmortem timeline event can hold one fact per line.** Each line of a
  `|` block renders on its own line in Markdown, Confluence and ADF, and
  `**Lead-in:**` renders bold.
- **A run step says up front that it wants evidence**, and which kind:
  `Evidence : required — screenshot, link  ([e] adds it)`.
- **`validate` warns about `evidence.results` that do nothing**: a key that is
  not one of the operation's environments, a `file` that does not exist, a
  `link` without a URL, an image type given inline text.

### Changed

- **One step number everywhere in a run: the manual's.** The `[b]` back and
  `[j]` jump pickers list each step once, under the number the heading and
  `generate manual --env` show (`1.2.1  Deploy database  (completed)`), with
  no second row number beside it. Messages, `samaritan sessions` and
  `report.md` use the same number (`## Step 1.2.1: …`; reports of older runs
  keep their position numbers). At the picker you can type that number, the
  number the multi-environment manual prints for the same step (`1b1`),
  `Step 1.2.1:` copied from a heading, or the step name or part of it.
- **`--from-step` takes the manual's step number or a step name**, for `run`
  and `resume`: `--from-step 2.7`, `--from-step "Deploy database"`.
  **Behaviour change for runbooks with sub-steps:** a plain number is now the
  step number, no longer the position in the flattened list, so
  `--from-step 2` starts at Step 2. A number that is no step is refused with
  a message. Runbooks without sub-steps are unaffected.
- **A step rolled back with `[r]` says so in the report** (`↩ rolled back`
  in the table and the step heading). It used to read as an unfinished step.
- **The report title shows the operation file, not its absolute path** on the
  operator's machine.
- **The operator name falls back to `$LOGNAME`, then the OS account** when
  `$USER` is unset; before, every action in such a shell was recorded as
  `unknown`.
- **The run banner shows the first paragraph of the description**, not all of
  it.
- **The postmortem timeline is rendered in time order**, not YAML order, so
  an entry appended later lands where it happened. Bare clock times
  (`16:20`, `18:05-18:10Z`) mixed with full timestamps are placed on the
  timestamps' day. When that is not possible (the timestamps span several
  days, or an `at` is not a time) the YAML order is kept and `generate
  postmortem` says why.
- **The postmortem Mermaid timeline is left out above 8 entries**, and a
  long or multi-line event is cut to its first line in the chart, marked
  `(see table)`. The table always has every entry in full.
- **The postmortem timeline table shows `Who` and `Ref` only when some entry
  has them.**
- **`generate postmortem` lists each validation error with its field**, not
  only `Schema validation failed`.
- **`[e]` evidence is one prompt.** Give it a file path (drag a screenshot
  in), a URL, or text; press Enter alone to capture the pane; `Esc` cancels.
  The kind is worked out from what you give. The old `f` / `t` answers still
  work. `evidence.types` is shown in the prompt as what the step asks for;
  recording another kind still counts and prints a note.
- **Files attached as evidence are stored beside the report**, in
  `.samaritan-runs/<session-id>/evidence/`, not under `~/.samaritan/`. Runs
  made before this keep their files where they are.
- **Misspelled keys under `evidence` are a validation error.** `require:` or
  `type:` used to pass and the evidence gate then never applied. If
  `validate` now rejects a file, rename the key to `required` / `types`.
- **`aggregate_step_rollbacks` keeps each step's own rollback entries in the
  order you wrote them.** Only the steps are reversed. Before, the whole entry
  list was reversed, so a step's `restore` → `verify restore` came out as
  `verify` → `restore`. If you wrote entries in reverse to work around this,
  put them back in their natural order.

### Fixed

- **Clipboard screenshots on macOS: copy, then ↵.** A Mac terminal sends
  nothing at all for `⌘V` when the clipboard holds a screenshot or a copied
  file, so pasting one at the `[e]` prompt did nothing. The run now looks at
  the clipboard itself: a screenshot or file copied during the step is shown
  in the prompt (`📋 On your clipboard: the screenshot you just copied`) and
  `↵` attaches it, also when it was copied after `[e]` opened. A file copied
  in Finder is attached as the file, not as its icon. Also on a Linux
  desktop (`wl-paste`/`xclip`).
- **Clipboard screenshots on macOS: the real error is shown, and more
  images are read.** Every failure to read the clipboard used to print "the
  clipboard holds no image", even when the helper itself failed (not allowed
  to run, timed out); now the helper's own error is quoted. macOS now first
  reads the clipboard through AppKit, which also takes an image copied as
  TIFF (from Preview, Safari, Keynote) and does not depend on the terminal's
  locale; the AppleScript reader stays as a fallback. The evidence prompt on
  a Mac says to press `Ctrl+V`, not `⌘V` (`⌘V` is the terminal's text paste
  and sends nothing for an image; typing `v` works too), and the "no image"
  message reminds you that `⌘⌃⇧4` copies a screenshot while `⌘⇧4` saves a
  file.
- **`report merge -o <file>` wrote nothing.** The parent `report` command
  took `-o` given after `merge`, so the merged report went to stdout and no
  file was written. `merge` now honours `-o` (and `-f`).

- **`samaritan lint` output read through a pipe is complete.** `lint
  --format json | jq` (and the text report piped to a file reader) got only
  the first 64 KiB: the command exited before the pipe had taken the rest,
  so large reports were cut off and the JSON did not parse. `lint` and
  `schema` now exit only after their output is written. Exit codes are
  unchanged.

- **`psql -c '<sql>'` is read correctly by lint.** The SQL was never seen,
  so a `DROP`/`UPDATE` through psql did not count as a state change or a data
  deletion.
- **A lint rule that crashes no longer fails `validate`.** It made the file
  invalid with `Parsing error: …`, although lint findings are warnings only
  there. `validate` now warns `lint skipped: rule <id> failed: …`, and `lint`
  reports the file as not linted (exit 2) naming the rule, instead of
  `cannot parse`.
- **`lint` says when `shell/shellcheck` could not run.** With the rule on and
  shellcheck missing, it was skipped silently; the file now gets a notice.
- **`validate --lint` no longer reports SAMARITAN placeholders as shell
  problems.** `rm -rf ${DIR}` got SC2086 although SAMARITAN replaces
  `${DIR}` before the shell sees it, and a variable set by an earlier step got
  SC2154. Placeholders are masked for shellcheck (inline commands only) and
  those codes are skipped there; `$VAR` shell variables are still checked.
- **`variants.<env>` commands and rollback lists are linted.** shellcheck,
  regex-lint and evidence checks skipped them.
- **`validate` reports duplicate step IDs.** The check counted IDs after
  putting them in a set, so it never fired: two steps with the same `id`
  passed, or showed up only as a misleading "cannot depend on itself" error.
  It now prints `Duplicate step ID: deploy (steps 1, 3)`.
- **`validate --lint` checks rollback commands.** shellcheck skipped every
  step-level `rollback` and the operation's `rollback.steps`. Rollback
  commands now get the same warnings as forward ones, so `--lint` may report
  new warnings on existing files; the exit code is unchanged unless
  `--strict`.
- **regex-lint checks `rollback.steps`.** An invalid `expect` regex in the
  operation-level rollback passed validation and could never match at run
  time. It is now an error, like on any other step.
- **Spawned `sessions:` work with `base-index 1`.** With `base-index` or
  `pane-base-index` set to 1 in `tmux.conf`, the panes SAMARITAN opened were
  never found: nothing was captured and `[p]` reported a paste that did not
  arrive. Panes are now addressed by their tmux id.
- **A session name with a `.` (or other punctuation) finds its pane.** A step
  with `session: db.primary` said `No tmux pane attached`.
- **The attach hint works inside tmux.** `tmux attach -t samaritan-<id>` is
  refused by tmux when you are already in tmux. There SAMARITAN now prints a
  split that shows the session beside the run, and `switch-client`.
- **Sessions start in about a second instead of 10 s each** when the shell
  prompt does not end in `$` (root `#`, zsh `%`, `❯`).
- Each spawned session's window is named after it, so pane messages read
  `samaritan-<id>:web.0`.
- **A step skipped with `s` is reported as skipped.** `report.md` showed it
  as an unfinished step and left it out of `Steps skipped`.
- **A postmortem timestamp without a time zone renders the same on every
  machine.** `2026-01-01T14:00:00` was read as the local time of whichever
  machine rendered it. It is now read in the `--timezone` zone (default
  `UTC`), and `generate postmortem` warns so you can add `Z` or an offset.
  An impossible date (`2026-02-30`) is now an error instead of being shown
  as written.
- **Times in the postmortem Mermaid timeline keep their colons.** `16:20`
  was rendered as `16-20` and a range as `18-05-18-10Z`; colons are now
  written as Mermaid entity codes and display as `16:20`.
- **A multi-line postmortem timeline event no longer breaks the Markdown
  table**; in Confluence its lines were run together into one paragraph.
- **A multi-line paste at the evidence prompt is kept whole.** Only the first
  line was recorded; the second became the description and the rest were read
  by the step bar, where a line that was a single letter triggered that
  action (skip, abort, run). The same applies to `[n]` notes.
- **A screenshot attached with `[e]` opens from `report.md`.** The report
  pointed at a path under the home directory that Markdown viewers could not
  resolve, and a file name with a space broke the link. The report now links
  to the copy beside it; `run --report <dir>` and `report --output <file>`
  link back to it with a relative path.
- **`[e]` with nothing entered no longer records an empty item** that
  satisfied `evidence.required`, and a path that does not exist is reported
  instead of being stored as text.
- **Typed answers are no longer shown twice** at the note, evidence and other
  line prompts.
- **A variable whose value references another variable now resolves in the
  run, not just in the manual.** A group variable set to an environment
  variable (`CACHE_HOST: cache.${NAMESPACE}.example.com`), or a `with:` value
  set to a group variable, showed and pasted with `[p]` as a literal
  `${NAMESPACE}`, and `[v]` checked `expect` against the literal; the shell
  then expanded it to an empty string. Manuals resolved the same chain only
  when the variables happened to be declared in the right order. Every
  engine now follows chains to the end, in any order; unknown names
  (`${HOME}`) and cycles are left as written.
- **Chained variables also resolve inside reusable files, loops and every
  manual format.** A reusable file's own default that references another
  default (`PORT: ${PORT_BASE}1`), a `with:` value that references another
  `with:` value, and a `foreach` value that references a common variable
  stayed literal everywhere. With `--env --resolve-vars`, the Confluence, ADF
  and HTML manuals now resolve step names, operation rollback names, the
  description and the environments table like the Markdown manual does.
- A sidecar capture whose tmux pane no longer exists no longer latches onto
  another tmux session's pane. tmux answers a query for an unknown pane with
  empty fields instead of an error, and the empty answer was then read as
  "the current pane": the pane name shown and the capture re-attach could
  land on an unrelated session.
- `validate` warns when a variable's value references a name that no layer
  defines (`cache.${NAMESPCE}.example.com`), and no longer reports a step's
  own `variables:` as undefined.
- `report merge` refuses sessions of different groups or environments. It
  merges steps by position, so two groups were blended into one report that
  claimed every step was completed.

### Added

- **Groups: several near-identical runbooks in one file.** Declare `groups:`
  at the top level (each with its own `variables`) and put `groups: [name]` on
  the steps, `uses:` entries or rollback steps that only some groups have.
  `--group <name>` selects one on `validate`, `generate manual|docs|schedule`,
  `diff` and `run`; `generate manual --all-groups --output-dir <dir>` writes
  `<dir>/<group>/<file>.md` for every group. An operation with groups needs a
  group on every command except `validate`, which checks them all. See
  `docs/groups.md` and `examples/deployment-with-groups.yaml`.
- A run now records which runbook it was. `report.md` starts its summary with
  `Operation`, `Environment` and `Group`, `events.jsonl` has the same fields on
  `session_start`, and `samaritan sessions` lists the group. Before, two groups
  of one file produced reports that could not be told apart.
- `run` and `resume` resolve `${VAR}` in step and rollback names, so the step
  heading and `report.md` read `Deploy web-server`, not `Deploy ${APP}`.
- `[t]` pane picker lists named windows as `session:windowName.pane` (with the
  pane id) and checks your answer against the panes as they are when you
  answer: a number picks the pane by id, a pane that closed meanwhile re-lists
  with a warning, `r` refreshes. Names and ids can be typed too.
- `[y]` on a long command that goes quiet without returning to the prompt (a
  polling loop's `sleep` behind ssh) prints `may still be running` instead of
  `Finished`, and a failed check then reads `⏳ Command may still be running —
  output not final yet.` with `v=re-verify` first and no `y=re-run`.
- `[e]` on a step with no new pane output captures the pane screen, so a
  "record the result" step needs one key instead of retyping what is on screen.
  While required evidence is missing, `e evidence` is shown on the step bar and
  the gate line says `press [e] then ↵ to capture the pane output`.
- The first sidecar step with a pane prints the `p → y → ↵` flow once.
- Sidecar failed-verify prompt: `y=re-run` pastes the command again, presses
  the guarded Enter, waits and re-verifies — one key per attempt. The prompt is
  now single-key.
- Sidecar `↵` with nothing pasted or run in the attached pane since the step
  started asks `Mark done anyway?` (catches a stray Enter after a verify pass).
  `y` is logged as `done_without_run` and noted on the step in `report.md`.
- `[b]`/`[j]` accept the manual's step number (`2.7`) or part of the step name.
- `validate` warns (`expect-lint:`) when a `contains`/`any_line_contains` value
  also appears in the step's command, or is a bare short number.

### Fixed

- An attached pane stays attached when tmux renumbers the window. Before,
  closing an earlier pane in the window made `[p]` paste into whichever pane
  took the old position, including samaritan's own.
- The `[t]` picker listed no panes on tmux 3.4 (tmux prints TAB as `_` in
  `list-panes` output) and always asked for a raw target.
- Failed-verify prompt: Enter no longer reads `stop`. In `[v]` it always went
  back to the step bar and now says so (`Enter=back to step`). In non-sidecar
  `automatic` mode, where it stopped the run, stopping now takes `q`.
- Evidence captured from the pane is stored without terminal colour codes.
- `[v]` on a step without `expect` (and other keys that do not apply to the
  step, such as `[p]` without a command) no longer marks the step done.
- `validate --strict` counts `evidence.required` on sub-steps before warning
  `No steps require evidence collection`.

### Breaking Changes

- **Removed the deprecated flat evidence fields `evidence_required` and
  `evidence_types`.** These were superseded by the nested `evidence:` object and
  are no longer parsed, validated, or rendered. The parser now throws a clear
  migration error if either field appears in a step (or rollback step).

  **Migration** — replace:

  ```yaml
  - name: Deploy
    command: kubectl apply -f deployment.yaml
    evidence_required: true
    evidence_types: [command_output]
  ```

  with the nested form:

  ```yaml
  - name: Deploy
    command: kubectl apply -f deployment.yaml
    evidence:
      required: true
      types: [command_output]
  ```

  All bundled examples, fixtures, and the `init`/`create` scaffolding templates
  already use the nested form.
