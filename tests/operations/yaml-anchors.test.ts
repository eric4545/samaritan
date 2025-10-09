import assert from 'node:assert';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { parseOperation } from '../../src/operations/parser';

describe('YAML Anchors and Aliases Support', () => {
  it('should support scalar anchors and aliases', async () => {
    const yaml = `
name: Test Scalar Anchors
version: 1.0.0

common_variables:
  default_timeout: &default_timeout 300
  default_host: &default_host example.com

environments:
  - name: production
    variables:
      TIMEOUT: *default_timeout
      HOST: *default_host

steps:
  - name: Test Step
    type: manual
    timeout: *default_timeout
    instruction: Connect to database server
`;

    const tempFile = `/tmp/samaritan-test-${Date.now()}-scalar-anchors.yaml`;
    fs.writeFileSync(tempFile, yaml);

    try {
      const operation = await parseOperation(tempFile);

      // Verify anchors are resolved
      assert.strictEqual(operation.environments[0].variables.TIMEOUT, 300);
      assert.strictEqual(
        operation.environments[0].variables.HOST,
        'example.com',
      );
      assert.strictEqual(operation.steps[0].timeout, 300);
      assert.ok(operation.steps[0].instruction?.includes('database'));
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('should support object anchors with merge keys', async () => {
    const yaml = `
name: Test Object Anchors
version: 1.0.0

common_variables:
  default_evidence: &default_evidence
    required: true
    types: [screenshot, log]

  default_retry: &default_retry
    max_attempts: 3
    backoff: exponential

environments:
  - name: production

steps:
  - name: Deploy Database
    type: manual
    instruction: Run migrations
    evidence:
      <<: *default_evidence
    retry:
      <<: *default_retry
      max_attempts: 5  # Override

  - name: Deploy App
    type: manual
    instruction: Deploy application
    evidence:
      <<: *default_evidence
      types: [screenshot]  # Override
`;

    const tempFile = `/tmp/samaritan-test-${Date.now()}-object-anchors.yaml`;
    fs.writeFileSync(tempFile, yaml);

    try {
      const operation = await parseOperation(tempFile);

      // Verify first step merged evidence
      const step1 = operation.steps[0];
      assert.strictEqual(step1.evidence?.required, true);
      assert.deepStrictEqual(step1.evidence?.types, ['screenshot', 'log']);
      assert.strictEqual(step1.retry?.max_attempts, 5);
      assert.strictEqual(step1.retry?.backoff, 'exponential');

      // Verify second step overrode evidence types
      const step2 = operation.steps[1];
      assert.strictEqual(step2.evidence?.required, true);
      assert.deepStrictEqual(step2.evidence?.types, ['screenshot']);
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('should support array/sequence anchors', async () => {
    const yaml = `
name: Test Array Anchors
version: 1.0.0

common_variables:
  common_tags: &common_tags
    - deployment
    - production
    - automated

environments:
  - name: production

tags: *common_tags

steps:
  - name: Deploy
    type: manual
    instruction: Deploy app
`;

    const tempFile = `/tmp/samaritan-test-${Date.now()}-array-anchors.yaml`;
    fs.writeFileSync(tempFile, yaml);

    try {
      const operation = await parseOperation(tempFile);

      // Verify array anchor is resolved
      assert.deepStrictEqual(operation.tags, [
        'deployment',
        'production',
        'automated',
      ]);
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('should support nested anchors in environment variables', async () => {
    const yaml = `
name: Test Nested Environment Anchors
version: 1.0.0

common_variables:
  base_vars: &base_vars
    NAMESPACE: default
    REPLICAS: 2
    LOG_LEVEL: info

environments:
  - name: staging
    variables:
      <<: *base_vars
      NAMESPACE: staging

  - name: production
    variables:
      <<: *base_vars
      NAMESPACE: production
      REPLICAS: 5
      LOG_LEVEL: warn

steps:
  - name: Deploy
    type: manual
    instruction: |
      Deploy to \${NAMESPACE} with \${REPLICAS} replicas
`;

    const tempFile = `/tmp/samaritan-test-${Date.now()}-nested-env-anchors.yaml`;
    fs.writeFileSync(tempFile, yaml);

    try {
      const operation = await parseOperation(tempFile);

      // Verify staging environment merged and overrode
      const staging = operation.environments.find((e) => e.name === 'staging');
      assert.ok(staging);
      assert.strictEqual(staging.variables.NAMESPACE, 'staging');
      assert.strictEqual(staging.variables.REPLICAS, 2);
      assert.strictEqual(staging.variables.LOG_LEVEL, 'info');

      // Verify production environment merged and overrode
      const production = operation.environments.find(
        (e) => e.name === 'production',
      );
      assert.ok(production);
      assert.strictEqual(production.variables.NAMESPACE, 'production');
      assert.strictEqual(production.variables.REPLICAS, 5);
      assert.strictEqual(production.variables.LOG_LEVEL, 'warn');
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('should support reusable step templates with anchors', async () => {
    const yaml = `
name: Test Reusable Step Templates
version: 1.0.0

common_variables:
  standard_preflight: &standard_preflight
    type: manual
    phase: preflight
    evidence:
      required: true
      types: [screenshot]

  standard_deployment: &standard_deployment
    type: manual
    timeout: 300
    evidence:
      required: true
      types: [screenshot, log]

environments:
  - name: production

steps:
  - <<: *standard_preflight
    name: Check Git Status
    instruction: |
      Run: git status --porcelain
      Ensure output is empty

  - <<: *standard_preflight
    name: Check Docker Daemon
    instruction: |
      Run: docker info
      Verify daemon is running

  - <<: *standard_deployment
    name: Deploy Database
    instruction: |
      Run: kubectl apply -f db.yaml

  - <<: *standard_deployment
    name: Deploy Application
    instruction: |
      Run: kubectl apply -f app.yaml
    timeout: 600  # Override timeout
`;

    const tempFile = `/tmp/samaritan-test-${Date.now()}-reusable-steps.yaml`;
    fs.writeFileSync(tempFile, yaml);

    try {
      const operation = await parseOperation(tempFile);

      // Verify preflight steps have correct properties
      const preflightSteps = operation.steps.filter(
        (s) => s.phase === 'preflight',
      );
      assert.strictEqual(preflightSteps.length, 2);

      for (const step of preflightSteps) {
        assert.strictEqual(step.type, 'manual');
        assert.strictEqual(step.phase, 'preflight');
        assert.strictEqual(step.evidence?.required, true);
        assert.deepStrictEqual(step.evidence?.types, ['screenshot']);
      }

      // Verify deployment steps have correct properties
      const deploymentSteps = operation.steps.filter(
        (s) => s.phase !== 'preflight',
      );
      assert.strictEqual(deploymentSteps.length, 2);

      const dbDeploy = deploymentSteps[0];
      assert.strictEqual(dbDeploy.name, 'Deploy Database');
      assert.strictEqual(dbDeploy.type, 'manual');
      assert.strictEqual(dbDeploy.timeout, 300);
      assert.strictEqual(dbDeploy.evidence?.required, true);
      assert.deepStrictEqual(dbDeploy.evidence?.types, ['screenshot', 'log']);

      const appDeploy = deploymentSteps[1];
      assert.strictEqual(appDeploy.name, 'Deploy Application');
      assert.strictEqual(appDeploy.timeout, 600); // Override worked
      assert.deepStrictEqual(appDeploy.evidence?.types, ['screenshot', 'log']);
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('should support complex DRY patterns with multiple anchors', async () => {
    const yaml = `
name: Complex DRY Example
version: 1.0.0

common_variables:
  # Reusable evidence configs
  evidence_screenshot: &evidence_screenshot
    required: true
    types: [screenshot]

  evidence_full: &evidence_full
    required: true
    types: [screenshot, log]

  # Reusable retry configs
  retry_standard: &retry_standard
    max_attempts: 3
    backoff: exponential

  retry_aggressive: &retry_aggressive
    max_attempts: 5
    backoff: linear

  # Reusable environment base
  env_base: &env_base
    DB_PORT: 5432
    REDIS_PORT: 6379
    LOG_LEVEL: info

environments:
  - name: staging
    variables:
      <<: *env_base
      DB_HOST: staging-db.example.com
      REPLICAS: 2

  - name: production
    variables:
      <<: *env_base
      DB_HOST: prod-db.example.com
      REPLICAS: 5
      LOG_LEVEL: warn

preflight:
  - name: Check Database
    command: pg_isready -h \${DB_HOST}
    evidence: *evidence_screenshot

  - name: Check Redis
    command: redis-cli -h \${REDIS_HOST} ping
    evidence: *evidence_screenshot

steps:
  - name: Migrate Database
    type: manual
    instruction: Run migrations
    timeout: 600
    evidence: *evidence_full
    retry: *retry_aggressive

  - name: Deploy Application
    type: manual
    instruction: Deploy app
    timeout: 300
    evidence: *evidence_full
    retry: *retry_standard

  - name: Verify Health
    type: manual
    instruction: Check health endpoints
    evidence: *evidence_screenshot
    retry: *retry_standard
`;

    const tempFile = `/tmp/samaritan-test-${Date.now()}-complex-dry.yaml`;
    fs.writeFileSync(tempFile, yaml);

    try {
      const operation = await parseOperation(tempFile);

      // Verify environments merged correctly
      const staging = operation.environments.find((e) => e.name === 'staging');
      assert.ok(staging);
      assert.strictEqual(staging.variables.DB_PORT, 5432);
      assert.strictEqual(staging.variables.REDIS_PORT, 6379);
      assert.strictEqual(staging.variables.LOG_LEVEL, 'info');
      assert.strictEqual(staging.variables.REPLICAS, 2);

      const production = operation.environments.find(
        (e) => e.name === 'production',
      );
      assert.ok(production);
      assert.strictEqual(production.variables.DB_PORT, 5432);
      assert.strictEqual(production.variables.LOG_LEVEL, 'warn');
      assert.strictEqual(production.variables.REPLICAS, 5);

      // Verify preflight checks have evidence
      const preflightSteps = operation.steps.filter(
        (s) => s.phase === 'preflight',
      );
      assert.strictEqual(preflightSteps.length, 2);

      for (const step of preflightSteps) {
        assert.strictEqual(step.evidence?.required, true);
        assert.deepStrictEqual(step.evidence?.types, ['screenshot']);
      }

      // Verify regular steps have correct evidence and retry configs
      const migrateStep = operation.steps.find(
        (s) => s.name === 'Migrate Database',
      );
      assert.ok(migrateStep);
      assert.strictEqual(migrateStep.evidence?.required, true);
      assert.deepStrictEqual(migrateStep.evidence?.types, [
        'screenshot',
        'log',
      ]);
      assert.strictEqual(migrateStep.retry?.max_attempts, 5);
      assert.strictEqual(migrateStep.retry?.backoff, 'linear');

      const deployStep = operation.steps.find(
        (s) => s.name === 'Deploy Application',
      );
      assert.ok(deployStep);
      assert.strictEqual(deployStep.retry?.max_attempts, 3);
      assert.strictEqual(deployStep.retry?.backoff, 'exponential');

      const verifyStep = operation.steps.find(
        (s) => s.name === 'Verify Health',
      );
      assert.ok(verifyStep);
      assert.deepStrictEqual(verifyStep.evidence?.types, ['screenshot']);
      assert.strictEqual(verifyStep.retry?.max_attempts, 3);
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('should support anchors in rollback procedures', async () => {
    const yaml = `
name: Test Rollback Anchors
version: 1.0.0

common_variables:
  standard_rollback_config: &standard_rollback_config
    timeout: 120
    evidence:
      required: true
      types: [screenshot]

environments:
  - name: production

steps:
  - name: Deploy Database
    type: manual
    instruction: Deploy database changes
    rollback:
      <<: *standard_rollback_config
      command: kubectl rollout undo deployment/database

  - name: Deploy Application
    type: manual
    instruction: Deploy application
    rollback:
      <<: *standard_rollback_config
      instruction: |
        Rollback to previous version:
        kubectl rollout undo deployment/app
      timeout: 180  # Override timeout

  - name: Deploy Worker
    type: manual
    instruction: Deploy worker service
    rollback:
      <<: *standard_rollback_config
      command: kubectl rollout undo deployment/worker
`;

    const tempFile = `/tmp/samaritan-test-${Date.now()}-rollback-anchors.yaml`;
    fs.writeFileSync(tempFile, yaml);

    try {
      const operation = await parseOperation(tempFile);

      // Verify first rollback has correct properties
      const rollback1 = operation.steps[0].rollback;
      assert.ok(rollback1);
      assert.strictEqual(rollback1.timeout, 120);
      assert.strictEqual(rollback1.evidence?.required, true);
      assert.deepStrictEqual(rollback1.evidence?.types, ['screenshot']);
      assert.strictEqual(
        rollback1.command,
        'kubectl rollout undo deployment/database',
      );

      // Verify second rollback overrode timeout
      const rollback2 = operation.steps[1].rollback;
      assert.ok(rollback2);
      assert.strictEqual(rollback2.timeout, 180); // Override worked
      assert.ok(
        rollback2.instruction?.includes('Rollback to previous version'),
      );

      // Verify third rollback
      const rollback3 = operation.steps[2].rollback;
      assert.ok(rollback3);
      assert.strictEqual(rollback3.timeout, 120);
      assert.strictEqual(
        rollback3.command,
        'kubectl rollout undo deployment/worker',
      );
    } finally {
      fs.unlinkSync(tempFile);
    }
  });
});
