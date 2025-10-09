import assert from 'node:assert';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { parseOperation } from '../../src/operations/parser';
import {
  enhancedOperationYaml,
  invalidOperationYaml,
  minimalTestYaml,
} from '../fixtures/operations';

describe('Enhanced Operation Parser', () => {
  it('should parse legacy deployment.yaml with backward compatibility', async () => {
    const operation = await parseOperation('examples/deployment.yaml');

    // Verify basic fields work
    assert.strictEqual(operation.name, 'Deploy Web Server');
    assert.strictEqual(operation.version, '1.1.0');
    assert.strictEqual(
      operation.description,
      'Deploys the main web server application to the staging environment.',
    );

    // Verify enhanced fields have defaults
    assert.ok(operation.id); // Should be generated UUID
    assert.strictEqual(operation.emergency, false);
    assert.ok(Array.isArray(operation.tags));
    assert.strictEqual(operation.tags.length, 0);

    // Verify environments are properly converted
    assert.ok(operation.environments);
    assert.strictEqual(operation.environments.length, 2);

    const preprodEnv = operation.environments.find(
      (env) => env.name === 'preprod',
    );
    assert.ok(preprodEnv);
    assert.strictEqual(preprodEnv.description, 'preprod');
    assert.strictEqual(preprodEnv.approval_required, false);
    assert.strictEqual(preprodEnv.variables.REPLICAS, 2);

    const prodEnv = operation.environments.find(
      (env) => env.name === 'production',
    );
    assert.ok(prodEnv);
    assert.strictEqual(prodEnv.approval_required, true);
    assert.strictEqual(prodEnv.variables.REPLICAS, 5);

    // Verify variable matrix is built correctly
    assert.ok(operation.variables);
    assert.strictEqual(operation.variables.preprod.REPLICAS, 2);
    assert.strictEqual(operation.variables.production.REPLICAS, 5);

    // Verify metadata is generated
    assert.ok(operation.metadata);
    assert.ok(operation.metadata.created_at instanceof Date);
    assert.ok(operation.metadata.updated_at instanceof Date);
    assert.strictEqual(operation.metadata.execution_count, 0);

    // Verify steps are preserved (preflight migrated to steps with phase)
    assert.ok(operation.steps);
    assert.strictEqual(operation.steps.length, 8); // 2 preflight + 6 original steps

    // Check preflight steps (now in unified steps with phase)
    const preflightSteps = operation.steps.filter(
      (step) => step.phase === 'preflight',
    );
    assert.strictEqual(preflightSteps.length, 2);
    assert.strictEqual(preflightSteps[0].name, 'Check Git status');
    assert.strictEqual(preflightSteps[0].type, 'automatic');

    // Check regular steps (should be the original steps, starting after preflight)
    const regularSteps = operation.steps.filter(
      (step) => step.phase !== 'preflight',
    );
    assert.strictEqual(regularSteps.length, 6);
    assert.strictEqual(regularSteps[0].name, 'Build Docker Image');
    assert.strictEqual(regularSteps[0].type, 'automatic');

    // Verify preflight array no longer exists (everything unified into steps)
    assert.strictEqual(operation.preflight.length, 0);
  });

  it('should handle minimal YAML with proper defaults', async () => {
    // Write to temporary file for testing
    const tempFile = `/tmp/samaritan-test-${Date.now()}-minimal-test.yaml`;
    fs.writeFileSync(tempFile, minimalTestYaml);

    try {
      const operation = await parseOperation(tempFile);

      // Verify required fields
      assert.strictEqual(operation.name, 'Minimal Test');
      assert.strictEqual(operation.version, '1.0.0');
      assert.strictEqual(operation.description, ''); // Default empty

      // Verify environment from YAML is used
      assert.strictEqual(operation.environments.length, 1);
      assert.strictEqual(operation.environments[0].name, 'default');
      assert.strictEqual(operation.environments[0].description, ''); // Empty because not specified in YAML

      // Verify other defaults
      assert.strictEqual(operation.emergency, false);
      assert.strictEqual(operation.tags.length, 0);
      assert.strictEqual(operation.preflight.length, 0);

      // Verify generated fields
      assert.ok(operation.id);
      assert.ok(operation.metadata.created_at);
    } finally {
      // Cleanup
      fs.unlinkSync(tempFile);
    }
  });

  it('should validate required fields and throw errors for invalid YAML', async () => {
    const tempFile = `/tmp/samaritan-test-${Date.now()}-invalid-test.yaml`;
    fs.writeFileSync(tempFile, invalidOperationYaml);

    try {
      await assert.rejects(async () => {
        await parseOperation(tempFile);
      }, /Schema validation failed/);
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('should preserve all new enhanced fields when present', async () => {
    const tempFile = `/tmp/samaritan-test-${Date.now()}-enhanced-test.yaml`;
    fs.writeFileSync(tempFile, enhancedOperationYaml);

    try {
      const operation = await parseOperation(tempFile);

      // Verify enhanced fields are preserved
      assert.strictEqual(operation.author, 'test-author');
      assert.strictEqual(operation.category, 'deployment');
      assert.ok(operation.tags.includes('test'));
      assert.ok(operation.tags.includes('enhanced'));
      assert.strictEqual(operation.emergency, true);

      // Verify enhanced environment fields
      const env = operation.environments[0];
      assert.ok(env.restrictions.includes('business-hours'));
      assert.strictEqual(env.validation_required, true);

      // Verify enhanced step fields (Deploy step is now at index 1 after preflight migration)
      const deployStep = operation.steps.find((step) => step.name === 'Deploy');
      assert.ok(deployStep, 'Deploy step should exist');
      assert.strictEqual(deployStep.timeout, 300);
      assert.strictEqual(deployStep.evidence?.required, true);
      assert.ok(deployStep.evidence?.types?.includes('screenshot'));
      assert.ok(deployStep.evidence?.types?.includes('log'));

      // Verify enhanced preflight fields (now in unified steps with phase)
      const preflightStep = operation.steps.find(
        (step) => step.phase === 'preflight',
      );
      assert.ok(preflightStep, 'Preflight step should exist');
      assert.strictEqual(preflightStep.type, 'automatic');
    } finally {
      fs.unlinkSync(tempFile);
    }
  });
});
