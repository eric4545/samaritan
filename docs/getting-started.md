# Getting started

Install nothing, validate an operation, generate a runbook, then run it.

## No installation required

SAMARITAN runs straight from GitHub with `npx`, so you can try it without adding a
dependency to anything:

```bash
npx github:eric4545/samaritan --help
```

If you would rather install it:

```bash
npm install -g github:eric4545/samaritan
samaritan --help
```

The rest of these docs write commands as `samaritan …` for brevity. Prefix them with
`npx github:eric4545/samaritan` if you have not installed it.

## Your first operation

Create `my-operation.yaml`:

```yaml
name: Simple Deployment
version: 1.0.0
description: Deploy application to Kubernetes

environments:
  - name: staging
    variables:
      REPLICAS: 1
      NAMESPACE: staging
  - name: production
    variables:
      REPLICAS: 3
      NAMESPACE: production
    approval_required: true

steps:
  - name: Deploy App
    type: automatic
    command: kubectl apply -f deployment.yaml -n ${NAMESPACE}

  - name: Scale Replicas
    type: automatic
    command: kubectl scale deployment/app --replicas=${REPLICAS} -n ${NAMESPACE}
    expect:
      equals: "${REPLICAS}"

  - name: Verify Deployment
    type: manual
    instruction: |
      Check that all pods are running:
      kubectl get pods -n ${NAMESPACE}
    evidence:
      required: true
      types: [screenshot]
```

::: warning `expect:`, not `verify:`
Assertions go in `expect:`. A step is verified by matching `expect` against its own
`command:` output — there is no separate verification command. The older
`verify: { command: …, expect: … }` form still parses, but **only `verify.expect` is
read**; `verify.command` is silently discarded and never runs. `samaritan validate`
warns when it finds one.
:::

Then validate and run it:

```bash
samaritan validate my-operation.yaml
samaritan run my-operation.yaml --env staging
```

## The core loop

```bash
# Validate, with strict checks against a specific environment
samaritan validate my-operation.yaml --strict --env production

# Generate a single-environment manual with variables resolved
samaritan generate manual my-operation.yaml --env staging --resolve-vars --output staging-runbook.md

# Run it. A run record is ALWAYS written beside the operation at
# <op-dir>/.samaritan-runs/<id>/ (events.jsonl + report.md).
# --report writes an extra copy of the report wherever you want it.
samaritan run my-operation.yaml --env staging --report ./staging-evidence

# If something went wrong, seed a postmortem from that run
samaritan postmortem from-run <session-id> --output incident.yaml
samaritan generate postmortem incident.yaml --output incident.md
```

## Common commands

```bash
# Preview the whole plan without running anything
samaritan run examples/sidecar-deployment.yaml --env staging --dry-run

# Replay each step's expect against its captured evidence.results (no tmux).
# Exits non-zero on any failure — useful in CI to catch drifted verify rules.
samaritan run examples/mock-run-expect.yaml --env staging --mock

# One manual per environment at once
samaritan generate manual examples/deployment.yaml --all-envs

# List saved sessions and resume one
samaritan sessions
samaritan resume <session-id>

# Regenerate a report from a run's black box
samaritan report examples/.samaritan-runs/<id>/events.jsonl --output evidence.md
```

See the [CLI reference](/reference/cli) for every command and flag — it is generated
from the source, so it is always current.

## Workflows

### Template-based operation creation

```bash
# 1. Create an operation from a template, with placeholders
samaritan operation --template deployment

# 2. Edit the generated file and replace the __PLACEHOLDER__ values
# 3. Validate the customised operation
samaritan validate operations/deployment_*.yaml --strict

# 4. Execute in staging first
samaritan run operations/deployment_*.yaml --env staging
```

### Standard deployment

```bash
# 1. Validate
samaritan validate deployment.yaml --env production --strict

# 2. Generate the staging manual, with variables resolved
samaritan generate manual deployment.yaml --env staging --resolve-vars

# 3. Rehearse the procedure in staging, following the generated manual

# 4. Generate the production manual
samaritan generate manual deployment.yaml --env production --resolve-vars

# 5. Execute in production, collecting evidence as you go
```

### Emergency response

```bash
# 1. Validate the emergency operation
samaritan validate emergency/restart-service.yaml --env production

# 2. Generate the manual with variables resolved
samaritan generate manual emergency/restart-service.yaml --env production --resolve-vars

# 3. Follow the manual, documenting every action and its evidence
```

### Multi-operator runs

Each operator focuses only on their own steps; steps assigned to someone else are
auto-skipped, and steps with no PIC are shared. Afterwards the partial runs merge:

```bash
samaritan run examples/multi-operator.yaml --env staging --pic alice@example.com
samaritan run examples/multi-operator.yaml --env staging --pic bob@example.com
samaritan report merge <alice-session-id> <bob-session-id> --output merged.md
```

## Developing SAMARITAN itself

```bash
git clone https://github.com/eric4545/samaritan.git
cd samaritan
npm install
npm test

npm start -- validate examples/deployment.yaml
```

See [Contributing](/contributing) for the full development setup.
