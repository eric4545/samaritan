---
paths:
  - "src/lib/lint/**"
  - "src/lib/lint/**/*.ts"
  - "src/cli/commands/lint.ts"
  - "tests/lib/lint-*.test.ts"
---

# Procedure lint (`samaritan lint`)

## Layout

| Piece | File | Holds |
|---|---|---|
| Lexer | `shell-lexer.ts` | Shell text → simple commands. No expansion, ever (determinism). |
| Command model | `command-model.ts` | argv → executable / options / operands / assignments / redirects, using a `SpecLookup`. Patterns (`banned:`/`required:`). |
| Tool profiles | `tools/*.ts`, `tools/registry.ts` | Everything lint knows about a program, as data: option spec, verbs that mutate / back up / delete data, resource options, output format. |
| Rules | `command-lint.ts` (family A), `step-dataflow.ts` (B), `expect-consistency.ts` (C), `instruction-lint.ts` (instruction prose; phrase list is data), `existing-rules.ts` (validate checks) | One rule = id + tier + default severity + `check`. |
| Registry, presets | `rules.ts` | The canonical list of rule ids; `samaritan:recommended|strict|all`. |
| Engine | `engine.ts` | Builds step infos (variants included), runs rules, locates (`source-index.ts`), suppresses, sorts. Wraps a crashing rule in `LintRuleError`. |
| Config | `config.ts` | `lint:` section, `extends`, `tools`, ajv-validated. |

## Rules never name a tool's verbs or options

Ask `ctx.tools` (a `ToolRegistry`: built-in profiles + the team's
`lint.tools`): `isMutating`, `isBackup` (via `classify.ts`), `isDataDeletion`,
`resourceIds`, `outputFormat`, `verbDepth`, `specOf`. To teach lint a tool,
add or extend a profile in `tools/` (and list it in `tools/index.ts`), never a
`switch` in a rule. `classify.ts` holds only generic helpers. Parse commands
with `ctx.tools.specOf` (`parseCommands`, `normalizeCommand`,
`compilePattern`) so a team's option specs apply to patterns too. A rule about
one tool's behaviour (`tmux/kill-commands`, `aws/no-pager`) is still a rule;
its tables live in that tool's module (`tools/tmux.ts`, `tools/aws.ts`).

Team profiles are data only (`lint.tools`, shareable through `extends`).
There is no JavaScript plugin loading: a config file in a cloned repository
must never run code, and the checker stays a small deterministic kernel.

## Adding a rule

1. Implement it in the family file; `inValidate: 'warning'` if `validate`
   should print it, `'already'` if validate reports it another way.
2. Add a firing sample to `tests/lib/lint-conformance.test.ts` (coverage is
   enforced) and must-not-fire cases to `tests/lib/lint-rules-negative.test.ts`.
3. Default `off` means it is in the locked opt-in list in the conformance test.
4. `docs/reference/lint-rules.md` is generated; update `docs/linting.md` prose
   and the skill's `reference/cli.md` when behaviour users see changes.

Refactors must keep `samaritan lint --format json` identical over
`examples/` and `tests/fixtures/operations/` with `extends: [samaritan:all]`
(compare before/after; the tool-profile refactor was checked this way).

## A step's session: `sessionOf(info)`

Rules read the session a step runs in with `sessionOf(info)`
(`rule-types.ts`): `info.step.session ?? info.inheritedSession`. The engine
sets `inheritedSession` while walking forward steps (nearest ancestor's
`session:`; a variant gets its base step's) — the same rule as the run loop
(`inheritSubStepSessions`). Never read `info.step.session` for routing.
`flow/session-undeclared` stays on the explicit field (`fieldIn`): an
inherited name was already checked on the ancestor.

## Top-level keys (`schema/unknown-key`)

Known = the schema's `properties` + `PARSER_ONLY_TOP_LEVEL_KEYS`
(`src/validation/schema-validator.ts`: keys the parser reads that the schema
never listed, e.g. `id`, `tags`). A test greps `rawOperation.<key>` in the
parser, so a new key read there must be added to the schema or that list.
`x-…` keys are allowed (anchor holders). A path hit can name a key with
`field` (`path: []`, `field: key`), so `line:col` points at the key itself.
