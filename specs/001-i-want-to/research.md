# Comprehensive SAMARITAN Research

## Table of Contents
1. [Technology Stack](#technology-stack)
2. [GitHub Actions + Ansible Hybrid Pattern](#github-actions--ansible-hybrid-pattern)
3. [Operation Schema Evolution](#operation-schema-evolution) 
4. [Auto-to-Manual Conversion System](#auto-to-manual-conversion-system)
5. [Ansible Patterns Integration](#ansible-patterns-integration)
6. [Data Model and Architecture](#data-model-and-architecture)
7. [Implementation Strategy](#implementation-strategy)

## Technology Stack

### Node.js 24+ Technology Stack

#### Runtime Environment
**Decision**: Node.js 24+ LTS (Latest LTS in 2025)

**Rationale**:
- Node.js 24 is the latest LTS as of 2025 with long-term support until 2029
- Performance improvements: 20-40% faster startup times vs Node.js 22
- Built-in test runner with enhanced features and better TypeScript integration
- Native TypeScript compilation and enhanced ESM support

**Engine Constraint**: `"node": ">=24.0.0"`

#### Core Dependencies
- **CLI Framework**: Commander.js v12.x for robust argument parsing
- **YAML Processing**: js-yaml v4.x (fast) + yaml v2.x (comment preservation)
- **Interactive Prompts**: Inquirer.js v10.x with async/await API
- **AI Integration**: OpenAI SDK v5.x (GPT-5) + Anthropic SDK v0.40+ (Claude 4)
- **File Operations**: Native Node.js fs/promises + simple-git
- **Logging**: Pino v9.x with structured logging
- **Testing**: Native Node.js test runner with memfs

#### Sample package.json Structure
```json
{
  "name": "@samaritan/cli",
  "version": "1.0.0",
  "type": "module",
  "engines": {
    "node": ">=24.0.0"
  },
  "bin": {
    "samaritan": "./bin/cli.js"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "inquirer": "^10.2.0",
    "js-yaml": "^4.1.0",
    "yaml": "^2.4.0",
    "openai": "^5.0.0",
    "@anthropic-ai/sdk": "^0.40.0",
    "simple-git": "^3.21.0",
    "cross-spawn": "^7.0.3",
    "screenshot-desktop": "^1.15.0",
    "pino": "^9.5.0",
    "pino-pretty": "^11.5.0"
  },
  "devDependencies": {
    "memfs": "^4.15.0",
    "supertest": "^6.3.4",
    "@types/node": "^24.0.0",
    "semantic-release": "^23.0.0",
    "@semantic-release/changelog": "^6.0.3",
    "@semantic-release/git": "^10.0.1"
  },
  "release": {
    "branches": ["main"],
    "plugins": [
      "@semantic-release/commit-analyzer",
      "@semantic-release/release-notes-generator",
      "@semantic-release/changelog",
      "@semantic-release/npm",
      "@semantic-release/git",
      "@semantic-release/github"
    ]
  }
}
```

## GitHub Actions + Ansible Hybrid Pattern

### Core Concept
Combine GitHub Actions' workflow syntax and CI/CD patterns with Ansible's idempotent operations and configuration management for the ultimate Operations as Code platform.

### Best of Both Worlds

#### GitHub Actions Strengths
- **Familiar YAML syntax** for developers
- **Matrix builds** for multi-environment execution
- **Event-driven triggers** (push, PR, schedule, manual)
- **Marketplace ecosystem** for reusable actions
- **Built-in secrets management**
- **Conditional execution** with `if` statements
- **Job dependencies** and parallel execution

#### Ansible Strengths  
- **Idempotent operations** - safe to rerun
- **Rich module ecosystem** for infrastructure
- **Variable precedence system** for configuration
- **Handler system** for post-execution workflows
- **Inventory management** for target systems
- **Check mode** for dry-run operations
- **Template system** for dynamic configuration

#### SAMARITAN Hybrid Schema
```yaml
# Combines GitHub Actions workflow syntax with Ansible operation concepts
name: Deploy WebApp with Database Migration

# GitHub Actions-style triggers
on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Target environment'
        required: true
        type: choice
        options: [staging, production]
      version:
        description: 'Application version to deploy'
        required: true
        type: string

# Ansible-style environment configuration
environments:
  staging:
    variables:
      REPLICAS: 2
      DB_HOST: staging-db.company.com
      BACKUP_ENABLED: false
    targets:
      - k8s-staging-cluster
  
  production:
    variables:
      REPLICAS: 5
      DB_HOST: prod-db.company.com
      BACKUP_ENABLED: true
    targets:
      - k8s-prod-cluster
    restrictions:
      - requires_approval

# GitHub Actions-style job matrix with Ansible idempotency
jobs:
  preflight:
    name: Pre-flight Checks
    steps:
      - name: Verify cluster access
        k8s_info:
          api_version: v1
          kind: Node
        register: cluster_nodes
        check_mode: true  # Ansible dry-run concept
        
      - name: Check database connectivity
        postgresql_ping:
          host: "{{ DB_HOST }}"
        register: db_status
        
      - name: Validate deployment prerequisites
        assert:
          that:
            - cluster_nodes.resources | length > 0
            - db_status.is_available
          fail_msg: "Prerequisites not met for deployment"

  deploy:
    name: Deploy Application
    needs: preflight  # GitHub Actions dependency
    # Ansible-style idempotent operations
    steps:
      - name: Create namespace if not exists
        k8s:
          name: "{{ APP_NAME }}"
          api_version: v1
          kind: Namespace
          state: present
        # Ansible idempotency - won't recreate if exists
        
      - name: Deploy application
        k8s_deployment:
          name: "{{ APP_NAME }}"
          namespace: "{{ APP_NAME }}"
          image: "{{ APP_NAME }}:{{ inputs.version }}"
          replicas: "{{ REPLICAS }}"
        register: deployment_result
        notify: verify_deployment  # Ansible handler system
        
      - name: Run database migrations
        k8s_job:
          name: "db-migration-{{ ansible_date_time.epoch }}"
          namespace: "{{ APP_NAME }}"
          image: "{{ APP_NAME }}:{{ inputs.version }}"
          command: ["python", "manage.py", "migrate"]
        when: deployment_result.changed
        notify: backup_database

# Ansible-style handlers for post-execution workflows        
handlers:
  - name: verify_deployment
    k8s_info:
      api_version: apps/v1
      kind: Deployment
      name: "{{ APP_NAME }}"
      namespace: "{{ APP_NAME }}"
      wait: true
      wait_condition:
        type: Available
        status: "True"
    
  - name: backup_database
    postgresql_db:
      name: "{{ APP_NAME }}"
      state: dump
      target: "/backups/{{ APP_NAME }}-{{ ansible_date_time.iso8601 }}.sql"
    when: BACKUP_ENABLED | default(false)
```

## Operation Schema Evolution

### MVP Schema Focus
The MVP focuses on core auto-to-manual conversion:

```yaml
operation:
  name: deploy-webapp
  description: "Deploy web application with database migration"
  
# Simple environment matrix
environments:
  staging:
    variables:
      REPLICAS: 2
      DB_URL: "postgresql://staging-db:5432/app"
  production: 
    variables:
      REPLICAS: 5
      DB_URL: "postgresql://prod-db:5432/app"

# Core execution modes
execution:
  mode: auto  # auto | manual | interactive | check
  timeout: 1800
  retry_on_failure: true

# Simple step definition
steps:
  - name: deploy-app
    k8s_deployment:
      name: webapp
      image: webapp:${VERSION}
      replicas: ${REPLICAS}
    evidence: screenshot
    
  - name: verify-health
    http:
      url: ${APP_URL}/health
      expected_status: 200
    evidence: log
```

### Advanced Schema (Post-MVP)
```yaml
# Full GitHub Actions + Ansible hybrid schema
name: "Deploy E-commerce Platform"
description: "Full stack deployment with database migration and monitoring setup"

# GitHub Actions-inspired metadata
on:
  workflow_dispatch:
    inputs:
      environment:
        type: choice
        options: [staging, production, canary]
        required: true
      force_migration:
        type: boolean
        default: false
        description: "Force database migration even if risky"

# Ansible-inspired environment configuration  
environments:
  staging: &base_config
    variables:
      APP_REPLICAS: 2
      DB_POOL_SIZE: 10
      CACHE_SIZE: "256Mi"
    secrets:
      database_url: "staging/db-url"
      redis_url: "staging/redis-url"
      
  production:
    <<: *base_config  # YAML inheritance
    variables:
      APP_REPLICAS: 5
      DB_POOL_SIZE: 50
      CACHE_SIZE: "1Gi"
    secrets:
      database_url: "production/db-url" 
      redis_url: "production/redis-url"
    restrictions:
      - requires_approval: true
      - business_hours_only: true

# GitHub Actions-style job dependencies with Ansible idempotency
jobs:
  validate:
    name: "Validate Environment & Prerequisites"
    steps:
      - name: check-cluster-resources
        k8s_info:
          api_version: v1
          kind: Node
        register: cluster_info
        assert:
          that: cluster_info.resources | length >= 3
          fail_msg: "Insufficient cluster nodes"
          
  deploy:
    name: "Deploy Application Stack"
    needs: [validate]
    strategy:
      matrix:
        component: [database, cache, app, worker]
    steps:
      - name: "deploy-{{ matrix.component }}"
        include_tasks: "components/{{ matrix.component }}.yaml"
        notify:
          - verify_component_health
          - update_monitoring_dashboard

# Ansible-style handlers with GitHub Actions integration
handlers:
  - name: verify_component_health
    uri:
      url: "{{ component_health_check_url }}"
      method: GET
      status_code: 200
    retries: 10
    delay: 30
```

## Auto-to-Manual Conversion System

### Core Conversion Engine
Every automated step must be convertible to detailed manual instructions:

#### Automated Step Example
```yaml
- name: scale-deployment
  k8s_scale:
    api_version: apps/v1
    kind: Deployment
    name: webapp
    namespace: default
    replicas: 5
  evidence: screenshot
```

#### Generated Manual Example
```markdown
# Manual for: Deploy Web Server (v1.1.0)

_Deploys the main web server application._

## Environments Overview

| Environment | Variables | Approval Required |
|-------------|-----------|-------------------|
| staging     | REPLICAS: 2 | No |
| production  | REPLICAS: 5 | Yes |

## Pre-flight Checklist

- **Check Git status:** Ensure no uncommitted changes exist.
  ```bash
  git status --porcelain
  ```

## Operation Steps

### Step 1: Build Docker Image (automatic)
Build the application's Docker image.

**Command:** `docker build -t web-server:latest .`

### Step 4: Scale Deployment (automatic)  
Scale the Kubernetes deployment to the specified replica count.

**Commands by environment:**
- **staging**: `kubectl scale deployment web-server --replicas=2`
- **production**: `kubectl scale deployment web-server --replicas=5`

### Step 5: Manual Verification (manual)
Manually verify deployment health.

**Command:** `curl https://web-server.example.com/health`
```

**Key Design Principles:**
- **Single Document**: One manual covers all environments
- **KISS Format**: Simple bullet lists instead of complex tables  
- **Environment Differences**: Only shown when variables exist
- **Clear Command Visibility**: Shows exactly what automation executes

### Five Core Conversion Examples

1. **Kubernetes Operations**: Deployment scaling, service updates, secret management
2. **Database Operations**: Schema migrations, backup/restore, connection testing
3. **HTTP API Calls**: Health checks, configuration updates, webhook triggers
4. **File System Operations**: Config file updates, log collection, backup creation
5. **Infrastructure Commands**: Load balancer updates, DNS changes, certificate renewal

## Ansible Patterns Integration

### 1. Idempotent Operations
```yaml
# Ansible-inspired idempotent modules
steps:
  - name: ensure-namespace-exists
    k8s:
      name: webapp
      api_version: v1
      kind: Namespace
      state: present  # Idempotent - safe to rerun
    check_mode: true  # Dry-run capability
```

### 2. Variable Precedence System
```yaml
# Hierarchical configuration (all → environment → runtime)
environments:
  all: &global_defaults
    TIMEOUT: 300
    RETRY_COUNT: 3
    
  production:
    <<: *global_defaults
    TIMEOUT: 600  # Override for production
    BACKUP_ENABLED: true
    
# Runtime override: --set TIMEOUT=900
```

### 3. Handler System
```yaml
steps:
  - name: deploy-app
    k8s_deployment:
      name: webapp
      image: webapp:${VERSION}
    notify: 
      - verify-health
      - update-monitoring
      - notify-team
      
# Handlers only run if deployment changed
handlers:
  - name: verify-health
    http:
      url: ${APP_URL}/health
      expected_status: 200
      
  - name: update-monitoring
    grafana_dashboard:
      dashboard_id: webapp
      version: ${VERSION}
      
  - name: notify-team
    slack:
      channel: "#deployments"
      message: "✅ WebApp ${VERSION} deployed"
```

### 4. Environment Inventory System
```yaml
# Ansible-inspired inventory management
environments:
  staging:
    description: "Staging environment for testing"
    targets:
      - k8s-staging-cluster
      - staging-db.company.com
    variables:
      REPLICAS: 2
      DATABASE_URL: "postgresql://staging-db:5432/app"
      LOG_LEVEL: "debug"
      
  production:
    description: "Production environment"  
    targets:
      - k8s-prod-cluster
      - prod-db.company.com
    variables:
      REPLICAS: 5
      DATABASE_URL: "postgresql://prod-db:5432/app"
      LOG_LEVEL: "info"
    restrictions:
      - requires_approval
      - requires_staging_validation
```

## Data Model and Architecture

### Core Entities

#### Operation
```typescript
interface Operation {
  name: string;
  description: string;
  version: string;
  environments: Record<string, Environment>;
  jobs: Job[];
  handlers?: Handler[];
  on_success?: Handler[];
  on_failure?: Handler[];
}
```

#### Environment
```typescript
interface Environment {
  description?: string;
  variables: Record<string, any>;
  secrets?: Record<string, string>;
  targets?: string[];
  restrictions?: Restriction[];
  parent?: string;  // Inheritance
}
```

#### Job and Step
```typescript
interface Job {
  name: string;
  needs?: string[];  // Dependencies
  strategy?: {
    matrix?: Record<string, any[]>;
    fail_fast?: boolean;
  };
  steps: Step[];
}

interface Step {
  name: string;
  module: string;  // k8s, http, command, etc.
  parameters: Record<string, any>;
  when?: string;  // Conditional execution
  register?: string;  // Store result
  notify?: string[];  // Trigger handlers
  evidence?: 'log' | 'screenshot' | 'file';
  timeout?: number;
  retries?: number;
}
```

#### Execution Context
```typescript
interface ExecutionContext {
  operation: Operation;
  environment: string;
  variables: Record<string, any>;
  session_id: string;
  operator: string;
  mode: 'auto' | 'manual' | 'interactive' | 'check';
  evidence_collection: boolean;
}
```

### Session Management
```typescript
interface Session {
  id: string;
  operation_name: string;
  environment: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
  current_job: string;
  current_step: number;
  variables: Record<string, any>;
  evidence: Evidence[];
  created_at: Date;
  updated_at: Date;
}

interface Evidence {
  step_name: string;
  type: 'log' | 'screenshot' | 'file';
  content: string;
  timestamp: Date;
}
```

## Implementation Strategy

### Phase 1: MVP Core (Months 1-2)
- Basic CLI structure with Commander.js
- Simple YAML operation parsing
- Core auto-to-manual conversion engine
- Basic step execution (command, http, k8s)
- Evidence collection (logs only)
- Simple environment variable support

### Phase 2: Enhanced Operations (Months 3-4)
- Advanced step modules (database, file, cloud)
- Handler system implementation
- Session management and resume capability
- Screenshot evidence collection
- Approval gates and interactive mode

### Phase 3: Enterprise Features (Months 5-6)
- Matrix execution across environments
- Variable precedence and inheritance
- Encrypted secrets management
- Comprehensive audit logging
- Integration with Jira, Slack, monitoring tools

### Phase 4: Advanced Patterns (Months 7+)
- GitHub Actions workflow import/export
- Ansible playbook conversion utilities
- Operation marketplace and sharing
- AI-assisted operation generation
- Advanced compliance and governance features

## Confluence Integration Strategy

### Confluence REST API Integration
- **Authentication**: Personal Access Tokens or OAuth 2.0
- **Content Creation**: Automated QRH page generation
- **Version Management**: Track changes and maintain history
- **Template System**: Standardized page layouts for operations
- **Search Integration**: Find existing procedures and documentation

### QRH (Quick Reference Handbook) Generation
```typescript
// Confluence page structure for generated QRH
interface QRHPage {
  title: string;
  spaceKey: string;
  content: {
    overview: string;
    prerequisites: string[];
    steps: QRHStep[];
    troubleshooting: TroubleshootingGuide;
    rollback: RollbackProcedure;
    contacts: EmergencyContacts;
  };
}
```

### Sample Confluence Integration
```typescript
import { ConfluenceApi } from 'confluence-api';

class QRHGenerator {
  async generateEmergencyProcedure(operation: Operation): Promise<void> {
    const confluence = new ConfluenceApi({
      username: process.env.CONFLUENCE_USER,
      password: process.env.CONFLUENCE_TOKEN,
      baseUrl: process.env.CONFLUENCE_BASE_URL
    });
    
    const pageContent = this.convertOperationToQRH(operation);
    
    await confluence.postContent({
      spaceKey: 'SRE',
      title: `Emergency: ${operation.name}`,
      content: pageContent,
      parentId: process.env.QRH_PARENT_PAGE_ID
    });
  }
}
```

This comprehensive research consolidates all our findings into a single source of truth for SAMARITAN development, combining the best patterns from GitHub Actions and Ansible while maintaining focus on the core auto-to-manual conversion value proposition.