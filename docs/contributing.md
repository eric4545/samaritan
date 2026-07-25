# Contributing

Setting up a development environment and the conventions this project holds to.

## Setup for Contributing

```bash
# Clone repository
git clone https://github.com/eric4545/samaritan.git
cd samaritan

# Install dependencies
npm install

# Run tests
npm test

# Run CLI locally
npm start -- validate examples/deployment.yaml

# Build for distribution
npm run build
```

## Project Structure

```
samaritan/
├── src/
│   ├── cli/           # CLI commands and interface
│   ├── operations/    # Operation parsing and execution
│   ├── evidence/      # Evidence collection and validation
│   ├── sessions/      # Session management
│   ├── models/        # Type definitions
│   ├── schemas/       # JSON Schema validation
│   └── validation/    # Schema validators
├── templates/         # Operation templates
│   └── operations/    # Template operations with placeholders
├── examples/          # Example operations
│   └── environments/  # Reusable environment manifests (k8s-cluster, database)
├── tests/            # Test suite
└── bin/              # Executable wrapper
```

## Adding New Features

1. **Follow KISS/YAGNI/DRY principles**
2. **Add JSON Schema validation** for new fields
3. **Write comprehensive tests**
4. **Update documentation** and examples
5. **Maintain backward compatibility**

## Testing Operations

```bash
# Test operation validation
npm test -- tests/operations/

# Test CLI commands
npm test -- tests/cli/

# Test evidence collection
npm test -- tests/evidence/
```

## End-to-End Tests (real tmux)

The sidecar `run` workflows are covered by end-to-end tests that drive a **real
tmux** session (a genuine TTY, so the raw-mode key handling is exercised — not
the readline fallback that piped stdin gets). They launch samaritan inside a
tmux pane, send keystrokes with `tmux send-keys`, and assert on the rendered TUI
plus the persisted run record.

```bash
# Requires a real `tmux` binary on PATH
npm run test:e2e
```

- Without tmux, the suite **skips** gracefully (so `npm test` stays green on any
  machine — e2e tests live in `tests/e2e/*.e2e.ts` and are excluded from the
  default `npm test` glob).
- In CI they run in a dedicated `e2e` job that installs tmux and sets
  `SAMARITAN_E2E_REQUIRE_TMUX=1`, which makes a missing tmux **fail** the job
  rather than skip — so a broken sidecar path can't slip through unnoticed.
