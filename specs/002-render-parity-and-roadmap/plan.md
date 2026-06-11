# Plan 002 — Render-Path Parity Fixes, Recurrence Prevention & Roadmap Refresh

**Date**: 2026-06-11
**Status**: Ready for implementation
**Intended executor**: implementation subagent (Sonnet), one workstream per commit
**Branch**: develop on the current feature branch; never push to `main` directly

---

## 1. Why this plan exists (first-principles review)

A review of all 43 PRs and 12 issues shows the same three bug classes recurring:

| Bug class | Fix PRs | Root cause |
|---|---|---|
| `${VAR}` resolution missing for one more field/context | #30, #37, #38, #39, #51, #54, #55 (7) | Substitution is re-plumbed per call site instead of applied once per render |
| `verify`/`expect` rendering (missing, dropped falsy values, unsubstituted) | #37, #38, #39, #45, #47 (5) | Same field rendered independently in 4 places |
| Single-env vs multi-env vs ADF vs Confluence path divergence | #3, #19, #22, #23, #24, #39 (6) | Four hand-rolled render paths, no cross-format parity test |

**Structural root cause**: every `StepContent` field must be manually rendered (and
variable-substituted) in **four** independent paths:

1. `src/manuals/generator.ts` — multi-env table (`generateStepRow` / `generateSubStepRow`)
2. `src/manuals/generator.ts` — single-env headings (`generateSingleEnvManual` → `renderStep`)
3. `src/manuals/adf-generator.ts` — Confluence ADF
4. `src/cli/commands/generate.ts` — Confluence wiki markup

Each new field ships in 1–3 of the 4 paths; the missing path becomes next month's fix PR.
This plan fixes the currently-divergent fields **and** adds a parity test so the class
of bug can't silently recur (CLAUDE.md non-negotiable #1: tests ship with code).

The project's first principle (plan.md Constitution Check: *Simplicity*; CLAUDE.md rule #4:
*StepContent is the shared base*) is respected: we do **not** rewrite the generators —
we share the substitution helpers and add an exhaustive cross-format test.

---

## 2. Verified bugs to fix (Workstream A)

All four were verified against current `main` (651/651 tests passing). Fix in this order.

### A1. Confluence wiki markup: `step.script` never rendered for regular steps/sub-steps — HIGH
- **Where**: `src/cli/commands/generate.ts`. Regular-step cell rendering (~lines 1269–1328)
  and sub-step rendering (~lines 1802–1876) handle `instruction` and `command` but not `script`.
- **Proof of divergence**: rollback script IS rendered there (`generate.ts:1472` and `:1624`,
  reads the file and emits `{code:bash}`), and both markdown paths (`generator.ts:607–624`,
  single-env equivalent) and ADF (`adf-generator.ts:648–670`) render step scripts.
- **Fix**: mirror the rollback-script handling for `effectiveStep.script` in both the
  regular-step and sub-step cells: emit `*Script:* \`path\`` then the file content in
  `{code:bash}…{code}`, with the same graceful "file not found" fallback used elsewhere.
  Resolve the path against `operationDir` exactly as rollback does.
- **Test**: extend the Confluence generator tests with a fixture step using `script:`
  (reuse `tests/fixtures/operations/...` script fixtures); assert the script label and
  embedded content appear for regular step AND sub-step.

### A2. Confluence wiki markup: `expect` never rendered at all — HIGH
- **Where**: `src/cli/commands/generate.ts` — zero references to `renderExpectParts`
  or `.expect` in step cells (grep confirms).
- **Reference implementations**: markdown multi-env `generator.ts:626–642`,
  single-env `generator.ts:1908–1922`, ADF `adf-generator.ts:672–681`.
- **Fix**: after command/script rendering, if `effectiveStep.expect != null`, render
  `*Expected:*` followed by one checkbox line per entry from `renderExpectParts(...)`
  (import from `src/lib/assertions.ts` — same source the other generators use).
  Apply variable substitution per A3's shared helper when `--resolve-vars` is active.
  Cover rollback `expect` too (see A4).
