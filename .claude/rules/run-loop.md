---
paths:
  - "src/cli/commands/run.ts"
  - "src/lib/**"
  - "src/lib/**/*.ts"
---

# Interactive run loop (`run` / `resume`)

`samaritan run` is implemented (interactive loop only — NOT non-interactive
execution). **Default mode is `sidecar`**: SAMARITAN DISPLAYS each step's
resolved command but does NOT send it to tmux — the operator runs it, then
presses `↵` (verify & next) or `[v]` to verify `step.expect`. Other modes: `manual` (operator-driven,
tmux-optional), `automatic` (tmux-backed send/verify), `hybrid`. `CaptureBackend`
in `src/lib/capture-backend.ts`; `TmuxPaneCapture` in `src/lib/tmux-session.ts`.

Non-interactive command execution is NOT implemented — `--auto-approve` /
`automatic` marks steps complete without running commands. Automatic evidence
collection is NOT implemented. (Check `ROADMAP.md`.)

## Action keys — one-row bar, single keys, typos never act

Every bar goes through `promptBar(hints, commandToCopy?)` → `renderActionBar`
(`src/lib/tui.ts`): ONE row, hints in priority order filled to the terminal
width, then `? more` (`? help` when all fit; non-TTY = all shown). `?` prints
`renderKeyHelp` (every key, incl. ones cut from the row) + `captureRef.hint`.
`readActionKey(immediate)` takes the BAR's own key set (single-char keys of its
hints, minus `needsEnter` ones, plus `?`) — so `a` is immediate only on the
approval bar and the word `abort` still types on the sidecar bar. State lives in
the labels (no status row): `↵ verify & next`/`↵ next`, `p paste` (pane
attached) vs `t attach pane` (none), `e evidence!` (required, none) /
`e evidence·N`.

- Sidecar/manual bar: `↵` next, `v` verify, `p` paste, `t` attach/switch pane,
  `c` copy, `e` evidence, `x` remove evidence (once evidence exists — deletes
  the session record + the copied file in the run/session evidence dir; logged
  `evidence_removed`), `n` note, `s` skip, `b` back (not first step), `j` jump
  (not last), `r` rollback, `g` global rollback (when `operation.rollback`),
  `q`/`quit`/`abort`/`Ctrl+C` abort.
- Approval bar: `a` approve, `d` deny (`approve`/`reject`/`deny` words still
  accepted), `e`, `s`, `r` **+Enter** (`needsEnter: true`, rendered `r↵` — an
  immediate `r` fired rollback on the first letter of `reject`), `g`, `q`.
- **Unknown input never completes, skips or approves** (`warnUnknownKey`, stay on
  the bar). Free text + Enter used to complete the step with it as the note, and
  any unrecognised approval input used to `skipStep`. Notes go through `[n]` only.
- Automatic (non-sidecar) bars use `promptChoice(hints, isAutomaticBarChoice)`.
  `c` copy is handled INSIDE `promptBar` (it re-prompts) — it used to return `''`
  which then fell through to send/confirm.

## `↵` = verify & next

On a sidecar/manual step, bare `↵` with `step.expect` + a pane attached + not yet
in `verifiedSteps` calls `verifyManualOutput(..., advancing=true)`; the step
completes only on `'pass'`/`'override'` (`VerifyOutcome`). PASS/override add
the step to `verifiedSteps` (`[v]` too), so a later `↵` just advances. No pane →
completes with a warning + `user_input`/`verify_skipped`. The evidence gate runs
AFTER verify, so the PASS auto-capture satisfies it. The failure menu
(`promptAssertFailureAction`) is the same single-key bar: `↵` stay (or `stop
run` via `enterLabel` on the tmux-automatic path), `o` override, `v` re-verify,
`m` more, `c` copy command, `r` rollback.

## `[p]` paste — bracketed paste, never Enter

