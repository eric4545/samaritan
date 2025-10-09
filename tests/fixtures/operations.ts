import type { Operation } from '../../src/models/operation';

/**
 * Shared test operation in YAML format
 * This is the canonical source of truth for test data
 */
export const deploymentOperationYaml = `name: Deploy Web Server
version: 1.1.0
description: Deploys the main web server application to staging and production environments.

environments:
  - name: staging
    description: Staging environment for testing
    variables:
      REPLICAS: 2
      DB_HOST: staging-db.example.com
      PORT: 8080
    targets:
      - cluster-staging-us-east-1
      - cluster-staging-eu-west-1
    approval_required: false
    validation_required: false

  - name: production
    description: Live production environment
    variables:
      REPLICAS: 5
      DB_HOST: prod-db.example.com
      PORT: 80
    targets:
      - cluster-prod-us-east-1
      - cluster-prod-eu-west-1
      - cluster-prod-asia-south-1
    approval_required: true
    validation_required: true

preflight:
  - name: Check Git status
    description: Ensure no uncommitted changes exist in the current branch
    command: git status --porcelain
    expect_empty: true
    type: command

  - name: Check Docker daemon
    description: Verify that the Docker daemon is running and accessible
    command: docker info
    type: command

steps:
  - name: Build Docker Image
    type: automatic
    phase: preflight
    description: Build the application's Docker image
    command: docker build -t web-server:latest .

  - name: Push Docker Image
    type: automatic
    phase: flight
    description: Push the image to the container registry
    command: docker push my-registry/web-server:latest

  - name: Deploy to Kubernetes
    type: automatic
    phase: flight
    description: Deploy the application to Kubernetes
    command: kubectl apply -f k8s/deployment.yaml
    rollback:
      command: kubectl rollout undo deployment/web-server

  - name: Scale Deployment
    type: automatic
    phase: flight
    description: Scale the Kubernetes deployment to the specified replica count
    command: kubectl scale deployment web-server --replicas=\${REPLICAS}

  - name: Health Check
    type: manual
    phase: postflight
    description: Manually verify deployment health
    instruction: Check the application health endpoint at http://localhost:\${PORT}/health
    pic: john.doe
    timeline: 2024-01-15 10:00
    ticket: JIRA-123

  - name: Verify Services
    type: manual
    phase: postflight
    description: Verify all services are running correctly
    command: curl https://web-server.example.com/health
`;

/**
 * Parsed TypeScript Operation object
 * This should match what parseOperation() returns for the YAML above
 */
export const deploymentOperation: Operation = {
  id: 'deploy-web-server',
  name: 'Deploy Web Server',
  version: '1.1.0',
  description:
    'Deploys the main web server application to staging and production environments.',
  environments: [
    {
      name: 'staging',
      description: 'Staging environment for testing',
      variables: {
        REPLICAS: 2,
        DB_HOST: 'staging-db.example.com',
        PORT: 8080,
      },
      restrictions: [],
      approval_required: false,
      validation_required: false,
      targets: ['cluster-staging-us-east-1', 'cluster-staging-eu-west-1'],
    },
    {
      name: 'production',
      description: 'Live production environment',
      variables: {
        REPLICAS: 5,
        DB_HOST: 'prod-db.example.com',
        PORT: 80,
      },
      restrictions: [],
      approval_required: true,
      validation_required: true,
      targets: [
        'cluster-prod-us-east-1',
        'cluster-prod-eu-west-1',
        'cluster-prod-asia-south-1',
      ],
    },
  ],
  variables: {
    staging: { REPLICAS: 2, DB_HOST: 'staging-db.example.com', PORT: 8080 },
    production: { REPLICAS: 5, DB_HOST: 'prod-db.example.com', PORT: 80 },
  },
  steps: [
    {
      name: 'Build Docker Image',
      type: 'automatic',
      phase: 'preflight',
      description: "Build the application's Docker image",
      command: 'docker build -t web-server:latest .',
    },
    {
      name: 'Push Docker Image',
      type: 'automatic',
      phase: 'flight',
      description: 'Push the image to the container registry',
      command: 'docker push my-registry/web-server:latest',
    },
    {
      name: 'Deploy to Kubernetes',
      type: 'automatic',
      phase: 'flight',
      description: 'Deploy the application to Kubernetes',
      command: 'kubectl apply -f k8s/deployment.yaml',
      rollback: {
        command: 'kubectl rollout undo deployment/web-server',
      },
    },
    {
      name: 'Scale Deployment',
      type: 'automatic',
      phase: 'flight',
      description:
        'Scale the Kubernetes deployment to the specified replica count',
      command: 'kubectl scale deployment web-server --replicas=${REPLICAS}',
    },
    {
      name: 'Health Check',
      type: 'manual',
      phase: 'postflight',
      description: 'Manually verify deployment health',
      instruction:
        'Check the application health endpoint at http://localhost:${PORT}/health',
      pic: 'john.doe',
      timeline: '2024-01-15 10:00',
      ticket: 'JIRA-123',
    },
    {
      name: 'Verify Services',
      type: 'manual',
      phase: 'postflight',
      description: 'Verify all services are running correctly',
      command: 'curl https://web-server.example.com/health',
    },
  ],
  preflight: [
    {
      name: 'Check Git status',
      type: 'command',
      description: 'Ensure no uncommitted changes exist in the current branch',
      command: 'git status --porcelain',
      expect_empty: true,
    },
    {
      name: 'Check Docker daemon',
      type: 'command',
      description: 'Verify that the Docker daemon is running and accessible',
      command: 'docker info',
    },
  ],
  metadata: {
    created_at: new Date('2024-01-01'),
    updated_at: new Date('2024-01-15'),
  },
};

