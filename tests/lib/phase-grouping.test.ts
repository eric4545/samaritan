import assert from 'node:assert';
import { describe, it } from 'node:test';
import { groupByPhase } from '../../src/lib/phase-grouping';
import type { Step } from '../../src/models/operation';

function step(partial: Partial<Step> & { name: string }): Step {
  return { type: 'manual', ...partial } as Step;
}

describe('groupByPhase', () => {
  it('buckets standalone steps by their own phase', () => {
    const steps = [
      step({ name: 'pre', phase: 'preflight' }),
      step({ name: 'main', phase: 'flight' }),
      step({ name: 'post', phase: 'postflight' }),
      step({ name: 'default' }), // no phase -> flight
    ];

    const phases = groupByPhase(steps, (s) => s);

    assert.deepStrictEqual(
      phases.preflight.map((s) => s.name),
      ['pre'],
    );
    assert.deepStrictEqual(
      phases.flight.map((s) => s.name),
      ['main', 'default'],
    );
    assert.deepStrictEqual(
      phases.postflight.map((s) => s.name),
      ['post'],
    );
  });

  it('keeps a uses-block preflight local to the block (flight bucket)', () => {
    const g = { id: 'g1', name: 'Post-deploy Checks' };
    const steps = [
      step({ name: 'top-pre', phase: 'preflight' }),
      step({ name: 'top-main', phase: 'flight' }),
      // reused block near the end with its own preflight + flight steps
      step({ name: 'block-pre', phase: 'preflight', usesGroup: g }),
      step({ name: 'block-main', phase: 'flight', usesGroup: g }),
    ];

    const phases = groupByPhase(steps, (s) => s);

    // Only the TOP-LEVEL preflight hoists; the block's preflight stays with it.
    assert.deepStrictEqual(
      phases.preflight.map((s) => s.name),
      ['top-pre'],
    );
    // Block travels together into flight, contiguous and in document order.
    assert.deepStrictEqual(
      phases.flight.map((s) => s.name),
      ['top-main', 'block-pre', 'block-main'],
    );
  });

  it('places a pure-preflight uses-block into the preflight bucket', () => {
    const g = { id: 'g2' };
    const steps = [
      step({ name: 'main', phase: 'flight' }),
      step({ name: 'check-a', phase: 'preflight', usesGroup: g }),
      step({ name: 'check-b', phase: 'preflight', usesGroup: g }),
    ];

    const phases = groupByPhase(steps, (s) => s);

    assert.deepStrictEqual(
      phases.preflight.map((s) => s.name),
      ['check-a', 'check-b'],
    );
    assert.deepStrictEqual(
      phases.flight.map((s) => s.name),
      ['main'],
    );
  });

  it('routes a postflight-only block to the postflight bucket', () => {
    const g = { id: 'g3' };
    const steps = [
      step({ name: 'cleanup-a', phase: 'postflight', usesGroup: g }),
      step({ name: 'cleanup-b', phase: 'postflight', usesGroup: g }),
    ];

    const phases = groupByPhase(steps, (s) => s);

    assert.deepStrictEqual(
      phases.postflight.map((s) => s.name),
      ['cleanup-a', 'cleanup-b'],
    );
    assert.strictEqual(phases.flight.length, 0);
  });

  it('treats adjacent blocks with different ids as separate units', () => {
    const ga = { id: 'a' };
    const gb = { id: 'b' };
    const steps = [
      step({ name: 'a-pre', phase: 'preflight', usesGroup: ga }),
      step({ name: 'a-main', phase: 'flight', usesGroup: ga }),
      step({ name: 'b-pre', phase: 'preflight', usesGroup: gb }),
      step({ name: 'b-main', phase: 'flight', usesGroup: gb }),
    ];

    const phases = groupByPhase(steps, (s) => s);

    // Each block keeps its own preflight local; nothing hoists.
    assert.strictEqual(phases.preflight.length, 0);
    assert.deepStrictEqual(
      phases.flight.map((s) => s.name),
      ['a-pre', 'a-main', 'b-pre', 'b-main'],
    );
  });

  it('works with wrapped { step, stepNumber } entries', () => {
    const g = { id: 'g4' };
    const entries = [
      { step: step({ name: 'top-pre', phase: 'preflight' }), stepNumber: 1 },
      {
        step: step({ name: 'block-pre', phase: 'preflight', usesGroup: g }),
        stepNumber: 2,
      },
      {
        step: step({ name: 'block-main', phase: 'flight', usesGroup: g }),
        stepNumber: 3,
      },
    ];

    const phases = groupByPhase(entries, (e) => e.step);

    assert.deepStrictEqual(
      phases.preflight.map((e) => e.stepNumber),
      [1],
    );
    assert.deepStrictEqual(
      phases.flight.map((e) => e.stepNumber),
      [2, 3],
    );
  });
});
