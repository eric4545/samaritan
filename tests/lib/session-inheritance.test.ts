import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  inheritSubStepSessions,
  withInheritedSessions,
} from '../../src/lib/session-inheritance';
import type { Step } from '../../src/models/operation';

const step = (name: string, more: Partial<Step> = {}): Step =>
  ({ name, type: 'manual', ...more }) as Step;

describe('inheritSubStepSessions', () => {
  it('a sub-step with no session runs in its parent session', () => {
    const [parent] = inheritSubStepSessions([
      step('Setup', { session: 'ops', sub_steps: [step('Check')] }),
    ]);
    assert.strictEqual(parent.sub_steps?.[0].session, 'ops');
  });

  it('an explicit sub-step session wins over the inherited one', () => {
    const [parent] = inheritSubStepSessions([
      step('Setup', {
        session: 'ops',
        sub_steps: [step('Local', { session: 'local' })],
      }),
    ]);
    assert.strictEqual(parent.sub_steps?.[0].session, 'local');
  });

  it('a grandchild inherits from its NEAREST ancestor with a session', () => {
    const [parent] = inheritSubStepSessions([
      step('Setup', {
        session: 'ops',
        sub_steps: [
          step('Group', { sub_steps: [step('Leaf')] }),
          step('Other', { session: 'db', sub_steps: [step('Leaf 2')] }),
        ],
      }),
    ]);
    assert.strictEqual(parent.sub_steps?.[0].session, 'ops');
    assert.strictEqual(parent.sub_steps?.[0].sub_steps?.[0].session, 'ops');
    assert.strictEqual(parent.sub_steps?.[1].sub_steps?.[0].session, 'db');
  });

  it('a top-level step without a session is left on the default pane', () => {
    const steps = [step('Top', { sub_steps: [step('Child')] })];
    const out = inheritSubStepSessions(steps);
    assert.strictEqual(out, steps, 'nothing to inherit: same array back');
    assert.strictEqual(out[0].session, undefined);
    assert.strictEqual(out[0].sub_steps?.[0].session, undefined);
  });

  it('never mutates the authored steps and adds no stray keys', () => {
    const child = step('Check', { command: 'echo hi' });
    const steps = [step('Setup', { session: 'ops', sub_steps: [child] })];
    const out = inheritSubStepSessions(steps);
    assert.strictEqual(child.session, undefined, 'authored child untouched');
    assert.notStrictEqual(out[0].sub_steps?.[0], child);
    assert.ok(
      !Object.hasOwn(out[0].sub_steps?.[0] ?? {}, 'sub_steps'),
      'a leaf gets no sub_steps key',
    );
  });

  it('is idempotent', () => {
    const steps = [
      step('Setup', { session: 'ops', sub_steps: [step('Check')] }),
    ];
    const once = inheritSubStepSessions(steps);
    assert.strictEqual(inheritSubStepSessions(once), once);
  });

  it('withInheritedSessions returns the same operation when nothing changes', () => {
    const operation = { steps: [step('Top')] };
    assert.strictEqual(withInheritedSessions(operation), operation);
  });
});
