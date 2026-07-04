# SAMARITAN - AI Assistant Context

**Project**: Operations as Code CLI for SRE Teams
**Version**: 1.0.0 (MVP - Documentation Generator)
**Status**: ✅ Shipped (2025-10-08) | 674/674 tests passing

---

## 🎯 What This Project Does

SAMARITAN converts YAML operation definitions into comprehensive manuals (Markdown & Confluence). It's a **documentation generator and validator**, NOT an execution engine (yet).

**Current capabilities (v1.0)**:
- Parse YAML operations with multi-environment support
- Generate Markdown and Confluence (ADF) manuals
- Validate operations with JSON Schema
- Include Git metadata for audit trails
- Track evidence requirements (as documentation)
- Embed pre-captured evidence in generated manuals via `evidence.results`

**See [ROADMAP.md](ROADMAP.md) for future features** - don't implement them unless explicitly requested!

---

## 🚨 Non-Negotiable Rules

These rules apply to every code change, no exceptions:

1. **Tests ship with code** — every new feature or bug fix must include tests in the same commit; never commit implementation without tests
2. **Examples + docs for every feature** — every new feature must include a working example in `examples/` and updated user documentation in `README.md`; never commit a feature without both
3. **Lint clean before commit** — run `npx @biomejs/biome check --write <changed files>` and fix all errors before committing; never commit with lint errors
4. **StepContent is the shared base** — never add execution/content fields directly to `Step` or `RollbackStep`; add them to `StepContent` so both types benefit automatically
5. **Check ROADMAP.md** — before implementing any "auto", "run", or execution feature, verify it's in scope; most execution features are roadmap items, not v1.0
6. **Keep Agent Skills in sync** — when a change alters CLI commands/flags, operation YAML fields, the schema, or scope (implemented vs roadmap), update the affected `.claude/skills/**/SKILL.md` (and its `reference/*.md`) in the same commit; never let a skill describe behavior that no longer matches the code
7. **Reproduce before you diagnose — NO GUESSING** — never claim a root cause or call a bug fixed from reading code alone. First write the smallest YAML that triggers it and run `validate` + the relevant `generate manual` (multi-env AND `--env <name>` single-env, since they are separate code paths) to see the actual broken output. Then fix, then re-run the SAME repro to prove the output changed. A fix without a before/after repro and a regression test (rule 1) is not done. This is why bugs like "global rollback step renders heading-only" kept coming back — earlier passes patched an adjacent path (step-level `Step.rollback` with sub_steps) without reproducing the actual failing path (operation-level `rollback.steps[]`).

---

## 🏗️ Architecture

```
src/
├── models/          # TypeScript interfaces (Operation, Step, Evidence, etc.)
├── operations/      # YAML parsing, environment loading
├── manuals/         # Manual generators (Markdown, Confluence ADF)
├── validation/      # JSON Schema validators
├── cli/commands/    # CLI command handlers (validate, generate, etc.)
├── evidence/        # Evidence models (data only, no collection in v1.0)
├── lib/             # Utilities (git-metadata, executor models, session)
└── schemas/         # JSON schemas for validation

tests/
├── fixtures/        # Test data (operations.ts has YAML as TypeScript objects)
├── manuals/         # Snapshot tests for manual generation
└── */               # Unit and integration tests
```

---

## ⚠️ Implementation Status (CRITICAL - READ THIS!)

### ✅ Implemented in v1.0
- YAML parsing with environment matrix support
- Manual generation (Markdown & Confluence ADF formats)
- JSON Schema validation with strict mode
- Git metadata integration (commit hash, branch, author)
- Evidence requirement models (`evidence.types` is documentation-only)
- Evidence results (`evidence.results`) for embedding pre-captured evidence in manuals
- Schema export command for IDE integration and custom tooling
- CLI commands: `validate`, `generate manual`, `generate confluence`, `schema`, `init`, `create operation`

