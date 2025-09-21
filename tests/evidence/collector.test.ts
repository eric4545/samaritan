import { describe, it } from 'node:test';
import assert from 'node:assert';
import { EvidenceCollector, createEvidenceCollector, createEvidenceRequirements } from '../../src/evidence/collector';
import { EvidenceRequirement } from '../../src/models/evidence';

describe('Evidence Collector', () => {
  it('should create collector with initial state', () => {
    const requirements: EvidenceRequirement = {
      types: ['screenshot', 'log'],
      minimum_count: 2,
      description: 'Test evidence collection'
    };

    const collector = createEvidenceCollector('step-1', requirements);
    const state = collector.getState();

    assert.strictEqual(state.step_id, 'step-1');
    assert.strictEqual(state.collected.length, 0);
    assert.deepStrictEqual(state.missing, ['screenshot', 'log']);
    assert.strictEqual(state.completed, false);
  });

  it('should add valid evidence successfully', () => {
    const requirements: EvidenceRequirement = {
      types: ['screenshot'],
      minimum_count: 1
    };

    const collector = new EvidenceCollector('step-1', requirements);
    const result = collector.addEvidence(
      'screenshot',
      'test screenshot content',
      'test-user',
      {
        filename: 'screenshot.png',
        description: 'Test screenshot',
        metadata: { format: 'image/png' }
      }
    );

    assert.strictEqual(result.success, true);
    assert.ok(result.evidence);
    assert.strictEqual(result.evidence.type, 'screenshot');
    assert.strictEqual(result.evidence.operator, 'test-user');
    assert.strictEqual(result.evidence.validated, true);

    const state = collector.getState();
    assert.strictEqual(state.collected.length, 1);
    assert.strictEqual(state.missing.length, 0);
    assert.strictEqual(state.completed, true);
  });

  it('should reject invalid evidence', () => {
    const requirements: EvidenceRequirement = {
      types: ['screenshot'],
      validation_rules: [{
        type: 'screenshot',
        max_size: 100, // Very small limit
        allowed_formats: ['image/png']
      }]
    };

    const collector = new EvidenceCollector('step-1', requirements);
    const result = collector.addEvidence(
      'screenshot',
      'x'.repeat(200), // Exceeds size limit
      'test-user',
      { metadata: { format: 'image/png' } }
    );

    assert.strictEqual(result.success, false);
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors.some(e => e.includes('exceeds maximum')));

    const state = collector.getState();
    assert.strictEqual(state.collected.length, 0);
  });

  it('should track missing evidence types', () => {
    const requirements: EvidenceRequirement = {
      types: ['screenshot', 'log', 'command_output'],
      minimum_count: 3
    };

    const collector = new EvidenceCollector('step-1', requirements);

    // Add screenshot
    collector.addEvidence('screenshot', 'screenshot content', 'user1');
    let state = collector.getState();
    assert.deepStrictEqual(state.missing, ['log', 'command_output']);

    // Add log
    collector.addEvidence('log', 'log content', 'user1');
    state = collector.getState();
    assert.deepStrictEqual(state.missing, ['command_output']);

    // Add command output
    collector.addEvidence('command_output', 'command output', 'user1');
    state = collector.getState();
    assert.strictEqual(state.missing.length, 0);
    assert.strictEqual(state.completed, true);
  });

  it('should handle minimum count requirements', () => {
    const requirements: EvidenceRequirement = {
      types: ['screenshot'],
      minimum_count: 3
    };

    const collector = new EvidenceCollector('step-1', requirements);

    // Add one screenshot
    collector.addEvidence('screenshot', 'screenshot 1', 'user1');
    assert.strictEqual(collector.isComplete(), false);

    // Add second screenshot
    collector.addEvidence('screenshot', 'screenshot 2', 'user1');
    assert.strictEqual(collector.isComplete(), false);

    // Add third screenshot
    collector.addEvidence('screenshot', 'screenshot 3', 'user1');
    assert.strictEqual(collector.isComplete(), true);
  });

  it('should remove evidence correctly', () => {
    const requirements: EvidenceRequirement = {
      types: ['screenshot', 'log']
    };

    const collector = new EvidenceCollector('step-1', requirements);

    // Add evidence
    const result1 = collector.addEvidence('screenshot', 'screenshot', 'user1');
    const result2 = collector.addEvidence('log', 'log', 'user1');

    assert.strictEqual(collector.getState().collected.length, 2);
    assert.strictEqual(collector.isComplete(), true);

    // Remove screenshot
    const removed = collector.removeEvidence(result1.evidence!.id);
    assert.strictEqual(removed, true);
    assert.strictEqual(collector.getState().collected.length, 1);
    assert.strictEqual(collector.isComplete(), false);

    // Try to remove non-existent evidence
    const notRemoved = collector.removeEvidence('non-existent-id');
    assert.strictEqual(notRemoved, false);
  });

  it('should get evidence by type', () => {
    const requirements: EvidenceRequirement = {
      types: ['screenshot', 'log']
    };

    const collector = new EvidenceCollector('step-1', requirements);

    collector.addEvidence('screenshot', 'screenshot 1', 'user1');
    collector.addEvidence('screenshot', 'screenshot 2', 'user1');
    collector.addEvidence('log', 'log 1', 'user1');

    const screenshots = collector.getEvidenceByType('screenshot');
    const logs = collector.getEvidenceByType('log');
    const photos = collector.getEvidenceByType('photo');

    assert.strictEqual(screenshots.length, 2);
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(photos.length, 0);
  });

  it('should generate collection summary', () => {
    const requirements: EvidenceRequirement = {
      types: ['screenshot', 'log', 'command_output']
    };

    const collector = new EvidenceCollector('step-1', requirements);

    collector.addEvidence('screenshot', 'screenshot 1', 'user1');
    collector.addEvidence('screenshot', 'screenshot 2', 'user1');
    collector.addEvidence('log', 'log 1', 'user1');

    const summary = collector.getSummary();

    assert.strictEqual(summary.total, 3);
    assert.strictEqual(summary.byType.screenshot, 2);
    assert.strictEqual(summary.byType.log, 1);
    assert.strictEqual(summary.byType.command_output, 0);
    assert.deepStrictEqual(summary.missing, ['command_output']);
    assert.strictEqual(summary.completed, false);
  });

  it('should validate entire collection', () => {
    const requirements: EvidenceRequirement = {
      types: ['screenshot'],
      validation_rules: [{
        type: 'screenshot',
        forbidden_content: ['secret']
      }]
    };

    const collector = new EvidenceCollector('step-1', requirements);

    // Add valid evidence
    collector.addEvidence('screenshot', 'valid content', 'user1');
    
    // Add invalid evidence (this should be rejected at add time)
    const invalidResult = collector.addEvidence('screenshot', 'contains secret data', 'user1');
    assert.strictEqual(invalidResult.success, false);

    // Validate collection
    const validation = collector.validateCollection();
    assert.strictEqual(validation.valid, true);
  });

  it('should export collection data', () => {
    const requirements: EvidenceRequirement = {
      types: ['screenshot']
    };

    const collector = new EvidenceCollector('step-1', requirements);
    collector.addEvidence('screenshot', 'screenshot', 'user1');

    const exported = collector.export();

    assert.strictEqual(exported.stepId, 'step-1');
    assert.strictEqual(exported.collected.length, 1);
    assert.ok(exported.summary);
    assert.ok(exported.timestamp instanceof Date);
  });

  it('should detect content formats correctly', () => {
    const requirements: EvidenceRequirement = {
      types: ['screenshot', 'log', 'file']
    };

    const collector = new EvidenceCollector('step-1', requirements);

    // Test PNG detection from filename
    const pngResult = collector.addEvidence('screenshot', 'content', 'user1', {
      filename: 'test.png'
    });
    assert.strictEqual(pngResult.evidence?.metadata.format, 'image/png');

    // Test JSON detection from content
    const jsonContent = JSON.stringify({ test: 'data' });
    const logResult = collector.addEvidence('log', jsonContent, 'user1');
    assert.strictEqual(logResult.evidence?.metadata.format, 'application/json');

    // Test base64 image detection
    const base64Result = collector.addEvidence('screenshot', 'data:image/jpeg;base64,abc123', 'user1');
    assert.strictEqual(base64Result.evidence?.metadata.format, 'image/jpeg');
  });
});

describe('Evidence Requirements Helper', () => {
  it('should create requirements from step configuration', () => {
    const requirements = createEvidenceRequirements(
      true,
      ['screenshot', 'log'],
      {
        minimumCount: 2,
        description: 'Custom description',
        autoCollect: true
      }
    );

    assert.ok(requirements);
    assert.deepStrictEqual(requirements.types, ['screenshot', 'log']);
    assert.strictEqual(requirements.minimum_count, 2);
    assert.strictEqual(requirements.description, 'Custom description');
    assert.strictEqual(requirements.auto_collect, true);
  });

  it('should return null when evidence not required', () => {
    const requirements = createEvidenceRequirements(false);
    assert.strictEqual(requirements, null);
  });

  it('should use defaults when minimal configuration provided', () => {
    const requirements = createEvidenceRequirements(true);

    assert.ok(requirements);
    assert.deepStrictEqual(requirements.types, ['screenshot']);
    assert.strictEqual(requirements.minimum_count, 1);
    assert.strictEqual(requirements.auto_collect, false);
  });
});