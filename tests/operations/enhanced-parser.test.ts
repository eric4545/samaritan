import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { parseOperation, OperationParseError } from '../../src/operations/parser';

describe('Enhanced Operation Parser', () => {
  it('should parse operation with new Step fields including instructions', async () => {
    const enhancedYaml = `
name: Enhanced Operation
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

    const tempFile = '/tmp/enhanced-operation.yaml';
    fs.writeFileSync(tempFile, enhancedYaml);

    try {
      const operation = await parseOperation(tempFile);

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
      assert.strictEqual(manualStep.instruction, 'Navigate to admin panel and configure the following settings...');
      assert.strictEqual(manualStep.estimated_duration, 600);
      assert.strictEqual(manualStep.evidence?.required, true);

      // Test manual step with both command and instruction
      const manualWithCommand = operation.steps[3];
      assert.strictEqual(manualWithCommand.type, 'manual');
      assert.strictEqual(manualWithCommand.command, 'curl -X POST http://admin/configure');
      assert.strictEqual(manualWithCommand.instruction, 'Execute the command and verify the response contains \'success\'');

      // Test step with verify and sub_steps
      const complexStep = operation.steps[4];
      assert.strictEqual(complexStep.type, 'automatic');
      assert.ok(complexStep.verify);
      assert.strictEqual(complexStep.verify.command, 'kubectl get pods -l app=myapp | grep Running');
      assert.ok(complexStep.sub_steps);
      assert.strictEqual(complexStep.sub_steps.length, 2);

      // Test sub-steps
      const subStep1 = complexStep.sub_steps[0];
      assert.strictEqual(subStep1.name, 'Wait for pods');
      assert.strictEqual(subStep1.type, 'automatic');
      assert.strictEqual(subStep1.timeout, 120);

      const subStep2 = complexStep.sub_steps[1];
      assert.strictEqual(subStep2.type, 'manual');
      assert.strictEqual(subStep2.instruction, 'Check application dashboard shows green status');
      assert.strictEqual(subStep2.evidence?.required, true);

      // Test approval step
      const approvalStep = operation.steps[5];
      assert.strictEqual(approvalStep.type, 'approval');
      assert.ok(approvalStep.approval);
      assert.strictEqual(approvalStep.approval.required, true);

    } finally {
      fs.unlinkSync(tempFile);
    }
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

    const tempFile = '/tmp/invalid-operation.yaml';
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

    const tempFile = '/tmp/invalid-steps.yaml';
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

    const tempFile = '/tmp/invalid-numeric.yaml';
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

    const tempFile = '/tmp/error-test.yaml';
    fs.writeFileSync(tempFile, invalidYaml);

    try {
      await parseOperation(tempFile);
      assert.fail('Should have thrown OperationParseError');
    } catch (error) {
      assert(error instanceof OperationParseError);
      assert(error.errors.length > 0);
      // Schema validation produces different field paths
      assert(error.errors.some(e => e.field.includes('version') || e.field === '/version'));
      assert(error.errors.some(e => e.field.includes('name') || e.field.includes('/steps')));
      assert(error.errors.some(e => e.field.includes('type') || e.field.includes('/steps')));
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('should handle conditional steps', async () => {
    const conditionalYaml = `
name: Conditional Test
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

    const tempFile = '/tmp/conditional-test.yaml';
    fs.writeFileSync(tempFile, conditionalYaml);

    try {
      const operation = await parseOperation(tempFile);
      const conditionalStep = operation.steps[0];

      assert.strictEqual(conditionalStep.type, 'conditional');
      assert.strictEqual(conditionalStep.if, '${{ success() }}');

    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('should preserve all enhanced preflight fields', async () => {
    const preflightYaml = `
name: Preflight Test
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

    const tempFile = '/tmp/preflight-test.yaml';
    fs.writeFileSync(tempFile, preflightYaml);

    try {
      const operation = await parseOperation(tempFile);
      // After unified steps, find step with phase: 'preflight'
      const preflightStep = operation.steps.find(step => step.phase === 'preflight');
      assert.ok(preflightStep, 'Should have preflight step');

      assert.strictEqual(preflightStep.type, 'automatic');
      assert.strictEqual(preflightStep.condition, 'active');
      assert.strictEqual(preflightStep.timeout, 10);
      assert.strictEqual(preflightStep.evidence?.required, true);

    } finally {
      fs.unlinkSync(tempFile);
    }
  });
});