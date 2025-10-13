import assert from 'node:assert';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import {
  OperationParseError,
  parseOperation,
} from '../../src/operations/parser';
import { parseFixture } from '../fixtures/fixtures';

describe('Enhanced Operation Parser', () => {
  it('should parse operation with new Step fields including instructions', async () => {
    const operation = await parseFixture('enhancedStepFields');

    // Test basic fields
    assert.strictEqual(operation.name, 'Enhanced Operation');
    assert.strictEqual(operation.version, '2.1.0');
    assert.strictEqual(operation.author, 'test-engineer');

    // Test steps with new fields - now includes migrated preflight step
    assert.strictEqual(operation.steps.length, 6);

    // Test automatic step with new fields (index 1 after preflight migration)
    const automaticStep = operation.steps[1];
    assert.strictEqual(automaticStep.type, 'automatic');
    assert.strictEqual(automaticStep.estimated_duration, 180);
    assert.strictEqual(automaticStep.evidence?.required, true);
    assert.ok(automaticStep.evidence?.types?.includes('log'));
    assert.ok(automaticStep.evidence?.types?.includes('screenshot'));
    assert.strictEqual(automaticStep.continue_on_error, false);

    // Test manual step with instruction
    const manualStep = operation.steps[2];
    assert.strictEqual(manualStep.type, 'manual');
    assert.strictEqual(
      manualStep.instruction,
      'Navigate to admin panel and configure the following settings...',
    );
    assert.strictEqual(manualStep.estimated_duration, 600);
    assert.strictEqual(manualStep.evidence?.required, true);

    // Test manual step with both command and instruction
    const manualWithCommand = operation.steps[3];
    assert.strictEqual(manualWithCommand.type, 'manual');
    assert.strictEqual(
      manualWithCommand.command,
      'curl -X POST http://admin/configure',
    );
    assert.strictEqual(
      manualWithCommand.instruction,
      "Execute the command and verify the response contains 'success'",
    );

    // Test step with verify and sub_steps
    const complexStep = operation.steps[4];
    assert.strictEqual(complexStep.type, 'automatic');
    assert.ok(complexStep.verify);
    assert.strictEqual(
      complexStep.verify.command,
      'kubectl get pods -l app=myapp | grep Running',
    );
    assert.ok(complexStep.sub_steps);
    assert.strictEqual(complexStep.sub_steps.length, 2);

    // Test sub-steps
    const subStep1 = complexStep.sub_steps[0];
    assert.strictEqual(subStep1.name, 'Wait for pods');
    assert.strictEqual(subStep1.type, 'automatic');
    assert.strictEqual(subStep1.timeout, 120);

    const subStep2 = complexStep.sub_steps[1];
    assert.strictEqual(subStep2.type, 'manual');
    assert.strictEqual(
      subStep2.instruction,
      'Check application dashboard shows green status',
    );
    assert.strictEqual(subStep2.evidence?.required, true);

    // Test approval step
    const approvalStep = operation.steps[5];
    assert.strictEqual(approvalStep.type, 'approval');
    assert.ok(approvalStep.approval);
    assert.strictEqual(approvalStep.approval.required, true);
  });

  it('should validate step types and evidence types', async () => {
    const invalidYaml = `
name: Invalid Operation
version: 1.0.0
steps:
  - name: Invalid Step
    type: invalid_type
    command: echo test
    evidence:
      types: [invalid_evidence]
`;

    const tempFile = `/tmp/samaritan-test-${Date.now()}-invalid-operation.yaml`;
    fs.writeFileSync(tempFile, invalidYaml);

    try {
      await assert.rejects(async () => {
        await parseOperation(tempFile);
      }, OperationParseError);
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('should validate required fields for different step types', async () => {
    const invalidStepsYaml = `
name: Invalid Steps
version: 1.0.0
steps:
  - name: ""
    type: automatic
    description: Empty name should fail
  - type: manual
    description: Missing name should fail
`;

    const tempFile = `/tmp/samaritan-test-${Date.now()}-invalid-steps.yaml`;
    fs.writeFileSync(tempFile, invalidStepsYaml);

    try {
      await assert.rejects(async () => {
        await parseOperation(tempFile);
      }, OperationParseError);
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('should validate numeric fields', async () => {
    const invalidNumericYaml = `
name: Invalid Numeric
version: 1.0.0
steps:
  - name: Invalid Duration
    type: automatic
    command: echo test
    estimated_duration: -10
    timeout: "invalid"
`;

    const tempFile = `/tmp/samaritan-test-${Date.now()}-invalid-numeric.yaml`;
    fs.writeFileSync(tempFile, invalidNumericYaml);

    try {
      await assert.rejects(async () => {
        await parseOperation(tempFile);
      }, OperationParseError);
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('should provide detailed error messages', async () => {
    const invalidYaml = `
name: Error Test
version: invalid-version
environments:
  - name: default
steps:
  - name: ""
    type: unknown
`;

    const tempFile = `/tmp/samaritan-test-${Date.now()}-error-test.yaml`;
    fs.writeFileSync(tempFile, invalidYaml);

    try {
      await parseOperation(tempFile);
      assert.fail('Should have thrown OperationParseError');
    } catch (error) {
      assert(error instanceof OperationParseError);
      assert(error.errors.length > 0);
      // Schema validation produces different field paths
      assert(
        error.errors.some(
          (e) => e.field.includes('version') || e.field === '/version',
        ),
      );
      assert(
        error.errors.some(
          (e) => e.field.includes('name') || e.field.includes('/steps'),
        ),
      );
      assert(
        error.errors.some(
          (e) => e.field.includes('type') || e.field.includes('/steps'),
        ),
      );
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('should handle conditional steps', async () => {
    const operation = await parseFixture('conditional');
    const conditionalStep = operation.steps[0];

    assert.strictEqual(conditionalStep.type, 'conditional');
    assert.strictEqual(conditionalStep.if, '${{ success() }}');
  });

  it('should preserve all enhanced preflight fields', async () => {
    const operation = await parseFixture('enhancedPreflight');
    // After unified steps, find step with phase: 'preflight'
    const preflightStep = operation.steps.find(
      (step) => step.phase === 'preflight',
    );
    assert.ok(preflightStep, 'Should have preflight step');

    assert.strictEqual(preflightStep.type, 'automatic');
    assert.strictEqual(preflightStep.condition, 'active');
    assert.strictEqual(preflightStep.timeout, 10);
    assert.strictEqual(preflightStep.evidence?.required, true);
  });
});
