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

# Use specific branch (for testing/development)
npx github:eric4545/samaritan#branch-name validate my-operation.yaml
```

## 📋 Table of Contents

- [Core Concepts](#-core-concepts)
- [CLI Commands](#-cli-commands)
- [Operation Definition](#-operation-definition)
- [Execution Workflows](#-execution-workflows)
- [Examples](#-examples)
- [Roadmap](#-roadmap)
- [Development](#-development)

## 🎯 Core Concepts

### Operations as Code
- **YAML-defined procedures** stored in Git with version control
- **Environment-specific variables** for preprod/production deployment
- **Manual operation procedures** with evidence tracking
- **Approval gates** for compliance workflows

### Key Features
- **Manual Execution**: Present clear instructions for operator execution
- **Documentation Generation**: Create comprehensive manuals from YAML definitions
- **Validation**: Verify operation definitions and catch errors early
- **Multi-Environment**: Support for staging, production, and custom environments

### Evidence & Audit
- **Evidence tracking** - Document required evidence for each step
- **Git metadata** - Complete traceability with commit info
- **Structured documentation** - Generate manuals with evidence requirements
- **Audit-ready formats** - Markdown and Confluence outputs

> **Note**: Automatic evidence collection (screenshots, log capture, video recording) is planned for v2.0. See [ROADMAP.md](ROADMAP.md) for details.

## 🛠 CLI Commands

### Core Operations

```bash
# Validate operation definition
npx github:eric4545/samaritan validate <operation.yaml> [options]
  --strict              Enable strict validation with best practices
  --env <environment>   Validate for specific environment
  -v, --verbose         Verbose output

# Generate documentation
npx github:eric4545/samaritan generate manual <operation.yaml> [options]
  --output <file>       Output file (default: stdout)
  --format <md|confluence>  Output format (default: md)
  --env <environment>   Generate for specific environment only
  --resolve-vars        Resolve variables to actual values (ready-to-execute commands)

# Generate Confluence documentation
npx github:eric4545/samaritan generate confluence <operation.yaml> [options]
  --output <file>       Output Confluence storage format file
  --env <environment>   Generate for specific environment only
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

# Operation steps
steps:
  # Preflight checks
  - name: Check Git Status
    type: manual
    phase: preflight
    instruction: |
      Check for uncommitted changes:
      ```bash
      git status --porcelain
      ```
      Ensure output is empty before proceeding.

  - name: Verify Database Connection
    type: manual
    phase: preflight
    instruction: |
      Verify database connectivity:
      ```bash
      pg_isready -h ${DB_HOST}
      ```
      Confirm connection is ready.

  # Main operation steps
  - name: Database Migration
    type: manual
    instruction: |
      Run database migrations:
      ```bash
      npm run migrate
      ```
      Verify migration completes successfully (timeout: 300s)
      Capture screenshot and save migration logs.
    evidence:
      required: true
      types: [screenshot, log]  # Types are documentation only (v1.0)

  - name: Deploy Application
    type: manual
    instruction: |
      Deploy application to Kubernetes:
      ```bash
      kubectl apply -f k8s/
      ```

      Verify deployment:
      ```bash
      kubectl get pods -l app=webapp | grep Running
      ```
    evidence:
      required: true
      types: [screenshot]

  - name: Health Check
    type: manual
    instruction: |
      1. Open application dashboard: https://dashboard.company.com
      2. Verify all services show green status
      3. Test critical user flows
    evidence:
      required: true
      types: [screenshot]

  - name: Production Approval
    type: approval
    description: Require manager approval for production
    instruction: |
      Request approval from manager@company.com before proceeding.
      Document approval in evidence.
```

> **Note:** Steps with `phase: preflight` are recommended for pre-execution validation checks.

### Advanced Features

#### Enhanced Manual Generation with Metadata

Generated manuals now include comprehensive YAML frontmatter with git metadata and traceability:

```bash
# Generate manual for all environments with metadata
npx github:eric4545/samaritan generate manual deployment.yaml

# Generate manual for production environment only
npx github:eric4545/samaritan generate manual deployment.yaml --env production

