---
paths:
  - "src/operations/**"
  - "src/models/**"
  - "src/schemas/**"
---

# Parser, data model & schema

## StepContent is the shared base — never bypass it

`StepContent` is the shared base for both `Step` and `RollbackStep`, holding all
"what to do / who does it" fields: `command`, `script`, `instruction`, `timeout`,
`description`, `evidence`, `options`, `session`, `pic`, `reviewer`, `expect`.
**Never** add a content/execution field directly to `Step` or `RollbackStep` —
add it to `StepContent` so both types benefit automatically.

`Step`-only structural fields: `name`, `type`, `id`, `phase`, `if`, `foreach`,
`sub_steps`, `when`, `variants`, `approval`, `needs`, `template`/`with`,
`variables`, `capture`, `retry`, `rollback`, `section_heading`, `timeline`,
`ticket`, `manual_override`, `manual_instructions`, `estimated_duration`, `env`,
`usesGroup` (parser-set: groups steps expanded from one `uses:` block for
block-aware phase grouping).

## A rollback step IS a normal step — FULL field parity

`RollbackStep extends Omit<Partial<Step>, 'sub_steps'>` with
`sub_steps?: RollbackStep[]`. It accepts the **full** normal-step field surface
(its `StepContent` body plus `name`, `sub_steps`, `foreach`/`matrix`,
`variables`, `if`, `uses`/`with`, …). The ONLY excluded field is `rollback`
itself (no rollback-of-a-rollback; nest via `sub_steps`). This holds for BOTH
rollback concepts — step-level `Step.rollback: RollbackStep[]` and
operation-level `operation.rollback.steps[]` — and in ALL formats.

**Why this kept regressing:** rollback was a hand-maintained subset of a normal
step, duplicated across three places, so `name`, then `sub_steps`, then
`foreach` each got silently dropped in turn. The durable fixes — do NOT undo
them:

1. **Parser** — `normalizeRollbackStep()` is a **spread pass-through**
   (`{ ...r, evidence, expect, options, sub_steps }`), carrying EVERY authored
   field. Don't turn it back into a field-by-field allowlist.
2. **Schema** — rollback shape is defined in exactly ONE place,
   `#/definitions/rollbackStep` (strict `additionalProperties:false`,
   `not:{required:[command,script]}`), referenced by both
   `operation.rollback.steps` and inline `Step.rollback`. Kept at full parity
   with the normal step via `$ref` + `#/definitions/foreach`. The guardrail test
   `tests/schemas/rollback-parity.test.ts` fails CI if any normal-step field is
   missing from `rollbackStep` (minus documented `ROLLBACK_EXCLUDED_FIELDS` =
   just `rollback`). When you add a `Step` field, add it to `rollbackStep` too,
   or to the exclusion list with a reason.
3. **Renderers** — see `.claude/rules/manuals.md` (iterate all entries, route
   through the one shared per-format helper).

**`foreach`/`matrix` and `uses`/`with` on rollback steps expand at PARSE TIME**,
exactly like a normal step, via `expandForeachItem()` + `expandRollbackForeach()`
and `resolveRollbackReferences()`. The uses-loading core (circular guard,
per-file `baseDirectory` scoping, template load + `with:` merge + required-`${VAR}`
validation + substitution) is factored into ONE shared helper `expandUsesEntry()`
that BOTH the normal-step `uses:` branch and `resolveRollbackReferences` call —
do NOT re-duplicate the uses-loading logic (that duplication is the exact
parity trap).

**Global rollback grouping** (`operation.rollback.aggregate_step_rollbacks`) is
one pure helper `buildGlobalRollback(globalSteps, stepsToAggregate, { aggregate })`
(`src/lib/global-rollback.ts`): explicit `rollback.steps` followed by every
step's own rollback (recursing `sub_steps`) in reverse step order, each named
`↩ Rollback for "<step>"`. It returns `EffectiveRollbackStep[]` — folded entries
also carry `sourceAnchor` (`stepRollbackAnchor(step)` from `src/lib/anchor.ts`),
the jump-link target the manuals' inline rollback links point at (see
`.claude/rules/manuals.md`). `EffectiveRollbackStep extends RollbackStep` with an
OPTIONAL `sourceAnchor`, so it stays assignable to `RollbackStep[]` and the run
loop / renderers that ignore it are unaffected. All four operation-level renderers
iterate its output unchanged. Fixtures: `global-rollback-substeps.yaml`,
`step-rollback-substeps.yaml`, `rollback-foreach.yaml`, `rollback-with-uses.yaml`,
`aggregated-global-rollback.yaml` (the sub-step jump-link case reuses
`nested-substep-with-rollback.yaml` with the flag set in-test).

