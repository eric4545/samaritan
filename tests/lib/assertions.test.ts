import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  assertOutput,
  cleanTerminalOutput,
  renderExpectDescription,
  renderExpectParts,
} from '../../src/lib/assertions';
import { SessionState } from '../../src/lib/session-state';

describe('assertOutput (issue #12)', () => {
  it('contains - passes when output includes substring', () => {
    const r = assertOutput('pod web-0 Running', { contains: 'Running' });
    assert.strictEqual(r.pass, true);
    assert.strictEqual(r.type, 'contains');
  });

  it('contains - fails when output does not include substring', () => {
    const r = assertOutput('pod web-0 Pending', { contains: 'Running' });
    assert.strictEqual(r.pass, false);
  });

  it('not_contains - passes when substring absent', () => {
    const r = assertOutput('all pods healthy', { not_contains: 'Error' });
    assert.strictEqual(r.pass, true);
  });

  it('not_contains - fails when substring present', () => {
    const r = assertOutput('Error: pod crashlooping', {
      not_contains: 'Error',
    });
    assert.strictEqual(r.pass, false);
  });

  it('equals - passes on exact match (trimmed)', () => {
    const r = assertOutput('  healthy  ', { equals: 'healthy' });
    assert.strictEqual(r.pass, true);
  });

  it('equals - fails on mismatch', () => {
    const r = assertOutput('unhealthy', { equals: 'healthy' });
    assert.strictEqual(r.pass, false);
  });

  it('matches - passes on regex match', () => {
    const r = assertOutput('sha256:abc123def', { matches: 'sha256:[a-f0-9]+' });
    assert.strictEqual(r.pass, true);
  });

  it('matches - fails when regex does not match', () => {
    const r = assertOutput('no hash here', { matches: 'sha256:[a-f0-9]+' });
    assert.strictEqual(r.pass, false);
  });

  it('not_empty - passes on non-empty output', () => {
    const r = assertOutput('something', { not_empty: true });
    assert.strictEqual(r.pass, true);
  });

  it('not_empty - fails on empty output', () => {
    const r = assertOutput('   ', { not_empty: true });
    assert.strictEqual(r.pass, false);
  });

  it('any_line_contains - passes when at least one line matches', () => {
    const r = assertOutput('line1\nRunning\nline3', {
      any_line_contains: 'Running',
    });
    assert.strictEqual(r.pass, true);
  });

  it('any_line_contains - fails when no line matches', () => {
    const r = assertOutput('line1\nline2\nline3', {
      any_line_contains: 'Running',
    });
    assert.strictEqual(r.pass, false);
  });

  it('no_line_contains - passes when no line has the substring', () => {
    const r = assertOutput('line1\nline2\nline3', {
      no_line_contains: 'Error',
    });
    assert.strictEqual(r.pass, true);
  });

  it('no_line_contains - fails when a line has the substring', () => {
    const r = assertOutput('line1\nError: crash\nline3', {
      no_line_contains: 'Error',
    });
    assert.strictEqual(r.pass, false);
  });

  it('line_count - passes on exact count', () => {
    const r = assertOutput('a\nb\nc', { line_count: 3 });
    assert.strictEqual(r.pass, true);
  });

  it('line_count - fails on wrong count', () => {
    const r = assertOutput('a\nb', { line_count: 3 });
    assert.strictEqual(r.pass, false);
  });

  it('line_count_gte - passes when count is sufficient', () => {
    const r = assertOutput('a\nb\nc\nd', { line_count_gte: 3 });
    assert.strictEqual(r.pass, true);
  });

  it('line_count_gte - fails when count too low', () => {
    const r = assertOutput('a\nb', { line_count_gte: 3 });
    assert.strictEqual(r.pass, false);
  });

  it('numeric_gte - passes when first number meets threshold', () => {
    const r = assertOutput('replicas: 5', { numeric_gte: 3 });
    assert.strictEqual(r.pass, true);
  });

  it('numeric_gte - fails when first number below threshold', () => {
    const r = assertOutput('replicas: 1', { numeric_gte: 3 });
    assert.strictEqual(r.pass, false);
  });

  it('jsonpath - evaluates $.status equals', () => {
    const r = assertOutput('{"status":"Running","ready":true}', {
      jsonpath: '$.status',
      equals: 'Running',
    });
    assert.strictEqual(r.pass, true);
  });

  it('jsonpath - fails on wrong value', () => {
    const r = assertOutput('{"status":"Pending"}', {
      jsonpath: '$.status',
      equals: 'Running',
    });
    assert.strictEqual(r.pass, false);
  });

  it('shorthand string is treated as contains', () => {
    const r = assertOutput('pod Running', 'Running');
    assert.strictEqual(r.pass, true);
    assert.strictEqual(r.type, 'contains');
  });

  it('all_lines_match - passes when every non-empty line matches pattern', () => {
    const r = assertOutput('Running\nReady\nRunning', {
      all_lines_match: 'Running|Ready',
    });
    assert.strictEqual(r.pass, true);
  });

  it('all_lines_match - fails when a line does not match', () => {
    const r = assertOutput('Running\nFailed\nRunning', {
      all_lines_match: 'Running',
    });
    assert.strictEqual(r.pass, false);
  });

  it('result includes actual and expected fields', () => {
    const r = assertOutput('Running', { equals: 'Stopped' });
    assert.ok('actual' in r, 'should have actual');
    assert.ok('expected' in r, 'should have expected');
    assert.ok('type' in r, 'should have type');
  });
});

