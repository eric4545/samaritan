import assert from 'node:assert';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { parseOperation } from '../../src/operations/parser';
import {
  enhancedOperationYaml,
  foreachLoopYaml,
  invalidOperationYaml,
  matrixForeachYaml,
  matrixWithFiltersYaml,
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

  it('should expand foreach loops into multiple steps', async () => {
    const tempFile = `/tmp/samaritan-test-${Date.now()}-foreach-test.yaml`;
    fs.writeFileSync(tempFile, foreachLoopYaml);

    try {
      const operation = await parseOperation(tempFile);

      // Verify foreach was expanded to 3 separate steps
      assert.strictEqual(operation.steps.length, 3, 'Should have 3 expanded steps');

      // Verify each expanded step
      assert.strictEqual(operation.steps[0].name, 'Deploy Service (backend)');
      assert.strictEqual(operation.steps[0].command, 'kubectl apply -f ${SERVICE}.yaml -n production');
      assert.strictEqual(operation.steps[0].variables?.SERVICE, 'backend');
      assert.strictEqual(operation.steps[0].foreach, undefined, 'foreach should be removed after expansion');

      assert.strictEqual(operation.steps[1].name, 'Deploy Service (frontend)');
      assert.strictEqual(operation.steps[1].command, 'kubectl apply -f ${SERVICE}.yaml -n production');
      assert.strictEqual(operation.steps[1].variables?.SERVICE, 'frontend');

      assert.strictEqual(operation.steps[2].name, 'Deploy Service (worker)');
      assert.strictEqual(operation.steps[2].command, 'kubectl apply -f ${SERVICE}.yaml -n production');
      assert.strictEqual(operation.steps[2].variables?.SERVICE, 'worker');

      // Verify all steps have the same type
      assert.strictEqual(operation.steps[0].type, 'automatic');
      assert.strictEqual(operation.steps[1].type, 'automatic');
      assert.strictEqual(operation.steps[2].type, 'automatic');
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('should test progressive rollout example with foreach', async () => {
    // Test the actual progressive-rollout.yaml example
    const operation = await parseOperation('examples/progressive-rollout.yaml');

    // Should have preflight steps (2) + expanded foreach steps (4) + postflight steps (2) = 8 total
    const preflightSteps = operation.steps.filter(step => step.phase === 'preflight');
    const flightSteps = operation.steps.filter(step => step.phase === 'flight');
    const postflightSteps = operation.steps.filter(step => step.phase === 'postflight');

    assert.strictEqual(preflightSteps.length, 2, 'Should have 2 preflight steps');
    assert.strictEqual(flightSteps.length, 4, 'Should have 4 flight steps (foreach expanded)');
    assert.strictEqual(postflightSteps.length, 2, 'Should have 2 postflight steps');

    // Verify foreach expansion in flight phase
    assert.ok(flightSteps[0].name.includes('10%') || flightSteps[0].name.includes('(10)'),
              'First step should reference 10%');
    assert.ok(flightSteps[1].name.includes('25%') || flightSteps[1].name.includes('(25)'),
              'Second step should reference 25%');
    assert.ok(flightSteps[2].name.includes('50%') || flightSteps[2].name.includes('(50)'),
              'Third step should reference 50%');
    assert.ok(flightSteps[3].name.includes('100%') || flightSteps[3].name.includes('(100)'),
              'Fourth step should reference 100%');

    // Verify variables are injected
    assert.strictEqual(flightSteps[0].variables?.TRAFFIC_PERCENT, 10);
    assert.strictEqual(flightSteps[1].variables?.TRAFFIC_PERCENT, 25);
    assert.strictEqual(flightSteps[2].variables?.TRAFFIC_PERCENT, 50);
    assert.strictEqual(flightSteps[3].variables?.TRAFFIC_PERCENT, 100);
  });

  it('should expand matrix foreach into cartesian product of steps', async () => {
    const tempFile = `/tmp/samaritan-test-${Date.now()}-matrix-test.yaml`;
    fs.writeFileSync(tempFile, matrixForeachYaml);

    try {
      const operation = await parseOperation(tempFile);

      // 2 regions × 2 tiers = 4 expanded steps
      assert.strictEqual(operation.steps.length, 4, 'Should have 4 expanded steps (2×2 matrix)');

      // Verify expanded step names contain both variables
      assert.strictEqual(operation.steps[0].name, 'Deploy to ${REGION} for ${TIER} (us-east-1, web)');
      assert.strictEqual(operation.steps[1].name, 'Deploy to ${REGION} for ${TIER} (us-east-1, api)');
      assert.strictEqual(operation.steps[2].name, 'Deploy to ${REGION} for ${TIER} (eu-west-1, web)');
      assert.strictEqual(operation.steps[3].name, 'Deploy to ${REGION} for ${TIER} (eu-west-1, api)');

      // Verify variables are injected for each combination
      assert.strictEqual(operation.steps[0].variables?.REGION, 'us-east-1');
      assert.strictEqual(operation.steps[0].variables?.TIER, 'web');

      assert.strictEqual(operation.steps[1].variables?.REGION, 'us-east-1');
      assert.strictEqual(operation.steps[1].variables?.TIER, 'api');

      assert.strictEqual(operation.steps[2].variables?.REGION, 'eu-west-1');
      assert.strictEqual(operation.steps[2].variables?.TIER, 'web');

      assert.strictEqual(operation.steps[3].variables?.REGION, 'eu-west-1');
      assert.strictEqual(operation.steps[3].variables?.TIER, 'api');

      // Verify foreach is removed from expanded steps
      assert.strictEqual(operation.steps[0].foreach, undefined);
      assert.strictEqual(operation.steps[1].foreach, undefined);
      assert.strictEqual(operation.steps[2].foreach, undefined);
      assert.strictEqual(operation.steps[3].foreach, undefined);
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('should apply include and exclude filters to matrix expansion', async () => {
    const tempFile = `/tmp/samaritan-test-${Date.now()}-matrix-filters-test.yaml`;
    fs.writeFileSync(tempFile, matrixWithFiltersYaml);

    try {
      const operation = await parseOperation(tempFile);

      // Base: 2 regions × 2 tiers = 4 combinations
      // + 1 include (ap-south-1, web) = 5 total
      // - 1 exclude (eu-west-1, api) = 4 final combinations
      assert.strictEqual(operation.steps.length, 4, 'Should have 4 steps after include/exclude filters');

      // Verify the combinations that should exist
      const combinations = operation.steps.map(step => ({
        region: step.variables?.REGION,
        tier: step.variables?.TIER
      }));

      // Should include: us-east-1/web, us-east-1/api, eu-west-1/web, ap-south-1/web
      // Should NOT include: eu-west-1/api (excluded)
      assert.ok(combinations.some(c => c.region === 'us-east-1' && c.tier === 'web'));
      assert.ok(combinations.some(c => c.region === 'us-east-1' && c.tier === 'api'));
      assert.ok(combinations.some(c => c.region === 'eu-west-1' && c.tier === 'web'));
      assert.ok(combinations.some(c => c.region === 'ap-south-1' && c.tier === 'web'));

      // eu-west-1/api should be excluded
      assert.ok(!combinations.some(c => c.region === 'eu-west-1' && c.tier === 'api'),
                'eu-west-1/api combination should be excluded');
    } finally {
      fs.unlinkSync(tempFile);
    }
  });
});
