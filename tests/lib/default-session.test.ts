import assert from 'node:assert';
import { describe, it } from 'node:test';
import { applyDefaultSession } from '../../src/lib/default-session';
import { parseFixture } from '../fixtures/fixtures';

describe('applyDefaultSession (run.default_session)', () => {
  it('fills session on top-level steps that have none, keeps explicit ones', async () => {
    const op = await parseFixture('tmuxSessionName');
    assert.strictEqual(
      op.steps[0].session,
      undefined,
      'parser leaves it unset',
    );
    applyDefaultSession(op);
    assert.strictEqual(op.steps[0].session, 'work');
    assert.strictEqual(op.steps[1].session, 'aux', 'explicit session wins');
  });

  it('a sub-step without session gets the default, not its parent session', async () => {
    const op = await parseFixture('tmuxSessionName');
    applyDefaultSession(op);
    assert.strictEqual(op.steps[1].sub_steps?.[0].session, 'work');
  });

  it('step rollback inherits its step session; global rollback gets the default', async () => {
    const op = await parseFixture('tmuxSessionName');
    op.steps[0].session = 'aux';
    applyDefaultSession(op);
    const stepRb = op.steps[0].rollback;
    assert.ok(Array.isArray(stepRb));
    assert.strictEqual(stepRb[0].session, 'aux');
    assert.strictEqual(op.rollback?.steps[0].session, 'work');
  });

  it('is a no-op without run.default_session', async () => {
    const op = await parseFixture('tmuxSessionName');
    delete op.run?.default_session;
    applyDefaultSession(op);
    assert.strictEqual(op.steps[0].session, undefined);
    assert.strictEqual(op.rollback?.steps[0].session, undefined);
  });
});
