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
| `generate postmortem <file>` | Render a postmortem/incident report (RCA); `-f markdown\|confluence\|adf` |
| `postmortem from-run <session\|jsonl>` | Seed a postmortem YAML from a captured run record |
| `postmortem init` | Write a blank postmortem authoring template |
| `report <jsonl>` | Render a Markdown evidence report from a run log |
| `schema` | Export the JSON schema (IDE / tooling integration) |
| `run <file>` | Drive an operation interactively |
| `resume <session-id>` | Resume a paused session |
| `sessions` | List saved sessions (`--all` for everything) |
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

### generate postmortem / postmortem from-run
- `generate postmortem <file>` renders a **postmortem / incident report (RCA)** —
  a separate document type from operations (its own schema
  `src/schemas/postmortem.schema.json`; see `reference/postmortem-yaml.md`).
- `-f, --format markdown|confluence|adf` (default `markdown`); `-o` writes to a
  file, otherwise stdout. Confluence output wraps the Mermaid timeline in the
  `{markdown}` macro (same pattern as the operation Gantt).
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
  prints PASS/FAIL/SKIP, exits non-zero on failure. No tmux/execution.
- `--attach <tmux-target>` — attach to an existing tmux pane instead of spawning.
- `--from-step <N>` — start at step N; earlier steps are recorded as **skipped**
  (distinct from `resume --from-step`, which marks earlier steps completed).
- `--report <dir>` — write an extra copy of the run report.
- `--auto-approve` — note: `automatic` context marks steps complete WITHOUT
  running commands (non-interactive execution is a roadmap item, not real).
- `--no-require-evidence` — disable the evidence-required gate (see below);
  also available on `resume`.

## Interactive run loop actions

Per manual/sidecar step:
- `[n]` note — free-text annotation
- `[e]` evidence — capture pane output / attach file / paste text
- `[x]` remove evidence — only shown once evidence exists
- `[v]` verify — run `step.expect` against captured pane output
- `[t]` attach pane — (sidecar) attach/swap a tmux capture backend mid-run
- `[p]` send to pane — (sidecar) paste the resolved command into the attached pane WITHOUT Enter (operator reviews + runs it), using **bracketed paste** (`paste-buffer -p`) so multi-line commands land as one atomic block instead of executing line-by-line; only when the step has a command and a pane is attached. Re-run during verify = `[p]` then `[v]`
- `[b]` back — go back to an earlier step and re-run from there (resets it + later steps to pending; audit log keeps the prior attempt); not offered on the first step
- `[j]` jump — jump **forward** to a later step; the current step through the target are recorded as **skipped** (⏭) in the report, execution resumes at the target; not offered on the last step. Startup equivalent: `run --from-step <N>`
- `[r]` rollback — run *this step's* `rollback`, stay on the step
- `[g]` global rollback — only when the operation declares a top-level `rollback:`. Previews + runs the consolidated recovery (explicit `rollback.steps` + every **completed** step's rollback in reverse order when `aggregate_step_rollbacks: true`), then aborts the operation
- `q` / `quit` / `Ctrl+C` — **aborts** the operation, persists session as `paused` (resumable) and prints a resume hint (`Ctrl+C` saves too — it no longer hard-quits without saving)

## Evidence-required gate

When a step has `evidence: { required: true }`, completing it (`manual`/sidecar
`Enter`, or `approval`'s `approve`) is **blocked** by default until `[e]`
captures at least one evidence item (a typed-text note counts). There is no
separate gate menu — trying to complete with nothing captured just prints a
one-line warning **on the same action bar** (`⚠️  This step requires evidence
— press [e] to capture … or [s] to skip.`) and keeps you there. `[s]` skips
the step (recorded as skipped, not completed). Disable with
`--no-require-evidence`. Does NOT gate plain (non-sidecar) `type: automatic`
steps.

## Run artifacts

Each `run`/`resume` writes a black box beside the operation at
`<op-dir>/.samaritan-runs/<id>/`:
- `events.jsonl` — append-only event stream
- `report.md` — always-on per-step verification ledger + approval trail; terminal-escape noise is cleaned from captured output and operator-local path prefixes (home `→ ~`, run dir, operation dir) are stripped so it's safe to share

`.samaritan-runs/` is gitignored (force-add to commit a run). Sessions also
persist to `~/.samaritan/sessions/<id>.json` for `resume`.