## Variable resolution layering (don't conflate the two layers)

1. **Parse time** (`resolveStepReferences`): `${VAR}` inside `step.foreach`
   (values/matrix/include/exclude) is substituted against
   `{ ...commonVariables, ...step.variables }` **before**
   `generateMatrixCombinations`/`filterMatrixCombinations`. `commonVariables` =
   `common_variables:` + top-level `variables:` + `env_file`
   (priority `common_variables > variables > env_file`). This resolves expanded
   step **titles** and bakes the loop value into the expanded step's **content**
   (command/script/instruction/expect + recursively `sub_steps`/`variants`) via
   `substituteVariables(injected, literalCombo)` — for ALL formats, independent
   of `--resolve-vars`. Only combo values that are themselves plain literals are
   baked in (`literalCombo` filters out combo values still holding a `${VAR}`);
   unmatched `${VAR}`s pass through untouched. Env-specific vars are NOT in scope
   here (no env selected yet) — they stay literal, deferred to `--resolve-vars`.
   The authored step **name template** is only suffixed with the combo, not
   substituted, so `${REGION}` can still appear literally in a name.
2. **Generation time** (`--resolve-vars`, `src/lib/step-resolution.ts`
   `substituteVariables(command, envVariables, stepVariables?)`): resolves
   remaining `${VAR}` (including env-specific) against the selected env's
   variables, `step.variables` taking priority. `stepVariables` values that are
   themselves `${VAR}` references are pre-resolved against `envVariables` in one
   pass before merging, so chained references resolve in a single call.

Shell parameter expansions (`${X:?}`, `${X:-default}`, `${X##*/}` — any name
that isn't a plain `\w+` identifier) are NOT template variables:
`extractVariables`/`substituteVariables` match only `${\w+}`, so shell guards
pass through untouched (same rule in `variable-resolver.ts`, `session-state.ts`
`interpolate`, `validate.ts` warnings).

## Phase grouping is block-aware

Phase-grouped generators call `groupByPhase(items, getStep)`
(`src/lib/phase-grouping.ts`), NOT raw `step.phase`. Standalone steps bucket by
their own phase; steps expanded from one `uses:` block stay contiguous — the
parser stamps every expanded step with a shared `step.usesGroup = { id, name }`
(outermost `uses:` wins; expansion recurses inner-first), and `groupByPhase`
routes the whole block into one effective phase (`flight` if any step is flight,
else `postflight`, else `preflight`). `usesGroup` is Step-only + parser-set (not
authored, not applied to imported rollback steps). Example
`examples/scoped-preflight.yaml`; helper tests `tests/lib/phase-grouping.test.ts`.

## Templates (`template:` / `with:`)

`loadTemplateSteps` loads a step-array OR full-operation file; `extractVariables`
finds `${VAR}` recursively; `substituteVariables` replaces them type-preservingly
(`${TIMEOUT}` with `60` yields number `60`); `resolveStepReferences` inserts
template steps inline at the import location. All `${VAR}` must have a value in
`with:` or the parser throws. Fixtures `tests/fixtures/templates/*.yaml`.

## Postmortem is a separate document type (not embedded in operation.yaml)

Model `src/models/postmortem.ts`, schema `src/schemas/postmortem.schema.json`,
parser `src/operations/postmortem-parser.ts` (validates via shared Ajv
`SchemaValidationError`; parses with js-yaml `JSON_SCHEMA` so unquoted
timestamps stay strings). Renderers live in `src/manuals/postmortem-*.ts`.
Because a postmortem has its OWN sections (not operation steps), the
four-render-path `StepContent` parity concern does NOT apply. See the skill's
`reference/postmortem-yaml.md` for the authoring surface.
