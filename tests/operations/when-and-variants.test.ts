import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseOperation } from '../../src/operations/parser';
import { getFixturePath } from '../fixtures/fixtures';

describe('When and Variants', () => {
  it('should parse when constraint correctly', async () => {
    const operation = await parseOperation(
      getFixturePath('whenAndVariants'),
    );

    // Step 1: Only for production
    const step1 = operation.steps[0];
    assert.equal(step1.name, 'Enable production monitoring');
    assert.deepEqual(step1.when, ['prod']);

    // Step 3: For staging and preprod
    const step3 = operation.steps[2];
    assert.equal(step3.name, 'Run integration tests');
    assert.deepEqual(step3.when, ['staging', 'preprod']);
  });

  it('should parse variants correctly', async () => {
    const operation = await parseOperation(
      getFixturePath('whenAndVariants'),
    );

    // Step 2: Has variants for prod and staging
    const step2 = operation.steps[1];
    assert.equal(step2.name, 'Deploy application');
    assert.ok(step2.variants);
    assert.ok(step2.variants.prod);
    assert.ok(step2.variants.staging);

    // Check prod variant
    assert.ok(step2.variants.prod.instruction);
    assert.ok(step2.variants.prod.instruction.includes('blue-green'));
    assert.equal(step2.variants.prod.pic, 'senior-sre@example.com');

    // Check staging variant
    assert.ok(step2.variants.staging.command);
    assert.ok(step2.variants.staging.command.includes('deployment-staging'));
  });

  it('should parse combined when and variants', async () => {
    const operation = await parseOperation(
      getFixturePath('whenAndVariants'),
    );

    // Step 5: Has both when and variants
    const step5 = operation.steps[4];
    assert.equal(step5.name, 'Database migration');
    assert.deepEqual(step5.when, ['preprod', 'prod']);
    assert.ok(step5.variants);
    assert.ok(step5.variants.prod);

    // Check prod variant has overrides
    assert.ok(step5.variants.prod.instruction?.includes('backup'));
    assert.ok(step5.variants.prod.command?.includes('db:backup'));
    assert.equal(step5.variants.prod.reviewer, 'senior-dba@example.com');
    assert.equal(step5.variants.prod.timeout, 1800);
  });

  it('should handle steps without when or variants', async () => {
    const operation = await parseOperation(
      getFixturePath('whenAndVariants'),
    );

    // Step 4: No when constraint (applies to all envs)
    const step4 = operation.steps[3];
    assert.equal(step4.name, 'Verify deployment');
    assert.equal(step4.when, undefined);

    // But has variants for different envs
    assert.ok(step4.variants);
    assert.ok(step4.variants.staging);
    assert.ok(step4.variants.preprod);
    assert.ok(step4.variants.prod);
  });
});