Pastes the `${VAR}`-resolved command via a tmux paste **buffer** with
**bracketed paste** (`set-buffer -b samaritan-send -- <cmd>` +
`paste-buffer -d -p -b samaritan-send -t <pane>`, argv from `buildPasteBufferArgs()`,
via `pasteBufferTo()` / `CaptureBackend.pasteCommand()`) and **never** appends
Enter — the operator reviews and runs it. The `-p` (bracketed paste) is
load-bearing: without it tmux injects embedded newlines as literal Enter, so a
multi-line command executes line-by-line instead of landing atomically. This is
the ONLY write path in the otherwise read-only `CaptureBackend`
(`pasteCommand?` optional; both `TmuxSession` and `TmuxPaneCapture` implement
it). Emits a `user_input`/`action:'send_to_pane'` breadcrumb — deliberately NOT
`command_sent` (which `foldEvents` would fold into a misleading duplicate
"Command sent" row; sidecar never executes). Smoke-test in real tmux: the
command lands WITHOUT a trailing newline.

`buildPasteBufferArgs` stores `normalizePasteText(cmd)`: CRLF/CR → LF (tmux
rewrites LF→CR, so `\r\n` became `\r\r` — a blank line after each `\`
continuation and a broken command), trailing newlines stripped (a YAML `|`
block's final `\n` is an Enter in a non-bracketed shell). A multi-line command
(`isMultiLinePaste`) asks `Paste it? [y / Enter=cancel]` before pasting —
sh/dash ignore bracketed paste and run each line on arrival, and tmux 3.4
exposes no pane flag to detect that. e2e regression in
`tests/e2e/sidecar-tmux.e2e.ts` (CRLF continuation block).

## Step heading — single-env manual numbering

`flattenAndMarkForEnv` labels steps with `childStepLabel` (`src/lib/step-position.ts`):
dotted `10.2`, `10.2.1` — the numbering of `generate manual --env`, since a run
always targets one env (NOT the multi-env `10b`/`10b1` letters).
`describeStepPosition` renders `[Step 10.2 · 34/46]` (flat position = what
`[b]`/`[j]`/`--from-step` take) plus `Section :` (parent) and
`Next : … (N remaining)` (env-filtered steps excluded). Top-level detection for
the `needs` dep graph is still `/^\d+$/` on the label.

## `[b]` back / `[j]` jump / `--from-step`

`executor.goToStep(index)` (rewind) resets the target + every later step to
`pending`, rewinds counters, sets `currentStepIndex`. `executor.jumpToStep(target)`
marks every still-`pending` step from `currentStepIndex` up to `target` as
`skipped` (emitting `step_skipped`). Both reuse the SAME `navTarget` +
`i = target - 1; continue` mechanism; the loop branches on `navIsJump` to pick
the method and log `action:'jump'` vs `'back'`. `run --from-step <N>` calls
`jumpToStep(N-1)` after `startInteractive()` — distinct from `resume --from-step`
(uses `resumeFromIndex`, marks earlier steps `completed` not `skipped`).
Append-only `events.jsonl` is never rewritten. A `step_skip` event (folded to
`status:'skipped'`) is emitted so jumped-over steps render honestly. Both
`goToStep`/`jumpToStep` reuse the closed `operation_started` `ExecutionEventType`
so the event union stays closed.

## Evidence-required gate — inlined into the action bar (no sub-menu)

`needsEvidenceGate(i, step)` gates completing a step whose `evidence.required` is
true with zero captured items. The check lives INSIDE the action bar (two sites:
the manual/sidecar inner loop after the `↵` verify, and the `approval` branch's
`while(true)` bar on `a`) — it prints a one-line inline warning (pointing at
`e` then `↵` when a pane is attached) and `continue`s the same bar. `[e]` capture
(typed text / link counts) = done; `[s]` skip = not done (records `skipped`).
The approval `for` is labelled `stepLoop:` so the `while` can `continue`/`break
stepLoop`. Enforcement is `requireEvidence` (`options.requireEvidence !== false`,
ON by default; `--no-require-evidence` disables). Does NOT gate plain
`type: automatic` steps. Fixture `evidence-required.yaml`.

## `[e]` evidence — single-key sub-bar

`captureEvidence(i, captureSinceStepStart, command)`: `↵` pane output
(`stripCommandEcho(cleanTerminalOutput(raw), command)`, tail preview via
`tailOfOutput`), `i` clipboard image (`readClipboardImage` in
`src/lib/clipboard.ts`: osascript / PowerShell / wl-paste / xclip, PNG-magic
checked, argv-only), `f` file, `t` text — a single `http(s)` URL becomes a
`link` item (`parseEvidenceLink`, `src/lib/evidence-link.ts`, strips
`user:pass@`). One description prompt with a default. Files go to
`getRunEvidenceDir(operationFile, sessionId)` = `<run-dir>/evidence/` (fallback
`getSessionEvidenceDir`), so `redactLocalPaths` turns the report link into a
relative `evidence/<file>` that renders. `link` is an `EvidenceType`, an
`evidence.types` schema value (not `results`), and renders
`[label](url)` in `report-generator.ts`.

## `q`/`Ctrl+C` abort — both SAVE (paused/resumable)

`q`/`quit` aborts (was: recorded a note + completed). `runInteractiveStepLoop`
installs one `onAbortSignal` handler on `process.on('SIGINT')` + `rl.on('SIGINT')`;
the raw-mode `readActionKey` Ctrl+C branch re-raises via
`process.kill(process.pid, 'SIGINT')` (raw mode swallows terminal SIGINT). The
handler cancels the executor, runs shared `finalizeRun()` (closes readline+logger,
writes `step_log` + `report.md`), calls `sessionManager.pauseSession`, prints the
resume hint, exits 130. Guarded by an `aborting` flag, removed in `finally`. JSONL
`session_end` still records `status: cancelled`.

## `--pic` multi-operator focus mode

The ONLY place `step.pic` drives control flow (elsewhere it's display/report
metadata). `resolveFocusPic(options.pic)` + `stepBelongsToFocus(step, focusPic)`
(exported from `run.ts`) gate the loop: with `focusPic` set and `skipOthers`
(not `--no-skip-others`), a step whose `pic` differs is auto-skipped via
`executor.skipStep(i)` + `logSkip(i)` BEFORE its `step_start`. No `pic` = shared
(shown to everyone); matching `pic` = own. Section-header parents never filtered.
Bare `--pic` → `$USER`; absent → focus off. Focused PIC becomes the session
operator. Not persisted (re-read on `resume`). `focusPic`/`skipOthers` are the
10th/11th params of `runInteractiveStepLoop`. `report merge <session...>`
(`src/lib/report-merge.ts` `mergeSessions`) consolidates operators' partial runs
of the same operation (keyed by `operation_file`); `mergeStepRecords` picks the
most-complete record per index (completed > failed > skipped > pending).

## Verify output cleaning & sidecar UX

`StepController.verifyOutput` passes pane captures through `cleanTerminalOutput()`
(`src/lib/assertions.ts`, strips ANSI/OSC, resolves `\r` overwrites) then
`stripCommandEcho(cleaned, command)` (the `${VAR}`-resolved command) — the pane
slice since step start begins with the echoed command, so without this both the
assertion and the highlighted tail would match the command text instead of its
OUTPUT. `stripCommandEcho` anchors on the **FIRST** consecutive run of the
command block (each output line matched by `endsWith` — the first echoed line
carries the prompt, continuation lines a PS2 `> ` prefix) since the echo always
precedes its output, then consumes any immediately-repeated copies whose leading
line is byte-identical to the anchor's (a genuine readline/SSH redraw), keeping
only what follows. Anchoring on first-plus-identical-repeats (NOT the last match)
is what stops a real RESULT line that merely *ends with* a short command — e.g.
`file.ls` after `ls` — from being dropped as if it were the echo. No-op fallback
when no command is passed or no echo is found (never makes a working capture
worse). `verifyOutput` also returns `detailed` (`assertOutputDetailed()` —
evaluates ALL checks, no short-circuit; `assertOutput` still short-circuits).
`verifyManualOutput` loops via `renderVerifyOutcome(detailed, expect,
{expand})` (PASS/FAIL header, per-check checklist, highlighted output tail
`VERIFY_OUTPUT_TAIL_LINES=12`). On FAIL, `promptAssertFailureAction` offers
`↵` stay/`o`/`r`/`c` (copy resolved command)/`m` (full output)/`v` (re-capture).

## Retryable verification (`expect.retry`)

`StepController.runVerify` polls on a failed assertion: waits `interval`
(`parseInterval`: `5s`/`500ms`/`2m`/bare ms), re-captures, re-asserts up to `max`
times (`src/lib/retry-assert.ts`). Optional `expect.retry.while` (substring or
regex) only retries transient-matching failures (`isRetryableOutput`/`shouldRetry`).
Sleep is injectable via `StepControllerOptions.sleep` for tests. (`step.retry`
step-level command re-execution remains a ROADMAP item — unimplemented.)

## Auto-capture on verify

The first passing verify (`↵` or `[v]`) per step auto-records the verified pane output as
a `command_output` EvidenceItem (`src/lib/verified-evidence.ts`
`buildVerifiedEvidenceItem`; `automatic`/`validated`, `metadata.source:'verify'`,
deduped per step). Content comes from the pane's **rendered screen**
(`capturePaneScreen()` → `tmux capture-pane -p -J`, optional
`CaptureBackend.captureScreen()`), NOT the raw `pipe-pane` slice used for the
assertion. `captureVerifiedEvidence` (in `run.ts`) takes a `captureScreen`
closure; falls back to `cleanTerminalOutput(rawSlice)`.

## Step-index persistence gotcha

The executor emits `step_completed` BEFORE advancing `currentStepIndex`, so the
event-driven save records a stale index. The interactive loop calls
`persistProgress()` (`updateSessionFromExecutor`) after every
`executeStepManually` to persist the post-advance index — without it, `resume`
repeats the just-completed step.

## Run artifacts

Every `run`/`resume` writes an append-only `events.jsonl` AND an always-on
`report.md` beside the operation at `<op-dir>/.samaritan-runs/<id>/` (helpers
`getRunDir`/`getRunLogPath`/`getRunReportPath` in `src/lib/session-persistence.ts`,
writable fallback to `~/.samaritan/sessions/<id>/`). `.samaritan-runs/` is
gitignored (force-add to commit). Events are folded into records by
`src/lib/session-log.ts` (`foldEvents`/`buildStepRecords`/`readEvents` — single
source of truth for the persisted `step_log` and the report). When adding a
`StepRecord` field, update the `foldEvents` case that populates it AND the
`renderStep` block that displays it. **Report sanitization:** every
command/output/evidence body goes through `cleanTerminalOutput()` then
`redactLocalPaths()` (`src/lib/path-redact.ts` — home `→ ~`, run dir + operation
dir stripped to relative tail; only absolute bases of length > 1). Keep any new
rendered path/command/output field routed through the same clean/redact pair.

## Capture setup — work pane create/reuse (`src/lib/tmux-workspace.ts`)

`run` AND `resume` call `captureStrategy()` → `pickCaptureStrategy` then
`setupCapture()`. Precedence: `--attach` (sidecar) → `sessions:` bootstrap →
`work-pane` (sidecar + `$TMUX` + `stdin.isTTY` + not `--no-tmux`) → `relaunch`
(sidecar + no `$TMUX` + `--tmux`) → none. Piped stdin NEVER creates panes
(tests/CI). `ensureWorkPane(tag)` reuses the pane in samaritan's window whose
`@samaritan` pane option = `workPaneTag(operation.name)`, else
`split-window -h -d -P -F '#{pane_id}'` + `set-option -p`. `relaunch` runs
before a session is created (one session only): `new-session -s
samaritan-<tag>`, or `new-window` + `attach-session` when it exists. Every
strategy prints `attachHint(...)` (sessions inside tmux → `switch-client`,
never a nested `attach`), passed to the loop as `captureHint` for `?`.
Teardown only closes the pipe — the work pane is the operator's shell and is
reused next run. `--tmux`/`--no-tmux` on run + resume (Commander: both defined →
`options.tmux` true/false/undefined); resume also takes `--attach`. The old
`src/lib/iterm2.ts` (`openDisplaySplits`, never called) was deleted.

