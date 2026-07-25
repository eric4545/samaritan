# Running an operation

Driving an operation interactively: sidecar mode, the action bar, verification, sessions and resume.

## Sidecar mode (default)

**Sidecar** is the default run mode (`-m sidecar`). Samaritan acts as your copilot: it displays each step's resolved command, *you* run it yourself in your own terminal, and samaritan validates `step.expect` **only when you press `[v]`**. No commands are ever sent automatically.

```bash
# Default — sidecar mode
samaritan run deployment.yaml --env staging

# Attach to an existing tmux pane so [v] can read its output
samaritan run deployment.yaml --env staging --attach mysession:0.0

# Mid-flight: press [t] at any step to attach a pane
```

Pressing `[t]` fires immediately (no Enter needed) and shows a numbered picker of all existing tmux panes — pick one by number, or type a raw target (`mysession:0.0`, `%3`). Samaritan's own pane is marked `(this pane — samaritan)`:

```
    Available tmux panes:
      1) work:0.0  zsh
      2) work:0.1  node  (this pane — samaritan)
    Select pane [number or target, Enter to cancel]:
```

**How sidecar attach works:**

| Scenario | What happens |
|---|---|
| `sessions:` defined in YAML | Samaritan bootstraps its own tmux session; prints `Attach with: tmux attach -t samaritan-<id>` |
| `--attach <target>` flag | Samaritan attaches a pipe-pane capture to your existing pane without touching your session |
| No sessions, no `--attach` | Prompt-only mode; `[v]` will indicate that you need `[t]` to attach a pane first |

**Caveats:**
- `--attach` mode uses a **single capture target** for all steps. Per-step `session:` routing is ignored; all capture reads come from the attached pane.
- `tmux pipe-pane` replaces any existing pipe on that pane when attaching.
- `samaritan` **never kills** your session on exit — only the temporary capture pipe and temp file are cleaned up.

**Step display in sidecar:**
- `type: automatic` steps: Command is displayed prominently; the `command_displayed` event is written to the audit log (not `command_sent`). The report renders it as `**Command (run by operator)**`.
- `type: manual` steps: Same prompt loop as always.
- **Script-only steps** (`script:` with no inline `command`): the run loop shows `Script: <path>`, embeds the script file's content, and displays the `bash <path>` invocation to run. `[c] copy` and `[p] send to pane` operate on that `bash <path>` invocation.
- Both types offer `[v] verify` (when `expect` is defined), `[t] attach pane`, and `[p] send to pane` (when the step has a command **or a `script`** and a pane is attached).

## Execution flow (spawn-own sessions)

```
samaritan run deployment-with-sessions.yaml --env production
  1. Creates a tmux session (samaritan-<id>)
  2. Bootstraps one window per named session (local or SSH)
  3. Starts pipe-pane background capture on every pane
  4. Launches the interactive TUI in the current terminal
  5. Writes all events to /tmp/samaritan-<id>.jsonl
```

In iTerm2, panes open as native vertical splits automatically. In any other terminal with tmux, panes are split inside the current window.

## Interactive prompts

At each step, SAMARITAN pauses and shows the step details, then prompts based on step type:

| Step type / mode | Prompt | Keys |
|---|---|---|
| `automatic` in **sidecar** | `Run this command in your terminal:` | `Enter`=done, `c`=copy, `n`=note, `e`=evidence, `v`=verify, `t`=attach, `p`=send to pane, `b`=back, `j`=jump, `s`=skip, `r`=rollback, `g`=global rollback, `q`/`abort`=quit |
| `automatic` (tmux-backed, non-sidecar) | `▶  Send to tmux?` | `Enter`=send, `s`=skip, `r`=rollback, `g`=global rollback, `q`=quit |
| `automatic` (prompt-only, non-sidecar) | `▶  Execute?` | `Enter`=confirm, `s`=skip, `r`=rollback, `g`=global rollback, `q`=quit |
| `manual` | `✋ Mark done` | `Enter`/notes=confirm, `n`=note, `e`=evidence, `v`=verify, `t`=attach (sidecar), `p`=send to pane (sidecar), `b`=back, `j`=jump, `r`=rollback, `g`=global rollback, `s`=skip, `q`/`abort`=quit |
| `approval` | `⚡ approve/reject` | `approve`, `reject`, `r`=rollback, `g`=global rollback, `skip` |

