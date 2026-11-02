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

### Added

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
