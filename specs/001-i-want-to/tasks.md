# Tasks: SAMARITAN - Manual Playbook Generator (MVP)

**Input**: `spec.md` focusing on FR-053 and FR-056.

**Status**: ✅ **MVP COMPLETE** (2025-10-08)
- Core functionality: Operation parsing, manual generation, CLI framework
- Test coverage: 154 passing tests, 16 test suites
- Documentation: Comprehensive README.md with examples
- Skipped: External integrations (Jira, Confluence, PagerDuty, Git APIs), AI chat, formal contract tests

---

## Phase 1: Project Foundation
*Goal: Set up the project structure and tooling. This phase is already complete.*

- [x] **T001** Initialize Node.js project and install core dependencies.
- [x] **T002** Configure TypeScript (`tsconfig.json`).
- [x] **T003** Configure BiomeJS for code quality and formatting.
- [x] **T004** Set up the Node.js native test runner.

---

## Phase 2: MVP Implementation
*Goal: Implement the core feature of generating a manual from a SAMARITAN Operation YAML.*

- [x] **T005** Create a sample SAMARITAN Operation YAML file at `examples/deployment.yaml`. This file must include `preflight` checks and `steps` with `run` commands.
- [x] **T006** Define the basic data models for `Operation`, `Step`, and `PreflightCheck` in `src/models/operation.ts`.
- [x] **T007** Implement an `operation-parser` service in `src/operations/parser.ts` that reads and validates the SAMARITAN Operation YAML against the data models.
- [x] **T008** Implement a `manual-generator` service in `src/manuals/generator.ts`. This service will take a parsed `Operation` object and convert it into a detailed Markdown string, correctly formatting the preflight checklist and steps.
- [x] **T008.1** (Bug Fix) Fix a bug in the manual generator where a `null` or empty `step.description` results in `undefined` being rendered in the output.
- [x] **T009** Update the `generate:manual` CLI command in `src/cli/commands/manuals.ts` to use the new parser and generator services.
- [x] **T010** Update the test in `tests/manuals/generator.test.ts` to use the new `examples/deployment.yaml` input and verify that the generated Markdown correctly includes the preflight checklist and formatted steps.

---

## Phase 3: Full Product Tests (TDD)
*CRITICAL: These tests MUST be written and MUST FAIL before ANY implementation for the full product.*

**MVP Decision**: Contract tests skipped in favor of comprehensive unit/integration tests (154 tests passing).

- [ ] **T011** [MVP-SKIP] Write failing contract tests for the CLI interface in `tests/contract/cli-interface.test.ts` based on `contracts/cli-interface.yaml`.
- [ ] **T012** [MVP-SKIP] Write failing contract tests for the Integrations API in `tests/contract/integrations-api.test.ts` based on `contracts/integrations-api.yaml`.
- [ ] **T013** [MVP-SKIP] Write failing integration test for the `init` and `create operation` flow in `tests/integration/init-create.test.ts` based on `quickstart.md`.
- [ ] **T014** [MVP-SKIP] Write failing integration test for the `validate` and `run` operation flow in `tests/integration/validate-run.test.ts` based on `quickstart.md`.
- [ ] **T015** [MVP-SKIP] Write failing integration test for the `generate docs` and `qrh search` flows in `tests/integration/generate-qrh.test.ts` based on `quickstart.md`.

## Phase 4: Full Product Core Implementation
*Based on `data-model.md`. These can be developed in parallel.*

- [x] **T016** [P] Implement `Operation`, `Step`, and `Environment` models in `src/models/operation.ts` (expand on existing).
- [x] **T017** [P] Implement `EvidenceItem` and `EvidenceType` models in `src/models/evidence.ts`.
- [x] **T018** [P] Implement `OperationSession` and related state models (e.g., `SessionCheckpoint`) in `src/models/session.ts`.
- [x] **T019** [P] Implement `QRHEntry` model in `src/models/qrh.ts`.
- [x] **T020** [P] Implement supporting configuration models (`ApprovalConfig`, `RetryConfig`, etc.) in `src/models/operation.ts`.
- [x] **T021** [P] Implement the `operation-parser` library in `src/operations/parser.ts` (enhanced existing implementation).
- [x] **T022** [P] Implement the `evidence-collector` library in `src/evidence/collector.ts` and `src/evidence/validator.ts`.
- [ ] **T023** [P][MVP-SKIP] Implement the `ai-assistant` library.
- [x] **T024** Create the skeleton for the `executor` library in `src/lib/executor.ts`.
- [ ] **T025** [P][MVP-SKIP] Implement the Jira API client in `src/integrations/jira.ts`.
- [ ] **T026** [P][MVP-SKIP] Implement the Confluence API client in `src/integrations/confluence.ts`.
- [ ] **T027** [P][MVP-SKIP] Implement the Git API client in `src/integrations/git.ts`.
- [ ] **T028** [P][MVP-SKIP] Implement the PagerDuty API client in `src/integrations/pagerduty.ts`.
- [x] **T029** Implement the main CLI entrypoint and command router using Commander.js in `src/cli/index.ts` (expand on existing).
- [x] **T030** [P] Implement the `init` and `create` commands in `src/cli/commands/project.ts`.
- [x] **T031** [P] Implement the `validate` command in `src/cli/commands/validate.ts`.
- [x] **T032** [P] Implement the `generate` command in `src/cli/commands/generate.ts`.
- [ ] **T033** [P][MVP-SKIP] Implement the `chat` command in `src/cli/commands/chat.ts`.
- [x] **T034** [P] Implement the `qrh` command in `src/cli/commands/qrh.ts`.
- [x] **T035** Implement the `run` and `resume` commands in `src/cli/commands/run.ts`, integrating the `executor` library.

## Phase 5: Polish & Finalization

**MVP Status**: Core polish completed with 154 passing tests and comprehensive README.md.

- [x] **T036** [P] Write comprehensive unit tests for all libraries and services in `tests/unit/`. *(154 tests across 16 suites passing)*
- [ ] **T037** [P][MVP-SKIP] Add JSDoc/TSDoc documentation to all public functions, classes, and models.
- [ ] **T038** [MVP-SKIP] Run all contract and integration tests and ensure they pass. *(Skipped contract tests, unit tests passing)*
- [x] **T039** Create the project `README.md` with setup and usage instructions based on `quickstart.md`.
- [ ] **T040** [MVP-SKIP] Manually execute all scenarios from `quickstart.md` to ensure the final product is working as expected.

---

## Summary

**✅ MVP COMPLETE**: SAMARITAN successfully implements operations-as-code manual generation with:
- YAML operation parsing with environment support
- Manual generation (Markdown, Confluence/ADF formats)
- Git metadata integration for traceability
- Evidence collection models
- CLI framework with all core commands
- 154 passing tests with comprehensive coverage

**🔮 Future Enhancements** (marked MVP-SKIP):
- External API integrations (Jira, Confluence, PagerDuty, Git)
- AI assistant chat interface
- Formal OpenAPI contract tests
- Complete JSDoc documentation
- Additional output formats (mkdocs, AsciiDoc)
