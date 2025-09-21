import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { parseOperation, OperationParseError } from '../../src/operations/parser';

describe('Enhanced Operation Parser', () => {
  it('should parse operation with new Step fields including instructions', () => {
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

preflight:
  - name: Check cluster access
    type: command
    command: kubectl cluster-info
    description: Verify cluster connectivity
    timeout: 30

steps:
  - name: Automatic Deployment
    type: automatic
    description: Deploy automatically
    command: kubectl apply -f deployment.yaml
    timeout: 300
    estimated_duration: 180
    evidence_required: true
    evidence_types: [log, screenshot]
    continue_on_error: false
    
  - name: Manual Configuration
    type: manual
    description: Manual configuration step
    instruction: "Navigate to admin panel and configure the following settings..."
    estimated_duration: 600
    evidence_required: true
    evidence_types: [screenshot]
    
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
        evidence_required: true
        evidence_types: [screenshot]
        
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
      const operation = parseOperation(tempFile);

      // Test basic fields
      assert.strictEqual(operation.name, 'Enhanced Operation');
      assert.strictEqual(operation.version, '2.1.0');
      assert.strictEqual(operation.author, 'test-engineer');

      // Test steps with new fields
      assert.strictEqual(operation.steps.length, 5);

      // Test automatic step with new fields
      const automaticStep = operation.steps[0];
      assert.strictEqual(automaticStep.type, 'automatic');
      assert.strictEqual(automaticStep.estimated_duration, 180);
      assert.strictEqual(automaticStep.evidence_required, true);
      assert.ok(automaticStep.evidence_types?.includes('log'));
      assert.ok(automaticStep.evidence_types?.includes('screenshot'));
      assert.strictEqual(automaticStep.continue_on_error, false);

      // Test manual step with instruction
      const manualStep = operation.steps[1];
      assert.strictEqual(manualStep.type, 'manual');
      assert.strictEqual(manualStep.instruction, 'Navigate to admin panel and configure the following settings...');
      assert.strictEqual(manualStep.estimated_duration, 600);
      assert.strictEqual(manualStep.evidence_required, true);

      // Test manual step with both command and instruction
      const manualWithCommand = operation.steps[2];
      assert.strictEqual(manualWithCommand.type, 'manual');
      assert.strictEqual(manualWithCommand.command, 'curl -X POST http://admin/configure');
      assert.strictEqual(manualWithCommand.instruction, 'Execute the command and verify the response contains \'success\'');

      // Test step with verify and sub_steps
      const complexStep = operation.steps[3];
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
      assert.strictEqual(subStep2.evidence_required, true);

      // Test approval step
      const approvalStep = operation.steps[4];
      assert.strictEqual(approvalStep.type, 'approval');
      assert.ok(approvalStep.approval);
      assert.strictEqual(approvalStep.approval.required, true);

    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('should validate step types and evidence types', () => {
    const invalidYaml = `
name: Invalid Operation
version: 1.0.0
steps:
  - name: Invalid Step
    type: invalid_type
    command: echo test
    evidence_types: [invalid_evidence]
`;

    const tempFile = '/tmp/invalid-operation.yaml';
    fs.writeFileSync(tempFile, invalidYaml);

    try {
      assert.throws(() => {
        parseOperation(tempFile);
      }, OperationParseError);
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('should validate required fields for different step types', () => {
    const invalidStepsYaml = `
name: Invalid Steps
version: 1.0.0
steps:
  - name: Automatic without command
    type: automatic
    description: Missing command
  - name: Manual without instruction or command
    type: manual
    description: Missing both
`;

    const tempFile = '/tmp/invalid-steps.yaml';
    fs.writeFileSync(tempFile, invalidStepsYaml);

    try {
      assert.throws(() => {
        parseOperation(tempFile);
      }, OperationParseError);
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('should validate numeric fields', () => {
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
      assert.throws(() => {
        parseOperation(tempFile);
      }, OperationParseError);
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('should provide detailed error messages', () => {
    const invalidYaml = `
name: Error Test
version: invalid-version
steps:
  - name: ""
    type: unknown
`;

    const tempFile = '/tmp/error-test.yaml';
    fs.writeFileSync(tempFile, invalidYaml);

    try {
      parseOperation(tempFile);
      assert.fail('Should have thrown OperationParseError');
    } catch (error) {
      assert(error instanceof OperationParseError);
      assert(error.errors.length > 0);
      assert(error.errors.some(e => e.field === 'version'));
      assert(error.errors.some(e => e.field.includes('name')));
      assert(error.errors.some(e => e.field.includes('type')));
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('should handle conditional steps', () => {
    const conditionalYaml = `
name: Conditional Test
version: 1.0.0
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
      const operation = parseOperation(tempFile);
      const conditionalStep = operation.steps[0];
      
      assert.strictEqual(conditionalStep.type, 'conditional');
      assert.strictEqual(conditionalStep.if, '${{ success() }}');
      
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('should preserve all enhanced preflight fields', () => {
    const preflightYaml = `
name: Preflight Test
version: 1.0.0
preflight:
  - name: Enhanced Preflight
    type: check
    command: systemctl is-active docker
    condition: active
    description: Verify Docker service is running
    timeout: 10
    evidence_required: true
steps:
  - name: Simple Step
    type: automatic
    command: echo done
`;

    const tempFile = '/tmp/preflight-test.yaml';
    fs.writeFileSync(tempFile, preflightYaml);

    try {
      const operation = parseOperation(tempFile);
      const preflight = operation.preflight[0];
      
      assert.strictEqual(preflight.type, 'check');
      assert.strictEqual(preflight.condition, 'active');
      assert.strictEqual(preflight.timeout, 10);
      assert.strictEqual(preflight.evidence_required, true);
      
    } finally {
      fs.unlinkSync(tempFile);
    }
  });
});