# 🚀 SAMARITAN Quick Usage Guide

## Getting Started (No Installation Required!)

SAMARITAN can be run directly from GitHub using `npx` - no local installation needed!

### Basic Commands

```bash
# Show help
npx github:eric4545/samaritan --help

# Validate an operation
npx github:eric4545/samaritan validate examples/deployment.yaml

# Generate operation manual
npx github:eric4545/samaritan generate:manual examples/deployment.yaml manual.md

# Execute operation (dry run)
npx github:eric4545/samaritan run examples/deployment.yaml --env preprod --dry-run
```

### Real-World Workflow

```bash
# 1. Create new operation from template
npx github:eric4545/samaritan operation my-deployment --template deployment

# 2. Validate your operation with strict checks
npx github:eric4545/samaritan validate my-deployment.yaml --strict --env production

# 3. Generate manual for review
npx github:eric4545/samaritan generate:manual my-deployment.yaml deployment-manual.md

# 4. Execute in staging first
npx github:eric4545/samaritan run my-deployment.yaml --env staging

# 5. Execute in production
npx github:eric4545/samaritan run my-deployment.yaml --env production
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

  - name: Verify Deployment
    type: manual
    instruction: |
      Check that all pods are running:
      kubectl get pods -n ${NAMESPACE}
    evidence_required: true
    evidence_types: [screenshot]
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