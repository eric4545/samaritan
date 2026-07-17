import assert from 'node:assert';
import { describe, it } from 'node:test';
import { mergeStepRecords } from '../../src/lib/report-merge';
import type { StepRecord } from '../../src/models/step-record';

function step(
  index: number,
  name: string,
  status: StepRecord['status'],
): StepRecord {
  return { index, name, status, commands: [], notes: [], evidence: [] };
}

describe('report merge: mergeStepRecords', () => {
  it('prefers an executed record over a skipped one and attributes the operator', () => {
    // Alice ran step 1 and skipped step 2; Bob did the opposite.
    const alice = {
      operator: 'alice',
      steps: [
        step(0, 'Alice deploy', 'completed'),
        step(1, 'Bob migrate', 'skipped'),
      ],
    };
    const bob = {
      operator: 'bob',
      steps: [
        step(0, 'Alice deploy', 'skipped'),
        step(1, 'Bob migrate', 'completed'),
      ],
    };

    const merged = mergeStepRecords([alice, bob]);

    assert.strictEqual(merged.length, 2);
    assert.strictEqual(merged[0].status, 'completed');
    assert.strictEqual(merged[0].executed_by, 'alice');
    assert.strictEqual(merged[1].status, 'completed');
    assert.strictEqual(merged[1].executed_by, 'bob');
  });

  it('does not attribute an operator to a step everyone skipped', () => {
    const a = { operator: 'alice', steps: [step(0, 'Shared', 'skipped')] };
    const b = { operator: 'bob', steps: [step(0, 'Shared', 'skipped')] };

    const merged = mergeStepRecords([a, b]);

    assert.strictEqual(merged[0].status, 'skipped');
    assert.strictEqual(merged[0].executed_by, undefined);
  });

  it('ranks completed > failed > skipped > pending', () => {
    const a = { operator: 'alice', steps: [step(0, 'S', 'failed')] };
    const b = { operator: 'bob', steps: [step(0, 'S', 'completed')] };
    const c = { operator: 'carol', steps: [step(0, 'S', 'pending')] };

    const merged = mergeStepRecords([a, c, b]);

    assert.strictEqual(merged[0].status, 'completed');
    assert.strictEqual(merged[0].executed_by, 'bob');
  });

  it('sorts merged steps by index', () => {
    const a = {
      operator: 'alice',
      steps: [step(2, 'C', 'completed'), step(0, 'A', 'completed')],
    };
    const b = { operator: 'bob', steps: [step(1, 'B', 'completed')] };

    const merged = mergeStepRecords([a, b]);

    assert.deepStrictEqual(
      merged.map((s) => s.index),
      [0, 1, 2],
    );
  });
});
