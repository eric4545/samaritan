# 🤖 SAMARITAN

**Operations as Code CLI for SRE Teams**

Define operations once, execute anywhere with complete audit trails, evidence collection, and integrated approval workflows.

[![npm version](https://badge.fury.io/js/samaritan.svg)](https://badge.fury.io/js/samaritan)
[![CI](https://github.com/eric4545/samaritan/workflows/CI/badge.svg)](https://github.com/eric4545/samaritan/actions)

## 🚀 Quick Start

**No installation required!** Run SAMARITAN directly from GitHub:

```bash
# Validate an operation definition
npx github:eric4545/samaritan validate my-operation.yaml

# Execute an operation
npx github:eric4545/samaritan run my-operation.yaml --env production

# Generate operation manual
npx github:eric4545/samaritan generate manual my-operation.yaml
```

## 📋 Table of Contents

- [Core Concepts](#-core-concepts)
- [CLI Commands](#-cli-commands)
- [Operation Definition](#-operation-definition)
- [Execution Workflows](#-execution-workflows)
- [Examples](#-examples)
- [Development](#-development)

## 🎯 Core Concepts

### Operations as Code
- **YAML-defined procedures** stored in Git with version control
- **Environment-specific variables** for preprod/production deployment
- **Automatic and manual steps** with evidence collection
- **Approval gates** integrated with Jira and team workflows

### Execution Modes
- **Automatic**: Run commands and collect evidence automatically
- **Manual**: Present instructions for operator execution
- **Hybrid**: Mix of automatic and manual steps with mode switching
- **Dry Run**: Validate without executing any commands

### Evidence & Audit
- **Complete audit trails** with timestamps and execution logs
- **Evidence collection** (screenshots, logs, command outputs)
- **Session management** with pause/resume capabilities
- **Release reports** with comprehensive execution summaries

## 🛠 CLI Commands

### Core Operations

```bash
# Validate operation definition
npx github:eric4545/samaritan validate <operation.yaml> [options]
  --strict              Enable strict validation with best practices
  --env <environment>   Validate for specific environment
  -v, --verbose         Verbose output

# Execute operation
npx github:eric4545/samaritan run <operation.yaml> [options]
  --env <environment>   Target environment (required)
  --mode <auto|manual>  Execution mode (default: auto)
  --dry-run            Validate without executing
  --session-id <id>    Resume existing session

# Resume interrupted execution
npx github:eric4545/samaritan resume <session-id>

# Generate documentation
npx github:eric4545/samaritan generate manual <operation.yaml> [options]
  --output <file>       Output file (default: stdout)
  --format <md|html>    Output format (default: md)
```

### Project Management

```bash
# Initialize new SAMARITAN project
npx github:eric4545/samaritan init [directory]

# Create operation from template
npx github:eric4545/samaritan operation [options]
  --template <type>     Operation template (deployment, backup, incident-response, maintenance)
  --env <environments>  Target environments (comma-separated)
```

### Emergency Procedures

```bash
# Quick Reference Handbook for emergencies
npx github:eric4545/samaritan qrh [options]
  --search <term>       Search for specific procedure
  --service <name>      Filter by service name
  --alert <code>        Find procedure for alert code
```

## 📝 Operation Definition

### Basic Structure

```yaml
name: Deploy Web Application
version: 1.0.0
description: Deploys web application with database migrations
author: sre-team@company.com
category: deployment
emergency: false

# Environment configurations
environments:
  - name: staging
    description: Staging environment
    variables:
      REPLICAS: 2
      DB_HOST: staging-db.company.com
    approval_required: false

  - name: production
    description: Production environment
    variables:
      REPLICAS: 5
      DB_HOST: prod-db.company.com
    approval_required: true
    validation_required: true

# Pre-execution checks
preflight:
  - name: Check Git Status
    type: command
    command: git status --porcelain
    description: Ensure no uncommitted changes

  - name: Verify Database Connection
    type: command
    command: pg_isready -h ${DB_HOST}
    timeout: 30

# Operation steps
steps:
  - name: Database Migration
    type: automatic
    command: npm run migrate
    timeout: 300
    evidence_required: true
    evidence_types: [log, command_output]

  - name: Deploy Application
    type: automatic
    command: kubectl apply -f k8s/
    verify:
      command: kubectl get pods -l app=webapp | grep Running

  - name: Manual Health Check
    type: manual
    instruction: |
      1. Open application dashboard: https://dashboard.company.com
      2. Verify all services show green status
      3. Test critical user flows
    evidence_required: true
    evidence_types: [screenshot]

  - name: Production Approval
    type: approval
    description: Require manager approval for production
    approval:
      required: true
      approvers: [manager@company.com]
      timeout: "24h"
```

### Advanced Features

#### DRY Environment Manifests (Recommended)

Eliminate environment duplication across operations by using reusable environment manifests:

```yaml
# environments/k8s-cluster.yaml - Reusable environment definitions
apiVersion: samaritan/v1
kind: EnvironmentManifest
metadata:
  name: k8s-cluster
  description: Standard Kubernetes cluster environments
  version: 1.0.0

environments:
  - name: staging
    description: Staging environment for testing
    variables:
      NAMESPACE: staging
      REPLICAS: 2
      DB_HOST: staging-db.company.com
      DOMAIN: staging.company.com
    approval_required: false

  - name: production
    description: Production environment
    variables:
      NAMESPACE: prod
      REPLICAS: 5
      DB_HOST: prod-db.company.com
      DOMAIN: company.com
    approval_required: true
```

```yaml
# operation.yaml - Inherit from environment manifests with overrides
name: Deploy Web Application
version: 1.0.0
description: Deploy using reusable environments

# Inherit from environment manifests with operation-specific overrides
environments:
  - name: staging
    from: k8s-cluster  # Inherit base configuration
    variables:         # Override/add variables
      IMAGE_TAG: latest
      DEBUG_ENABLED: true

  - name: production
    from: k8s-cluster  # Inherit base configuration
    variables:         # Override/add variables
      IMAGE_TAG: v${VERSION}
      DEBUG_ENABLED: false

steps:
  - name: Deploy Application
    type: automatic
    command: kubectl apply -f k8s/ --namespace ${NAMESPACE}
    timeout: 300
```

#### Reusable Step Libraries

```yaml
# operation.yaml
name: Complex Deployment
version: 2.0.0
imports:
  - ./lib/database-steps.yaml
  - ./lib/monitoring-steps.yaml

steps:
  - use: backup-database    # From imported library
    timeout: 600           # Override timeout

  - name: Custom Step
    type: automatic
    command: echo "Custom logic"

  - use: setup-monitoring   # From imported library
```

#### Conditional Execution

```yaml
steps:
  - name: Conditional Migration
    type: conditional
    if: ${{ env.MIGRATE_DB == 'true' }}
    command: npm run migrate

  - name: Rollback on Failure
    type: automatic
    command: kubectl rollout undo deployment/webapp
    rollback:
      command: kubectl rollout status deployment/webapp
```

#### Sub-steps and Complex Workflows

```yaml
steps:
  - name: Complex Deployment
    type: automatic
    command: deploy.sh
    sub_steps:
      - name: Wait for Pods
        type: automatic
        command: kubectl wait --for=condition=ready pod -l app=webapp
        timeout: 120

      - name: Verify Deployment
        type: manual
        instruction: Check application responds correctly
        evidence_required: true
```

## 🔄 Execution Workflows

### 1. Template-Based Operation Creation

```bash
# 1. Create operation from template with placeholders
npx github:eric4545/samaritan operation --template deployment

# 2. Edit the generated file and replace __PLACEHOLDER__ values
# 3. Validate the customized operation
npx github:eric4545/samaritan validate operations/deployment_*.yaml --strict

# 4. Execute in staging first
npx github:eric4545/samaritan run operations/deployment_*.yaml --env staging
```

### 2. Standard Deployment Workflow

```bash
# 1. Validate operation
npx github:eric4545/samaritan validate deployment.yaml --env production --strict

# 2. Execute in staging first
npx github:eric4545/samaritan run deployment.yaml --env staging

# 3. Generate deployment manual for production
npx github:eric4545/samaritan generate manual deployment.yaml --env production

# 4. Execute in production with evidence collection
npx github:eric4545/samaritan run deployment.yaml --env production
```

### 3. Emergency Response Workflow

```bash
# 1. Find relevant emergency procedure
npx github:eric4545/samaritan qrh --alert P0 --service webapp

# 2. Execute emergency operation
npx github:eric4545/samaritan run emergency/restart-service.yaml --env production --mode manual

# 3. Generate incident report
npx github:eric4545/samaritan generate report --session <session-id>
```

### 4. Session Management

```bash
# Start operation
npx github:eric4545/samaritan run long-operation.yaml --env production
# ... operation paused/interrupted ...

# Resume from last checkpoint
npx github:eric4545/samaritan resume <session-id>

# Check session status
npx github:eric4545/samaritan sessions list
npx github:eric4545/samaritan sessions show <session-id>
```

## 📚 Examples

### Simple Database Backup

```yaml
name: Database Backup
version: 1.0.0
description: Create and verify database backup

environments:
  - name: production
    variables:
      DB_NAME: webapp_prod
      BACKUP_BUCKET: s3://backups-prod

steps:
  - name: Create Backup
    type: automatic
    command: pg_dump ${DB_NAME} | gzip > backup_$(date +%Y%m%d).sql.gz
    timeout: 1800
    evidence_required: true

  - name: Upload to S3
    type: automatic
    command: aws s3 cp backup_*.sql.gz ${BACKUP_BUCKET}/

  - name: Verify Backup
    type: manual
    instruction: |
      1. Check backup file exists in S3: ${BACKUP_BUCKET}
      2. Verify file size is reasonable (>100MB)
      3. Download and test restore on test database
    evidence_required: true
    evidence_types: [screenshot, log]
```

### Incident Response

```yaml
name: Service Restart Emergency
version: 1.0.0
description: Emergency service restart procedure
emergency: true
category: incident

environments:
  - name: production
    variables:
      SERVICE_NAME: webapp
      NAMESPACE: production

preflight:
  - name: Check Service Status
    type: command
    command: kubectl get pods -n ${NAMESPACE} -l app=${SERVICE_NAME}

steps:
  - name: Scale Down Service
    type: automatic
    command: kubectl scale deployment ${SERVICE_NAME} --replicas=0 -n ${NAMESPACE}
    evidence_required: true

  - name: Clear Cache
    type: manual
    instruction: |
      Clear Redis cache:
      1. Connect to Redis: redis-cli -h cache.company.com
      2. Run: FLUSHALL
      3. Confirm with: INFO keyspace
    evidence_required: true

  - name: Scale Up Service
    type: automatic
    command: kubectl scale deployment ${SERVICE_NAME} --replicas=3 -n ${NAMESPACE}
    verify:
      command: kubectl get pods -n ${NAMESPACE} -l app=${SERVICE_NAME} | grep Running | wc -l | grep 3
```

## 🧪 Development

### Setup for Contributing

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

### Project Structure

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
├── environments/      # Reusable environment manifests
├── templates/         # Operation templates
│   └── operations/    # Template operations with placeholders
├── examples/          # Example operations
├── tests/            # Test suite
└── bin/              # Executable wrapper
```

### Adding New Features

1. **Follow KISS/YAGNI/DRY principles**
2. **Add JSON Schema validation** for new fields
3. **Write comprehensive tests**
4. **Update documentation** and examples
5. **Maintain backward compatibility**

### Testing Operations

```bash
# Test operation validation
npm test -- tests/operations/

# Test CLI commands
npm test -- tests/cli/

# Test evidence collection
npm test -- tests/evidence/
```

## 📄 License

ISC License - see [LICENSE](LICENSE) file for details.

## 🤝 Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Follow existing code style and add tests
4. Commit changes: `git commit -m 'Add amazing feature'`
5. Push to branch: `git push origin feature/amazing-feature`
6. Open Pull Request

## 📞 Support

- **GitHub Issues**: [Report bugs or request features](https://github.com/eric4545/samaritan/issues)
- **Documentation**: [Full documentation](https://github.com/eric4545/samaritan/docs)
- **Examples**: [Operation examples](examples/)

---

**Built with ❤️ for SRE teams who believe in Operations as Code**