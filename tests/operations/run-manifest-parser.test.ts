import assert from 'node:assert';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  computeFileHash,
  parseRunManifest,
  RunManifestValidationError,
} from '../../src/operations/run-manifest-parser';

const FIXTURE = join(
  process.cwd(),
  'tests/fixtures/runs/staging-2025-10-16-v1.yaml',
);

describe('parseRunManifest', () => {
  it('parses required fields correctly', () => {
    const manifest = parseRunManifest(FIXTURE);
    assert.strictEqual(manifest.id, 'staging-2025-10-16-v1');
    assert.strictEqual(manifest.environment, 'staging');
    assert.strictEqual(manifest.status, 'completed');
    assert.strictEqual(manifest.operator, 'ops@example.com');
    assert.strictEqual(manifest.operation_commit, 'abc123def456');
  });

  it('parses timestamps', () => {
    const manifest = parseRunManifest(FIXTURE);
    assert.ok(manifest.started_at?.startsWith('2025-10-16'));
    assert.ok(manifest.completed_at?.startsWith('2025-10-16'));
  });

  it('parses step evidence', () => {
    const manifest = parseRunManifest(FIXTURE);
    assert.ok(manifest.steps, 'has steps');
    assert.ok(manifest.steps!['deploy-application'], 'has deploy-application');
    const step = manifest.steps!['deploy-application'];
    assert.strictEqual(step.evidence.length, 2);
    assert.strictEqual(step.evidence[0].type, 'command_output');
    assert.ok(step.evidence[0].content?.includes('web-server created'));
    assert.strictEqual(step.evidence[1].type, 'screenshot');
  });

  it('resolves file paths to absolute', () => {
    const manifest = parseRunManifest(FIXTURE);
    const step = manifest.steps!['deploy-application'];
    const screenshotItem = step.evidence[1];
    assert.ok(screenshotItem.file, 'has file path');
    assert.ok(screenshotItem.file!.startsWith('/'), 'file path is absolute');
  });

  it('includes orphaned step evidence', () => {
    const manifest = parseRunManifest(FIXTURE);
    assert.ok(manifest.steps!['orphaned-step'], 'includes orphaned step');
    const orphaned = manifest.steps!['orphaned-step'];
    assert.strictEqual(orphaned.evidence[0].type, 'command_output');
  });

  it('throws RunManifestValidationError for missing required fields', () => {
    const fixture = join(
      process.cwd(),
      'tests/fixtures/runs/invalid/missing-required-fields.yaml',
    );
    assert.throws(() => parseRunManifest(fixture), RunManifestValidationError);
  });

  it('throws for invalid status value', () => {
    const fixture = join(
      process.cwd(),
      'tests/fixtures/runs/invalid/bad-status.yaml',
    );
    assert.throws(() => parseRunManifest(fixture), RunManifestValidationError);
  });
});

describe('computeFileHash', () => {
  it('returns sha256: prefixed hash', () => {
    const hash = computeFileHash(FIXTURE);
    assert.match(hash, /^sha256:[a-f0-9]{64}$/);
  });

  it('returns different hashes for different files', () => {
    const h1 = computeFileHash(FIXTURE);
    const h2 = computeFileHash(
      join(process.cwd(), 'tests/fixtures/operations/valid/minimal.yaml'),
    );
    assert.notStrictEqual(h1, h2);
  });

  it('returns same hash for same file read twice', () => {
    const h1 = computeFileHash(FIXTURE);
    const h2 = computeFileHash(FIXTURE);
    assert.strictEqual(h1, h2);
  });
});
