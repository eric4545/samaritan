# SAMARITAN — AI Assistant Context

**Operations-as-Code CLI for SRE teams.** SAMARITAN converts YAML operation
definitions into reviewable runbooks (Markdown & Confluence ADF), validates
them, and drives them interactively. It is a **documentation generator,
validator, and interactive runner — NOT a non-interactive execution engine.**

**See [ROADMAP.md](ROADMAP.md) before implementing any "auto", "run", or
execution feature** — most execution features are roadmap items, not shipped.

---

## 🚨 Non-Negotiable Rules

1. **Tests ship with code** — every feature/fix includes tests in the SAME commit.
2. **Examples + docs for every feature** — a working file in `examples/` AND
   updated `README.md`. Never commit a feature without both.
3. **Lint clean before commit** — `npx @biomejs/biome check --write <changed files>`; fix all errors.
4. **StepContent is the shared base** — never add execution/content fields directly
   to `Step` or `RollbackStep`; add them to `StepContent` so both benefit.
5. **Check ROADMAP.md** before any "auto"/"run"/execution feature.
6. **Keep Agent Skills AND `.claude/rules/` in sync** — when a change alters CLI
   commands/flags, operation YAML fields, the schema, or scope
   (implemented vs roadmap), update the affected
   `.claude/skills/**/SKILL.md` (+ its `reference/*.md`) and any relevant
   `.claude/rules/*.md` in the SAME commit. Never let docs describe behavior the
   code no longer has.
7. **Reproduce before you diagnose — NO GUESSING.** Never claim a root cause or
   call a bug fixed from reading code alone. Write the smallest YAML that triggers
   it, run `validate` + the relevant `generate manual` (multi-env AND `--env <name>`
   single-env — separate code paths) to see the actual broken output. Then fix,
   then re-run the SAME repro to prove it changed. A fix without a before/after
   repro and a regression test (rule 1) is not done.

---

## 🏗️ Architecture

```
src/
├── models/        # TypeScript interfaces (Operation, Step, Evidence, …)
├── operations/    # YAML parsing, environment loading, postmortem parser
├── manuals/       # Manual generators (Markdown, Confluence ADF, postmortem)
├── validation/    # JSON Schema validators
├── cli/commands/  # CLI handlers (validate, generate, run, resume, …)
├── evidence/      # Evidence models (data only)
├── lib/           # Utilities (run loop, git-metadata, session, executor)
└── schemas/       # JSON schemas for validation
tests/             # fixtures/, manuals/ (snapshots), unit + integration
```

Deeper, path-scoped guidance loads automatically from `.claude/rules/` when you
open the matching source (manuals, parser/schema, run loop, tests).

---

## ⚠️ Implementation Status

**Implemented:** YAML parsing (env matrix, templates, `foreach`/matrix,
`uses`/`with`), Markdown + Confluence ADF generation, JSON-Schema validation
(`--lint` shellcheck, `expect` regex-lint), Git metadata, evidence models +
embedding (`evidence.results`), `schema` export, interactive `run` (sidecar /
manual / automatic / hybrid), session persistence + `resume`/`sessions`,
`run --mock`, auto-capture on verify, retryable verification (`expect.retry`),
multi-operator `--pic` focus + `report merge`, rollback (step + operation-level,
full parity), postmortem / incident-report (RCA) documents.
CLI: `validate`, `generate manual|confluence|postmortem`, `postmortem`,
`report`, `schema`, `init`, `create operation`, `run`, `resume`, `sessions`, `qrh`.

**NOT implemented (roadmap):** non-interactive command execution
(`--auto-approve`/`automatic` marks steps complete without running them),
automatic evidence collection, QRH database, external integrations
(Jira/Confluence API/Slack), AI assistant.

---

## 🛠️ Setup

```bash
npm install
npm test                          # all tests
npm test tests/manuals/           # one suite
npm run test:snapshots:update     # update manual snapshots
npm run build
npm start -- validate examples/deployment.yaml
npm start -- generate manual examples/deployment.yaml --output /tmp/manual.md
npx @biomejs/biome check .        # lint
```

`npm run test:e2e` runs the real-tmux sidecar tests (`tests/e2e/*.e2e.ts`).

---

## 📝 Code Style

- **TypeScript strict mode** — no `any` without good reason.
- **Single quotes, no semicolons** (Biome v2.2.4 enforces). Compile target
  ES2022, module resolution Node16.
- **Functional patterns**, explicit types, avoid deep nesting (extract functions).
- Naming: interfaces/types `PascalCase`, functions `camelCase`, constants
  `SCREAMING_SNAKE_CASE`, files `kebab-case.ts`.
- Two justified `biome.json` exceptions: `noExplicitAny` (YAML parsing) and
  `noTemplateCurlyInString` (intentional template-syntax test strings) disabled.
- Use `prepublishOnly` (NOT `prepare`) for the build script — `prepare` runs on
  every install and breaks production installs without dev deps. See
  `package.json`.

---

## 🧪 Testing (essentials)

- YAML fixtures load via `parseFixture` / `loadYaml` / `getFixturePath` from
  `tests/fixtures/fixtures.ts` (type-safe `FIXTURES` names). Generator-only tests
  use the 2 `Operation` objects in `tests/fixtures/operations.ts`.
- **TDD, non-negotiable:** RED → GREEN → REFACTOR → LINT → commit tests with code.
- Debug/temp files go in `/tmp/` only, never the project root, never committed.

Per-area testing traps (readline multi-prompt gotcha, e2e notes) load from
`.claude/rules/testing.md` when you open `tests/**`.

---

## 🔀 Git Workflow

- **ONLY commit changed files** — never `git add .` blindly.
- Commit tests WITH code (same commit). Message format: `feat:`/`fix:`/`docs:`/`test:`.
- Never commit `node_modules/`, `dist/`, `/tmp/` debug files, `.env`/credentials.
- `git add src/manuals/` needs `-f` — `.gitignore`'s `manuals/` also matches
  `src/manuals/` (files are already tracked): `git add -f src/manuals/<file>`.

---

## 📚 Reference

- **README.md** — user docs · **USAGE.md** — quick start · **ROADMAP.md** —
  planned vs implemented (check before "future" features).
- **Skill `samaritan-operations`** (`.claude/skills/`) — how to author/validate/
  generate/run operations; `reference/{cli,operation-yaml,postmortem-yaml}.md`.
- **`.claude/rules/`** — path-scoped code-editing traps (manuals, parser/schema,
  run loop, tests), loaded on demand.
- **Source of truth:** `src/schemas/operation.schema.json`; `examples/*.yaml` are
  validated, copy-ready samples.

---

**Last Updated**: 2026-07-23 · **Maintainer**: @sre-team
