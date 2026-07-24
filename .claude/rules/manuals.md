---
paths:
  - "src/manuals/**"
  - "src/cli/commands/generate.ts"
  - "src/manuals/**/*.ts"
---

# Manual generators (Markdown / ADF / Confluence)

Traps that repeatedly caused bugs when editing the generators. Reproduce in
every format before claiming a rendering fix (CLAUDE.md rule 7).

## `git add src/manuals/` requires `-f`

`.gitignore` contains `manuals/`, which also matches `src/manuals/`, so plain
`git add src/manuals/*.ts` silently fails. Those files are already tracked, so
use `git add -f src/manuals/<file>` to stage them.

## Two rendering paths inside `generator.ts` (easy to update one, miss the other)

- `generateStepRow` / `generateSubStepRow` — multi-env table format (used
  **without** `--env`).
- `generateSingleEnvManual` → `renderStep` — heading format (used **with**
  `--env`).

When adding a field to `renderStep` in `generateSingleEnvManual`, cover each new
field with a test — the pattern of adding rendering logic without a test is how
the `else if` instruction/command bug went undetected.

## Update ALL generators when a feature affects rendering (critical — often missed)

A feature that changes how steps/evidence/rollback render must be applied to
every format, or the formats silently diverge:

1. Data model in `src/models/operation.ts`
2. Parser in `src/operations/parser.ts`
3. JSON schema in `src/schemas/operation.schema.json`
4. **ALL generators**:
   - `src/manuals/generator.ts` (Markdown) — pass `operationDir` for file
     reading; update BOTH rendering paths above.
   - `src/manuals/adf-generator.ts` (ADF/JSON) — receives `operationDir` via
     `generateADF` → `createStepsTable`.
   - `src/cli/commands/generate.ts` (Confluence markup) — pass `operationDir`
     for file reading.
5. CLI commands to pass the operation directory where needed.
6. Tests for all output formats.

## Evidence rendering specifics

- Evidence **metadata** (types, required status) is shown once in the step
  column. Evidence **results** are shown in environment-specific columns; each
  environment shows only its own `evidence.results.<env>`.
- For `command_output`/`log` results with `file`, generators read the file and
  embed it as a code block (path is relative to the operation file, same as
  `script:`). Screenshots/photos render as images; other types as download
  links. When `results` are absent for an env, a `# Paste command output here`
  placeholder is rendered for `command_output` evidence only.

## Rollback rendering — iterate ALL entries, route through the shared helper

Every step-level rollback site loops `step.rollback.filter(hasRollbackContent)`
— NOT `step.rollback?.[0]` (that silently dropped foreach-expanded / authored
siblings). Each per-format rollback site routes through ONE recursive helper
(`renderRollbackStepSingleEnv`, `renderRollbackCellMarkdown(..., includeSubsteps)`,
`emitRollbackRow`, ADF `buildRollbackCellNodes`/`pushRollbackRows`, Confluence
`renderInlineRollback`'s `buildCell` + `emitRollbackRow` + `renderRollbackDocStep`).
Don't re-copy a rollback renderer — extend the shared one. See
`.claude/rules/parser-and-schema.md` for the full rollback-parity contract.

## `aggregate_step_rollbacks` centralizes rollbacks + emits jump-links/anchors

When `operation.rollback?.aggregate_step_rollbacks` is true, every generator
(gated on a `linkRollbacks`/`aggregateRollbacks` boolean threaded to the row
helpers) does THREE things — keep them in lock-step across all four paths:

1. **Inline rollback → jump-link.** Each step/sub-step inline rollback block
   collapses to a single link instead of the full table/heading. The label is the
   SEMANTIC `stepRollbackHeadingText(step)` (`Rollback for "<name>"`), NOT a
   numeric position — so link text and target heading share a searchable phrase:
   Markdown `↩ **Rollback:** [Rollback for "<name>" ↓](#<anchor>)`, Confluence
   wiki `[Rollback for "<name>" |#<anchor>]`, ADF a `link` mark to `#<anchor>`.
2. **Rollback Plan carries the jump target.** The folded entry advertises
   `EffectiveRollbackStep.sourceAnchor` AND `sourceHeading` (both set by
   `buildGlobalRollback`). The target differs by format because sanitizers
   (GitHub) rewrite hand-authored `<a id>` to `user-content-…` with no clean
   `#slug` alias — only HEADING slugs jump. So **Markdown** renders the folded
   entry as a real heading `### <sourceHeading>` whose slug IS the anchor (multi-
   env: heading + mini env-table split out of the explicit-steps table; single-
   env: `renderRollbackStepSingleEnv(..., headingOverride=sourceHeading)`), NO
   `<a id>`. Confluence wiki keeps `{anchor:...}` and ADF the `anchor` macro
   (`extension` node, `extensionKey:'anchor'`) — native macros already jump.
   Emit once per source step (dedup Set).
3. **Drop the duplicate `Rollback Procedures` section** (Markdown multi-env + ADF)
   so full content lives only in the Plan.

The anchor id MUST match on both sides — always `stepRollbackAnchor(step)`
(= `slugify(stepRollbackHeadingText(step))` = `slugify('Rollback for "<name>"')`,
in `src/lib/anchor.ts`), computed from the SAME source step at the inline site
and inside `buildGlobalRollback`. Deriving the anchor by slugifying the heading
text is what guarantees the Markdown link resolves to its heading; keep the
heading emoji-free so `slugify` matches the renderer's own slug. Never re-derive
it from the provenance label. ADF top-level step rollbacks have no inline row (they only
lived in Procedures/Plan), and the Confluence wiki only renders a sub-step's
inline rollback when that sub-step has nested `sub_steps` — both are pre-existing
structural quirks, so those inline jump-links simply don't appear there.
Fixtures: `aggregated-global-rollback.yaml` (top-level); the sub-step jump-link
case reuses `nested-substep-with-rollback.yaml` with the flag set in-test. Flag
off → output byte-identical to before (regression-tested).

## `--resolve-vars` must pass step.variables

All generators (`generator.ts` single/multi-env, `adf-generator.ts`,
`generate.ts` Confluence) must pass both the env/common variables AND
`step.variables` (or `commonVariables` for the shared multi-env name cell) to
`substituteVariables` (`src/lib/step-resolution.ts`) so step names, commands,
instructions, and `expect`/rollback content resolve correctly.

## Snapshot workflow

After changing a generator, run `npm run test:snapshots:update`, review the
diffs carefully, and commit generator changes + updated snapshots together.