### ✅ Implemented since v1.1
- **Interactive execution** (`run` command — sidecar/manual/automatic/hybrid modes, see Gotcha #3)
- **Session persistence + resume** (`~/.samaritan/sessions/<id>.json`, `resume <session-id>`)
- **Mock run** (`run --mock`, `src/lib/mock-run.ts`) — replays each step's `expect` against its `evidence.results[<env>]` `command_output`/`log` output (no tmux/execution); resolves `${VAR}` in `expect`, prints a PASS/FAIL/SKIP report, exits non-zero on failure. Read-only reuse of `evidence.results`.
- **Auto-capture on verify** (`src/lib/verified-evidence.ts` `buildVerifiedEvidenceItem`) — in the interactive run loop, the first passing `[v]` verify per step auto-records the verified pane output as a `command_output` EvidenceItem (`automatic`/`validated`, `metadata.source: 'verify'`), deduped per step. Keeps `expect` (the check) and `evidence` (the record) as separate concepts while closing the loop.
- **Retryable verification** (`expect.retry`, `src/lib/retry-assert.ts`) — `StepController.runVerify` (automatic verify path) now polls on a failed assertion: waits `interval` (`parseInterval`: `5s`/`500ms`/`2m`/bare ms), re-captures the pane, re-asserts up to `max` times. Optional `expect.retry.while` (substring or regex) is a retryable guard — only transient-matching failures are retried, others fail fast (`isRetryableOutput`/`shouldRetry`). Sleep is injectable via `StepControllerOptions.sleep` for tests. (`step.retry` step-level command re-execution remains a ROADMAP item — unimplemented.)
- **Command linting** (`validate --lint`, `src/lib/shell-lint.ts`) — optional shellcheck pass over step `command`/`script`; warnings by default, errors under `--strict`, gracefully skipped when shellcheck is absent.
- **Postmortem / incident report (RCA)** — a **separate document type** from operations (NOT embedded in `operation.yaml`): a blameless incident record that references the operation and run it came from (`operation → run → postmortem`). Model `src/models/postmortem.ts`, schema `src/schemas/postmortem.schema.json`, parser `src/operations/postmortem-parser.ts` (validates via the shared Ajv `SchemaValidationError`; parses with js-yaml `JSON_SCHEMA` so unquoted timestamps stay strings). Three self-contained renderers — `src/manuals/postmortem-generator.ts` (Markdown), `postmortem-adf-generator.ts` (ADF), `postmortem-confluence.ts` (wiki markup) — sharing pure helpers in `postmortem-shared.ts` (`buildMermaidTimeline` etc.); the Confluence Mermaid `timeline` is wrapped in the `{markdown}` macro like the operation Gantt. Because a postmortem has its OWN sections (not operation steps), the four-render-path `StepContent` parity concern does NOT apply — each format just needs its own renderer + test. CLI: `generate postmortem <file> [-f markdown|confluence|adf]` (in `src/cli/commands/generate.ts`) and a top-level `postmortem` command (`src/cli/commands/postmortem.ts`) with `from-run <session|events.jsonl>` (seeds timeline/participants/window/back-refs from a run record via `src/lib/postmortem-from-run.ts`, reusing `readEvents`/`foldEvents`) and `init`. One document type serves both a full postmortem and a lightweight incident report — only `title`/`summary` are required. Example `examples/postmortems/checkout-outage.yaml` (kept in a subdir so the `examples/*.yaml` CI loop doesn't validate it as an operation).

### 🚧 NOT Implemented (Roadmap)
These features are **documented but not functional**:
- ❌ **Non-interactive command execution** (`--auto-approve`/`automatic` context marks steps complete without running commands; tmux-backed send/verify only works in the interactive loop)
- ❌ **Automatic evidence collection** (no screenshot capture, log reading, etc.)
- ❌ **QRH** (command scaffolding exists, no functionality)
- ❌ **External integrations** (Jira, Confluence API, Slack)
- ❌ **AI assistant** (roadmap research item only — no code, no `--with-ai` flag)

**Check [ROADMAP.md](ROADMAP.md) before implementing any "auto" or execution features!**

---

## 🛠️ Setup Commands

```bash
# Install dependencies
npm install

# Run all tests
npm test

# Run specific test suite
npm test tests/manuals/

# Update snapshot tests (manual generation)
npm run test:snapshots:update

# Build for distribution
npm run build

# Run CLI locally
npm start -- validate examples/deployment.yaml
npm start -- generate manual examples/deployment.yaml --output /tmp/manual.md

# Lint code
npx @biomejs/biome check .
```

---

## 📝 Code Style

### General Guidelines
- **TypeScript strict mode** - no `any` without good reason
- **Single quotes**, no semicolons (Biome v2.2.4 enforces this)
- **Functional patterns** where possible (pure functions, immutability)
- **Explicit over implicit** - clear types, no magic
- **Avoid deep nesting** - extract functions instead
- **Lint rules**: Two justified exceptions in `biome.json`:
  - `noExplicitAny`: Disabled (180 instances in YAML parsing - type-safe alternatives overly complex)
  - `noTemplateCurlyInString`: Disabled (23 test strings with intentional template syntax)

### Naming Conventions
- Interfaces: `PascalCase` (e.g., `Operation`, `Step`)
- Types: `PascalCase` (e.g., `StepType`, `EvidenceType`)
- Functions: `camelCase` (e.g., `parseOperation`, `generateManual`)
- Constants: `SCREAMING_SNAKE_CASE` (e.g., `DEFAULT_TIMEOUT`)
- Files: `kebab-case.ts` (e.g., `adf-generator.ts`)

### Import Organization
```typescript
// 1. Node built-ins
import { readFileSync } from 'fs'
import { randomUUID } from 'crypto'

// 2. External dependencies
import yaml from 'js-yaml'
import Ajv from 'ajv'

// 3. Internal modules
import { Operation, Step } from '../models/operation'
import { parseOperation } from '../operations/parser'
```

### Error Handling
- Use `Error` subclasses for specific error types
- Provide context in error messages
- Don't swallow errors silently

### NPM Lifecycle Scripts
- **CRITICAL**: Use `prepublishOnly` (NOT `prepare`) for build scripts
- `prepublishOnly` runs only before `npm publish` (not on user installs)
- `prepare` runs on every install, including production installs without dev dependencies
- This prevents TypeScript compilation errors when users install the package
- CI workflows should explicitly run `npm run build` when needed

**Current configuration (package.json:18)**:
```json
"prepublishOnly": "npm run build"
```

**Why this matters**:
- Users installing the package get pre-built `dist/` folder
- They don't need TypeScript or `@types/node` installed
- Prevents "Cannot find module 'node:fs'" errors in production installs
- Build only happens before publishing, not on every install

---

## 🧪 Testing Instructions

### Test Organization
- **YAML Fixtures**: Stored as separate `.yaml` files in `tests/fixtures/operations/`
  - **Loading**: Use `parseFixture('fixtureName')` from `tests/fixtures/fixtures.ts`
  - **Raw YAML**: Use `loadYaml('fixtureName')` to get YAML string content
  - **File paths**: Use `getFixturePath('fixtureName')` for CLI tests
  - **Type-safe**: Fixture names autocomplete via `FIXTURES` constant
- **TypeScript Objects**: Use pre-parsed `Operation` objects from `tests/fixtures/operations.ts`
  - For testing generators without parsing (e.g., `deploymentOperation`)
  - Only 2 objects maintained (reduced from 1,141 lines)
- **Snapshot tests**: `tests/manuals/*.test.ts` for manual generation
- **Unit tests**: Test pure functions in isolation
- **Integration tests**: Test full workflows (parse → validate → generate)

### Using Fixtures in Tests
```typescript
// Parser tests - use parseFixture()
import { parseFixture } from '../fixtures/fixtures'
const operation = await parseFixture('minimal')

// Generator tests - use TypeScript Operation objects
import { deploymentOperation } from '../fixtures/operations'
const manual = generateManual(deploymentOperation)

// CLI tests - use getFixturePath()
import { getFixturePath } from '../fixtures/fixtures'
const inputPath = getFixturePath('deployment')
execSync(`npx tsx src/cli/index.ts validate ${inputPath}`)

// Tests needing YAML strings - use loadYaml()
import { loadYaml } from '../fixtures/fixtures'
const yamlContent = loadYaml('enhanced')
```

### TDD Approach (NON-NEGOTIABLE)
1. **RED**: Write failing test first
2. **GREEN**: Implement minimal code to pass
3. **REFACTOR**: Clean up while keeping tests green
4. **LINT**: Run `npx @biomejs/biome check --write <changed files>` and fix any new errors
5. **Commit**: Always commit tests with implementation in the same commit

> When adding fields to `renderStep` in `generateSingleEnvManual`, cover each new field with a test — the pattern of adding rendering logic without a test is how the `else if` instruction/command bug went undetected.

### Debug Files
- Create debug/temp files in `/tmp/` folder, **NEVER in project root**
- Never commit debug files
- Use descriptive names: `/tmp/samaritan-debug-parser-output.json`

### CI Pipeline
See `.github/workflows/ci.yml`:
- **test**: Node 20/22/24 compatibility
- **lint**: Biome checks
- **validate-examples**: Validate all `examples/*.yaml`
- **security**: npm audit

---

## 📁 File Organization

### Operation Examples
- **Location**: `examples/*.yaml`
- **Purpose**: Demonstration and validation
- **Naming**: `{purpose}-{type}.yaml` (e.g., `deployment-production.yaml`)

### Test Fixtures
- **Location**: `tests/fixtures/`
  - **`fixtures.ts`**: Centralized fixture mapping and loader utilities
  - **`operations.ts`**: TypeScript `Operation` objects for generator-only tests (2 objects)
  - **`operations/`**: YAML fixture files organized by category
    - `valid/`: Valid operation YAML files
    - `invalid/`: Invalid YAML for error handling tests
    - `features/`: Feature-specific fixtures (foreach, matrix, nesting, etc.)
    - `confluence/`: Confluence generator-specific fixtures
- **Why separate YAML files**: Realistic testing, better organization, eliminates temp file writes
- **Fixture mapping**: Type-safe with autocomplete via `FIXTURES` constant in `fixtures.ts`

### JSON Schemas
- **Location**: `src/schemas/*.json`
- **Copied to**: `dist/schemas/` during build (`npm run build`)
- **Usage**: Loaded by `validation/schema-validator.ts`

### Generated Outputs
- **Manuals**: Output to path specified by `--output` flag or stdout
- **Confluence**: ADF JSON format saved to specified file

### Planning Documents
- **Location**: `specs/001-i-want-to/`
- **Files**: `plan.md`, `research.md`, `data-model.md`, `tasks.md`

---

## 🔑 Key Patterns & Conventions

### Operation Parsing
```typescript
// Parser functions return Operation interfaces
function parseOperation(yamlContent: string): Operation {
  const data = yaml.load(yamlContent)
  // Transform to Operation interface
  return operation
}
```

### Manual Generation
```typescript
// Generator functions accept Operation, return string
function generateManual(operation: Operation, options: GeneratorOptions): string {
  // Build manual content
  return markdown
}
```

### Evidence Configuration
```yaml
# ✅ Current format (v1.0+) - Environment-specific evidence
evidence:
  required: true
  types: [screenshot, log, command_output]  # Types are for docs, not collected automatically
  results:                                  # Environment-keyed evidence results
    staging:
      - type: screenshot
        file: ./evidence/staging-dashboard.png
        description: Dashboard showing 3 pods
      - type: command_output
        file: ./evidence/staging-deploy.log  # NEW: Read from file and embed
        description: Deployment output
    production:
      - type: screenshot
        file: ./evidence/prod-dashboard.png
      - type: command_output
        content: |                           # Inline content still supported
          deployment.apps/web-server created
          pod/web-0    1/1     Running   0    10s
        description: Production deployment output

# ❌ Removed (parser throws a migration error if these appear)
# evidence_required: true
# evidence_types: [screenshot, log]
# Use the nested evidence: { required, types } form above instead.
```

**Evidence Results Details:**
- **Purpose**: Embed pre-captured evidence directly in generated manuals
- **Environment-Specific**: Results are keyed by environment name (e.g., `staging`, `production`)
- **Storage Options**:
  - `file`: Path to evidence file (relative to operation file)
  - `content`: Inline evidence content (for text-based evidence)
- **File Reading (BONUS)**:
  - For `command_output` and `log` types with `file`, generator reads file content and embeds it as code block
  - Screenshots/photos: Rendered as embedded images
  - Other file types: Rendered as download links
- **Validation**: JSON Schema enforces `oneOf` constraint (must have either file OR content, not both)
- **Rendering**:
  - **Evidence metadata** (types, required status): Shown **once** in the step column
  - **Evidence results**: Shown in **environment-specific** columns
  - Each environment shows only its own evidence (e.g., staging column shows `evidence.results.staging`)
- **Test Fixtures**: See `tests/fixtures/operations/features/evidence-with-results.yaml` and `reviewer-and-env-evidence.yaml`

**Implementation Notes:**
When adding features that affect evidence rendering, ensure ALL components are updated:
1. Update data model in `src/models/operation.ts`
2. Update parser in `src/operations/parser.ts`
3. Update JSON schema in `src/schemas/operation.schema.json`
4. **Update ALL generators** (critical - often missed):
   - `src/manuals/generator.ts` (Markdown) - pass `operationDir` for file reading
     - **Two rendering paths inside this file** (easy to update one and miss the other):
       - `generateStepRow` / `generateSubStepRow` — multi-env table format (used without `--env`)
       - `generateSingleEnvManual` → `renderStep` — heading format (used with `--env`)
   - `src/manuals/adf-generator.ts` (ADF/JSON)
   - `src/cli/commands/generate.ts` (Confluence markup) - pass `operationDir` for file reading
5. Update CLI commands to pass operation directory where needed
6. Add comprehensive tests for all output formats

### Step Types & Aviation-Inspired Fields
```yaml
# In v1.0, ALL steps are effectively "manual" (just documentation)
# type: automatic doesn't execute commands - parsed but not run
steps:
  - name: Deploy App
    type: manual  # ✅ Accurate in v1.0
    pic: ops-team@example.com        # Person In Charge (executor)
    reviewer: sre-lead@example.com   # Reviewer/buddy (monitoring)
    instruction: |
      Run deployment:
      ```bash
      kubectl apply -f deployment.yaml
      ```
    evidence:
      required: true
      types: [command_output]
      results:
        staging:
          - type: command_output
            file: ./evidence/staging-deploy.log
        production:
          - type: command_output
            file: ./evidence/prod-deploy.log
```

**Aviation-Inspired Fields:**
- **`pic`** (Person In Charge): The person responsible for executing the step
- **`reviewer`** (Reviewer/Buddy): The person who monitors and verifies the PIC's work
- **Sign-off Checkboxes**: Generated manuals include checkboxes for PIC and Reviewer sign-off when these fields are set

### Script File Import (script)

**✅ Implemented in v1.0+**

The `script:` field references an external shell script file. The generator reads the file at generation time and embeds its full content as a `bash` code block in the manual.

```yaml
steps:
  - name: Deploy Application
    type: manual
    instruction: Review the script below, then run it.
    script: ./scripts/deploy.sh   # Path relative to operation file
```

**Use `script` vs `command`:**
- `command:` → short inline command typed directly into a terminal
- `script:` → path to an external `.sh` file whose full content is embedded in the manual
- **Mutually exclusive**: a step cannot have both `command` and `script` (schema validation error)

**Rendering:**
- Shows `**Script:** \`./path/to/script.sh\`` label in the manual
- Reads and embeds full script content as a `bash` fenced code block
- Operators can either run the script directly (`bash ./scripts/deploy.sh`) or copy-paste the content
- If the file is missing at generation time, shows a graceful error message in the manual

**Example:** `examples/deployment-with-scripts.yaml` + `examples/scripts/deploy.sh`

**Implementation Notes:**
- Path is relative to the operation file (same as `evidence.results[env].file`)
- File reading happens at generation time (not parse time)
- Both `operationDir` threading in `generator.ts` and `adf-generator.ts` required for file reading
- `adf-generator.ts` receives `operationDir` via `generateADF` → `createStepsTable` call chain
- `script:` works on both `Step` and `RollbackStep` (via the shared `StepContent` base)

### Data Model: StepContent Base Interface

`StepContent` is the shared base interface for both `Step` and `RollbackStep`, containing all "what to do / who does it" fields. Adding a field to `StepContent` automatically propagates to both.

**Fields in `StepContent` (shared by Step and RollbackStep):**
- `command` — inline terminal command
- `script` — path to external shell script
- `instruction` — markdown instructions
- `timeout` — step timeout in seconds
- `description` — step description
- `evidence` — evidence config (nested `{ required, types, results }`)
- `options` — step options (substitute_vars, show_command_separately)
- `session` — execution session reference
- `pic` — Person In Charge
- `reviewer` — Reviewer/buddy
- `expect` — output verification config

**Fields that remain `Step`-only (structural/organizational):**
`name`, `type`, `id`, `phase`, `if`, `foreach`, `sub_steps`, `when`, `variants`, `approval`, `needs`, `template`/`with`, `variables`, `capture`, `retry`, `rollback`, `section_heading`, `timeline`, `ticket`, `manual_override`, `manual_instructions`, `estimated_duration`, `env`, `usesGroup` (parser-set: groups steps expanded from one `uses:` block for block-aware phase grouping)

**Rule**: Never add a content/execution field directly to `Step` or `RollbackStep` — add it to `StepContent` so both types benefit automatically.

### Template Import (template)

**✅ Implemented in v1.0+**

SAMARITAN supports reusable step templates via the `template:` directive, enabling DRY (Don't Repeat Yourself) principles for common operation patterns.

**How it works:**
```yaml
# Template file (examples/templates/health-checks.yaml)
# Can be either:
# 1. Array of steps (simple)
- name: Check API
  command: curl ${ENDPOINT}/health
  timeout: ${TIMEOUT}

# 2. Full operation (with metadata)
name: Health Checks Template
version: 1.0.0
steps:
  - name: Check API
    command: curl ${ENDPOINT}/health
```

**Usage:**
```yaml
# Main operation
steps:
  - template: ./templates/health-checks.yaml
    with:
      ENDPOINT: https://api.example.com
      TIMEOUT: 60
```

**Implementation Details (src/operations/parser.ts):**
1. **Template Loading** (`loadTemplateSteps`): Loads YAML file, extracts steps (handles both array and operation format)
2. **Variable Extraction** (`extractVariables`): Finds all `${VAR}` placeholders recursively
3. **Variable Substitution** (`substituteVariables`): Replaces placeholders, preserves types (e.g., `${TIMEOUT}` with value `60` yields number `60`, not string `"60"`)
4. **Inline Expansion** (`resolveStepReferences`): Template steps inserted at import location (not nested)
5. **Validation**: All `${VAR}` must have corresponding values in `with:`, otherwise parser throws error

**Key Features:**
- ✅ Supports both step array and operation file formats
- ✅ Type-preserving variable substitution (numbers stay numbers, booleans stay booleans)
- ✅ Relative path resolution (template paths relative to importing operation)
- ✅ Validation of required variables (errors if any ${VAR} not provided)
- ✅ Environment variable integration (can pass ${ENV_VAR} from parent to template)
- ✅ Multiple imports of same template with different parameters

**Tests:**
- Parser tests: `tests/operations/parser.test.ts` (Template Import suite)
- Test fixtures: `tests/fixtures/templates/*.yaml`
- Integration: `tests/fixtures/operations/valid/with-template-import.yaml`
- Examples: `examples/templates/*.yaml`, `examples/deployment-with-templates.yaml`

**Schema (src/schemas/operation.schema.json):**
- Steps `oneOf` includes third variant for template imports
- Required: `template` (path to template)
- Optional: `with` (variables to pass, defaults to empty object)
- Recursive `$ref` for sub_steps points to `oneOf/2` (regular step definition)

### Variable Resolution Layering (foreach/matrix + `--resolve-vars`)

Variable resolution happens in two distinct layers — don't conflate them:

1. **Parse time** (`src/operations/parser.ts`, `resolveStepReferences`): `${VAR}` references inside `step.foreach` (values/matrix/include/exclude) are substituted against `{ ...importContext.commonVariables, ...step.variables }` **before** `generateMatrixCombinations`/`filterMatrixCombinations` run. `commonVariables` comes from `common_variables:` + top-level `variables:` + `env_file` (priority: `common_variables > variables: > env_file`). This is what makes expanded step **titles** (via `formatVariableCombination`) and the loop variable injected into `step.variables` show resolved values like `(oncall@example.com)` instead of `(${ONCALL_EMAIL})` — for ALL output formats, independent of `--resolve-vars`. Environment-specific variables are NOT in scope here (no environment has been selected yet), so `${TEAM_EMAIL}`-style references stay literal after parsing. The foreach combo is also recursively injected into the expanded step's `sub_steps` (at every nesting level, via `injectComboVariables`) and `variants`, so `${VAR}` references inside sub-step `command`/`instruction`/`expect`/`rollback` resolve the same way as the parent step.
2. **Generation time** (`--resolve-vars`, `src/lib/step-resolution.ts` `substituteVariables(command, envVariables, stepVariables?)`): resolves remaining `${VAR}` placeholders (including environment-specific ones) against the selected environment's variables, with `step.variables` taking priority. `stepVariables` values that are themselves `${VAR}` references (e.g. `step.variables.TEST_RECIPIENT = "${EMAIL_A}"`, injected by foreach) are pre-resolved against `envVariables` in one pass before merging — so chained references fully resolve in a single call. All generators (`generator.ts` markdown single-env/multi-env, `adf-generator.ts`, `generate.ts` Confluence) must pass both the relevant env/common variables AND `step.variables` (or `commonVariables` for the shared multi-env name cell) to get correct resolution of step names, commands, instructions, and `expect`/rollback content.

### Phase Grouping is Block-Aware (`uses:` preflight scoping)

The phase-grouped generators (multi-env markdown, ADF, Confluence, and both Mermaid gantts) must NOT bucket steps by raw `step.phase` anymore — they call **`groupByPhase(items, getStep)`** (`src/lib/phase-grouping.ts`). Standalone steps still bucket by their own phase (so top-level `phase: preflight` hoists into the global Pre-Flight section), but steps expanded from one `uses:` block stay **contiguous**: the parser stamps every expanded step with a shared `step.usesGroup = { id, name }` (outermost `uses:` wins, since expansion recurses inner-first — `src/operations/parser.ts`), and `groupByPhase` routes the whole block into one effective phase (`flight` if any step is flight, else `postflight`, else `preflight`). Net effect: a reused block's own `phase: preflight` checks render locally right before the block (in the Flight phase, labelled via the existing `step.phase !== currentPhase` badge), not hoisted to the top. `generateSingleEnvManual` renders in document order and is unaffected. `usesGroup` is a Step-only structural field (NOT `StepContent`) and is parser-set, not authored in YAML. Example: `examples/scoped-preflight.yaml`; helper tests: `tests/lib/phase-grouping.test.ts`.

---

## 🔀 Git Workflow

### Commit Guidelines
- **ONLY commit changed files** - never `git add .` blindly
- **Commit tests with code** - same commit, not separate
- **Message format**: `feat: add X`, `fix: resolve Y`, `docs: update Z`, `test: add tests for W`
- **Never commit**:
  - `node_modules/`
  - `dist/` (built files)
  - `/tmp/` debug files
  - `.env` or credential files

### Branch Strategy
- **main**: Stable, released code
- **feature branches**: `feature/add-xyz`, `fix/bug-123`
- **Merge**: Via PR with tests passing

---

## ⚡ Common Gotchas

### 1. Auto Features Aren't Implemented
```yaml
# ❌ This looks like it runs commands, but it doesn't in v1.0
- name: Deploy
  type: automatic
  command: kubectl apply -f deployment.yaml

# ✅ This is accurate for v1.0
- name: Deploy
  type: manual
  instruction: |
    Run: kubectl apply -f deployment.yaml
```

### 2. Evidence Types vs Evidence Results
```typescript
// evidence.types is parsed and included in generated manuals
// BUT: No actual screenshot capture, log reading, or file collection in v1.0
// Phase 2.2 (ROADMAP) will implement automatic collection

// ✅ evidence.results IS implemented (v1.0+) with environment-specific structure
// You CAN embed pre-captured evidence directly in manuals
evidence:
  required: true
  types: [screenshot, command_output]      // Documentation-only (what's expected)
  results:                                 // Actual evidence (embedded in generated manuals)
    staging:
      - type: screenshot
        file: ./evidence/staging-deployment.png
    production:
      - type: command_output
        file: ./evidence/prod-deploy.log  // File content will be read and embedded
```

### 3. Commands with No Implementation
- `samaritan run` - Interactive loop is implemented. **Default mode is now `sidecar`** (since v1.1). In sidecar mode, samaritan DISPLAYS each step's resolved command but does NOT send it to tmux — the operator runs it themselves, then presses `[v]` to verify `step.expect`. Both spawn-own tmux (`sessions:` in YAML) and attach-to-existing pane (`--attach <tmux-target>`) are supported, plus mid-flight attach/switch via `[t]`. See `CaptureBackend` in `src/lib/capture-backend.ts` and `TmuxPaneCapture` in `src/lib/tmux-session.ts`.

  Non-sidecar modes still work: `manual` (operator-driven, tmux-optional), `automatic` (tmux-backed send/verify), `hybrid`. `manual` steps support: `[n] note` (free-text annotations), `[e] evidence` (capture tmux output, attach a file/screenshot/image, or paste text — persisted as `EvidenceItem`s and rendered in the report as images/links/code blocks), `[x] remove evidence` (only shown once evidence exists for the step — lists captured items, deletes the chosen one from the session record and, for file/screenshot/video evidence, from `~/.samaritan/sessions/<id>/evidence/` on disk too; logged as an `evidence_removed` event and omitted from `--report`), and `[v] verify` (runs `step.expect` against captured pane output). In sidecar mode, ALL steps (automatic and manual) additionally show `[t] attach pane` to attach/swap a capture backend mid-run, and `[p] send to pane` when the step has a command and a pane is attached. Every step that isn't the first also shows `[b] back` to return to an earlier step. When the operation declares a top-level `rollback:` block, every step prompt also shows `[g] global rollback` (next to per-step `[r] rollback`) — see the global-rollback note in Gotcha #6.

  **`[p]` send to pane (sidecar)**: pastes the `${VAR}`-resolved command into the attached pane via a tmux paste **buffer** (`set-buffer -b samaritan-send -- <cmd>` + `paste-buffer -d -b samaritan-send -t <pane>`, in `pasteBufferTo()` / `CaptureBackend.pasteCommand()` in `src/lib/tmux-session.ts`) and **never** appends Enter — the operator reviews the command at their own prompt and runs it. Deliberately the ONLY write path in the otherwise read-only `CaptureBackend` abstraction (`src/lib/capture-backend.ts`): `pasteCommand?` is optional; both `TmuxSession` (spawn-own) and `TmuxPaneCapture` (attach) implement it. Gated on `mode === 'sidecar' && resolvedCommand && backend.hasTarget(...)`; with nothing attached it tells the operator to `[t]` attach first. Emits a `user_input`/`action: 'send_to_pane'` breadcrumb (carrying the `command`) — deliberately NOT `command_sent`, since `foldEvents` would fold that into the step's command list and the report would render a misleading duplicate "Command sent" row (sidecar never executes). The raw paste stays in `events.jsonl`. "Retry the command during verify" = press `[p]` again, then `[v]` — no separate verify-retry action exists. Smoke-test in real tmux: the command must land at the prompt WITHOUT a trailing newline.

  **`[b]` back navigation**: `executor.goToStep(index)` (`src/lib/executor.ts`, the rewind counterpart to `resumeFromIndex`) resets the target step and every later step to `pending`, rewinds the matching status counters, and sets `currentStepIndex`. The run loop reassigns the `for` loop's `i = target - 1` then `continue` so `i++` lands exactly on the target; the post-loop step-execution block is bypassed via a `navTarget` flag. `persistProgress()` saves the rewound index. The append-only `events.jsonl` is never rewritten — a `user_input`/`action: 'back'` event records the jump and the prior attempt's events remain. `goToStep` reuses the closed `operation_started` `ExecutionEventType` (like `resumeFromIndex`) so the event union stays closed.

  **`q`/`quit` behavior change (v1.1)**: In the manual/sidecar action loop, `q` now **aborts** the operation (same as `abort`). Previously `q` recorded "q" as a note and completed the step. Integration tests that use `q` to abort are correct; any test that expected `q` to complete a step as a note must be updated. An abort additionally persists the session as **`paused`** (resumable) and prints a `samaritan resume <id>` hint — the JSONL `session_end` event still records `status: cancelled`.

  **`[t]` attach pane**: fires immediately without Enter (in `IMMEDIATE_ACTION_CHARS`) and shows a numbered picker built from `listTmuxPanes()` (`tmux list-panes -a`, samaritan's own pane marked via `$TMUX_PANE`); typing a raw target still works. **Raw-mode keypress gotcha**: `readActionKey` must suspend readline's own `keypress` listener while reading in raw mode — otherwise every key is echoed twice ("t" renders as "tt") and also lands in readline's internal line buffer, pre-filling the next `question()` prompt (the historical stray "v" on the assertion-failure prompt).

  **Verify output cleaning**: `StepController.verifyOutput` passes pane captures through `cleanTerminalOutput()` (`src/lib/assertions.ts`) before asserting — strips ANSI/OSC escape sequences and resolves `\r` overwrites/`\r\n` line endings from tmux pipe-pane captures. Failed assertions print the tail of the actual output via `renderAssertOutcome()` (`src/lib/tui.ts`).

  **Sidecar verify UX (checklist + highlighted output + gutter)**: `StepController.verifyOutput` now also returns `detailed` (`assertOutputDetailed()` in `src/lib/assertions.ts` — evaluates ALL checks, no short-circuit; `assertOutput` is unchanged and still short-circuits). `verifyManualOutput` (`src/cli/commands/run.ts`) loops on `[v]`: it calls `renderVerifyOutcome(detailed, step.expect, { expand })` (`src/lib/tui.ts`) which renders a PASS/FAIL header, a per-check checklist with inline computed values (e.g. `found "1", need ≥ 3`), and the captured output (tail of `VERIFY_OUTPUT_TAIL_LINES=12`, or full when `expand`) with GREEN+INVERSE highlights on matched `contains`/`any_line_contains`/`matches`/`any_line_matches`, RED on offending `not_contains`/`no_line_contains`/`no_line_matches`, and `missing: <expected>` hints for unmatched failures. (Per-line regex matchers `any_line_matches`/`no_line_matches` — regex siblings of the `*_contains` line checks — highlight via `firstLineRegexSpan` so `^`/`$` anchors resolve per-line; `validate` regex-lints all `expect` regex fields via `src/lib/regex-lint.ts`: uncompilable → error, ReDoS-prone → warning/strict-error.) Each output line is prefixed by `renderHighlightedBlock`'s optional gutter: an absolute line number (accounting for tail truncation) + `→` arrow on lines containing a highlight + `│` separator. On PASS the loop ends with a "press [v] again to re-check" hint; on FAIL `promptAssertFailureAction` offers `o`/`r`/`c` (copy the `${VAR}`-resolved command to the clipboard so the operator can re-run it; only offered when `commandToCopy` is passed — non-terminal, re-renders the menu)/`m` (expand to full output, re-render)/`v` (re-capture pane + re-run all checks)/Enter=stop. `step.expect`'s `Expected: <criteria>` is also printed up front before the step prompt via `renderExpectDescription`.

  **Run-loop `${VAR}` resolution includes step.variables**: `tryResolve(text, stepVars?)` in `run.ts` resolves `command`/`instruction`/`description`/rollback display against `{ ...vars, ...stepVars }` (step vars pre-resolved against `vars`, mirroring `substituteVariables`/`substituteExpectVars`) — so a `foreach`/`matrix` loop variable (injected into `step.variables` at parse time) resolves in the displayed command, not just in `expect`. Always pass `step.variables` to `tryResolve` for per-step content; without it, expanded matrix/foreach steps leak literal `${LOOP_VAR}`.

  **Step-index persistence gotcha**: the executor emits `step_completed` BEFORE advancing `currentStepIndex`, so SessionManager's event-driven save records a stale index. The interactive loop calls `persistProgress()` (explicit `updateSessionFromExecutor`) after every `executeStepManually` to persist the post-advance index — without it, `resume` repeats the step that was just completed.

  > **Testing note**: the manual-step prompts (`[n]`/`[e]`/`[x]`/`[v]`/`[t]`) each chain multiple sequential `readline` `question()` calls. This is fine with real keyboard input (each line arrives as its own event), but piped/batch stdin that delivers several lines in one chunk can make Node's `readline` drop every buffered line but the first per pending question — a `question()` issued from a freshly-invoked async helper can then hang forever. Integration tests for these flows should stick to single-prompt interactions (e.g. `'q\n'` or `'abort\n'`); never chain `'t\ntarget\n'`. See the `[x] remove evidence` tests in `tests/cli/run.test.ts`. (The pre-existing `'recording a note emits...'` test only passes because of an unrelated `📝` substring in the audit-log banner line — it does not actually exercise the multi-prompt note flow.)
- **Run record / session log** - **Implemented**: every `run`/`resume` writes an append-only black box `events.jsonl` AND an always-on `report.md` **beside the operation** at `<op-dir>/.samaritan-runs/<id>/` (path helpers `getRunDir`/`getRunLogPath`/`getRunReportPath` in `src/lib/session-persistence.ts`, with a writable fallback to `~/.samaritan/sessions/<id>/`). `.samaritan-runs/` is gitignored (force-add to commit a run). `createEventLogger(sessionId, operationFile)` now takes the operation file. The events stream is folded into structured records by `src/lib/session-log.ts` (`foldEvents`/`buildStepRecords`/`readEvents` — single source of truth for both the persisted `step_log` and the Markdown report). The session JSON (`OperationSession.step_log: StepRecord[]`, `src/models/step-record.ts`) carries per-step input/output/verification/approval/notes/evidence/status/timing — refreshed each step via `SessionManager.updateStepLog` from `persistProgress` and once more at run end. The report (`src/lib/report-generator.ts`) renders a per-step verification ledger (`assert_result` checks) and an aggregated Approval Trail; `--report <dir>` writes an *extra* copy. When adding fields to `StepRecord`, update the `foldEvents` case that populates it AND the `renderStep` block that displays it.
- `samaritan resume` - **Fully implemented**: `run` persists sessions to `~/.samaritan/sessions/<id>.json` (`src/lib/session-persistence.ts`); `resume <session-id>` restores variables, execution mode, and step index, then re-enters the interactive loop
- `samaritan sessions` - **Implemented**: lists saved sessions from `~/.samaritan/sessions/` (resumable ones by default, `--all` for everything) with a `samaritan resume <id>` hint per resumable session (`src/cli/commands/sessions.ts`)
- `samaritan qrh` - Command exists, no QRH database

### 4. Don't Assume Features Exist
- Check implementation before assuming functionality
- If docs mention a feature, verify in code
- When in doubt, check `ROADMAP.md`

### 5. `git add src/manuals/` Requires `-f`
The `.gitignore` contains `manuals/` which also matches `src/manuals/`, so plain `git add src/manuals/*.ts` silently fails. Since those files are already tracked, use `git add -f src/manuals/<file>` to stage them.

### 6. Rollback steps are "just like normal steps" — `name` + nested `sub_steps`, rendered everywhere
A `RollbackStep` is structurally a step: `RollbackStep extends Omit<Partial<Step>, 'sub_steps'>` with `sub_steps?: RollbackStep[]`. It may carry an optional `name` and nest `sub_steps`, which render recursively (`<label>.N`, `<label>.N.M`) in **both** rollback concepts and **all** formats:
- **Step-level rollback** (`Step.rollback: RollbackStep[]`) — renders after the step as a `🔄 Rollback` heading/section; nested `sub_steps` render inline (markdown/Confluence cells use a `↳ N` prefix; single-env uses nested headings).
- **Operation-level rollback plan** (`operation.rollback.steps[]`) — renders as `Rollback Step N`, `N.M`, … (headings in single-env; rows in multi-env/ADF/Confluence).

**THE recurring trap (why this took three attempts):** rollback handling was *copied* in four layers, and each copy independently forgot `sub_steps`:
1. **Parser** (`src/operations/parser.ts`) — step-level rollback was normalized field-by-field and dropped `name`/`sub_steps` entirely (operation-level was passed through raw, so it kept them — that asymmetry is why op-level "worked" while step-level didn't). Now `normalizeRollbackStep()` is recursive and copies `name` + `sub_steps`. **If you add a rollback field, add it here or it vanishes before rendering.**
2. **Schema** — `#/definitions/rollbackStep` (operation-level + nested `sub_steps`, strict `additionalProperties:false`) and the inline `Step.rollback` schema both allow `name`/`sub_steps`.
3. **Markdown/ADF/Confluence renderers** — every per-format rollback site now routes through ONE recursive helper: `renderRollbackStepSingleEnv` (single-env), `renderRollbackCellMarkdown(..., includeSubsteps)` (multi-env step-level + sub-step + aggregate), `emitRollbackRow` (operation-level multi-env), ADF `buildRollbackCellNodes`/`pushRollbackRows`, Confluence `renderInlineRollback`'s `buildCell` + `emitRollbackRow` + `renderRollbackDocStep`. Don't re-copy a rollback renderer — extend the shared one.

Fixtures `global-rollback-substeps.yaml` / `step-rollback-substeps.yaml`; tests `tests/manuals/global-rollback-substeps.test.ts` / `step-rollback-substeps.test.ts`; example `examples/rollback-with-substeps.yaml`. Reproduce in every format AND both rollback concepts (rule 7) before claiming a rollback fix.

**Global rollback grouping (`aggregate_step_rollbacks`)** — the two rollback concepts above are linked by ONE pure helper, `buildGlobalRollback(globalSteps, stepsToAggregate, { aggregate })` (`src/lib/global-rollback.ts`). When `operation.rollback.aggregate_step_rollbacks` is true it returns the explicit `operation.rollback.steps` followed by every step's own `rollback` (recursing into `sub_steps`) in **reverse step order**, each shallow-cloned with a provenance-prefixed `name` (`↩ Rollback for "<step>"`). Because it returns a plain `RollbackStep[]`, all four operation-level rollback renderers consume its output unchanged (they were switched from iterating `operation.rollback.steps` to iterating `buildGlobalRollback(...)` — no renderer-internal changes), and the run loop reuses it too. In `src/cli/commands/run.ts`, `[g]` (`doGlobalRollback`, predicate `isGlobalRollback`, in `IMMEDIATE_ACTION_CHARS`, offered when `operation.rollback` exists) builds the recovery from **completed** steps only, previews it, confirms, runs it via `StepController.runRollbackSteps` (new method that flattens `sub_steps` via `flattenRollbackSteps` and tags events `context: 'global'`; the per-step `rollback()` is untouched), then aborts. Known limitation: aggregated entries render/run with their command's `${VAR}` resolved against env/common vars only — step-scoped `step.variables` are not threaded into the global rollback (same as pre-existing op-level rollback). Fixture `aggregated-global-rollback.yaml`; tests `tests/lib/global-rollback.test.ts` + `tests/manuals/aggregated-global-rollback.test.ts`; example `examples/global-rollback-aggregated.yaml`.

---

## 📚 Key Files to Reference

### User Documentation
- **README.md** - Main user-facing documentation
- **USAGE.md** - Quick start guide
- **ROADMAP.md** - ⚠️ **CHECK THIS** before implementing "future" features

### Technical Documentation
- **specs/001-i-want-to/plan.md** - Implementation plan and architecture
- **specs/001-i-want-to/data-model.md** - Data model design
- **.github/workflows/ci.yml** - CI pipeline definition

### Core Implementation
- **src/models/operation.ts** - Core TypeScript interfaces
- **src/operations/parser.ts** - YAML parsing logic
- **src/manuals/generator.ts** - Markdown manual generation
- **src/manuals/adf-generator.ts** - Confluence ADF generation
- **src/validation/schema-validator.ts** - JSON Schema validation

---

## 🚀 Quick Reference

### Adding a New CLI Command
1. Create command file in `src/cli/commands/`
2. Export command function accepting `program: Command`
3. Register in `src/cli/index.ts`
4. Add tests in `tests/cli/`
5. Update README.md with command docs
6. Update `.claude/skills/samaritan-operations/reference/cli.md` (command table / flags)

**Example: Schema Export Command**
- Created `src/cli/commands/schema.ts` with `schemaCommand`
- Registered in `src/cli/index.ts` with `program.addCommand(schemaCommand)`
- Tests in `tests/cli/schema.test.ts` verify JSON/YAML export
- Documented in README.md under "Schema Inspection" section

### Adding a New Step Feature
1. Update `src/models/operation.ts` interfaces
2. Update JSON schema in `src/schemas/`
3. Update parser in `src/operations/parser.ts`
4. Update manual generator in `src/manuals/generator.ts`
5. Add test YAML fixture in `tests/fixtures/operations/features/`
6. Add fixture mapping entry in `tests/fixtures/fixtures.ts`
7. Add snapshot test in `tests/manuals/`
8. **Add example YAML in `examples/`** demonstrating the feature
9. Update README.md and USAGE.md with the new field/usage
10. Update CLAUDE.md with any new patterns
11. Update `.claude/skills/samaritan-operations/reference/operation-yaml.md` with the new field

> **Rule**: Every new feature MUST include a working example file in `examples/` and updated user documentation. The example should demonstrate the golden path usage clearly.

### Updating Manual Format
1. Modify generator in `src/manuals/generator.ts` or `adf-generator.ts`
2. Run `npm run test:snapshots:update` to update snapshots
3. Review snapshot diffs carefully
4. Commit generator changes and updated snapshots together

### Maintaining Agent Skills (`.claude/skills/`)
Agent Skills teach Claude (and contributors using it) how to drive SAMARITAN.
They live in `.claude/skills/<name>/SKILL.md` (+ optional `reference/*.md`) and
are committed to the repo (project-scoped). The current skill is
`samaritan-operations`.

A skill must be updated **in the same commit** as any change that makes it stale:
- **CLI commands/flags** changed → update `reference/cli.md`
- **Operation YAML fields / `StepContent` / schema** changed → update `reference/operation-yaml.md`
- **Scope changed** (a roadmap feature shipped, or a feature was removed) → update the
  "Scope guardrails" section of `SKILL.md` so implemented-vs-roadmap stays accurate
- **New skill added** → keep `SKILL.md` short (golden path only) and push depth into
  `reference/*.md` for progressive disclosure; the frontmatter `description` is the
  trigger and must state *what it does + when to use it*

Authoritative sources the skills point at (don't duplicate, reference them):
`src/schemas/operation.schema.json` and `examples/*.yaml`. Because the skill links
to these rather than restating them, keeping examples and the schema correct keeps
most of the skill correct automatically.

---

## 💡 Additional Notes

- **Performance**: Operation parsing should be <100ms for typical files
- **Compatibility**: Node 24 (main), supports 20+, tested on 20/22/24 in CI
- **TypeScript**: Compile target ES2022, module resolution Node16
- **Dependencies**: Keep minimal - currently just Commander, js-yaml, Ajv, atlaskit/adf-utils
- **Breaking changes**: Follow semantic versioning, provide migration guides

---

**Last Updated**: 2026-06-22
**Maintainer**: @sre-team

For questions or clarifications, check:
1. This file (CLAUDE.md)
2. ROADMAP.md (for what's planned vs implemented)
3. README.md (for user documentation)
4. specs/001-i-want-to/ (for design decisions)
