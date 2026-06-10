# 🚀 SAMARITAN Quick Usage Guide

## Getting Started (No Installation Required!)

SAMARITAN can be run directly from GitHub using `npx` - no local installation needed!

### Basic Commands

```bash
# Show help
npx github:eric4545/samaritan --help

# Validate an operation
npx github:eric4545/samaritan validate examples/deployment.yaml

# Generate multi-environment table manual (default)
npx github:eric4545/samaritan generate manual examples/deployment.yaml --output manual.md

# Generate single-environment heading-based manual (for use during execution)
npx github:eric4545/samaritan generate manual examples/deployment.yaml --env staging --output staging-manual.md

# Generate a denser, operator-friendly compact manual (checkbox-list sub-steps)
npx github:eric4545/samaritan generate manual examples/compact-deployment.yaml --env production --compact

# Preview operation plan without executing (dry run) — default sidecar mode
npx github:eric4545/samaritan run examples/sidecar-deployment.yaml --env staging --dry-run

# Execute with sidecar mode (default): samaritan displays commands, you run them
npx github:eric4545/samaritan run examples/sidecar-deployment.yaml --env staging

# Attach to an existing tmux pane for [v] verify in sidecar mode
npx github:eric4545/samaritan run examples/sidecar-deployment.yaml --env staging \
  --attach mysession:0.0

# Execute operation with interactive prompts, auto-generating an evidence report
npx github:eric4545/samaritan run examples/sidecar-deployment.yaml --env staging --report ./evidence

# List saved run sessions and resume one (q/abort saves progress as paused)
npx github:eric4545/samaritan sessions
npx github:eric4545/samaritan resume <session-id>

# Generate evidence report from an existing session log
npx github:eric4545/samaritan report /tmp/samaritan-<id>.jsonl --output evidence.md
```

### Real-World Workflow

```bash
# 1. Create new operation from template
npx github:eric4545/samaritan operation my-deployment --template deployment

# 2. Validate your operation with strict checks
npx github:eric4545/samaritan validate my-deployment.yaml --strict --env production

# 3. Generate single-env manual for staging (resolved variables, heading format)
npx github:eric4545/samaritan generate manual my-deployment.yaml --env staging --resolve-vars --output staging-runbook.md

# 4. Execute in staging (sidecar mode by default — you run each command yourself)
npx github:eric4545/samaritan run my-deployment.yaml --env staging --report ./staging-evidence

# 5. Execute in production (report written to ./production-evidence/)
npx github:eric4545/samaritan run my-deployment.yaml --env production --report ./production-evidence
```


### Development Setup (Optional)

If you want to contribute or modify SAMARITAN:

```bash
# Clone and setup for development
git clone https://github.com/eric4545/samaritan.git
cd samaritan
npm install
npm test

# Run locally
npm start -- validate examples/deployment.yaml
```

### Example Operation File

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
    verify:
      command: kubectl get deployment app -n ${NAMESPACE} -o jsonpath='{.status.readyReplicas}'
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

Then run:

```bash
npx github:eric4545/samaritan validate my-operation.yaml
npx github:eric4545/samaritan run my-operation.yaml --env staging
```

## 🎯 Key Benefits

- **No Installation**: Run directly with `npx`
- **Operations as Code**: YAML-defined, Git-versioned procedures
- **Documentation Generation**: Create manuals and Confluence pages
- **Multi-Environment**: Same operation, different environments
- **Validation**: Catch errors before execution
- **Git Integration**: Track changes and maintain audit trails

## 📖 Full Documentation

See [README.md](README.md) for comprehensive documentation, examples, and advanced features.