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
- `--attach <tmux-target>` — attach to an existing tmux pane instead of spawning. It wins over `sessions:`: named sessions are not spawned and every step (whatever its `session:`) captures from / pastes into this one pane; `[t]` switches the pane mid-run; `resume` re-attaches it the same way. One samaritan run per pane: tmux allows one `pipe-pane`, so a second run on the same pane takes it over (warned); the first run detects that at its next step/`[v]`, re-attaches, and verifies from the pane scrollback.
- `--from-step <N>` — start at step N; earlier steps are recorded as **skipped**
  (distinct from `resume --from-step`, which marks earlier steps completed).
- `--report <dir>` — write an extra copy of the run report.
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
  sessions are from different operations.

## Interactive run loop actions

Per manual/sidecar step:
- `[n]` note — free-text annotation
- `[e]` evidence — capture pane output / attach file / paste text
- `[x]` remove evidence — only shown once evidence exists
- `[v]` verify — run `step.expect` against captured pane output. A PASS never completes the step: `↵` does. On a TTY, keys typed in the same burst as an action key are discarded (`v⏎` = verify only), and a second bare `↵` within 400 ms of an acted-on one (no other key between) is ignored (`Enter ignored: pressed twice`), so a double press never completes the next step
- **Compact step bar** (`src/lib/step-actions.ts` `stepActionHints`): shows `y` (armed) · `↵` · `p` · `v` · `t` (only while no pane is attached) · `s` · `r` · `?` more; `?` prints the rest (`c`, `n`, `e`, `x`, `t` attach another pane, `b`, `j`, `g`, `abort`). Hidden keys still work without `?`. With a pane attached the command header reads `Command — [p] pastes it into <pane>:` (`runCommandHeader`), else `Run this command in your terminal ([t] attaches a pane for [p]/[v]):`
- `[t]` attach pane — (sidecar) attach/swap a tmux capture backend mid-run
- `[p]` send to pane — (sidecar) paste the resolved command into the attached pane WITHOUT Enter (operator reviews + runs it), using **bracketed paste** (`paste-buffer -p`) so multi-line commands land as one atomic block instead of executing line-by-line; only when the step has a command (or a `script:`, whose `bash <path>` invocation is pasted) and a pane is attached. Re-run during verify = `[p]` then `[v]`. Before pasting, CRLF/CR becomes LF and trailing newlines are stripped (tmux LF→CR would otherwise turn a stray `\r` into a blank line that breaks `\` continuations). Multi-line commands paste with no confirmation prompt (bracketed paste lands them as one un-run block in bash ≥ 4.4 / zsh ≥ 5.1); shells without bracketed paste (sh/dash) would run each line as it arrives. While a paste is still un-run on the pane's input line (cursor line ends with it), `[p]` is refused until it is run or cleared (Ctrl+U), and `↵` on that step asks `Mark done anyway? [y / n=go back]` (`y` → `paste_not_run` event + ⚠️ report note); same for rollback `p`/`↵`
- Step headings read `[Step 10.2 · 34/46]`: the single-env manual number (`generate manual --env`, dotted sub-steps) plus the flat run position (the number `[b]`/`[j]`/`--from-step` use), followed by `Section :` (the parent) and `Next : … (N remaining)` lines
- `[y]` run it — (sidecar, only right after a `[p]` paste, forward or rollback) samaritan presses Enter in that pane (`send-keys -t <%pane_id> Enter`) ONLY while the pane is exactly as the paste left it: same live pane, not in copy/view mode, `synchronize-panes` off, input not disabled, same `pane_current_command`, and NO pane output / cursor / prompt-row change since the post-paste snapshot (so an edited or already-run command is never sent). Refusals print `🛑 Enter NOT sent: <reason>`, send nothing and keep `[y]` armed. After Enter it waits (`⏳ Running…`) until the pane is back at its pre-paste prompt (digits normalized) and quiet 0.3s — or 3s quiet with the shell in front when the prompt changed — then auto-runs `[v]` (step or rollback-entry `expect`); a different foreground program (silent `kubectl`) keeps it waiting; any key stops waiting. Not carried across steps. Logged `user_input`/`enter_sent`; report shows `⏎ Enter sent from samaritan [y]`. No flag/config
- A **script-only step** (`script:` with no inline `command`) displays `Script: <path>`, the embedded script content, and a `bash <path>` runnable; `[c]` copy and `[p]` send-to-pane act on that `bash <path>` invocation
- `[b]` back — go back to an earlier step and re-run from there (resets it + later steps to pending; audit log keeps the prior attempt); not offered on the first step. With steps in between, it first asks `Re-run only "<picked>", then come back to "<current>"? [y / n=rewind]`: `y` resets only the picked step and returns to the current one after it, leaving the in-between steps' status untouched (events `rerun` / `rerun_return`); `n` = the rewind
- `[j]` jump — jump **forward** to a later step; the current step through the target are recorded as **skipped** (⏭) in the report, execution resumes at the target; not offered on the last step. Startup equivalent: `run --from-step <N>`
- `[r]` rollback — run *this step's* `rollback`, stay on the step. Sidecar/manual rollback is operator-driven per entry: `↵` done — I ran it · `p` paste into pane (no Enter) · `c` copy · `v` verify its `expect` · `s` skip · `a` abort rollback; commands are `${VAR}`-resolved and the report records completed / partial / NOT executed (never an assumed success). Only non-sidecar spawn-own `sessions:` runs send rollback commands via tmux. When this step has no rollback of its own, offers the **nearest upstream** step's rollback instead (needs chain first, else document order; only completed steps qualify).
- `[g]` global rollback — only when the operation declares a top-level `rollback:`. Previews + runs the consolidated recovery (explicit `rollback.steps` + every **completed** step's rollback in reverse order when `aggregate_step_rollbacks: true`; ordered by reverse-topological order when `needs` are present) after a single-key `y`, then aborts the operation. After the last step an **All steps done** screen still offers `r`/`g` before the run exits
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

**Forward gating (`needs`):** before a step whose `needs` aren't all completed (e.g. a dependency was skipped by `[j]` jump or `--from-step`), the run loop warns (`⚠️ This step needs: …`) and prompts `Start anyway? [y=proceed / Enter=go back]`. `y` proceeds (logging a `needs_override` audit event); Enter rewinds to the first unmet dependency. Skipped ≠ completed.

## Run artifacts

Each `run`/`resume` writes a black box beside the operation at
`<op-dir>/.samaritan-runs/<id>/`:
- `events.jsonl` — append-only event stream
- `report.md` — always-on per-step verification ledger + approval trail; terminal-escape noise is cleaned from captured output and operator-local path prefixes (home `→ ~`, run dir, operation dir) are stripped so it's safe to share. Counts only genuinely completed steps (`Steps completed: N/total`); an aborted/cancelled run flags where it stopped — an `Aborted at step N: <name>` summary line plus a `🛑 (aborted here — in progress)` marker on the in-progress step's heading

`.samaritan-runs/` is gitignored (force-add to commit a run). Sessions also
persist to `~/.samaritan/sessions/<id>.json` for `resume`. A sidecar session
saves its attached pane (`--attach`/`[t]`) as the stable pane id (`%3`) in
`attach_target`; `resume` re-attaches it (warns if the pane is gone), and
`resume --attach <pane>` overrides it. Samaritan never attaches to its own pane.
