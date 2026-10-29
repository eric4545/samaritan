import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  runCommandHeader,
  type StepActionContext,
  stepActionHints,
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
