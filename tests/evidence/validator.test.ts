import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  validateEvidence,
  validateStepEvidence,
} from '../../src/evidence/validator';
import type {
  EvidenceItem,
  EvidenceValidationRule,
} from '../../src/models/evidence';
import type { EvidenceType } from '../../src/models/operation';

describe('Evidence Validator', () => {
  it('should validate screenshot evidence successfully', () => {
    const evidence: EvidenceItem = {
      id: 'test-1',
      step_id: 'step-1',
      type: 'screenshot',
      content:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      timestamp: new Date(),
      operator: 'test-user',
      automatic: false,
      validated: false,
      metadata: {
        size: 150,
        format: 'image/png',
        source: 'manual',
        resolution: '1920x1080',
      },
    };

    const result = validateEvidence(evidence);

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
    assert.ok(result.metadata.checksum);
  });

  it('should reject oversized evidence', () => {
    const evidence: EvidenceItem = {
      id: 'test-2',
      step_id: 'step-1',
      type: 'screenshot',
      content: 'x'.repeat(15 * 1024 * 1024), // 15MB, exceeds default 10MB limit
      timestamp: new Date(),
      operator: 'test-user',
      automatic: false,
      validated: false,
      metadata: {
        size: 15 * 1024 * 1024,
        format: 'image/png',
        source: 'manual',
      },
    };

    const result = validateEvidence(evidence);

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('exceeds maximum')));
  });

  it('should reject invalid file formats', () => {
    const evidence: EvidenceItem = {
      id: 'test-3',
      step_id: 'step-1',
      type: 'screenshot',
      content: 'test content',
      timestamp: new Date(),
      operator: 'test-user',
      automatic: false,
      validated: false,
      metadata: {
        size: 100,
        format: 'application/pdf', // Invalid for screenshot
        source: 'manual',
      },
    };

    const result = validateEvidence(evidence);

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('not allowed')));
  });

  it('should detect forbidden content in logs', () => {
    const evidence: EvidenceItem = {
      id: 'test-4',
      step_id: 'step-1',
      type: 'log',
      content: 'User login successful. Session token: abc123secret',
      timestamp: new Date(),
      operator: 'test-user',
      automatic: true,
      validated: false,
      metadata: {
        size: 50,
        format: 'text/plain',
        source: 'automatic',
      },
    };

    const result = validateEvidence(evidence);

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('forbidden terms')));
  });

  it('should validate with custom rules', () => {
    const customRules: EvidenceValidationRule[] = [
      {
        type: 'screenshot',
        max_size: 1024, // 1KB limit
        allowed_formats: ['image/png'],
        min_resolution: '1920x1080',
      },
    ];

    const evidence: EvidenceItem = {
      id: 'test-5',
      step_id: 'step-1',
      type: 'screenshot',
      content: 'x'.repeat(2048), // 2KB, exceeds custom limit
      timestamp: new Date(),
      operator: 'test-user',
      automatic: false,
      validated: false,
      metadata: {
        size: 2048,
        format: 'image/png',
        source: 'manual',
        resolution: '800x600', // Below minimum
      },
    };

    const result = validateEvidence(evidence, customRules);

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('exceeds maximum')));
    assert.ok(result.warnings.some((w) => w.includes('below minimum')));
  });

  it('should validate step evidence collection', () => {
    const evidence: EvidenceItem[] = [
      {
        id: 'test-6',
        step_id: 'step-1',
        type: 'screenshot',
        content: 'test screenshot content',
        timestamp: new Date(),
        operator: 'test-user',
        automatic: false,
        validated: false,
        metadata: {
          size: 100,
          format: 'image/png',
          source: 'manual',
        },
      },
    ];

    const requiredTypes: EvidenceType[] = ['screenshot', 'log'];
    const result = validateStepEvidence(evidence, requiredTypes);

    assert.strictEqual(result.valid, false);
    assert.ok(
      result.errors.some((e) =>
        e.includes('Missing required evidence types: log'),
      ),
    );
  });

  it('should validate complete step evidence collection', () => {
    const evidence: EvidenceItem[] = [
      {
        id: 'test-7',
        step_id: 'step-1',
        type: 'screenshot',
        content: 'test screenshot content',
        timestamp: new Date(),
        operator: 'test-user',
        automatic: false,
        validated: false,
        metadata: {
          size: 100,
          format: 'image/png',
          source: 'manual',
        },
      },
      {
        id: 'test-8',
        step_id: 'step-1',
        type: 'log',
        content: 'Application started successfully',
        timestamp: new Date(),
        operator: 'test-user',
        automatic: true,
        validated: false,
        metadata: {
          size: 50,
          format: 'text/plain',
          source: 'automatic',
        },
      },
    ];

    const requiredTypes: EvidenceType[] = ['screenshot', 'log'];
    const result = validateStepEvidence(evidence, requiredTypes);

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
  });

  it('should validate video evidence duration', () => {
    const evidence: EvidenceItem = {
      id: 'test-9',
      step_id: 'step-1',
      type: 'video',
      content: 'mock video content',
      timestamp: new Date(),
      operator: 'test-user',
      automatic: false,
      validated: false,
      metadata: {
        size: 1000,
        format: 'video/mp4',
        source: 'manual',
        duration: 400, // 400 seconds, exceeds default 300s limit
      },
    };

    const result = validateEvidence(evidence);

    assert.strictEqual(result.valid, false);
    assert.ok(
      result.errors.some(
        (e) => e.includes('duration') && e.includes('exceeds'),
      ),
    );
  });

  it('should handle empty content validation', () => {
    const evidence: EvidenceItem = {
      id: 'test-10',
      step_id: 'step-1',
      type: 'log',
      content: '',
      timestamp: new Date(),
      operator: 'test-user',
      automatic: false,
      validated: false,
      metadata: {
        size: 0,
        format: 'text/plain',
        source: 'manual',
      },
    };

    const result = validateEvidence(evidence);

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('empty')));
  });

  it('should detect JSON format in logs', () => {
    const jsonContent = JSON.stringify({
      timestamp: '2023-01-01T00:00:00Z',
      level: 'INFO',
      message: 'Application started',
    });

    const evidence: EvidenceItem = {
      id: 'test-11',
      step_id: 'step-1',
      type: 'log',
      content: jsonContent,
      timestamp: new Date(),
      operator: 'test-user',
      automatic: true,
      validated: false,
      metadata: {
        size: jsonContent.length,
        format: 'text/plain',
        source: 'automatic',
      },
    };

    const result = validateEvidence(evidence);

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.metadata.format, 'application/json');
  });
});
