import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  childStepLabel,
  describeStepPosition,
  type PositionedStep,
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