# Generate manual with resolved variables (ready-to-execute commands)
npx github:eric4545/samaritan generate manual deployment.yaml --env production --resolve-vars
```

**Generated YAML frontmatter example:**
```yaml
---
source_file: "examples/deployment.yaml"
operation_id: "34ba0902-7669-4961-9038-fc17ace22fac"
operation_version: "1.1.0"
target_environment: "production"  # Only when --env specified
generated_at: "2025-09-25T17:03:26.350Z"
git_sha: "61b7299fecdec972c1bfcf8a02f539f05ae1986a"
git_branch: "001-i-want-to"
git_short_sha: "61b7299f"
git_author: "Eric Ng"
git_date: "2025-09-24 22:13:50 +0800"
git_message: "feat: restore TypeScript dependency..."
git_dirty: true
generator_version: "1.0.0"
---
```

**Variable Resolution Example:**

Without `--resolve-vars` (shows templates):
```bash
kubectl scale deployment web-server --replicas=${REPLICAS}
```

With `--resolve-vars` (ready-to-execute):
```bash
kubectl scale deployment web-server --replicas=5
```

**Code Block Protection:**

Variables inside fenced code blocks (` ``` `) are **protected from expansion** to preserve shell scripts and bash functions:

```yaml
common_variables:
  TIMESTAMP: $(date +%Y%m%d_%H%M%S)

steps:
  - name: Deploy with Timestamp Function
    instruction: |
      Use this bash function to capture deployment time:
      ```bash
      deploy() {
        local TIMESTAMP=$(date +%Y%m%d_%H%M%S)  # Stays literal
        echo "Deployed at ${TIMESTAMP}"          # Stays literal
      }
      ```
```

Even with `--resolve-vars`, the `${TIMESTAMP}` inside the code block remains as `${TIMESTAMP}` (not expanded to the YAML variable value). This prevents conflicts between YAML variables and bash/shell variables with the same name.

**Benefits:**
- **Audit Trail**: Know exactly which code version generated each manual
- **Environment Focus**: Production manuals show only production procedures
- **Ready-to-Execute**: Use `--resolve-vars` for copy-paste commands during emergencies
- **Change Tracking**: Generated timestamp and git status for compliance
- **File Organization**: Environment-specific files get appropriate suffixes (`deployment-production-manual.md`)

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
    type: manual
    instruction: |
      Deploy application to Kubernetes:
      ```bash
      kubectl apply -f k8s/ --namespace ${NAMESPACE}
      ```
      Timeout: 300s (5 minutes)
    evidence:
      required: true
      types: [screenshot]
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
    type: manual
    instruction: |
      Execute custom logic:
      ```bash
      echo "Custom logic"
      ```

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
    type: manual
    instruction: |
      If deployment fails, rollback:
      ```bash
      kubectl rollout undo deployment/webapp
      ```

      Check rollback status:
      ```bash
      kubectl rollout status deployment/webapp
      ```
```

#### Sub-steps and Complex Workflows

Organize complex procedures into hierarchical sub-steps with automatic numbering (1a, 1b, 1a1, 1a2, etc.):

**Basic Sub-steps:**
```yaml
steps:
  - name: Complex Deployment
    type: manual
    instruction: Deploy all components
    sub_steps:
      - name: Wait for Pods          # Numbered as 1a
        type: manual
        instruction: |
          Wait for pods to be ready:
          ```bash
          kubectl wait --for=condition=ready pod -l app=webapp --timeout=120s
          ```

      - name: Verify Deployment      # Numbered as 1b
        type: manual
        instruction: Check application responds correctly
        evidence:
          required: true
          types: [screenshot]
```

**Nested Sub-steps (Multi-level):**

Sub-steps can be nested up to 4 levels deep for organizing complex multi-tier deployments:

```yaml
steps:
  - name: Full Stack Deployment
    type: manual
    instruction: Deploy complete application stack
    sub_steps:
      # First level: Infrastructure (1a, 1b)
      - name: Infrastructure Setup
        type: manual
        section_heading: true  # Renders as section heading in manuals
        description: Provision infrastructure components
        pic: Infrastructure Team
        sub_steps:
          # Second level: Network components (1a1, 1a2)
          - name: Setup Networking
            type: automatic
            command: terraform apply -target=module.networking
            sub_steps:
              # Third level: Network verification (1a1a, 1a1b)
              - name: Verify Network Configuration
                type: manual
                instruction: Verify VPC, subnets, and security groups
                evidence:
                  required: true
                  types: [screenshot]

              - name: Test Connectivity
                type: automatic
                command: ping -c 3 ${GATEWAY_IP}

      # Another first level section (1b)
      - name: Database Tier
        type: manual
        section_heading: true
        description: Deploy database systems
        pic: DBA Team
        sub_steps:
          - name: Deploy PostgreSQL
            type: automatic
            command: helm install postgres bitnami/postgresql
            sub_steps:
              - name: Initialize Schema
                type: automatic
                section_heading: true  # Nested section heading
                description: Create tables and indexes
                command: psql -f schema.sql
