# SAMARITAN - AI Assistant Context

**Project**: Operations as Code CLI for SRE Teams
**Version**: 1.0.0 (MVP - Documentation Generator)
**Status**: ✅ Shipped (2025-10-08) | 154/154 tests passing

---

## 🎯 What This Project Does

SAMARITAN converts YAML operation definitions into comprehensive manuals (Markdown & Confluence). It's a **documentation generator and validator**, NOT an execution engine (yet).

**Current capabilities (v1.0)**:
- Parse YAML operations with multi-environment support
- Generate Markdown and Confluence (ADF) manuals
- Validate operations with JSON Schema
- Include Git metadata for audit trails
- Track evidence requirements (as documentation)

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
- CLI commands: `validate`, `generate manual`, `generate confluence`, `init`, `create operation`

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
- **Single quotes**, no semicolons (Biome enforces this)
- **Functional patterns** where possible (pure functions, immutability)
- **Explicit over implicit** - clear types, no magic
- **Avoid deep nesting** - extract functions instead

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

---

## 🧪 Testing Instructions

### Test Organization
- **Fixtures**: Create operation YAML as TypeScript objects in `tests/fixtures/operations.ts`
  - NOT as separate `.yaml` files (easier to maintain and type-safe)
  - Export as `const operationFixtures = { ... }`
- **Snapshot tests**: `tests/manuals/*.test.ts` for manual generation
- **Unit tests**: Test pure functions in isolation
- **Integration tests**: Test full workflows (parse → validate → generate)

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
- **test**: Node 18/20/22 compatibility
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
- **Location**: `tests/fixtures/operations.ts` (TypeScript, not YAML!)
- **Format**: Export TypeScript objects with operation definitions
- **Why TypeScript**: Type safety, easier to maintain, can share fragments

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
# ✅ Current format (v1.0 - documentation only)
evidence:
  required: true
  types: [screenshot, log]  # Types are for docs, not collected automatically

# ⚠️ Deprecated (still supported for backward compatibility)
evidence_required: true
evidence_types: [screenshot, log]
```

### Step Types
```yaml
# In v1.0, ALL steps are effectively "manual" (just documentation)
# type: automatic doesn't execute commands - parsed but not run
steps:
  - name: Deploy App
    type: manual  # ✅ Accurate in v1.0
    instruction: |
      Run deployment:
      ```bash
      kubectl apply -f deployment.yaml
      ```
```

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

### 2. Evidence Types Are Documentation-Only
```typescript
// evidence.types is parsed and included in generated manuals
// BUT: No actual screenshot capture, log reading, or file collection in v1.0
// Phase 2.2 (ROADMAP) will implement automatic collection
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

### Adding a New Step Feature
1. Update `src/models/operation.ts` interfaces
2. Update JSON schema in `src/schemas/`
3. Update parser in `src/operations/parser.ts`
4. Update manual generator in `src/manuals/generator.ts`
5. Add test fixture in `tests/fixtures/operations.ts`
6. Add snapshot test in `tests/manuals/`
7. Update README.md examples

### Updating Manual Format
1. Modify generator in `src/manuals/generator.ts` or `adf-generator.ts`
2. Run `npm run test:snapshots:update` to update snapshots
3. Review snapshot diffs carefully
4. Commit generator changes and updated snapshots together

---

## 💡 Additional Notes

- **Performance**: Operation parsing should be <100ms for typical files
- **Compatibility**: Node 18+, tested on 18/20/22 in CI
- **TypeScript**: Compile target ES2022, module resolution Node16
- **Dependencies**: Keep minimal - currently just Commander, js-yaml, Ajv, atlaskit/adf-utils
- **Breaking changes**: Follow semantic versioning, provide migration guides

---

**Last Updated**: 2025-10-09
**Maintainer**: @eric4545

For questions or clarifications, check:
1. This file (CLAUDE.md)
2. ROADMAP.md (for what's planned vs implemented)
3. README.md (for user documentation)
4. specs/001-i-want-to/ (for design decisions)
