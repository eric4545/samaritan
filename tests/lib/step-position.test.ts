import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  childStepLabel,
  describeStepPosition,
  type PositionedStep,
  resolveStepPick,
} from '../../src/lib/step-position';

// Flat run order for: 1 prep, 2 deploy { 2.1 upload, 2.2 review { 2.2.1 } }, 3
const STEPS: PositionedStep[] = [
  { label: '1', name: 'prep' },
  { label: '2', name: 'deploy' },
  { label: '2.1', name: 'upload' },
  { label: '2.2', name: 'review-upload' },
  { label: '2.2.1', name: 'nested-check' },
  { label: '3', name: 'finish' },
];

describe('childStepLabel', () => {
  it('numbers top-level steps from 1', () => {
    assert.strictEqual(childStepLabel('', 0), '1');
    assert.strictEqual(childStepLabel('', 9), '10');
  });

  it('uses the single-env manual dotted scheme for sub-steps', () => {
    assert.strictEqual(childStepLabel('10', 1), '10.2');
    assert.strictEqual(childStepLabel('10.2', 0), '10.2.1');
  });
});

describe('describeStepPosition', () => {
  it('heading carries the manual number and the flat progress position', () => {
    assert.strictEqual(
      describeStepPosition(STEPS, 3).heading,
      '[Step 2.2 · 4/6]',
    );
  });

  it('names the parent section of a sub-step', () => {
    assert.strictEqual(describeStepPosition(STEPS, 3).parent, 'Step 2: deploy');
    assert.strictEqual(
      describeStepPosition(STEPS, 4).parent,
      'Step 2.2: review-upload',
    );
    assert.strictEqual(describeStepPosition(STEPS, 1).parent, undefined);
  });

  it('shows the next step and how many remain', () => {
    const pos = describeStepPosition(STEPS, 3);
    assert.strictEqual(pos.next, 'Step 2.2.1: nested-check');
    assert.strictEqual(pos.remaining, 2);
  });

  it('skips env-filtered steps when computing next/remaining', () => {
    const steps = STEPS.map((s) =>
      s.label === '2.2.1' ? { ...s, filteredByEnv: true } : s,
    );
    const pos = describeStepPosition(steps, 3);
    assert.strictEqual(pos.next, 'Step 3: finish');
    assert.strictEqual(pos.remaining, 1);
  });

  it('has no next step on the last step', () => {
    const pos = describeStepPosition(STEPS, 5);
    assert.strictEqual(pos.next, undefined);
    assert.strictEqual(pos.remaining, 0);
  });
});

describe('resolveStepPick — [b]/[j] by position, manual number or name', () => {
  // Pickable: everything after "deploy" (flat positions 3..6).
  const allowed = [2, 3, 4, 5];

  it('keeps a plain number as the flat position (unchanged behaviour)', () => {
    assert.deepStrictEqual(resolveStepPick('4', STEPS, allowed), { index: 3 });
  });

  it('accepts a dotted manual number (2.2 is position 4, not 2)', () => {
    assert.deepStrictEqual(resolveStepPick('2.2', STEPS, allowed), {
      index: 3,
    });
    assert.deepStrictEqual(resolveStepPick('2.2.1', STEPS, allowed), {
      index: 4,
    });
  });

  it('accepts a unique, case-insensitive name fragment', () => {
    assert.deepStrictEqual(resolveStepPick('Nested', STEPS, allowed), {
      index: 4,
    });
  });

  it('refuses an ambiguous name and lists the matches', () => {
    const pick = resolveStepPick('upload', STEPS, allowed);
    assert.ok('error' in pick);
    assert.match(pick.error, /2\.1 upload/);
    assert.match(pick.error, /2\.2 review-upload/);
  });

  it('refuses steps outside the allowed range and unknown input', () => {
    assert.ok('error' in resolveStepPick('1', STEPS, allowed));
    assert.ok('error' in resolveStepPick('2.1.9', STEPS, allowed));
    assert.ok('error' in resolveStepPick('nope', STEPS, allowed));
    // A label outside the range is refused even though it exists.
    assert.ok('error' in resolveStepPick('prep', STEPS, allowed));
  });
});
