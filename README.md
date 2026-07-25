# 🤖 SAMARITAN

**Operations as Code CLI for SRE Teams**

Define an operation once in YAML. SAMARITAN turns it into a reviewable runbook,
validates it before anyone runs anything, and walks an operator through it while
recording what actually happened.

[![npm version](https://badge.fury.io/js/samaritan.svg)](https://badge.fury.io/js/samaritan)
[![CI](https://github.com/eric4545/samaritan/workflows/CI/badge.svg)](https://github.com/eric4545/samaritan/actions)

📖 **[Full documentation →](https://eric4545.github.io/samaritan/)**

## Quick start

**Requires Node.js 22+.** Runs directly from GitHub, no installation:

```bash
# Validate an operation definition
npx github:eric4545/samaritan validate my-operation.yaml

# Generate a reviewable manual
npx github:eric4545/samaritan generate manual my-operation.yaml

# Walk through it, capturing evidence as you go
npx github:eric4545/samaritan run my-operation.yaml --env production
```

## What it looks like

```yaml
name: Simple Deployment
version: 1.0.0

environments:
  - name: staging
    variables: { REPLICAS: 1, NAMESPACE: staging }
  - name: production
    variables: { REPLICAS: 3, NAMESPACE: production }
    approval_required: true

steps:
  - name: Scale Replicas
    type: automatic
    command: kubectl scale deployment/app --replicas=${REPLICAS} -n ${NAMESPACE}
    expect:
      equals: "${REPLICAS}"

  - name: Verify Deployment
    type: manual
    instruction: Check that all pods are running in ${NAMESPACE}
    evidence:
      required: true
      types: [screenshot]
```

## What SAMARITAN is — and is not

It is a **documentation generator, validator, and interactive runner**.

It is **not a non-interactive execution engine.** SAMARITAN never runs your commands
unattended. Even in `automatic` mode, or with `--auto-approve`, steps are marked
complete rather than executed — an operator is always in the loop. Automatic command
execution, automatic evidence collection, and external integrations (Jira, Confluence
API, Slack) are tracked in [ROADMAP.md](ROADMAP.md), not shipped.

## Documentation

Everything lives at **[eric4545.github.io/samaritan](https://eric4545.github.io/samaritan/)**:

| | |
| --- | --- |
| [Getting started](https://eric4545.github.io/samaritan/getting-started) | Install nothing, write your first operation, run it |
| [Core concepts](https://eric4545.github.io/samaritan/concepts) | Operations, steps, evidence — the vocabulary |
| [Writing an operation](https://eric4545.github.io/samaritan/operation-yaml) | The authoring guide |
| [Running an operation](https://eric4545.github.io/samaritan/running) | Sidecar mode, verification, sessions, resume |
| [Rollback](https://eric4545.github.io/samaritan/rollback) | Planned recovery, not improvised |
| [CLI reference](https://eric4545.github.io/samaritan/reference/cli) | Every command and flag — generated from the source |
| [Operation YAML reference](https://eric4545.github.io/samaritan/reference/operation-yaml) | Every field — generated from the JSON Schema |

The two reference pages are **generated from the code**, so they cannot drift from what
the tool actually does. Run the site locally with `npm run docs:dev`.

## Development

```bash
git clone https://github.com/eric4545/samaritan.git
cd samaritan
npm install
npm test
```

See [Contributing](https://eric4545.github.io/samaritan/contributing) for the full
setup, project structure and conventions.

## License

ISC License — see [LICENSE](LICENSE).

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Follow the existing code style and add tests
4. Commit your changes: `git commit -m 'Add amazing feature'`
5. Push the branch: `git push origin feature/amazing-feature`
6. Open a Pull Request

## Support

- **GitHub Issues**: [Report bugs or request features](https://github.com/eric4545/samaritan/issues)
- **Documentation**: [eric4545.github.io/samaritan](https://eric4545.github.io/samaritan/)
- **Examples**: [Operation examples](examples/)
