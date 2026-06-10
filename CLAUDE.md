# SAMARITAN - AI Assistant Context

**Project**: Operations as Code CLI for SRE Teams
**Version**: 1.0.0 (MVP - Documentation Generator)
**Status**: ✅ Shipped (2025-10-08) | 161/161 tests passing

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

# ⚠️ Deprecated (still supported for backward compatibility)
evidence_required: true
evidence_types: [screenshot, log]
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
- `evidence` / `evidence_required` — evidence config
- `options` — step options (substitute_vars, show_command_separately)
- `session` — execution session reference
- `pic` — Person In Charge
- `reviewer` — Reviewer/buddy
- `verify` — output verification config

**Fields that remain `Step`-only (structural/organizational):**
`name`, `type`, `id`, `phase`, `if`/`condition`, `foreach`, `sub_steps`, `when`, `variants`, `approval`, `needs`, `template`/`with`, `variables`, `capture`, `retry`, `rollback`, `section_heading`, `timeline`, `ticket`, `manual_override`, `manual_instructions`, `validation`, `estimated_duration`, `env`

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

  Non-sidecar modes still work: `manual` (operator-driven, tmux-optional), `automatic` (tmux-backed send/verify), `hybrid`. `manual` steps support: `[n] note` (free-text annotations), `[e] evidence` (capture tmux output, attach a file/screenshot/image, or paste text — persisted as `EvidenceItem`s and rendered in the report as images/links/code blocks), `[x] remove evidence` (only shown once evidence exists for the step — lists captured items, deletes the chosen one from the session record and, for file/screenshot/video evidence, from `~/.samaritan/sessions/<id>/evidence/` on disk too; logged as an `evidence_removed` event and omitted from `--report`), and `[v] verify` (runs `step.expect` against captured pane output). In sidecar mode, ALL steps (automatic and manual) additionally show `[t] attach pane` to attach/swap a capture backend mid-run.

  **`q`/`quit` behavior change (v1.1)**: In the manual/sidecar action loop, `q` now **aborts** the operation (same as `abort`). Previously `q` recorded "q" as a note and completed the step. Integration tests that use `q` to abort are correct; any test that expected `q` to complete a step as a note must be updated. An abort additionally persists the session as **`paused`** (resumable) and prints a `samaritan resume <id>` hint — the JSONL `session_end` event still records `status: cancelled`.

  **`[t]` attach pane**: fires immediately without Enter (in `IMMEDIATE_ACTION_CHARS`) and shows a numbered picker built from `listTmuxPanes()` (`tmux list-panes -a`, samaritan's own pane marked via `$TMUX_PANE`); typing a raw target still works. **Raw-mode keypress gotcha**: `readActionKey` must suspend readline's own `keypress` listener while reading in raw mode — otherwise every key is echoed twice ("t" renders as "tt") and also lands in readline's internal line buffer, pre-filling the next `question()` prompt (the historical stray "v" on the assertion-failure prompt).

  **Verify output cleaning**: `StepController.verifyOutput` passes pane captures through `cleanTerminalOutput()` (`src/lib/assertions.ts`) before asserting — strips ANSI/OSC escape sequences and resolves `\r` overwrites/`\r\n` line endings from tmux pipe-pane captures. Failed assertions print the tail of the actual output via `renderAssertOutcome()` (`src/lib/tui.ts`).

  **Step-index persistence gotcha**: the executor emits `step_completed` BEFORE advancing `currentStepIndex`, so SessionManager's event-driven save records a stale index. The interactive loop calls `persistProgress()` (explicit `updateSessionFromExecutor`) after every `executeStepManually` to persist the post-advance index — without it, `resume` repeats the step that was just completed.

  > **Testing note**: the manual-step prompts (`[n]`/`[e]`/`[x]`/`[v]`/`[t]`) each chain multiple sequential `readline` `question()` calls. This is fine with real keyboard input (each line arrives as its own event), but piped/batch stdin that delivers several lines in one chunk can make Node's `readline` drop every buffered line but the first per pending question — a `question()` issued from a freshly-invoked async helper can then hang forever. Integration tests for these flows should stick to single-prompt interactions (e.g. `'q\n'` or `'abort\n'`); never chain `'t\ntarget\n'`. See the `[x] remove evidence` tests in `tests/cli/run.test.ts`. (The pre-existing `'recording a note emits...'` test only passes because of an unrelated `📝` substring in the audit-log banner line — it does not actually exercise the multi-prompt note flow.)
- `samaritan resume` - **Fully implemented**: `run` persists sessions to `~/.samaritan/sessions/<id>.json` (`src/lib/session-persistence.ts`); `resume <session-id>` restores variables, execution mode, and step index, then re-enters the interactive loop
- `samaritan sessions` - **Implemented**: lists saved sessions from `~/.samaritan/sessions/` (resumable ones by default, `--all` for everything) with a `samaritan resume <id>` hint per resumable session (`src/cli/commands/sessions.ts`)
- `samaritan qrh` - Command exists, no QRH database

### 4. Don't Assume Features Exist
- Check implementation before assuming functionality
- If docs mention a feature, verify in code
- When in doubt, check `ROADMAP.md`

### 5. `git add src/manuals/` Requires `-f`
The `.gitignore` contains `manuals/` which also matches `src/manuals/`, so plain `git add src/manuals/*.ts` silently fails. Since those files are already tracked, use `git add -f src/manuals/<file>` to stage them.

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

> **Rule**: Every new feature MUST include a working example file in `examples/` and updated user documentation. The example should demonstrate the golden path usage clearly.

### Updating Manual Format
1. Modify generator in `src/manuals/generator.ts` or `adf-generator.ts`
2. Run `npm run test:snapshots:update` to update snapshots
3. Review snapshot diffs carefully
4. Commit generator changes and updated snapshots together

---

## 💡 Additional Notes

- **Performance**: Operation parsing should be <100ms for typical files
- **Compatibility**: Node 24 (main), supports 20+, tested on 20/22/24 in CI
- **TypeScript**: Compile target ES2022, module resolution Node16
- **Dependencies**: Keep minimal - currently just Commander, js-yaml, Ajv, atlaskit/adf-utils
- **Breaking changes**: Follow semantic versioning, provide migration guides

---

**Last Updated**: 2025-10-17
**Maintainer**: @sre-team

For questions or clarifications, check:
1. This file (CLAUDE.md)
2. ROADMAP.md (for what's planned vs implemented)
3. README.md (for user documentation)
4. specs/001-i-want-to/ (for design decisions)