```

**Step Numbering Pattern:**
- Level 0 (top-level): `1, 2, 3`
- Level 1 (first sub-steps): `1a, 1b, 1c`
- Level 2 (nested sub-steps): `1a1, 1a2, 1a3`
- Level 3 (deeply nested): `1a1a, 1a1b, 1a1c`
- Level 4 (maximum depth): `1a1a1, 1a1a2, 1a1a3`

**Section Headings:**

Use `section_heading: true` to break up long operations into logical sections. Section headings:
- Render as headings (h3, h4, h5) in generated manuals
- Close and reopen procedure tables for visual clarity
- Support PIC (Person In Charge) and timeline metadata
- Can be used at any nesting level

See `examples/nested-deployment.yaml` for a complete multi-tier deployment example.

#### Foreach Loops (Repeatable Steps)

Eliminate repetitive step definitions with `foreach` loops. Perfect for progressive rollouts, multi-service deployments, or any pattern where you repeat the same operation with different parameters.

##### Single Variable Foreach

**Basic Example:**
```yaml
steps:
  - name: Deploy Service
    type: automatic
    description: Deploy microservice to cluster
    command: kubectl apply -f ${SERVICE}.yaml
    foreach:
      var: SERVICE
      values: [backend, frontend, worker]
```

This expands to 3 separate steps at parse time:
- Step 1: Deploy Service (backend) with `SERVICE=backend`
- Step 2: Deploy Service (frontend) with `SERVICE=frontend`
- Step 3: Deploy Service (worker) with `SERVICE=worker`

**Progressive Rollout Example:**

See `examples/progressive-rollout.yaml` for a complete example demonstrating progressive canary deployment:

```yaml
steps:
  - name: Deploy to ${TRAFFIC_PERCENT}% of traffic
    type: manual
    instruction: |
      **Canary Deployment: ${TRAFFIC_PERCENT}% Traffic**

      1. Update traffic split:
      ```bash
      kubectl set traffic ${APP_NAME} \
        --stable=v1 --canary=v2 \
        --split ${TRAFFIC_PERCENT}:$((100-${TRAFFIC_PERCENT}))
      ```

      2. Monitor metrics for 15 minutes:
         - Error rate should remain < 1%
         - P99 latency should remain < 500ms

      **Wait for metrics to stabilize before proceeding!**
    foreach:
      var: TRAFFIC_PERCENT
      values: [10, 25, 50, 100]
    evidence:
      required: true
      types: [screenshot, command_output]
```

This creates 4 deployment steps (10% → 25% → 50% → 100%).

##### Matrix Expansion (Multiple Variables)

For operations that need multiple variables, use matrix expansion to create a cartesian product of all combinations:

**Basic Matrix Example:**
```yaml
steps:
  - name: Deploy ${TIER} to ${REGION}
    type: manual
    instruction: |
      Deploy ${TIER} service to ${REGION}:
      ```bash
      kubectl apply -f ${TIER}-service.yaml --context ${REGION}
      ```
    foreach:
      matrix:
        REGION: [us-east-1, us-west-2, eu-west-1]
        TIER: [web, api, worker]
    evidence:
      required: true
      types: [screenshot]
```

This creates **9 steps** (3 regions × 3 tiers):
- Deploy web to us-east-1
- Deploy api to us-east-1
- Deploy worker to us-east-1
- Deploy web to us-west-2
- ... (and so on for all combinations)

**Matrix with Include/Exclude Filters:**

Add or remove specific combinations from the matrix:

```yaml
steps:
  - name: Deploy ${SERVICE} to ${REGION}
    type: manual
    instruction: |
      Deploy ${SERVICE} to ${REGION} region
    foreach:
      matrix:
        REGION: [us-east-1, eu-west-1]
        TIER: [web, api]
      include:
        # Add specific combination not in matrix
        - REGION: ap-south-1
          TIER: web
      exclude:
        # Remove specific combination from matrix
        - REGION: eu-west-1
          TIER: api