describe('SessionState (issue #12)', () => {
  it('captures and retrieves values', () => {
    const state = new SessionState();
    state.capture('IMAGE_ID', 'abc123');
    assert.strictEqual(state.get('IMAGE_ID'), 'abc123');
  });

  it('interpolates ${VAR} in strings', () => {
    const state = new SessionState();
    state.capture('IMAGE_ID', 'sha256:abc');
    const result = state.interpolate('contains: ${IMAGE_ID}');
    assert.strictEqual(result, 'contains: sha256:abc');
  });

  it('throws on undefined ${VAR}', () => {
    const state = new SessionState();
    assert.throws(() => state.interpolate('value is ${MISSING}'), /MISSING/);
  });

  it('multiple vars interpolated in single string', () => {
    const state = new SessionState();
    state.capture('A', 'hello');
    state.capture('B', 'world');
    const result = state.interpolate('${A} ${B}');
    assert.strictEqual(result, 'hello world');
  });

  it('interpolates bare $VAR when captured', () => {
    const state = new SessionState();
    state.capture('APP_VERSION', '1.2.3');
    const result = state.interpolate('$APP_VERSION');
    assert.strictEqual(result, '1.2.3');
  });

  it('leaves bare $VAR untouched when not captured (for shell expansion)', () => {
    const state = new SessionState();
    const result = state.interpolate('$HOME and $USER');
    assert.strictEqual(result, '$HOME and $USER');
  });

  it('resolves bare $VAR in expect equals while leaving unknown shell vars', () => {
    const state = new SessionState();
    state.capture('STATUS', 'Running');
    const result = state.interpolate('$STATUS vs $SHELL_VAR');
    assert.strictEqual(result, 'Running vs $SHELL_VAR');
  });

  it('resolves mixed ${VAR} and $VAR in same string', () => {
    const state = new SessionState();
    state.capture('A', 'alpha');
    state.capture('B', 'beta');
    const result = state.interpolate('${A} and $B');
    assert.strictEqual(result, 'alpha and beta');
  });

  it('extractCapture with pattern and group', () => {
    const state = new SessionState();
    state.extractCapture('ID', 'Successfully built abc123def', {
      pattern: 'Successfully built ([a-f0-9]+)',
      group: 1,
    });
    assert.strictEqual(state.get('ID'), 'abc123def');
  });

  it('extractCapture with line: last', () => {
    const state = new SessionState();
    state.extractCapture('LAST', 'line1\nline2\nlastline', { line: 'last' });
    assert.strictEqual(state.get('LAST'), 'lastline');
  });

  it('extractCapture with line: first', () => {
    const state = new SessionState();
    state.extractCapture('FIRST', 'firstline\nline2\nline3', { line: 'first' });
    assert.strictEqual(state.get('FIRST'), 'firstline');
  });
});

describe('assertOutput — array expect (AND semantics)', () => {
  it('passes when all checks pass', () => {
    const r = assertOutput('Running pods: 5', [
      { contains: 'Running' },
      { not_contains: 'Error' },
    ]);
    assert.strictEqual(r.pass, true);
    assert.strictEqual(r.type, 'all');
  });

  it('fails fast on first failing check and reports its type', () => {
    const r = assertOutput('Running pods: 1', [
      { contains: 'Running' },
      { numeric_gte: 3 },
    ]);
    assert.strictEqual(r.pass, false);
    assert.strictEqual(r.type, 'numeric_gte');
  });

  it('fails on second check when first passes', () => {
    const r = assertOutput('healthy\nerror detected', [
      { contains: 'healthy' },
      { not_contains: 'error' },
    ]);
    assert.strictEqual(r.pass, false);
    assert.strictEqual(r.type, 'not_contains');
  });

  it('allows multiple contains checks', () => {
    const r = assertOutput('pod Running\nservice Ready', [
      { contains: 'Running' },
      { contains: 'Ready' },
    ]);
    assert.strictEqual(r.pass, true);
  });

  it('fails when one of multiple contains checks fails', () => {
    const r = assertOutput('pod Running', [
      { contains: 'Running' },
      { contains: 'Ready' },
    ]);
    assert.strictEqual(r.pass, false);
    assert.strictEqual(r.type, 'contains');
  });
});

describe('renderExpectDescription — array expect', () => {
  it('joins multiple descriptions with semicolons', () => {
    const desc = renderExpectDescription([
      { contains: 'Running' },
      { not_contains: 'Error' },
      { line_count_gte: 3 },
    ]);
    assert.strictEqual(
      desc,
      'contains: Running; does not contain: Error; at least 3 line(s)',
    );
  });

  it('filters out empty descriptions', () => {
    const desc = renderExpectDescription([{ contains: 'ok' }, {} as any]);
    assert.strictEqual(desc, 'contains: ok');
  });

  it('returns empty string for empty array', () => {
    const desc = renderExpectDescription([]);
    assert.strictEqual(desc, '');
  });
});