- **Test**: Confluence output test asserting expect checkboxes for string shorthand,
  `ExpectConfig`, and array-of-checks forms — include a **numeric** value
  (`contains: 0`) since falsy/numeric handling regressed twice before (#45, #47).

### A3. ADF: `expect` rendered without variable substitution — MEDIUM
- **Where**: `src/manuals/adf-generator.ts:672–681` calls
  `renderExpectParts(effectiveStep.expect)` directly; both markdown paths call
  `substituteExpectVars(expect, envVars, step.variables)` first
  (`generator.ts:626–635` and `:1908–1915`).
- **Fix (do the structural part here)**: `substituteExpectVars` and its
  `EXPECT_STRING_FIELDS` list currently live privately in `src/manuals/generator.ts:25–55`.
  **Move them into `src/lib/step-resolution.ts`** (alongside `substituteVariables`),
  export them, and re-import in `generator.ts`, `adf-generator.ts`, and
  `cli/commands/generate.ts` (for A2). This kills the per-file duplication that caused
  PRs #37/#38/#39. In ADF, apply it with the environment's variables and
  `effectiveStep.variables` under the same `resolveVariables` condition used for the
  step name/command there.
- **Test**: ADF test with `expect.contains: "${TEAM_EMAIL}"` + `--resolve-vars`-equivalent
  option asserting the resolved value appears (and the literal `${TEAM_EMAIL}` does when
  resolution is off).

### A4. `rollback.expect` not rendered by any generator — MEDIUM
- **Where**: `expect` is a `StepContent` field (`src/models/operation.ts:158`), so
  `RollbackStep` (`operation.ts:161`) legitimately carries it — but rollback rendering in
  all four paths (e.g. `generator.ts:1554–1668`, `generate.ts:1380–1646`,
  `adf-generator.ts:1085–1092` area) renders instruction/command/script/pic/reviewer
  and skips `expect`.
- **Fix**: render rollback `expect` the same way as main-step expect (checkbox list,
  substituted via the shared helper) in all four paths.
- **Test**: fixture with `rollback: [{command: ..., expect: {contains: ...}}]`,
  snapshot/assert in markdown (both paths), ADF, and Confluence.

### A-non-bugs (do NOT "fix" these — verified false positives)
- Report generator event names are correct: it consumes **JSONL audit events**
  (`step_start`, `step_complete`, `user_input`, …) emitted by `run.ts`, not the
  executor's in-memory `step_started`-style events. No mismatch.
- Evidence removal: `run.ts` already deletes evidence files from
  `~/.samaritan/sessions/<id>/evidence/`; `report-generator.ts` filtering the array
  without touching disk is correct.
- `persistProgress()` / resume step-index handling is correct as of PR #52.

### A5. Recurrence prevention: cross-format parity test — REQUIRED, same workstream
Create `tests/manuals/render-parity.test.ts` + one fixture
`tests/fixtures/operations/features/all-content-fields.yaml` (register in
`tests/fixtures/fixtures.ts`) containing a single operation that exercises **every
renderable `StepContent` field**: `command`, `script`, `instruction`, `expect`
(string + config + array + numeric), `evidence` (+ per-env `results`), `pic`,
`reviewer`, `timeout`, plus a `rollback` entry carrying command/script/expect/pic,
and at least one `${VAR}` in command, instruction, and expect.

The test generates all four outputs (markdown multi-env, markdown `--env`, ADF JSON
stringified, Confluence markup) and asserts each output contains a distinctive marker
string per field (e.g. the resolved var value, the script content sentinel, the expect
text). It is a presence test, not a formatting snapshot — formats may differ, content
may not be silently dropped. This is the test that would have caught PRs
#3/#19/#22/#24/#25/#37/#38/#39/#45/#47 before merge.

---

## 3. PR & issue hygiene (Workstream B — needs maintainer, not code)

- **Close PR #39** (`fix/expect-step-vars-single-env`) as superseded: its fix already
  exists on `main` at `generator.ts:1908–1915` (single-env path passes
  `effectiveStep.variables` to `substituteExpectVars`). Comment with that pointer.
- **PR #53** (`--compact` manuals) is the only live feature PR. It predates #54/#55 —
  rebase onto `main`, re-run tests/snapshots, then review for merge. (Subagent may do
  the rebase + test run if asked; the merge decision stays with the maintainer.)
- All 12 GitHub issues are closed; no open issue backlog.

---

## 4. Documentation refresh (Workstream C)

`ROADMAP.md` has drifted badly from reality (acknowledged twice already, PRs #33/#51):

1. **Phase 2.3 Interactive Execution Mode** — implemented (sidecar/manual/automatic/hybrid,
   pause/resume, skip, rollback, progress display). Mark ✅ with version note (v1.1).
2. **Phase 2.4 Session Management** — implemented (`~/.samaritan/sessions/`, `resume`,
   `sessions` list). Mark ✅.
3. Not in roadmap but shipped and worth listing under Phase 1/2 shipped features:
   structured verification & assertions (#12/#42/#45), JSONL audit log + evidence
   report generation (#7/#10/#16), `diff` command (#44), sub-steps (#49),
   template `uses:` composition with remote/GitHub shorthand (#31/#43), `script:` field (#35).
4. Keep as genuinely NOT implemented (unchanged): Phase 2.1 non-interactive command
   execution, Phase 2.2 automatic evidence collection, Phase 3 integrations
   (Jira / Confluence API publishing / advanced Git), Phase 4 AI/analytics/scheduling,
   QRH database (command scaffold only, `src/cli/commands/qrh.ts` loads from a `./qrh/`
   dir that ships empty).
5. Update the test count claim (CLAUDE.md/ROADMAP say "161 tests"; suite is now 651).
6. `--auto-approve` (README ~line 354): clarify it selects automatic mode / skips
   prompts but does **not** execute commands non-interactively (Phase 2.1). PR #36
   already promised this warning; verify the CLI prints it and the README states it.
7. There is **no `openspec/` directory**; specs live in `specs/001-i-want-to/` and
   `.claude/commands/plan.md` references a `/memory/constitution.md` that does not
   exist — either add a minimal constitution capturing CLAUDE.md's five
   Non-Negotiable Rules or fix the reference.

---

## 5. Next roadmap feature (Workstream D — recommendation, requires owner sign-off)

Per CLAUDE.md rule #5, execution features must be explicitly scoped before
implementation — the subagent must NOT start these without the maintainer choosing:

- **Recommended next: Phase 3.2 Confluence API publishing** (lowest effort / highest
  leverage: the ADF generator already exists; needs only an authenticated REST client,
  `--publish` flag, page create/update). Roadmap estimate 1–2 weeks.
- **Alternative: Phase 2.1 non-interactive execution** (`samaritan run --mode automatic`
  actually executing commands with exit codes/timeout/retry). Highest user value but
  largest blast radius; needs its own spec under `specs/00X-…` first.
- QRH: either ship a starter `qrh/` entry pack + docs, or remove the command from
  README until the database exists (currently a documented façade).

---

## 6. Execution instructions for the implementation subagent

**Scope for the subagent: Workstream A (A1→A5) and Workstream C. B and D are
maintainer decisions.**

Ground rules (from CLAUDE.md — non-negotiable):
1. TDD: write the failing test first, then the fix; tests + implementation in the same commit.
2. Run `npx @biomejs/biome check --write <changed files>` before every commit.
3. `.gitignore` contains `manuals/`, which also matches `src/manuals/` — `rg`/Grep will
   **silently skip** those files and `git add src/manuals/*.ts` silently fails; use
   `grep --no-ignore`-style searches or read files directly, and stage with
   `git add -f src/manuals/<file>`.
4. Snapshot updates: `npm run test:snapshots:update`, then review diffs before committing.
5. Debug artifacts go to `/tmp/`, never the repo.
6. Don't add content fields to `Step`/`RollbackStep` directly — `StepContent` only.
7. Full suite (`npm test`, currently 651 passing) must stay green after every commit.

Suggested commit sequence:
1. `refactor: move substituteExpectVars into step-resolution and share across generators` (A3 helper move, no behavior change, tests prove parity)
2. `fix: render script field for regular steps and sub-steps in Confluence output` (A1)
3. `fix: render expect assertions in Confluence output with variable substitution` (A2)
4. `fix: substitute variables in ADF expect rendering` (A3 behavior)
5. `fix: render rollback expect across all generator formats` (A4)
6. `test: add cross-format render parity test for all StepContent fields` (A5)
7. `docs: refresh ROADMAP and README to match implemented v1.1 features` (C)

Each fix must update **all four** render paths or explicitly state why a path is exempt.
