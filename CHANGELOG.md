# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **`aggregate_step_rollbacks` keeps each step's own rollback entries in the
  order you wrote them.** Only the steps are reversed. Before, the whole entry
  list was reversed, so a step's `restore` → `verify restore` came out as
  `verify` → `restore`. If you wrote entries in reverse to work around this,
  put them back in their natural order.

### Fixed

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
