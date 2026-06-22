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
| `qrh` | Quick Reference Handbook (scaffold only, no DB yet) |

## Key flags

### validate
- `--lint` — run shellcheck over `command`/`script` (warnings by default).
- `--strict` — promote lint warnings and schema warnings to errors.

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
- `q` / `quit` — **aborts** the operation, persists session as `paused` (resumable)

## Run artifacts

Each `run`/`resume` writes a black box beside the operation at
`<op-dir>/.samaritan-runs/<id>/`:
- `events.jsonl` — append-only event stream
- `report.md` — always-on per-step verification ledger + approval trail

`.samaritan-runs/` is gitignored (force-add to commit a run). Sessions also
persist to `~/.samaritan/sessions/<id>.json` for `resume`.