describe('assertOutput — equals_captured fallback (bug fix)', () => {
  it('returns pass:false when equals_captured key was not resolved', () => {
    const result = assertOutput('some output', {
      equals_captured: 'missing_var',
    });
    assert.strictEqual(result.pass, false);
    assert.strictEqual(result.type, 'equals_captured');
    assert.ok(
      result.expected.includes('missing_var'),
      'expected message should name the missing variable',
    );
  });

  it('returns pass:false regardless of actual output content', () => {
    const result = assertOutput('', { equals_captured: 'unset_capture' });
    assert.strictEqual(result.pass, false);
  });
});

describe('numeric expect values (variable substitution can resolve "${VAR}" to a number)', () => {
  // ${VAR} substitution preserves type for bare single-variable strings, so
  // `expect: "${EXPECTED_COUNT}"` with EXPECTED_COUNT: 0 resolves to the
  // literal number 0 — which must not be treated as "no expect" (falsy).
  it('renderExpectParts treats a numeric expect as the string shorthand', () => {
    assert.deepStrictEqual(renderExpectParts(0), ['0']);
    assert.deepStrictEqual(renderExpectParts(3), ['3']);
  });

  it('renderExpectParts treats a boolean expect as the string shorthand', () => {
    assert.deepStrictEqual(renderExpectParts(false), ['false']);
  });

  it('renderExpectParts still returns [] for undefined/null', () => {
    assert.deepStrictEqual(renderExpectParts(undefined), []);
    assert.deepStrictEqual(renderExpectParts(null as any), []);
  });

  it('assertOutput treats a numeric expect as a "contains" check', () => {
    const pass = assertOutput('replicas: 0', 0 as any);
    assert.strictEqual(pass.pass, true);
    assert.strictEqual(pass.type, 'contains');

    const fail = assertOutput('replicas: 5', 0 as any);
    assert.strictEqual(fail.pass, false);
  });

  it('assertOutput treats a boolean expect as a "contains" check', () => {
    const result = assertOutput('healthy: true', true as any);
    assert.strictEqual(result.pass, true);
    assert.strictEqual(result.type, 'contains');
  });
});

describe('assertOutput — invalid user-supplied regex (security hardening)', () => {
  it('matches with invalid regex fails the check instead of throwing', () => {
    const r = assertOutput('some output', { matches: '(unclosed' });
    assert.strictEqual(r.pass, false);
    assert.strictEqual(r.type, 'matches');
    assert.ok(r.expected.includes('invalid pattern'));
  });

  it('all_lines_match with invalid regex fails the check instead of throwing', () => {
    const r = assertOutput('line1\nline2', { all_lines_match: '[bad' });
    assert.strictEqual(r.pass, false);
    assert.strictEqual(r.type, 'all_lines_match');
    assert.ok(r.expected.includes('invalid pattern'));
  });
});

describe('SessionState.extractCapture — invalid pattern (security hardening)', () => {
  it('skips the capture instead of throwing on invalid regex', () => {
    const state = new SessionState();
    state.extractCapture('BAD', 'output text', { pattern: '(unclosed' });
    assert.strictEqual(state.get('BAD'), undefined);
  });
});

describe('cleanTerminalOutput — raw tmux pipe-pane capture normalization', () => {
  it('strips ANSI color codes wrapped around expected text', () => {
    const raw = '\u001b[32msuccessfully rolled out\u001b[0m';
    assert.strictEqual(cleanTerminalOutput(raw), 'successfully rolled out');
  });

  it('strips color codes embedded INSIDE the expected substring', () => {
    // kubectl/grep often colorize part of a line — contains: "pod Running"
    // must still match
    const raw = 'pod \u001b[1;32mRunning\u001b[0m';
    const cleaned = cleanTerminalOutput(raw);
    assert.strictEqual(cleaned, 'pod Running');
    assert.strictEqual(
      assertOutput(cleaned, { contains: 'pod Running' }).pass,
      true,
    );
  });

  it('normalizes \\r\\n line endings so equals/line checks work', () => {
    const raw = 'line one\r\nline two\r\n';
    assert.strictEqual(cleanTerminalOutput(raw), 'line one\nline two\n');
    assert.strictEqual(
      assertOutput(cleanTerminalOutput(raw), { equals: 'line one\nline two' })
        .pass,
      true,
    );
  });

  it('resolves carriage-return overwrites (progress bars)', () => {
    const raw = 'progress 10%\rprogress 50%\rprogress 100%';
    assert.strictEqual(cleanTerminalOutput(raw), 'progress 100%');
  });

  it('strips OSC title sequences', () => {
    const raw = '\u001b]0;my-terminal-title\u0007actual output';
    assert.strictEqual(cleanTerminalOutput(raw), 'actual output');
  });

  it('leaves plain text untouched', () => {
    const raw = 'deployment.apps/web created\npod/web-0 Running';
    assert.strictEqual(cleanTerminalOutput(raw), raw);
  });
});
