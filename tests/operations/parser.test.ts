import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { parseOperation } from '../../src/operations/parser';
import { Operation, Environment, OperationMetadata } from '../../src/models/operation';

describe('Enhanced Operation Parser', () => {
  it('should parse legacy deployment.yaml with backward compatibility', () => {
    const operation = parseOperation('examples/deployment.yaml');

    // Verify basic fields work
    assert.strictEqual(operation.name, 'Deploy Web Server');
    assert.strictEqual(operation.version, '1.1.0');
    assert.strictEqual(operation.description, 'Deploys the main web server application to the staging environment.');

    // Verify enhanced fields have defaults
    assert.ok(operation.id); // Should be generated UUID
    assert.strictEqual(operation.emergency, false);
    assert.ok(Array.isArray(operation.tags));
    assert.strictEqual(operation.tags.length, 0);

    // Verify environments are properly converted
    assert.ok(operation.environments);
    assert.strictEqual(operation.environments.length, 2);
    
    const preprodEnv = operation.environments.find(env => env.name === 'preprod');
    assert.ok(preprodEnv);
    assert.strictEqual(preprodEnv.description, 'preprod');
    assert.strictEqual(preprodEnv.approval_required, false);
    assert.strictEqual(preprodEnv.variables.REPLICAS, 2);

    const prodEnv = operation.environments.find(env => env.name === 'production');
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

    // Verify steps are preserved
    assert.ok(operation.steps);
    assert.strictEqual(operation.steps.length, 6);
    assert.strictEqual(operation.steps[0].name, 'Build Docker Image');
    assert.strictEqual(operation.steps[0].type, 'automatic');

    // Verify preflight checks are preserved
    assert.ok(operation.preflight);
    assert.strictEqual(operation.preflight.length, 2);
    assert.strictEqual(operation.preflight[0].name, 'Check Git status');
  });

  it('should handle minimal YAML with proper defaults', () => {
    // Create a minimal test operation
    const minimalYaml = `
name: Minimal Test
version: 1.0.0
environments:
  - name: default
steps:
  - name: Test Step
    type: automatic
    command: echo "test"
`;
    
    // Write to temporary file for testing
    const tempFile = '/tmp/minimal-test.yaml';
    fs.writeFileSync(tempFile, minimalYaml);

    try {
      const operation = parseOperation(tempFile);

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

  it('should validate required fields and throw errors for invalid YAML', () => {
    const invalidYaml = `
name: Invalid Operation
# Missing version and steps
`;
    
    const tempFile = '/tmp/invalid-test.yaml';
    fs.writeFileSync(tempFile, invalidYaml);

    try {
      assert.throws(() => {
        parseOperation(tempFile);
      }, /Schema validation failed/);
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('should preserve all new enhanced fields when present', () => {
    const enhancedYaml = `
name: Enhanced Operation
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
    evidence_required: true
    evidence_types: [screenshot, log]
`;

    const tempFile = '/tmp/enhanced-test.yaml';
    fs.writeFileSync(tempFile, enhancedYaml);

    try {
      const operation = parseOperation(tempFile);

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

      // Verify enhanced step fields
      const step = operation.steps[0];
      assert.strictEqual(step.timeout, 300);
      assert.strictEqual(step.evidence_required, true);
      assert.ok(step.evidence_types?.includes('screenshot'));
      assert.ok(step.evidence_types?.includes('log'));

      // Verify enhanced preflight fields
      const preflight = operation.preflight[0];
      assert.strictEqual(preflight.type, 'command');

    } finally {
      fs.unlinkSync(tempFile);
    }
  });
});