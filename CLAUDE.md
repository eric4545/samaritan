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

### 🚧 NOT Implemented (Roadmap)
These features are **documented but not functional**:
- ❌ **Command execution** (`type: automatic` steps don't run commands)
- ❌ **Automatic evidence collection** (no screenshot capture, log reading, etc.)
- ❌ **Interactive execution** (`run` command has minimal implementation)
- ❌ **Session persistence** (models exist, no storage)
- ❌ **QRH** (command scaffolding exists, no functionality)
- ❌ **External integrations** (Jira, Confluence API, Slack)
- ❌ **AI assistant** (planned for v4.0)

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
4. **Commit**: Always commit tests with implementation

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
  - Evidence results appear in the corresponding environment column in generated manuals
  - Each environment shows only its own evidence
- **Test Fixtures**: See `tests/fixtures/operations/features/evidence-with-results.yaml` and `reviewer-and-env-evidence.yaml`

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

### Template Import (uses)

**✅ Implemented in v1.0+**

SAMARITAN supports reusable step templates via the `uses:` directive, enabling DRY (Don't Repeat Yourself) principles for common operation patterns.

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
  - uses: ./templates/health-checks.yaml
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
- Required: `uses` (path to template)
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
- `samaritan run` - Minimal executor, no real execution
- `samaritan resume` - Models exist, no session storage
- `samaritan qrh` - Command exists, no QRH database

### 4. Don't Assume Features Exist
- Check implementation before assuming functionality
- If docs mention a feature, verify in code
- When in doubt, check `ROADMAP.md`

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
8. Update README.md examples

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
**Maintainer**: @eric4545

For questions or clarifications, check:
1. This file (CLAUDE.md)
2. ROADMAP.md (for what's planned vs implemented)
3. README.md (for user documentation)
4. specs/001-i-want-to/ (for design decisions)