/**
 * Minimal operation for edge case testing
 */
export const minimalOperation: Operation = {
  id: 'minimal-op',
  name: 'Minimal Operation',
  version: '1.0.0',
  description: 'Minimal operation for testing',
  environments: [
    {
      name: 'default',
      description: 'Default environment',
      variables: {},
      restrictions: [],
      approval_required: false,
      validation_required: false,
    },
  ],
  variables: {},
  steps: [
    {
      name: 'Single Step',
      type: 'automatic',
      command: 'echo "hello"',
    },
  ],
  preflight: [],
  metadata: {
    created_at: new Date(),
    updated_at: new Date(),
  },
};

/**
 * Operation with sub-steps for testing nested structure
 */
export const operationWithSubSteps: Operation = {
  id: 'nested-op',
  name: 'Operation with Sub-Steps',
  version: '1.0.0',
  description: 'Operation with nested sub-steps',
  environments: [
    {
      name: 'staging',
      description: 'Staging',
      variables: { ENV: 'staging' },
      restrictions: [],
      approval_required: false,
      validation_required: false,
    },
  ],
  variables: {},
  steps: [
    {
      name: 'Parent Step',
      type: 'automatic',
      phase: 'flight',
      description: 'Parent step with substeps',
      sub_steps: [
        {
          name: 'Sub Step 1',
          type: 'automatic',
          command: 'echo "substep 1"',
        },
        {
          name: 'Sub Step 2',
          type: 'manual',
          instruction: 'Do something manually',
        },
      ],
    },
  ],
  preflight: [],
  metadata: {
    created_at: new Date(),
    updated_at: new Date(),
  },
};

/**
 * Operation with section headings for testing table breaks
 */
export const operationWithSectionHeadingsYaml = `name: Section Heading Test
version: 1.0.0
description: Test section heading feature

environments:
  - name: staging
  - name: production

steps:
  - name: Step Before Section
    type: automatic
    phase: flight
    command: echo "before"

  - name: Database Migration
    type: manual
    phase: flight
    section_heading: true
    description: Migrate database schema
    pic: DBA Team
    timeline: 2024-01-15 10:00
    command: run migrations

  - name: Step After Section
    type: automatic
    phase: flight
    command: echo "after"
`;

/**
 * Operation with section heading as first step (edge case)
 */
export const operationWithSectionHeadingFirstYaml = `name: Section First Test
version: 1.0.0
description: Test section heading as first step

environments:
  - name: staging
  - name: production

steps:
  - name: Initial Setup
    type: manual
    phase: flight
    section_heading: true
    description: Setup required before deployment
    pic: DevOps Team
    command: run setup

  - name: Deploy App
    type: automatic
    phase: flight
    command: kubectl apply -f app.yaml

  - name: Verify
    type: manual
    phase: flight
    command: curl /health
`;

// Parser test fixtures

/**
 * Minimal operation YAML for testing defaults
 */
export const minimalTestYaml = `name: Minimal Test
version: 1.0.0
environments:
  - name: default
steps:
  - name: Test Step
    type: automatic
    command: echo "test"
`;

/**
 * Invalid YAML missing required fields
 */
export const invalidOperationYaml = `name: Invalid Operation
# Missing version and steps
`;

/**
 * Enhanced operation YAML with all new fields
 */
