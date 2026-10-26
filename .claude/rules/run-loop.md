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
presses `[v]` to verify `step.expect`. Other modes: `manual` (operator-driven,
tmux-optional), `automatic` (tmux-backed send/verify), `hybrid`. `CaptureBackend`
in `src/lib/capture-backend.ts`; `TmuxPaneCapture` in `src/lib/tmux-session.ts`.

Non-interactive command execution is NOT implemented — `--auto-approve` /
`automatic` marks steps complete without running commands. Automatic evidence
collection is NOT implemented. (Check `ROADMAP.md`.)

## Action keys

- `[n]` note, `[e]` evidence (capture pane / attach file / paste text), `[x]`
  remove evidence (only shown once evidence exists — deletes from the session
  record and from `~/.samaritan/sessions/<id>/evidence/` on disk; logged
  `evidence_removed`), `[v]` verify (`step.expect` against captured output).
- Sidecar-only: `[t]` attach pane (fires immediately, numbered picker from
  `listTmuxPanes()`), `[p]` send to pane (when step has a command + pane attached).
- `[b]` back (not on first step), `[j]` jump forward (not on last step),
  `[r]` per-step rollback, `[g]` global rollback (when `operation.rollback`
  exists), `q`/`quit`/`Ctrl+C` abort. See "Rollback delivery" below.

## Rollback delivery — operator-driven unless non-sidecar spawn-own tmux

`runRollback(rbSteps, i, context, ownerVars)` first `${VAR}`-resolves the
tree (`resolveRollbackTree`, recursive). ONLY `mode !== 'sidecar'` with a
spawn-own `tmuxSession` sends via `controller.runRollbackSteps` (send+Enter →
`status:'success'`). Everything else (sidecar `--attach`/`[t]`/spawn-own, and
manual without tmux) goes through `runOperatorRollback`: per entry it emits
`command_displayed` (+`context`), offers `↵` done · `p` paste (same
`pasteCommand` + multi-line confirm as forward `[p]`; logs
`user_input/send_to_pane` with `context`) · `c` · `v` (`verifyOutput(...,
context)` → the `assert_result` folds onto the rollback entry, NOT the step)
· `s` · `a`, then emits `rollback_step {index, outcome, verified?}`; finally
`rollback_complete {status: completed|partial|not_executed, executed, skipped,
total}`. NEVER emit `command_sent` or `success` for something only displayed
(the original bug: attach mode printed commands, sent nothing, logged
`command_sent` to a nonexistent `default` session, and `success`).
`StepController.rollback/runRollbackSteps` without tmux likewise log
`command_displayed` + `not_executed`. `foldEvents` routes ANY `context` on
`command_sent`/`command_displayed`/`pane_captured`/`assert_result`/
`user_input` to the open rollback record. After the loop, if the run reached
the end and `[r]`/`[g]` have something to undo, an **All steps done** screen
(`COMPLETION_KEYS`) offers them — skipped when readline is closed (`rlClosed`,
piped stdin) so scripted runs end as before. Single-key y/n via
`confirmKey()` (`readActionKey(CONFIRM_KEYS, prompt)`). e2e: "--attach
rollback" + "completion screen" (`e2e-rollback.yaml`).

## `[p]` send to pane — bracketed paste, never Enter

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
(`isMultiLinePaste`) asks `Paste it? [y / n=cancel]` (single key via `confirmKey`) before pasting —
sh/dash ignore bracketed paste and run each line on arrival, and tmux 3.4
exposes no pane flag to detect that. e2e regression in
`tests/e2e/sidecar-tmux.e2e.ts` (CRLF continuation block).

## `variants.<env>` resolved once, in `flattenAndMarkForEnv`

Every flat step is `mergeStepVariant(step, targetEnv)` before anything else
reads it, so display, `[c]`/`[p]`, `[v]`, evidence and rollback all see the
same overrides `generate manual --env` renders. Never read the authored
`operation.steps` in the loop — use `executor.getState().steps` / `flatSteps`.
Regression: `run-variants.yaml` + `run command: step variants.<env>`.

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
the manual/sidecar inner loop before the completion fall-through, and the
`approval` branch's `while(true)` bar with an added `[e]` key) — it prints a
one-line inline warning and `continue`s the same bar, re-rendering only the
key-hints. `[e]` capture (typed text counts) = done; `[s]` skip = not done
(records `skipped`). The old `[o]` override + `confirmEvidenceGate` were REMOVED.
The approval `for` is labelled `stepLoop:` so the `while` can
`continue`/`break stepLoop`. Enforcement is `requireEvidence`
(`options.requireEvidence !== false`, ON by default; `--no-require-evidence`
disables). Does NOT gate plain `type: automatic` steps. Fixture
`evidence-required.yaml`.

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
`stripCommandEcho(cleaned, command)` (the `${VAR}`-resolved command) then
`stripTrailingPrompt(text, promptLine)` — the pane slice ENDS with the next
shell prompt (unterminated last line), which would otherwise count as a line
for `line_count`/`all_lines_match` and break `equals`. `promptLine` is the
pane's cursor line (`CaptureBackend.promptLine?()` → `capturePaneCursorLine`,
`#{cursor_y}` + `capture-pane -S y -E y`), removed as a suffix; without it an
unterminated line ending in a prompt sigil is dropped. A failing `[v]` whose
check still holds a bare `$NAME` prints a "compared literally" hint
(`findShellVarRefs`, `src/lib/expect-lint.ts`; validate warns `expect-lint:`).
About `stripCommandEcho`: the pane
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
`verifyManualOutput` loops on `[v]` via `renderVerifyOutcome(detailed, expect,
{expand})` (PASS/FAIL header, per-check checklist, highlighted output tail
`VERIFY_OUTPUT_TAIL_LINES=12`). On FAIL, `promptAssertFailureAction` offers
`o`/`r`/`c` (copy resolved command)/`m` (full output)/`v` (re-capture)/Enter=stop.

