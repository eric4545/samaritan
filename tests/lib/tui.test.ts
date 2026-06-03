import assert from 'node:assert';
import { describe, it } from 'node:test';
import { SessionState } from '../../src/lib/session-state';
import { interpolateExpect } from '../../src/lib/tui';

function makeState(vars: Record<string, string>): SessionState {
  const state = new SessionState();
  for (const [k, v] of Object.entries(vars)) {
    state.capture(k, v);
  }
  return state;
}

describe('interpolateExpect — var substitution', () => {
  it('string shorthand interpolates', () => {
    const state = makeState({ STATUS: 'ok' });
    const result = interpolateExpect('${STATUS}', state);
    assert.strictEqual(result, 'ok');
  });

  it('contains substitutes ${VAR}', () => {
    const state = makeState({ WANT: 'Running' });
    const result = interpolateExpect({ contains: '${WANT}' }, state);
    assert.deepStrictEqual((result as any).contains, 'Running');
  });

  it('not_contains substitutes ${VAR}', () => {
    const state = makeState({ BANNED: 'Error' });
    const result = interpolateExpect({ not_contains: '${BANNED}' }, state);
    assert.deepStrictEqual((result as any).not_contains, 'Error');
  });

  it('equals substitutes ${VAR}', () => {
    const state = makeState({ EXPECTED: 'healthy' });
    const result = interpolateExpect({ equals: '${EXPECTED}' }, state);
    assert.deepStrictEqual((result as any).equals, 'healthy');
  });

  it('matches substitutes ${VAR}', () => {
    const state = makeState({ PAT: 'sha256:[a-f0-9]+' });
    const result = interpolateExpect({ matches: '${PAT}' }, state);
    assert.deepStrictEqual((result as any).matches, 'sha256:[a-f0-9]+');
  });

  it('any_line_contains substitutes ${VAR}', () => {
    const state = makeState({ LINE: 'Ready' });
    const result = interpolateExpect({ any_line_contains: '${LINE}' }, state);
    assert.deepStrictEqual((result as any).any_line_contains, 'Ready');
  });

  it('no_line_contains substitutes ${VAR}', () => {
    const state = makeState({ BAD: 'CrashLoopBackOff' });
    const result = interpolateExpect({ no_line_contains: '${BAD}' }, state);
    assert.deepStrictEqual(
      (result as any).no_line_contains,
      'CrashLoopBackOff',
    );
  });

  it('all_lines_match substitutes ${VAR}', () => {
    const state = makeState({ PAT: 'Running|Ready' });
    const result = interpolateExpect({ all_lines_match: '${PAT}' }, state);
    assert.deepStrictEqual((result as any).all_lines_match, 'Running|Ready');
  });

  it('jsonpath substitutes ${VAR}', () => {
    const state = makeState({ FIELD: 'status' });
    const result = interpolateExpect(
      { jsonpath: '$.${FIELD}', equals: 'ok' },
      state,
    );
    assert.deepStrictEqual((result as any).jsonpath, '$.status');
  });

  it('equals_captured resolves to captured value', () => {
    const state = makeState({ IMAGE_ID: 'sha256:abc' });
    const result = interpolateExpect({ equals_captured: 'IMAGE_ID' }, state);
    assert.deepStrictEqual((result as any).equals, 'sha256:abc');
    assert.ok(!('equals_captured' in (result as any)));
  });

  it('equals_captured left as-is when key not captured', () => {
    const state = makeState({});
    const result = interpolateExpect({ equals_captured: 'MISSING' }, state);
    assert.deepStrictEqual((result as any).equals_captured, 'MISSING');
  });

  it('non-string fields (not_empty, line_count) are unchanged', () => {
    const state = makeState({});
    const result = interpolateExpect({ not_empty: true, line_count: 3 }, state);
    assert.deepStrictEqual((result as any).not_empty, true);
    assert.deepStrictEqual((result as any).line_count, 3);
  });
});
