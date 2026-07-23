---
paths:
  - "tests/**"
---

# Testing conventions

## Fixtures

- **YAML fixtures** live as separate `.yaml` files in
  `tests/fixtures/operations/` (organized `valid/`, `invalid/`, `features/`,
  `confluence/`). Load with:
  - `parseFixture('name')` — parsed `Operation` (parser tests)
  - `loadYaml('name')` — raw YAML string
  - `getFixturePath('name')` — file path (CLI tests)
  - Names are type-safe via the `FIXTURES` constant in `tests/fixtures/fixtures.ts`.
- **TypeScript `Operation` objects** in `tests/fixtures/operations.ts` (only 2,
  e.g. `deploymentOperation`) — for generator tests that skip parsing.
- **Snapshot tests**: `tests/manuals/*.test.ts`. Update with
  `npm run test:snapshots:update`, review diffs, commit generator + snapshot
  changes together.

When adding a step feature, also add: a fixture in
`tests/fixtures/operations/features/`, its mapping entry in `fixtures.ts`, and a
snapshot test in `tests/manuals/`.

## TDD is non-negotiable

RED (failing test first) → GREEN (minimal code) → REFACTOR → LINT
(`npx @biomejs/biome check --write <changed files>`) → commit tests WITH
implementation in the same commit.

When adding a field to `renderStep` in `generateSingleEnvManual`, cover each new
field with a test — adding rendering logic without a test is how the `else if`
instruction/command bug went undetected.

## readline multi-prompt gotcha (manual-step flows)

The manual-step prompts (`[n]`/`[e]`/`[x]`/`[v]`/`[t]`) each chain multiple
sequential `readline` `question()` calls. This is fine with real keyboard input
(each line arrives as its own event), but piped/batch stdin that delivers several
lines in one chunk makes Node's `readline` drop every buffered line but the first
per pending question — a `question()` issued from a freshly-invoked async helper
then hangs forever. Integration tests for these flows should stick to
single-prompt interactions (e.g. `'q\n'` or `'abort\n'`); **never** chain
`'t\ntarget\n'`. For unavoidable multi-question flows use the sleep-delimited
`bash -c` piping technique (`runSequenced` helper). See the `[x] remove evidence`
tests in `tests/cli/run.test.ts`.

`Ctrl+C`-saves tests spawn `node --import tsx` (so SIGINT hits our process, not a
shim) and assert the session persists as `paused`.

## Real-tmux e2e tests

`tests/e2e/*.e2e.ts` (`sidecar-tmux.e2e.ts` + `tmux-driver.ts`) drive samaritan
inside a real tmux pane (genuine TTY → exercises the raw-mode `readActionKey`
path, not the piped-stdin readline fallback), send keys with `tmux send-keys`,
and assert on `capture-pane` output + persisted `report.md`/`events.jsonl`. They
wait on captured output (`TmuxDriver.waitFor`), not fixed sleeps. Named `*.e2e.ts`
(NOT `*.test.ts`) so the default `npm test` glob skips them; run via
`npm run test:e2e`. Skip gracefully when tmux is absent unless
`SAMARITAN_E2E_REQUIRE_TMUX=1`. Fixtures: `tests/fixtures/operations/features/e2e-*.yaml`.

## Debug files

Create debug/temp files in `/tmp/` (descriptive names, e.g.
`/tmp/samaritan-debug-parser-output.json`) — **never** in the project root, never
committed.
