# Tasks: SAMARITAN - Operation Manual Automation Tool

**Input**: Design documents from `/Users/ericng/Developments/github/eric4545/samaritan/specs/001-i-want-to/`

---

## Phase 1: Proof of Concept (MVP)
*Goal: A simple CLI tool to convert a GitHub Actions YAML file into a Markdown manual.*

- [ ] **T001** Create a sample GitHub Actions YAML file in `specs/001-i-want-to/poc/example-deployment.yaml` that defines a simple deployment process.
- [ ] **T002** [P] Create a basic Node.js script in `src/poc/generate-manual.ts` that reads the YAML file. Use the `js-yaml` library.
- [ ] **T003** [P] Implement the logic in `src/poc/generate-manual.ts` to parse the YAML and convert it into a structured Markdown string.
- [ ] **T004** Implement a new CLI command `samaritan poc:generate-manual` in `src/cli/commands/poc.ts` that calls the generation script.
- [ ] **T005** Write a simple test in `tests/poc/generation.test.ts` that runs the command and verifies the output Markdown is created and contains expected content.

---

## Phase 2: Full Product Foundation
*These tasks establish the project structure and dependencies for the complete SAMARITAN tool.*

- [ ] **T006** Initialize Node.js project and install dependencies from `research.md` into `package.json`.
- [ ] **T007** Configure TypeScript (`tsconfig.json`) for a modern Node.js project (ESM, strict mode).
- [ ] **T008** [P] Configure BiomeJS for code quality and consistent formatting.
- [ ] **T009** [P] Set up the Node.js native test runner in `tests/`.

## Phase 3: Full Product Tests (TDD)
*CRITICAL: These tests MUST be written and MUST FAIL before ANY implementation for the full product.*

- [ ] **T010** [P] Write failing contract tests for the CLI interface in `tests/contract/cli-interface.test.ts` based on `contracts/cli-interface.yaml`.
- [ ] **T011** [P] Write failing contract tests for the Integrations API in `tests/contract/integrations-api.test.ts` based on `contracts/integrations-api.yaml`.
- [ ] **T012** [P] Write failing integration test for the `init` and `create operation` flow in `tests/integration/init-create.test.ts` based on `quickstart.md`.
- [ ] **T013** [P] Write failing integration test for the `validate` and `run` operation flow in `tests/integration/validate-run.test.ts` based on `quickstart.md`.
- [ ] **T014** [P] Write failing integration test for the `generate docs` and `qrh search` flows in `tests/integration/generate-qrh.test.ts` based on `quickstart.md`.

## Phase 4: Full Product Core Implementation
*Based on `data-model.md`. These can be developed in parallel.*

- [ ] **T015** [P] Implement `Operation`, `Step`, and `Environment` models in `src/models/operation.ts`.
- [ ] **T016** [P] Implement `EvidenceItem` and `EvidenceType` models in `src/models/evidence.ts`.
- [ ] **T017** [P] Implement `OperationSession` and related state models (e.g., `SessionCheckpoint`) in `src/models/session.ts`.
- [ ] **T018** [P] Implement `QRHEntry` model in `src/models/qrh.ts`.
- [ ] **T019** [P] Implement supporting configuration models (`ApprovalConfig`, `RetryConfig`, etc.) in `src/models/configs.ts`.
- [ ] **T020** [P] Implement the `operation-parser` library in `src/lib/operation-parser.ts`.
- [ ] **T021** [P] Implement the `evidence-collector` library in `src/lib/evidence-collector.ts`.
- [ ] **T022** [P] Implement the `ai-assistant` library in `src/lib/ai-assistant.ts`.
- [ ] **T023** Create the skeleton for the `executor` library in `src/lib/executor.ts`.
- [ ] **T024** [P] Implement the Jira API client in `src/integrations/jira.ts`.
- [ ] **T025** [P] Implement the Confluence API client in `src/integrations/confluence.ts`.
- [ ] **T026** [P] Implement the Git API client in `src/integrations/git.ts`.
- [ ] **T027** [P] Implement the PagerDuty API client in `src/integrations/pagerduty.ts`.
- [ ] **T028** Implement the main CLI entrypoint and command router using Commander.js in `src/cli/index.ts`.
- [ ] **T029** [P] Implement the `init` and `create` commands in `src/cli/commands/project.ts`.
- [ ] **T030** [P] Implement the `validate` command in `src/cli/commands/validate.ts`.
- [ ] **T031** [P] Implement the `generate` command in `src/cli/commands/generate.ts`.
- [ ] **T032** [P] Implement the `chat` command in `src/cli/commands/chat.ts`.
- [ ] **T033** [P] Implement the `qrh` command in `src/cli/commands/qrh.ts`.
- [ ] **T034** Implement the `run` and `resume` commands in `src/cli/commands/run.ts`, integrating the `executor` library.

## Phase 5: Polish & Finalization

- [ ] **T035** [P] Write comprehensive unit tests for all libraries and services in `tests/unit/`.
- [ ] **T036** [P] Add JSDoc/TSDoc documentation to all public functions, classes, and models.
- [ ] **T037** Run all contract and integration tests and ensure they pass.
- [ ] **T038** Create the project `README.md` with setup and usage instructions based on `quickstart.md`.
- [ ] **T039** Manually execute all scenarios from `quickstart.md` to ensure the final product is working as expected.