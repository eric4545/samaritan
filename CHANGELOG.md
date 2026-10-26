# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

### Added

- **Configurable tmux session name — `run.tmux_session`.** Names the tmux
  session holding the `sessions:` windows (default `samaritan-${SESSION_ID}`).
  `${VAR}` resolves at run time, with built-ins `${ENV}`, `${SESSION_ID}` and
  `${OPERATION_ID}` — e.g. `${TICKET}-${ENV}` → `GCSGPSOPS-17034-sbx`, so an SBX
  command can't be pasted into a DEV pane. An unresolved variable stops `run` /
  `resume` before anything starts.
- **Reuse of an existing tmux session with that name.** Instead of spawning a
  duplicate, samaritan adopts the windows named after `sessions:` keys as-is
  (it types nothing into them, not even `ssh`), adds any missing ones, and never
  kills a session it did not create. `resume` after `Ctrl+C` re-adopts the
  run's own session.
- **`run.default_session`** — the `sessions:` key for steps and rollback steps
  with no `session:`, so `[p]` and `[v]` work for them. Run-time only;
  manuals are unchanged. `validate` errors when it names an undeclared session.

### Fixed

- `run --var KEY=VALUE` was silently ignored (Commander stored it as
  `options.var`, the runner read `options.variables`).
- The `[t]` pane picker listed no panes on tmux 3.4+: tmux rewrites a TAB in
  `-F` output to `_`, so the tab-separated rows never parsed.
- Spawned windows are addressed by stable pane id instead of `<session>:<i>.0`,
  which broke under a `base-index 1` tmux config.
