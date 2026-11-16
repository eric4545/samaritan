import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  childStepLabel,
  describeStepPosition,
  multiEnvStepLabel,
  type PositionedStep,
  renderStepPickerRows,
  resolveStepPick,
  stepRef,
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

describe("resolveStepPick — one number: the manual's", () => {
  // Pickable: everything after "deploy" (2.1, 2.2, 2.2.1, 3).
  const allowed = [2, 3, 4, 5];

  it('a plain number is the manual step number, never the flat position', () => {
    // "3" is Step 3 (the 6th row), not the 3rd row (2.1).
    assert.deepStrictEqual(resolveStepPick('3', STEPS, allowed), { index: 5 });
  });

  it('accepts a dotted manual number', () => {
    assert.deepStrictEqual(resolveStepPick('2.2', STEPS, allowed), {
      index: 3,
    });
    assert.deepStrictEqual(resolveStepPick('2.2.1', STEPS, allowed), {
      index: 4,
    });
  });

  it('accepts the multi-env manual number of the same step (2b, 2b1)', () => {
    assert.strictEqual(multiEnvStepLabel('2.2'), '2b');
    assert.strictEqual(multiEnvStepLabel('2.2.1'), '2b1');
    assert.strictEqual(multiEnvStepLabel('1.2.1.1.3'), '1b1a3');
    assert.deepStrictEqual(resolveStepPick('2b', STEPS, allowed), { index: 3 });
    assert.deepStrictEqual(resolveStepPick('2B1', STEPS, allowed), {
      index: 4,
    });
  });

  it('accepts text copied from the heading or the manual', () => {
    assert.deepStrictEqual(resolveStepPick('Step 2.1:', STEPS, allowed), {
      index: 2,
    });
  });

  it('accepts an exact name, else a unique case-insensitive fragment', () => {
    assert.deepStrictEqual(resolveStepPick('Nested', STEPS, allowed), {
      index: 4,
    });
    // "upload" is also inside "review-upload": the exact name wins.
    assert.deepStrictEqual(resolveStepPick('upload', STEPS, allowed), {
      index: 2,
    });
  });

  it('refuses an ambiguous name and lists the matches', () => {
    const pick = resolveStepPick('load', STEPS, allowed);
    assert.ok('error' in pick);
    assert.match(pick.error, /2\.1 upload/);
    assert.match(pick.error, /2\.2 review-upload/);
  });

  it('says which step a number outside the list is, or that there is none', () => {
    const outside = resolveStepPick('1', STEPS, allowed);
    assert.ok('error' in outside);
    assert.match(outside.error, /Step 1: prep is not one of the steps listed/);
    const none = resolveStepPick('2.1.9', STEPS, allowed);
    assert.ok('error' in none);
    assert.match(none.error, /There is no Step 2\.1\.9/);
    assert.ok('error' in resolveStepPick('nope', STEPS, allowed));
    assert.ok('error' in resolveStepPick('prep', STEPS, allowed));
  });

  it('never treats digits as a name fragment', () => {
    const steps: PositionedStep[] = [
      { label: '1', name: 'open port 14' },
      { label: '2', name: 'close' },
    ];
    const pick = resolveStepPick('14', steps, [0, 1]);
    assert.ok('error' in pick);
    assert.match(pick.error, /There is no Step 14/);
  });
});

describe('renderStepPickerRows / stepRef', () => {
  it('lists one number per row: the manual number, aligned', () => {
    assert.deepStrictEqual(
      renderStepPickerRows(STEPS, [1, 4], (k) => (k === 1 ? 'completed' : '')),
      ['      2      deploy  (completed)', '      2.2.1  nested-check'],
    );
  });

  it('refers to a step by manual number and name', () => {
    assert.strictEqual(stepRef(STEPS, 3), 'Step 2.2: review-upload');
  });
});
