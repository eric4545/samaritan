import assert from 'node:assert';
import { describe, it } from 'node:test';
import { assertOutput } from '../../src/lib/assertions';
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