## One `pipe-pane` per pane — ownership + repair

tmux allows ONE `pipe-pane` per pane; a second `--attach`/`[t]` to the same
pane silently replaced ours (A's pipe file stopped growing → every `[v]`
reported `missing:`). `TmuxPaneCapture.attach()` writes a per-pane owner marker
(`paneOwnerFile(<#{socket_path}#{pane_id}>)` → `{captureId, pid, since}`,
mode 0600) in the PRIVATE `~/.samaritan/panes/` (0700) — never `tmpdir()`
(CodeQL js/insecure-temporary-file: predictable names in a world-writable dir
invite planted symlinks; and pane ids restart at `%0` per tmux server, hence
the socket in the key) — and returns the live
`previousOwner` it took over (printed via `paneTakeoverWarning`).
`ensureCapture()` (optional on `CaptureBackend`) checks `#{pane_pipe}` + the
marker and re-attaches when closed or taken (`{status:'reattached', takenBy}`).
The loop's `repairCapture(sessionName)` runs at step start (before the offset
baseline) and inside `captureSinceStepStart`; a repair mid-step sets
`captureRef.interrupted`, and reads then come from `captureHistory()`
(`capture-pane -S -2000`) via `sliceFromLastCommandEcho` (trimEnd'd so the
prompt is last again). `teardown()` only closes the pipe + deletes the marker
while it still owns the pane. e2e: "two runs on one pane".

## Resume re-attaches the sidecar pane (`attach_target`)

`attachSidecarPane(sessionId, target, verb)` (run.ts) is the ONE attach path
for `run --attach` and `resume`: validate → `resolvePaneId()` → refuse when it
is samaritan's own pane (`isOwnPane`, `$TMUX_PANE`) → `attach()` →
`sessionManager.setAttachTarget(id, paneId)`. `[t]` saves the same way. ALWAYS
persist the STABLE `#{pane_id}` (`%3`), never the positional target: closing a
pane renumbers the window, and the old `work:0.0` then resolved to samaritan's
OWN pane (caught by the e2e). `resume` uses `--attach` ?? `session.attach_target`
(sidecar, no spawn-own tmux), warns `Saved tmux pane … no longer exists` when
gone, passes the backend to the loop and tears it down after. e2e: "abort →
resume re-attaches the --attach pane".

## Retryable verification (`expect.retry`)

`StepController.runVerify` polls on a failed assertion: waits `interval`
(`parseInterval`: `5s`/`500ms`/`2m`/bare ms), re-captures, re-asserts up to `max`
times (`src/lib/retry-assert.ts`). Optional `expect.retry.while` (substring or
regex) only retries transient-matching failures (`isRetryableOutput`/`shouldRetry`).
Sleep is injectable via `StepControllerOptions.sleep` for tests. (`step.retry`
step-level command re-execution remains a ROADMAP item — unimplemented.)

## Auto-capture on verify

The first passing `[v]` verify per step auto-records the verified pane output as
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
`cleanTerminalOutput` also drops DCS strings, every ESC form (`ESC ( B`, `ESC =`),
applies backspaces and strips remaining control bytes; `renderReport` ends with
`stripControlChars` over the whole document so report.md is always plain UTF-8.

**Verification = final state.** `verifyOutput` emits ONE `assert_result` per
attempt carrying `checks` (full detailed checklist) + `output`; `foldEvents`
keeps the LATEST attempt (`pass`, `checks`, `output`) and counts
`attempts`/`failedAttempts`. Legacy events without `checks` still AND-fold one
check per event. A `user_input`/`override` event sets `verification.override`
`{by, at, reason}` → rendered `⚠️ OVERRIDDEN` + reason line, a heading suffix
and a summary line — never a bare `❌ FAIL`.