export const enhancedOperationYaml = `name: Enhanced Operation
version: 2.0.0
description: Full-featured operation
author: test-author
category: deployment
tags: [test, enhanced]
emergency: true
environments:
  - name: staging
    description: Staging environment
    variables:
      REPLICAS: 2
    restrictions: [business-hours]
    approval_required: false
    validation_required: true
preflight:
  - name: Check prerequisites
    type: command
    command: echo "checking"
    description: Verify system state
steps:
  - name: Deploy
    type: automatic
    description: Deploy the application
    command: kubectl apply -f deployment.yaml
    timeout: 300
    evidence:
      required: true
      types: [screenshot, log]
`;

// Enhanced parser test fixtures

/**
 * Operation with new Step fields including instructions
 */
export const enhancedStepFieldsYaml = `name: Enhanced Operation
version: 2.1.0
description: Testing all new fields
author: test-engineer

environments:
  - name: staging
    description: Staging environment
    variables:
      REPLICAS: 2
      TIMEOUT: 30
    restrictions: [business-hours]
    approval_required: false

steps:
  - name: Check cluster access
    type: automatic
    phase: preflight
    command: kubectl cluster-info
    description: Verify cluster connectivity
    timeout: 30

  - name: Automatic Deployment
    type: automatic
    description: Deploy automatically
    command: kubectl apply -f deployment.yaml
    timeout: 300
    estimated_duration: 180
    evidence:
      required: true
      types: [log, screenshot]
    continue_on_error: false

  - name: Manual Configuration
    type: manual
    description: Manual configuration step
    instruction: "Navigate to admin panel and configure the following settings..."
    estimated_duration: 600
    evidence:
      required: true
      types: [screenshot]

  - name: Manual with Command
    type: manual
    description: Manual step with command reference
    command: curl -X POST http://admin/configure
    instruction: "Execute the command and verify the response contains 'success'"

  - name: Complex Step with Sub-steps
    type: automatic
    description: Complex deployment with verification
    command: kubectl apply -f complex-deployment.yaml
    verify:
      command: kubectl get pods -l app=myapp | grep Running
    sub_steps:
      - name: Wait for pods
        type: automatic
        command: kubectl wait --for=condition=ready pod -l app=myapp
        timeout: 120
      - name: Manual health check
        type: manual
        instruction: "Check application dashboard shows green status"
        evidence:
          required: true
          types: [screenshot]

  - name: Approval Step
    type: approval
    description: Require manager approval
    approval:
      required: true
      approvers: [manager@company.com]
      timeout: "24h"
`;

/**
 * Conditional step test YAML
 */
export const conditionalStepYaml = `name: Conditional Test
version: 1.0.0
environments:
  - name: default
steps:
  - name: Conditional Step
    type: conditional
    if: "\${{ success() }}"
    command: echo "Previous steps succeeded"
    description: Only run if previous steps passed
`;

/**
 * Enhanced preflight fields test YAML
 */
export const enhancedPreflightYaml = `name: Preflight Test
version: 1.0.0
environments:
  - name: default
steps:
  - name: Enhanced Preflight
    type: automatic
    phase: preflight
    command: systemctl is-active docker
    condition: active
    description: Verify Docker service is running
    timeout: 10
    evidence:
      required: true
  - name: Simple Step
    type: automatic
    command: echo done
`;

// Confluence generator test fixtures

/**
 * Multi-line command test YAML
 */
export const multiLineCommandYaml = `name: Multi-line Test
version: 1.0.0
description: Test multi-line commands

environments:
  - name: staging
    variables:
      ENV: staging

steps:
  - name: Multi-line Command
    type: automatic
    phase: flight
    command: |
      echo "line 1"
      echo "line 2"
      echo "line 3"
`;

/**
 * Sub-steps test YAML
 */
export const subStepsYaml = `name: Sub-steps Test
version: 1.0.0
description: Test sub-steps

environments:
  - name: staging

steps:
  - name: Parent Step
    type: manual
    phase: flight
    instruction: Main task
    sub_steps:
      - name: Sub Task A
        type: automatic
        command: echo "A"
      - name: Sub Task B
        type: automatic
        command: echo "B"
`;

/**
 * Dependencies test YAML
 */
export const dependenciesYaml = `name: Dependencies Test
version: 1.0.0
description: Test dependencies

environments:
  - name: staging

steps:
  - name: Step One
    type: automatic
    phase: flight
    command: echo "one"

  - name: Step Two
    type: automatic
    phase: flight
    command: echo "two"
    needs:
      - Step One
`;

/**
 * Conditional step for Confluence test YAML
 */
