import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  evidenceGateMessage,
  runCommandHeader,
  type StepActionContext,
  sidecarFlowLegend,
  stepActionHints,
  unavailableKeyMessage,
} from '../../src/lib/step-actions';

const ctx = (over: Partial<StepActionContext> = {}): StepActionContext => ({
  sidecar: true,
  armed: false,
  hasCommand: true,
  hasExpect: true,
  paneAttached: true,
  hasEvidence: false,
  canGoBack: true,
  canJump: true,
  hasGlobalRollback: true,
  ...over,
});
const keys = (hints: Array<{ key: string }>): string[] =>
  hints.map((h) => h.key);

describe('stepActionHints — compact bar + ? more', () => {
  it('sidecar with a pane: the paste → verify → done flow, then ?', () => {
    const { primary, more } = stepActionHints(ctx());
    assert.deepStrictEqual(keys(primary), ['↵', 'p', 'v', 's', 'r', '?']);
    assert.deepStrictEqual(keys(more), [
      'c',
      'n',
      'e',
      't',
      'b',
      'j',
      'g',
      'abort',
    ]);
  });

  it('puts [y] first once a paste is armed', () => {
    assert.deepStrictEqual(
      keys(stepActionHints(ctx({ armed: true })).primary).slice(0, 2),
      ['y', '↵'],
    );
  });

  it('shows [t] attach in the bar while no pane is attached', () => {
    const { primary, more } = stepActionHints(ctx({ paneAttached: false }));
    assert.ok(keys(primary).includes('t'));
    assert.ok(!keys(more).includes('t'));
  });

  it('manual mode (no sidecar): no p/t/y anywhere', () => {
    const { primary, more } = stepActionHints(
      ctx({ sidecar: false, armed: true, paneAttached: false }),
    );
    assert.deepStrictEqual(keys(primary), ['↵', 'v', 's', 'r', '?']);
    assert.ok(!keys(more).includes('t'));
  });

  it('every key the bar used to show is still reachable (bar or ?)', () => {
    const { primary, more } = stepActionHints(ctx({ hasEvidence: true }));
    const all = new Set([...keys(primary), ...keys(more)]);
    for (const k of ['↵', 'c', 'n', 'e', 'x', 'v', 't', 'p', 'b', 'j', 's'])
      assert.ok(all.has(k), `missing ${k}`);
    for (const k of ['r', 'g', 'abort']) assert.ok(all.has(k), `missing ${k}`);
  });

  it('hides context-less keys (no command, first/last step, no evidence)', () => {
    const { primary, more } = stepActionHints(
      ctx({
        hasCommand: false,
        hasExpect: false,
        canGoBack: false,
        canJump: false,
        hasGlobalRollback: false,
      }),
    );
    const all = [...keys(primary), ...keys(more)];
    for (const k of ['p', 'c', 'v', 'b', 'j', 'g', 'x'])
      assert.ok(!all.includes(k), `${k} should be hidden`);
  });
});

describe('stepActionHints — required evidence', () => {
  it('moves [e] into the bar while required evidence is missing', () => {
    const { primary, more } = stepActionHints(ctx({ evidenceMissing: true }));
    assert.deepStrictEqual(keys(primary), ['↵', 'p', 'v', 'e', 's', 'r', '?']);
    assert.ok(!keys(more).includes('e'), '[e] is listed once');
  });

  it('keeps [e] under ? once evidence exists or is not required', () => {
    for (const over of [{ evidenceMissing: false }, {}]) {
      const { primary, more } = stepActionHints(ctx(over));
      assert.ok(!keys(primary).includes('e'));
      assert.ok(keys(more).includes('e'));
    }
  });
});

describe('evidenceGateMessage', () => {
  it('names the one-keystroke pane capture when a pane is attached', () => {
    const msg = evidenceGateMessage(true);
    assert.match(msg, /\[e\] then ↵ to capture the pane output/);
    assert.ok(!msg.includes('typed text is fine'));
  });

  it('falls back to typed text without a pane', () => {
    assert.match(evidenceGateMessage(false), /typed text is fine/);
  });
});

describe('sidecarFlowLegend — the p → y → ↵ flow, spelled out', () => {
  it('spells the flow out for a sidecar step with a command and a pane', () => {
    const legend = sidecarFlowLegend(ctx());
    assert.match(
      legend ?? '',
      /p pastes .* → y runs it \(verify follows\) → ↵ marks the step done/,
    );
  });

  it('omits "verify follows" for a step without expect', () => {
    assert.ok(
      !sidecarFlowLegend(ctx({ hasExpect: false }))?.includes('verify'),
    );
  });

  it('is undefined when the flow does not apply', () => {
    for (const over of [
      { sidecar: false },
      { hasCommand: false },
      { paneAttached: false },
    ])
      assert.strictEqual(sidecarFlowLegend(ctx(over)), undefined);
  });
});

describe('runCommandHeader', () => {
  it('points at [p] when a pane is attached', () => {
    assert.strictEqual(
      runCommandHeader({ paneTarget: 'tmux pane ux:0.0' }),
      'Command — [p] pastes it into tmux pane ux:0.0:',
    );
    assert.strictEqual(
      runCommandHeader({ paneTarget: 'tmux pane %3', script: true }),
      'Run — [p] pastes it into tmux pane %3:',
    );
  });

  it('says how to attach when no pane is attached', () => {
    assert.strictEqual(
      runCommandHeader({}),
      'Run this command in your terminal ([t] attaches a pane for [p]/[v]):',
    );
    assert.strictEqual(
      runCommandHeader({ script: true }),
      'Run this in your terminal ([t] attaches a pane for [p]/[v]):',
    );
  });
});

describe('unavailableKeyMessage — a known key never falls through to done', () => {
  it('[v] on a step without expect says there is nothing to verify', () => {
    const msg = unavailableKeyMessage('v', ctx({ hasExpect: false }));
    assert.match(msg ?? '', /no expect/);
    assert.match(msg ?? '', /\[e\] captures evidence/);
    assert.match(msg ?? '', /not marked done/);
  });

  it('covers keys whose action does not apply here', () => {
    assert.match(
      unavailableKeyMessage('p', ctx({ sidecar: false })) ?? '',
      /sidecar/,
    );
    assert.match(
      unavailableKeyMessage('p', ctx({ hasCommand: false })) ?? '',
      /no command/,
    );
    assert.match(
      unavailableKeyMessage('c', ctx({ hasCommand: false })) ?? '',
      /no command/,
    );
    assert.match(
      unavailableKeyMessage('x', ctx({ hasEvidence: false })) ?? '',
      /no evidence/,
    );
    assert.match(
      unavailableKeyMessage('b', ctx({ canGoBack: false })) ?? '',
      /first step/,
    );
    assert.match(
      unavailableKeyMessage('j', ctx({ canJump: false })) ?? '',
      /last step/,
    );
    assert.match(
      unavailableKeyMessage('g', ctx({ hasGlobalRollback: false })) ?? '',
      /no operation-level rollback/,
    );
  });

  it('returns undefined for done/skip/rollback and free text', () => {
    for (const k of ['', 's', 'r', 'all good']) {
      assert.strictEqual(unavailableKeyMessage(k, ctx()), undefined);
    }
  });
});
