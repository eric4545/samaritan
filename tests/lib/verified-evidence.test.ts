import assert from 'node:assert';
import { describe, it } from 'node:test';
import { buildVerifiedEvidenceItem } from '../../src/lib/verified-evidence';

describe('buildVerifiedEvidenceItem', () => {
  it('builds a validated, automatic command_output item from verified output', () => {
    const output = 'deployment.apps/web created\npod/web-0  1/1  Running';
    const item = buildVerifiedEvidenceItem(2, output, 'alice');

    assert.strictEqual(item.type, 'command_output');
    assert.strictEqual(item.step_id, '2');
    assert.strictEqual(item.content, output);
    assert.strictEqual(item.operator, 'alice');
    assert.strictEqual(item.automatic, true);
    assert.strictEqual(item.validated, true);
    assert.strictEqual(item.metadata.source, 'verify');
    assert.strictEqual(item.metadata.size, Buffer.byteLength(output, 'utf-8'));
    assert.ok(item.id, 'has a generated id');
    assert.ok(item.timestamp instanceof Date);
  });

  it('gives each captured item a distinct id', () => {
    const a = buildVerifiedEvidenceItem(0, 'x', 'op');
    const b = buildVerifiedEvidenceItem(0, 'x', 'op');
    assert.notStrictEqual(a.id, b.id);
  });
});