export const conditionalConfluenceYaml = `name: Conditional Test
version: 1.0.0
description: Test conditional steps

environments:
  - name: staging
  - name: production

steps:
  - name: Production Only Step
    type: conditional
    phase: flight
    command: echo "prod only"
    if: "\${ENVIRONMENT} == 'production'"
`;

/**
 * Markdown instructions test YAML
 */
export const markdownInstructionsYaml = `name: Markdown Test
version: 1.0.0
description: Test markdown instructions

environments:
  - name: staging

steps:
  - name: Manual Step
    type: manual
    phase: flight
    instruction: |
      # Instructions
      1. First thing
      2. Second thing
      **Important note**
`;

/**
 * Markdown with variables test YAML
 */
export const markdownWithVariablesYaml = `name: Escaping Test
version: 1.0.0
description: Test variable handling in markdown

environments:
  - name: staging
    variables:
      API_ENDPOINT: "https://api.staging.com"
      DB_HOST: "db.staging.com"

steps:
  - name: Manual Step with Variables
    type: manual
    phase: flight
    instruction: |
      # Check health endpoints
      1. Verify API: curl \${API_ENDPOINT}/health
      2. Check database: ping \${DB_HOST}
      **Important**: Variables like \${FOO} should be preserved
`;

/**
 * Step with variables for escaping test YAML
 */
export const stepWithVariablesYaml = `name: Escaping Test
version: 1.0.0
description: Test variable escaping

environments:
  - name: staging

steps:
  - name: Deploy \${SERVICE_NAME} to cluster
    description: Deploys using \${DEPLOY_METHOD}
    type: automatic
    phase: flight
    if: \${ENVIRONMENT} == 'production'
    command: echo "deploy"
`;

/**
 * Markdown links test YAML
 */
export const markdownLinksYaml = `name: Links Test
version: 1.0.0
description: Test link conversion

environments:
  - name: staging

steps:
  - name: Check Documentation
    type: manual
    phase: flight
    instruction: |
      Review the following:
      - [API Docs](https://api.example.com/docs)
      - [Dashboard](https://dashboard.example.com)
      - Contact [Support](mailto:support@example.com)
`;

/**
 * Global rollback test YAML
 */
export const globalRollbackYaml = `name: Rollback Test
version: 1.0.0
description: Test global rollback

environments:
  - name: staging
  - name: production

steps:
  - name: Deploy
    type: automatic
    phase: flight
    command: kubectl apply -f app.yaml

rollback:
  automatic: false
  conditions:
    - health_check_failure
    - error_rate_spike
  steps:
    - command: kubectl rollout undo deployment/app
    - instruction: |
        Verify rollback completed:
        1. Check pods are running
        2. Test API endpoints
`;

/**
 * Gantt chart timeline test YAML
 */
export const ganttTimelineYaml = `name: Deployment with Timeline
version: 1.0.0
description: Test Gantt chart generation with timeline data

environments:
  - name: staging
    description: Staging environment
    variables:
      REPLICAS: 2
  - name: production
    description: Production environment
    variables:
      REPLICAS: 5

steps:
  - name: Pre-deployment Check
    type: automatic
    phase: preflight
    command: kubectl get nodes
    pic: DevOps Team
    timeline: 2024-01-15 09:00, 30m

  - name: Deploy Backend
    type: automatic
    phase: flight
    command: kubectl apply -f backend.yaml
    pic: Backend Team
    timeline: active, 15m

  - name: Deploy Frontend
    type: automatic
    phase: flight
    command: kubectl apply -f frontend.yaml
    pic: Frontend Team
    timeline: after Deploy Backend, 10m

  - name: Post-deployment Verification
    type: manual
    phase: postflight
    command: curl https://example.com/health
    pic: QA Team
    timeline: after Deploy Frontend, 20m
`;

/**
 * Evidence requirements test YAML
 */
export const evidenceRequiredYaml = `name: Evidence Test
version: 1.0.0
description: Test evidence requirements

environments:
  - name: staging
  - name: production

steps:
  - name: Deploy Application
    type: automatic
    phase: flight
    command: kubectl apply -f deployment.yaml
    evidence:
      required: true
      types: ["screenshot", "command_output"]

  - name: Manual Verification
    type: manual
    phase: postflight
    instruction: |
      Verify deployment is successful:
      1. Check application homepage
      2. Test login functionality
    evidence:
      required: true
      types: ["screenshot"]

  - name: Optional Check
    type: manual
    phase: postflight
    instruction: Check monitoring dashboards
    evidence:
      required: false
      types: ["screenshot", "log"]

  - name: No Evidence
    type: automatic
    phase: postflight
    command: echo "Done"
`;
