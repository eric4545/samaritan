import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  assertTmuxSessionResolvable,
  prepareFlatOperation,
} from '../../src/cli/commands/run';
import type { Operation } from '../../src/models/operation';
import { parseFixture } from '../fixtures/fixtures';

describe('assertTmuxSessionResolvable (run/resume fail fast)', () => {
  const op = (over: Partial<Operation>): Operation =>
    ({
      sessions: { work: {} },
      run: { tmux_session: '${TICKET}-${ENV}' },
      ...over,
    }) as Operation;
  const missing = /references undefined variable\(s\): TICKET/;

  it('throws when the name needs a variable the run lacks', () => {
    assert.throws(
      () => assertTmuxSessionResolvable(op({}), {}, undefined),
      missing,
    );
  });

  it('passes once the variable is defined (built-ins never need defining)', () => {
    assert.doesNotThrow(() =>
      assertTmuxSessionResolvable(op({}), { TICKET: 'T-1' }, undefined),
    );
    assert.doesNotThrow(() =>
      assertTmuxSessionResolvable(op({ run: {} }), {}, undefined),
    );
  });

  it('skips the check when an attached pane replaces sessions:', () => {
    assert.doesNotThrow(() => assertTmuxSessionResolvable(op({}), {}, '%3'));
  });

  it('skips the check when there are no sessions: to bootstrap', () => {
    assert.doesNotThrow(() =>
      assertTmuxSessionResolvable(op({ sessions: {} }), {}, undefined),
    );
  });
});

describe('prepareFlatOperation applies run.default_session', () => {
  it('after the variants.<env> merge, so a variant rollback gets it too', async () => {
    // Regression: applying the default to the authored steps BEFORE the
    // variant merge left `variants.sbx.rollback` entries without a session.
    const authored = await parseFixture('tmuxSessionName');
    authored.steps[0].variants = {
      sbx: { rollback: [{ command: 'undo-sbx' }] },
    };
    const { execOperation } = prepareFlatOperation(authored, 'sbx');
    const [first] = execOperation.steps;
    assert.strictEqual(first.session, 'work');
    assert.deepStrictEqual(first.rollback, [
      { command: 'undo-sbx', session: 'work' },
    ]);
    assert.strictEqual(execOperation.rollback?.steps[0].session, 'work');
  });
});