```

This expands to 4 steps:
- us-east-1/web, us-east-1/api, eu-west-1/web (from matrix)
- ap-south-1/web (from include)
- eu-west-1/api is excluded

**Real-World Multi-Region Example:**

See `examples/multi-region-deployment.yaml` for a complete example deploying across 3 regions and 3 tiers (9 total deployments).

**Key Features:**
- **Automatic Expansion**: Parser expands loops at parse time into separate steps
- **Variable Injection**: Loop variables are added to `step.variables` for each iteration
- **Cartesian Product**: Matrix creates all possible combinations of variables
- **Include/Exclude**: Fine-tune which combinations are deployed
- **Full Integration**: Works with all step features (evidence, rollback, approval, etc.)
- **Clean Manuals**: Generated manuals show expanded steps with values in parentheses


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

# 2. Generate deployment manual for staging (with resolved variables)
npx github:eric4545/samaritan generate manual deployment.yaml --env staging --resolve-vars

# 3. Test procedure in staging (follow generated manual)

# 4. Generate deployment manual for production
npx github:eric4545/samaritan generate manual deployment.yaml --env production --resolve-vars

# 5. Execute in production following the manual, collect evidence
```

### 3. Emergency Response Workflow

```bash
# 1. Validate emergency operation
npx github:eric4545/samaritan validate emergency/restart-service.yaml --env production

# 2. Generate emergency manual with resolved variables
npx github:eric4545/samaritan generate manual emergency/restart-service.yaml --env production --resolve-vars

# 3. Follow manual procedures, document all actions and evidence
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
    type: manual
    instruction: |
      Create database backup:
      ```bash
      pg_dump ${DB_NAME} | gzip > backup_$(date +%Y%m%d).sql.gz
      ```
      Timeout: 1800s (30 minutes)
    evidence:
      required: true
      types: [screenshot, log]

  - name: Upload to S3
    type: manual
    instruction: |
      Upload backup to S3:
      ```bash
      aws s3 cp backup_*.sql.gz ${BACKUP_BUCKET}/
      ```
    evidence:
      required: true
      types: [screenshot]

  - name: Verify Backup
    type: manual
    instruction: |
      1. Check backup file exists in S3: ${BACKUP_BUCKET}
      2. Verify file size is reasonable (>100MB)
      3. Download and test restore on test database
    evidence:
      required: true
      types: [screenshot, log]
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

steps:
  - name: Check Service Status
    type: manual
    phase: preflight
    instruction: |
      Check current pod status:
      ```bash
      kubectl get pods -n ${NAMESPACE} -l app=${SERVICE_NAME}
      ```
      Document current state before proceeding.
    evidence:
      required: true
      types: [screenshot]

  - name: Scale Down Service
    type: manual
    instruction: |
      Scale service to zero replicas:
      ```bash
      kubectl scale deployment ${SERVICE_NAME} --replicas=0 -n ${NAMESPACE}
      ```
      Wait for all pods to terminate.
    evidence:
      required: true
      types: [screenshot]

  - name: Clear Cache
    type: manual
    instruction: |
      Clear Redis cache:
      1. Connect to Redis: redis-cli -h cache.company.com
      2. Run: FLUSHALL
      3. Confirm with: INFO keyspace
    evidence:
      required: true
      types: [screenshot, log]

  - name: Scale Up Service
    type: manual
    instruction: |
      Scale service back to 3 replicas:
      ```bash
      kubectl scale deployment ${SERVICE_NAME} --replicas=3 -n ${NAMESPACE}
      ```

      Verify all pods are running:
      ```bash
      kubectl get pods -n ${NAMESPACE} -l app=${SERVICE_NAME} | grep Running | wc -l
      ```
      Expected output: 3
    evidence:
      required: true
      types: [screenshot]
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

## 🗺️ Roadmap

SAMARITAN v1.0 focuses on documentation generation and validation. Future versions will add:
- **v2.0**: Command execution and automatic evidence collection
- **v3.0**: External integrations (Jira, Confluence, Slack)
- **v4.0**: AI assistance and operation analytics

See [ROADMAP.md](ROADMAP.md) for detailed feature plans and timelines.

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