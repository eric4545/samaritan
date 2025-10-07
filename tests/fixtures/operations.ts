import type { Operation } from '../../src/models/operation'

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
`

/**
 * Parsed TypeScript Operation object
 * This should match what parseOperation() returns for the YAML above
 */
export const deploymentOperation: Operation = {
  id: 'deploy-web-server',
  name: 'Deploy Web Server',
  version: '1.1.0',
  description: 'Deploys the main web server application to staging and production environments.',
  environments: [
    {
      name: 'staging',
      description: 'Staging environment for testing',
      variables: {
        REPLICAS: 2,
        DB_HOST: 'staging-db.example.com',
        PORT: 8080
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
        PORT: 80
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
      description: 'Scale the Kubernetes deployment to the specified replica count',
      command: 'kubectl scale deployment web-server --replicas=${REPLICAS}',
    },
    {
      name: 'Health Check',
      type: 'manual',
      phase: 'postflight',
      description: 'Manually verify deployment health',
      instruction: 'Check the application health endpoint at http://localhost:${PORT}/health',
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
}

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
}

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
}