`g`=global rollback is only offered when the operation declares a top-level `rollback:` block. It runs the consolidated recovery (see [Group per-step rollbacks into the global rollback](#group-per-step-rollbacks-into-the-global-rollback-aggregate_step_rollbacks)) and then aborts.

Before each step, samaritan prints `Expected: <criteria>` up front (e.g. `Expected: contains: Running, does not contain: CrashLoopBackOff`) so you know what `[v]` will check before you run anything.

## Verify output: checklist, highlighting, and the line-number gutter

Pressing `[v]` runs **every** check in `step.expect` (no short-circuit on the first failure) and renders a PASS/FAIL header, a per-check checklist, and the captured output — on **both** pass and fail:

```
    ✅ PASS
    ✅ contains: Running
    ✅ does not contain: CrashLoopBackOff
    ✅ does not contain: Error
    ✅ at least 1 line(s) (2 lines, expected ≥ 1)
  ╭─ output (tail) ────────────────────────────────────────╮
  │ 1  │ NAME           READY   STATUS    RESTARTS   AGE   │
  │ 2 →│ web-server-0   1/1     Running   0          45s   │
  ╰───────────────────────────────────────────────────────╯
```

- **Checklist** — one line per check (`✅`/`❌`), in the same order as `Expected:`. Numeric/count checks show their computed value inline, e.g. `found "2", need ≥ 3` or `2 lines, expected ≥ 1`.
- **Highlighted output** — the captured output (tail of the last 12 lines by default, or full output after `[m]`) is shown with:
  - **green + inverse** around the text that satisfied a passing `contains` / `any_line_contains` / `matches` / `any_line_matches` check
  - **red** around the offending text that violated a failing `not_contains` / `no_line_contains` / `no_line_matches` check
  - `missing: <expected>` for failing checks whose expected text isn't present in the output at all
- **Line-number gutter** — each line of the output block is prefixed with its absolute line number (accounting for tail truncation) and a `→` arrow on any line containing a highlight, e.g. ` 2 →│ web-server-0   1/1   Running   0   45s`. This makes it easy to see exactly which line satisfied (or violated) a check.

On **FAIL**, a single-key menu follows:

```
    ❌ FAIL
    ❌ contains: Running
    ❌ does not contain: CrashLoopBackOff
  ╭─ output (tail) ──────────────────────────────────────────────╮
  │ 1  │ NAME           READY   STATUS             RESTARTS   AGE │
  │ 2 →│ web-server-0   0/1     CrashLoopBackOff   3          2m  │
  │ 3  │ missing: Running                                         │
  ╰─────────────────────────────────────────────────────────────╯
⚠️  Assertion failed. [o=override with reason / r=rollback / c=copy command / m=more / v=re-verify / Enter=stop]:
```

- `o` — record an override reason in the audit log and continue
- `r` — trigger rollback
- `c` — **copy command**: copy the step's `${VAR}`-resolved command to the clipboard so you can paste and re-run it, then the menu re-renders (copy is not a terminal choice). Only shown when the step has a command.
- `m` — **more**: re-render the same captured output in full (`output (full)`, starting the gutter at line 1) instead of just the tail
- `v` — **re-verify**: re-capture the pane output and re-run all checks (useful when the command is still finishing)
- Enter — stop

On **PASS**, samaritan prints `✅ Verify passed — press [v] again any time to re-check.` — `[v]` is not consumed by passing; you can re-run it as often as you like.

> Verification runs against **cleaned** pane output: ANSI color codes and escape sequences are stripped and `\r`-overwrites (progress bars, `\r\n` line endings) are resolved before `expect` assertions run — so `contains`/`equals` match what you actually see on screen, even when tools colorize their output.

> **Responsive output**: command boxes and the verify output are sized to your terminal. On a narrow terminal, over-long lines are truncated with `…` so box borders stay aligned, and the captured-output tail shrinks to fit a short window. When output is piped or redirected (no TTY), rendering is unbounded and full content is preserved.

## Manual-step actions: note, evidence, verify

`manual` steps offer extra operator actions while you're working the step — they don't complete the step, so you can use any of them as many times as you like before pressing Enter to mark the step done:

```
[↵] done  ·  [c] copy  ·  [n] note  ·  [e] evidence  ·  [x] remove evidence  ·  [v] verify  ·  [p] send to pane  ·  [b] back  ·  [j] jump  ·  [s] skip  ·  [r] rollback  ·  [g] global rollback  ·  [abort] abort
```

- **`[n]` note** — record a free-text annotation (e.g. "restarted pod manually, confirmed with on-call"). Stored in the JSONL audit log as a `user_input`/`note` event and rendered as a bullet list under the step in the `--report` Markdown.
- **`[e]` evidence** — capture and persist evidence with the session, the same way you'd attach a file in Claude Code. You're offered up to three sources:
  - **capture terminal output** (default, only offered when a tmux session is attached to the step) — grabs everything written to the pane since the step started and stores it as `command_output` evidence
  - **`[f]` file or image** — drag a file into the terminal (most terminals insert its path) or type/paste the path; SAMARITAN reads it from disk, copies it into `~/.samaritan/sessions/<session-id>/evidence/`, and stores it as a typed `EvidenceItem` (`screenshot` for `png`/`jpg`/`jpeg`/`webp`/`gif`, `video` for `mp4`/`webm`/`mov`, `file` for everything else)
  - **`[t]` type/paste text** — type or paste evidence content directly
  
  Every captured item can include an optional description, and is rendered in the `--report` Markdown — screenshots as embedded images (`![Evidence](path)`), files/videos as download-style links (`[View file](path)`), and text/terminal captures as fenced code blocks.

  All evidence bytes — including dragged-in files, screenshots, and videos — are stored exclusively under `~/.samaritan/sessions/<session-id>/evidence/`, alongside the session's own JSON record. SAMARITAN never leaves a second copy elsewhere: the persisted session references the file by path rather than embedding its raw bytes.
- **`[x]` remove evidence** — only offered once at least one item has been captured for the current step. Lists the step's captured evidence (type, description, and stored path), lets you pick one by number to delete, removes it from the session record, and — for file/screenshot/video evidence copied into the session's evidence directory — deletes the copy from disk too (your original source file is never touched). Recorded in the JSONL audit log as an `evidence_removed` event, and the `--report` Markdown omits removed items entirely.
- **`[v]` verify** — only offered when the step defines `expect`. Reads the pane output captured since the step started and asserts it against `expect` (the same `assertOutputDetailed`/`interpolateExpect` machinery `automatic` steps use), evaluating **every** check (not just the first failure) and rendering the PASS/FAIL checklist + highlighted, line-numbered output described in [Verify output: checklist, highlighting, and the line-number gutter](#verify-output-checklist-highlighting-and-the-line-number-gutter) — and, on failure, the override/rollback/`[m]` more/`[v]` re-verify/stop prompt. This is what actually checks `expect` on `manual` steps; without pressing `[v]`, a manual step's `expect` is documentation only.
  - **Auto-capture on pass (closes the `expect` ↔ `evidence` loop):** the first time a step's `[v]` verify **passes**, the verified pane output is automatically saved as a `command_output` evidence item (marked `automatic`/`validated`, `source: verify`) — so the output you checked also becomes the output recorded in the session and `--report`. The evidence is captured from the pane's **rendered screen** (`tmux capture-pane -p -J`), so it reads as clean text in the report instead of the raw terminal byte stream (no ANSI/cursor-move/redraw noise). Re-pressing `[v]` won't record duplicates. `evidence` (the record) and `expect` (the check) stay separate concepts; this just records what you verified.
- **`[r]` rollback** — runs *this step's* `rollback` (sends each command via tmux, or lists them when there's no session) and stays on the step. If this step has **no rollback**, it offers the **nearest upstream** step's rollback instead — following the `needs` chain if present, otherwise scanning earlier steps in document order (only completed steps are offered).
- **`[g]` global rollback** — only offered when the operation declares a top-level `rollback:` block. Previews the **consolidated** recovery — the explicit `rollback.steps` plus, when `aggregate_step_rollbacks` is on, every **completed** step's own rollback in reverse order (ordered by reverse-topological order when `needs` are present) — asks for confirmation, runs it, then aborts the operation (the session stays resumable). Use it when a failure means abandoning forward progress and unwinding what's been done so far.
- **Forward gating (`needs`)** — before starting a step whose `needs` aren't all completed (e.g. a dependency was skipped by `[j]` jump or `--from-step`), the run loop warns (`⚠️ This step needs: …`) and prompts `Start anyway? [y=proceed / Enter=go back]`. `y` proceeds and records a `needs_override` audit event; Enter rewinds to the first unmet dependency. A **skipped** dependency counts as unmet.
- **`[p]` send to pane** (sidecar only) — **pastes** the step's `${VAR}`-resolved command into the attached tmux pane **without** pressing Enter, so you review it at your own prompt and run it yourself. The command is delivered via a tmux paste buffer with **bracketed paste** (`paste-buffer -p`), so a multi-line command (e.g. a heredoc script) lands as **one atomic block** at your prompt and does **not** execute line-by-line — you press Enter once yourself to run it. Only offered when the step has a command and a pane is attached (a spawn-own `sessions:` pane, or one attached via `[t]`/`--attach`); with nothing attached it tells you to `[t]` attach first. To re-run a command during verify, just press `[p]` again, then `[v]`. Logged as a `user_input`/`send_to_pane` breadcrumb in the JSONL audit log — sidecar still never executes anything on your behalf.
- **`[b]` back** — go back to an earlier, already-processed step to re-run it (e.g. an external dependency was fixed and you want to retry from there). Shows a numbered picker of the prior steps; the chosen step **and every step after it** are reset to pending and execution resumes from there. The append-only JSONL audit log keeps the full history of the earlier attempt, and the rewound step index is persisted so `resume` stays consistent. Not offered on the first step.
- **`[j]` jump** — jump **forward** to a later step (e.g. steps 3–5 are irrelevant this run and you want to go straight to step 6). Shows a numbered picker of the steps after the current one; the current step and every step up to (but not including) the target are recorded as **skipped** (⏭) in the run report, and execution resumes at the target. The append-only JSONL audit log keeps the full history. Not offered on the last step. To start a fresh run partway through instead, use `run --from-step <N>` (see below).

## Evidence-required gate

When a step declares `evidence: { required: true }`, completing it (pressing `Enter`/notes on a `manual`/sidecar step, or `approve` on an `approval` step) is **blocked** until at least one item has been captured via `[e]`. There is no separate gate menu — trying to complete with nothing captured just prints a one-line warning **on the same action bar**, so you never leave it:

```
    ⚠️  This step requires evidence — press [e] to capture (typed text is fine) or [s] to skip.
```

- **`[e]`** — runs the same `[e]` capture flow described above; a captured item (including a quick typed-text note) satisfies the requirement, and the step completes on your next `Enter`. If you can't attach real evidence right now, type a note explaining why via `[e]` — it's recorded in the run report as the audit trail.
- **`[s]`** — skip the step. It's recorded as **skipped** (not completed) in the run record, distinct from a completed step.

`approval` steps get an `[e] evidence` key on their own bar too, so they're satisfied the same way (capture, then `approve`).

This is **on by default** — declaring `evidence.required: true` is enough, no flag needed. To disable enforcement (e.g. a CI rehearsal or dry-run walk-through), pass `--no-require-evidence` to `run` or `resume`. The gate applies to `manual`/sidecar step completion and to `approval` steps' `approve` path; it does **not** gate plain (non-sidecar) `type: automatic` steps. See `examples/evidence-required-step.yaml`.

## Mock run (`--mock`): replay `expect` against captured evidence

`samaritan run <op> --env <env> --mock` validates your verification rules
**without** a terminal, tmux, or executing anything. For each step that defines
`expect`, it pulls the `command_output`/`log` entries from
`evidence.results[<env>]` (inline `content` or a referenced `file`), runs them
through the same `assertOutputDetailed` engine the interactive `[v]` verify
uses, and prints a per-step PASS/FAIL/SKIP report with the highlighted output:

```bash
samaritan run examples/mock-run-expect.yaml --env staging --mock
```

- Steps with `expect` but no replayable evidence for the environment are
  **skipped** (reported, not failed).
- `${VAR}` references in `expect` are resolved against the environment's
  variables, exactly as a real run would.
- Exits **non-zero** if any assertion fails — so CI can catch the day your
  `expect` rules drift from the output you actually capture.

This reuses `evidence.results` read-only; it doesn't change what evidence is
for. See [examples/mock-run-expect.yaml](https://github.com/eric4545/samaritan/blob/main/examples/mock-run-expect.yaml).

## The run record (durable, beside the operation)

Every `samaritan run`/`resume` writes a **run record next to the operation file**, so the audit trail travels with the operation you ran (operations-as-code) and can be committed or attached to a change ticket:

```
<operation-dir>/.samaritan-runs/<session-id>/
├── events.jsonl   # append-only "black box": every step start, command, capture,
│                  # verification, evidence, approval, and rollback (paths printed as 📝 Audit log)
└── report.md      # human-readable Markdown report, written automatically every run (📄 Report)
```

- **Always-on**: `report.md` is generated on every run — `--report <dir>` now writes an *extra copy* to a directory of your choice (e.g. an evidence bundle).
- **Local paths redacted**: operator-local path prefixes in commands, output, and evidence are stripped so a shared report doesn't leak machine-specific locations — your home directory shows as `~`, and the run directory / operation directory are relativized to their tail (e.g. `/tmp/operation/runs/JOB-1/email.html` → `email.html`).
- **Append-only across resume**: `resume` continues the same `events.jsonl`, so the full history survives across processes.
- **Verification & approvals**: the report surfaces each `expect` check (pass/fail with expected-vs-actual) and an **Approval Trail** (approver, decision, rationale, timestamp).
- **Read-only fallback**: if the operation's directory isn't writable, the run record falls back to `~/.samaritan/sessions/<session-id>/`.
- **Gitignored by default**: `.samaritan-runs/` is in `.gitignore` to keep working trees clean — `git add -f` a specific run folder when you want to commit it.

## Sessions & resume

Every `samaritan run` also creates a resumable **session state** file at `~/.samaritan/sessions/<session-id>.json`, persisted after each completed step (the session ID is printed at the start of the run: `📋 Session: <id>`). This file now carries a structured **`step_log`** — per step it records the input command(s), captured output, verification result, approval (with rationale), notes, evidence references, status, and timing — derived by folding `events.jsonl`, so the saved session is meaningful on its own, not just metadata.

```bash
# List resumable sessions (running / paused / failed)
samaritan sessions

# Include completed and cancelled sessions
samaritan sessions --all

# Continue a run where you left off
samaritan resume <session-id>

# Or jump to a specific step
samaritan resume <session-id> --from-step 4
```

`--from-step` (on both `run` and `resume`) takes the step number **as the
generated manual prints it**. Because step numbers follow the authored position,
an environment that filters steps out with `when:` has sparse numbers — asking
for one that this environment does not contain fails with the list of numbers it
does have, rather than silently starting somewhere else.

Quitting a run with `q`, `abort`, or **`Ctrl+C`** stops execution but **saves the session as paused**, prints the resume command, and keeps it listed in `samaritan sessions` — so you can stop mid-operation and pick it back up later. (`Ctrl+C` no longer hard-quits without saving — it now unwinds through the same save path as `abort`.) Resume restores variables, execution mode, and the current step index, then re-enters the interactive loop.

## Named sessions

Define where each step runs — local or over SSH:

```yaml
sessions:
  execution:
    host: prod-bastion.example.com
    user: deploy
    env:
      KUBECONFIG: /home/deploy/.kube/prod-config
  monitoring:
    host: monitoring.example.com
    user: sre-readonly         # read-only verification host
```

**Variable names.** `${VAR}` in a session name is resolved against common variables, so sessions can be
derived from, say, a ticket id instead of hardcoding. Quote keys that start with `${`:

```yaml
common_variables:
  ticket: JIRA-1234

sessions:
  "${ticket}":                  # → session "JIRA-1234"
    host: prod-bastion.example.com
    user: deploy
  "${ticket}-local": {}         # → session "JIRA-1234-local" (local pane)
```

`${VAR}` in a step's `session:` reference resolves the same way, so `session: ${ticket}` lines up with
the resolved session key. Remote-vs-local stays **config-driven** — a config with `host:` makes Samaritan
auto-run `ssh`; an empty `{}` is a local pane. See `examples/sessions-with-vars.yaml`.

Assign a step to a session with `session: <name>`. Verification can run in a *different* session than execution:

```yaml
steps:
  - name: Deploy
    session: execution
    command: kubectl apply -f deployment.yaml -n ${NAMESPACE}
    verify:
      session: monitoring      # check via the read-only pane
      command: kubectl rollout status deployment/web -n ${NAMESPACE}
      expect:
        contains: "successfully rolled out"
```

## Run modes (`auto_send` / `auto_exec`)

Control how hands-off the operator experience is:

```yaml
run:
  auto_send: false   # true → command auto-loaded into terminal on step start
  auto_exec: false   # true → Enter sent automatically after send
```

| `auto_send` | `auto_exec` | Behaviour |
|---|---|---|
| `false` | `false` | `[s]` loads command, operator presses Enter (most cautious) |
| `true` | `false` | command auto-loads, operator reviews then presses Enter |
| `false` | `true` | `[s]` loads and immediately executes |
| `true` | `true` | fully automatic — no operator intervention |

## Rule-based assertions

Verify command output automatically. Shorthand string = `contains`:

```yaml
verify:
  command: kubectl get pods -n prod | grep web | grep -c Running
  expect: "3"                 # shorthand: output must contain "3"
```

Or structured:

```yaml
verify:
  command: kubectl get pod web-0 -o jsonpath='{.status.phase}'
  expect:
    equals: "Running"
    retry:
      interval: 5s
      max: 12               # retry up to 12 times (60s total)
```

**All supported assertion types:**

| YAML key | Passes when |
|---|---|
| `contains: "text"` | output includes substring |
| `not_contains: "Error"` | output does not include substring |
| `equals: "value"` | trimmed output exactly equals value |
| `matches: "regex"` | output matches regular expression |
| `not_empty: true` | output is non-empty |
| `any_line_contains: "text"` | at least one line includes substring |
| `no_line_contains: "Error"` | no line includes substring |
| `all_lines_match: "regex"` | every non-empty line matches pattern |
| `any_line_matches: "regex"` | at least one line matches pattern (regex sibling of `any_line_contains`) |
| `no_line_matches: "Error\|FATAL"` | no line matches pattern (regex sibling of `no_line_contains`) |
| `line_count: 3` | exactly N non-empty lines |
| `line_count_gte: 1` | at least N non-empty lines |
| `numeric_gte: 80` | first number in output ≥ value |
| `jsonpath: "$.status" equals: "ok"` | JSONPath expression equals value |
| `equals_captured: VAR` | output equals a previously captured variable |

> **Regex semantics**: `matches`, `all_lines_match`, `any_line_matches`, and
> `no_line_matches` compile with Node's `new RegExp(pattern)` using **default
> flags** — case-sensitive, no multiline, and an **unanchored partial match**
> (`Running` matches anywhere; anchor with `^...$` for a full-string/full-line
> match). `samaritan validate` runs a built-in **regex-lint** pass over these
> fields (and `expect.retry.while`): an uncompilable pattern is a hard **error**,
> and an obviously catastrophic (ReDoS-prone) pattern such as `(a+)+` is a
> **warning** (promoted to an error under `--strict`).

### Retryable verification (`expect.retry`)

Some checks need a moment to settle (rolling deploys, health endpoints, async
jobs). Add a `retry` block so an **automatic** step's verify re-captures the
pane and re-asserts up to `max` times, `interval` apart:

```yaml
- name: Wait for rollout
  type: automatic
  command: kubectl rollout status deployment/web -n staging
  expect:
    contains: successfully rolled out
    retry:
      interval: 5s          # '5s', '500ms', '2m', or a bare number (ms)
      max: 10               # stop after 10 retries
      while: timeout|503    # OPTIONAL: only retry while output looks transient
```

- Without `while`, **any** failure is retried until it passes or `max` is hit.
- With `while` (substring **or** regex), only failures whose captured output
  matches the pattern are retried — a non-transient failure (e.g. a permission
  error) **fails fast** instead of burning the remaining attempts. This is the
  "retryable code / retryable message" guard.
- Polling applies to the automatic-step verify path; manual `[v]` verify stays
  operator-driven (press `[v]` again to re-check).
- The retry policy is also **rendered in generated manuals** (Markdown,
  Confluence, and ADF) as an extra Expected criterion, e.g. `retry up to 10×
  every 5s` (or `… while "<guard>"` when a `while` guard is set), so the runbook
  documents the polling behaviour alongside the assertion.

See [examples/expect-retry.yaml](https://github.com/eric4545/samaritan/blob/main/examples/expect-retry.yaml).

## Capture — carry values forward

Extract values from command output and use them in later steps:

```yaml
steps:
  - name: Build image
    command: docker build -t myapp .
    capture:
      IMAGE_ID:
        pattern: "Successfully built ([a-f0-9]+)"
        group: 1            # capture group 1 from the regex
      LAST_LINE:
        line: last          # or: line: first

  - name: Deploy
    command: kubectl set image deployment/web web=myapp:${IMAGE_ID}
    verify:
      command: kubectl get pod -l app=web -o jsonpath='{.items[0].spec.containers[0].image}'
      expect:
        contains: "${IMAGE_ID}"    # ${VAR} interpolated at runtime
```
