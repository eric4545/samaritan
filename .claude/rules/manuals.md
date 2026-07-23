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

## `--resolve-vars` must pass step.variables

All generators (`generator.ts` single/multi-env, `adf-generator.ts`,
`generate.ts` Confluence) must pass both the env/common variables AND
`step.variables` (or `commonVariables` for the shared multi-env name cell) to
`substituteVariables` (`src/lib/step-resolution.ts`) so step names, commands,
instructions, and `expect`/rollback content resolve correctly.

## Snapshot workflow

After changing a generator, run `npm run test:snapshots:update`, review the
diffs carefully, and commit generator changes + updated snapshots together.
