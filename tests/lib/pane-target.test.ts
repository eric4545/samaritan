import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  checkPaneTarget,
  describePaneTarget,
  type PaneIdentity,
  paneMatchesTarget,
  parsePaneTarget,
  targetMismatchMessage,
  targetStatusLine,
} from '../../src/lib/pane-target';

// Per-step `target:` — the tmux window a step's command belongs in. A sidecar
// run attached to a `staging` window pasted a step meant for `production`
// with no warning (reproduced in real tmux before this check existed).

const pane = (session: string, windowName: string): PaneIdentity => ({
  session,
  windowName,
  displayName: `${session}:${windowName}.0`,
});

describe('parsePaneTarget', () => {
  it('a bare name is a window in any session', () => {
    assert.deepStrictEqual(parsePaneTarget('production'), {
      window: 'production',
    });
  });

  it('session:window splits on the FIRST colon', () => {
    assert.deepStrictEqual(parsePaneTarget('ops:production'), {
      session: 'ops',
      window: 'production',
    });
    assert.deepStrictEqual(parsePaneTarget('ops:db:primary'), {
      session: 'ops',
      window: 'db:primary',
    });
  });

  it('`:window` means any session; blank or `ops:` is no target', () => {
    assert.deepStrictEqual(parsePaneTarget(':production'), {
      window: 'production',
    });
    assert.strictEqual(parsePaneTarget(undefined), undefined);
    assert.strictEqual(parsePaneTarget('   '), undefined);
    assert.strictEqual(parsePaneTarget('ops:'), undefined);
  });
});

describe('paneMatchesTarget', () => {
  it('matches the window name exactly (case-sensitive)', () => {
    const spec = { window: 'production' };
    assert.ok(paneMatchesTarget(pane('ops', 'production'), spec));
    assert.ok(paneMatchesTarget(pane('work', 'production'), spec));
    assert.ok(!paneMatchesTarget(pane('ops', 'staging'), spec));
    assert.ok(!paneMatchesTarget(pane('ops', 'Production'), spec));
    assert.ok(!paneMatchesTarget(pane('ops', 'production-2'), spec));
  });

  it('with a session, both must match', () => {
    const spec = { session: 'ops', window: 'production' };
    assert.ok(paneMatchesTarget(pane('ops', 'production'), spec));
    assert.ok(!paneMatchesTarget(pane('work', 'production'), spec));
  });
});

describe('checkPaneTarget', () => {
  it('none without a target, or when the backend cannot name panes', () => {
    assert.deepStrictEqual(
      checkPaneTarget(undefined, true, pane('ops', 'staging')),
      { status: 'none' },
    );
    // Spawned `sessions:` windows (TmuxSession) are routed by `session:`.
    assert.deepStrictEqual(checkPaneTarget('production', false, undefined), {
      status: 'none',
    });
  });

  it('match / mismatch on the live window name', () => {
    assert.strictEqual(
      checkPaneTarget('production', true, pane('ops', 'production')).status,
      'match',
    );
    assert.strictEqual(
      checkPaneTarget('production', true, pane('ops', 'staging')).status,
      'mismatch',
    );
  });

  it('unknown when the pane names cannot be read — never a silent pass', () => {
    assert.strictEqual(
      checkPaneTarget('production', true, undefined).status,
      'unknown',
    );
  });
});

describe('messages', () => {
  it('describePaneTarget quotes the window (and session)', () => {
    assert.strictEqual(
      describePaneTarget({ window: 'production' }),
      'window "production"',
    );
    assert.strictEqual(
      describePaneTarget({ session: 'ops', window: 'production' }),
      'window "ops:production"',
    );
  });

  it('targetStatusLine: ✓ on a match, ⚠️ + [t] hint on a mismatch', () => {
    const ok = checkPaneTarget('production', true, pane('ops', 'production'));
    assert.match(
      targetStatusLine('production', ok) ?? '',
      /Run in window "production" — attached pane ops:production\.0 ✓/,
    );
    const bad = checkPaneTarget('production', true, pane('ops', 'staging'));
    const line = targetStatusLine('production', bad) ?? '';
    assert.match(line, /^⚠️/);
    assert.match(line, /in window "staging"/);
    assert.match(line, /\[t\] attaches the right pane/);
  });

  it('targetStatusLine without a pane just says where to run it', () => {
    assert.strictEqual(
      targetStatusLine('production', { status: 'none' }),
      '🎯 Run in window "production"',
    );
    assert.strictEqual(
      targetStatusLine(undefined, { status: 'none' }),
      undefined,
    );
  });

  it('targetMismatchMessage names both windows', () => {
    const bad = checkPaneTarget('production', true, pane('ops', 'staging'));
    assert.ok(bad.status === 'mismatch');
    const msg = targetMismatchMessage(bad);
    assert.match(msg, /belongs in window "production"/);
    assert.match(msg, /ops:staging\.0 is in window "staging"/);
    const unknown = checkPaneTarget('production', true, undefined);
    assert.ok(unknown.status === 'unknown');
    assert.match(targetMismatchMessage(unknown), /could not be read/);
  });
});
