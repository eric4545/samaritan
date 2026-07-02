# SAMARITAN CLI Reference

Run `samaritan <command> --help` for authoritative flags. Locally use
`npm start -- <command>`.

## Commands

| Command | Purpose |
|---|---|
| `init` | Initialize SAMARITAN config in a repo |
| `create operation` | Interactive scaffold of a new operation YAML |
| `validate <file>` | JSON-Schema validation of an operation |
| `generate manual <file>` | Render a Markdown runbook |
| `generate confluence <file>` | Render Confluence ADF (JSON) |
| `schema` | Export the JSON schema (IDE / tooling integration) |
| `run <file>` | Drive an operation interactively |
| `resume <session-id>` | Resume a paused session |
| `sessions` | List saved sessions (`--all` for everything) |
| `serve <file>` | **[EXPERIMENTAL]** Local web UI: env tabs, all-steps sidecar view, evidence upload, history. Display-only, localhost by default |
| `qrh` | Quick Reference Handbook (scaffold only, no DB yet) |

## Key flags

### validate
- `--lint` — run shellcheck over `command`/`script` (warnings by default).
- `--strict` — promote lint warnings and schema warnings to errors.
- Always runs a built-in regex-lint over `expect` regex fields (`matches`,
  `all_lines_match`, `any_line_matches`, `no_line_matches`, `retry.while`):
  uncompilable patterns are errors; ReDoS-prone ones (e.g. `(a+)+`) are warnings
  (errors under `--strict`). No flag needed — regex compilation is built-in.

### generate manual / confluence
- `--env <name>` — single-environment heading format. Omitting it produces the
  multi-environment table format. These are two distinct rendering paths.
- `--output <path>` — write to file (defaults to stdout for Markdown).
- `--resolve-vars` — substitute `${VAR}` against the selected env's variables at
  generation time.

### run
- Default mode is **sidecar**: SAMARITAN displays each resolved command but does
  NOT send it to tmux — the operator runs it, then presses `[v]` to verify
  `step.expect`.
- Other modes: `manual`, `automatic` (tmux-backed send/verify), `hybrid`.
- `--mock` — replay each step's `expect` against `evidence.results[<env>]` output;
  prints PASS/FAIL/SKIP, exits non-zero on failure. No tmux/execution.
- `--attach <tmux-target>` — attach to an existing tmux pane instead of spawning.
- `--report <dir>` — write an extra copy of the run report.
- `--auto-approve` — note: `automatic` context marks steps complete WITHOUT
  running commands (non-interactive execution is a roadmap item, not real).

## Interactive run loop actions

Per manual/sidecar step:
- `[n]` note — free-text annotation
- `[e]` evidence — capture pane output / attach file / paste text
- `[x]` remove evidence — only shown once evidence exists
- `[v]` verify — run `step.expect` against captured pane output
- `[t]` attach pane — (sidecar) attach/swap a tmux capture backend mid-run
- `[p]` send to pane — (sidecar) paste the resolved command into the attached pane WITHOUT Enter (operator reviews + runs it); only when the step has a command and a pane is attached. Re-run during verify = `[p]` then `[v]`
- `[b]` back — go back to an earlier step and re-run from there (resets it + later steps to pending; audit log keeps the prior attempt); not offered on the first step
- `[r]` rollback — run *this step's* `rollback`, stay on the step
- `[g]` global rollback — only when the operation declares a top-level `rollback:`. Previews + runs the consolidated recovery (explicit `rollback.steps` + every **completed** step's rollback in reverse order when `aggregate_step_rollbacks: true`), then aborts the operation
- `q` / `quit` — **aborts** the operation, persists session as `paused` (resumable)

### serve [EXPERIMENTAL]

- `samaritan serve <file>` starts a local `node:http` server (no new npm
  deps) rendering the operation as a self-contained single-page web UI.
- Flags: `--port <n>` (default 4600), `--host <host>` (default `127.0.0.1`),
  `--env <name>` (initial environment tab), `--no-open` (no-op — samaritan
  never auto-opens a browser; it always just prints the URL).
- Routes: `GET /api/operation` (per-env resolved view model), `GET
  /api/history` / `GET /api/history/:id`, `POST /api/runs`, `POST
  /api/runs/:id/steps/:index`, `POST /api/runs/:id/steps/:index/evidence`.
- **Commands are DISPLAY-ONLY** — the server never executes/spawns/sends a
  step's `command`/`script` (same rule as terminal sidecar mode). Evidence
  uploads and step status/notes persist to the same
  `~/.samaritan/sessions/<id>.json` + evidence dir that `run` uses.
- Binds to `127.0.0.1` by default — this is a local operator tool, not a
  hosted service.

## Run artifacts

Each `run`/`resume` writes a black box beside the operation at
`<op-dir>/.samaritan-runs/<id>/`:
- `events.jsonl` — append-only event stream
- `report.md` — always-on per-step verification ledger + approval trail

`.samaritan-runs/` is gitignored (force-add to commit a run). Sessions also
persist to `~/.samaritan/sessions/<id>.json` for `resume`.
