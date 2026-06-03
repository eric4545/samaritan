import assert from 'node:assert';
import { describe, it } from 'node:test';
import { SessionState } from '../../src/lib/session-state';
import {
  interpolateExpect,
  renderCodeBlock,
  renderKeyHints,
} from '../../src/lib/tui';

const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const stripAnsi = (s: string) => s.replace(ANSI_RE, '');

function makeState(vars: Record<string, string>): SessionState {
  const state = new SessionState();
  for (const [k, v] of Object.entries(vars)) {
    state.capture(k, v);
  }
  return state;
}

describe('renderCodeBlock', () => {
  it('renders a single-line command with bash label', () => {
    const out = stripAnsi(renderCodeBlock('kubectl apply -f deploy.yaml'));
    const lines = out.split('\n');
    assert.ok(lines[0].includes('bash'), 'top border has language label');
    assert.ok(lines[0].startsWith('  ╭'), 'top border starts with ╭');
    assert.ok(
      lines[lines.length - 1].startsWith('  ╰'),
      'bottom border starts with ╰',
    );
    assert.ok(
      lines[1].includes('kubectl apply -f deploy.yaml'),
      'code line has command',
    );
  });

  it('renders with a custom language label', () => {
    const out = stripAnsi(renderCodeBlock('SELECT 1', 'sql'));
    assert.ok(
      out.split('\n')[0].includes('sql'),
      'label appears in top border',
    );
  });

  it('renders multi-line code', () => {
    const code = 'line one\nline two\nline three';
    const out = stripAnsi(renderCodeBlock(code));
    const lines = out.split('\n');
    assert.strictEqual(lines.length, 5, 'top + 3 code lines + bottom = 5');
    assert.ok(lines[1].includes('line one'));
    assert.ok(lines[2].includes('line two'));
    assert.ok(lines[3].includes('line three'));
  });

  it('trims trailing blank lines from code', () => {
    const out = stripAnsi(renderCodeBlock('cmd\n\n'));
    const lines = out.split('\n');
    assert.strictEqual(lines.length, 3, 'top + 1 code line + bottom = 3');
  });

  it('box columns align — top and bottom have same width', () => {
    const out = stripAnsi(renderCodeBlock('echo hello'));
    const lines = out.split('\n');
    assert.strictEqual(
      lines[0].length,
      lines[lines.length - 1].length,
      'top and bottom same width',
    );
  });

  it('caps width at 74 for very long lines', () => {
    const longCmd = 'a'.repeat(100);
    const out = stripAnsi(renderCodeBlock(longCmd));
    const lines = out.split('\n');
    // top line width = 2 (indent) + 1 (╭) + fillWidth (capped 72) + 1 (╮) = 76
    assert.ok(lines[0].length <= 76, 'top border does not exceed 76 chars');
  });
});

describe('renderKeyHints', () => {
  it('renders all hint keys and labels', () => {
    const out = stripAnsi(
      renderKeyHints([
        { key: '↵', label: 'send' },
        { key: 'c', label: 'copy' },
        { key: 'q', label: 'quit' },
      ]),
    );
    assert.ok(out.includes('↵'), 'key ↵ present');
    assert.ok(out.includes('send'), 'label send present');
    assert.ok(out.includes('c'), 'key c present');
    assert.ok(out.includes('copy'), 'label copy present');
    assert.ok(out.includes('q'), 'key q present');
    assert.ok(out.includes('quit'), 'label quit present');
  });

  it('separates hints with dots', () => {
    const out = stripAnsi(
      renderKeyHints([
        { key: 'a', label: 'alpha' },
        { key: 'b', label: 'beta' },
      ]),
    );
    assert.ok(out.includes('·'), 'separator · present');
  });

  it('starts with two-space indent', () => {
    const out = stripAnsi(renderKeyHints([{ key: 'x', label: 'foo' }]));
    assert.ok(out.startsWith('  '), 'starts with two spaces');
  });
});

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
