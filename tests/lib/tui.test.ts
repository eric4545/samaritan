import assert from 'node:assert';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { assertOutputDetailed } from '../../src/lib/assertions';
import {
  createEventLogger,
  type EventLogger,
} from '../../src/lib/event-logger';
import { SessionState } from '../../src/lib/session-state';
import {
  getTerminalSize,
  interpolateExpect,
  renderAssertOutcome,
  renderCodeBlock,
  renderHighlightedBlock,
  renderKeyHints,
  renderVerifyOutcome,
  StepController,
  type StepControllerOptions,
  truncateToWidth,
} from '../../src/lib/tui';

function makeLogger(id: string): EventLogger {
  return createEventLogger(id, join(tmpdir(), 'op.yaml'));
}

function cleanLogger(logger: EventLogger): void {
  logger.close();
  if (existsSync(logger.path)) unlinkSync(logger.path);
}

function readEvents(logger: EventLogger): any[] {
  return readFileSync(logger.path, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

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

  it('does not truncate long lines — full content is preserved', () => {
    const longCmd = 'a'.repeat(100);
    const out = stripAnsi(renderCodeBlock(longCmd));
    const lines = out.split('\n');
    assert.ok(lines[1].includes(longCmd), 'full long line is not truncated');
  });

  it('preserves comment lines in full', () => {
    const code = '# deploy the application\nkubectl apply -f deployment.yaml';
    const out = stripAnsi(renderCodeBlock(code));
    assert.ok(
      out.includes('# deploy the application'),
      'comment line is not stripped or truncated',
    );
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

describe('StepController without tmux (sidecar mode)', () => {
  it('can be constructed without a tmux session', () => {
    const logger = makeLogger('no-tmux-1');
    const opts: StepControllerOptions = {
      logger,
      // tmux intentionally omitted — should be undefined
      sessionState: null as any,
      autoSend: false,
      autoExec: false,
    };
    assert.doesNotThrow(() => new StepController(opts));
    cleanLogger(logger);
  });

  it('verifyOutput emits assert_result even without tmux', () => {
    const logger = makeLogger('no-tmux-2');
    const opts: StepControllerOptions = {
      logger,
      sessionState: null as any,
      autoSend: false,
      autoExec: false,
    };
    const ctrl = new StepController(opts);

    const step = {
      name: 'Check output',
      expect: { contains: 'Running' },
    } as any;

    const { assertResult } = ctrl.verifyOutput(step, 0, 'pod/web-0   Running');
    assert.ok(assertResult, 'should return an assertResult');
    assert.strictEqual(assertResult?.pass, true);

    const events = readEvents(logger).filter((e) => e.type === 'assert_result');
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].pass, true);

    cleanLogger(logger);
  });

  it('waitForCompletion returns done immediately without tmux', async () => {
    const logger = makeLogger('no-tmux-3');
    const opts: StepControllerOptions = {
      logger,
      sessionState: null as any,
      autoSend: false,
      autoExec: false,
    };
    const ctrl = new StepController(opts);
    const result = await ctrl.waitForCompletion('default', 5_000);
    assert.strictEqual(result, 'done');
    cleanLogger(logger);
  });

  it('runVerify returns complete immediately without tmux', async () => {
    const logger = makeLogger('no-tmux-4');
    const opts: StepControllerOptions = {
      logger,
      sessionState: null as any,
      autoSend: false,
      autoExec: false,
    };
    const ctrl = new StepController(opts);
    const step = {
      name: 'Check output',
      command: 'kubectl get pods',
      expect: { contains: 'Running' },
    } as any;

    const { state } = await ctrl.runVerify(step, 0);
    assert.strictEqual(state, 'complete');
    cleanLogger(logger);
  });
});

describe('StepController.verifyOutput', () => {
  function makeController(logger: EventLogger): StepController {
    const opts: StepControllerOptions = {
      logger,
      tmux: null as any,
      sessionState: null as any,
      autoSend: false,
      autoExec: false,
    };
    return new StepController(opts);
  }

  it('returns no assertResult when step has no expect', () => {
    const logger = makeLogger('verify-output-1');
    const ctrl = makeController(logger);

    const { assertResult } = ctrl.verifyOutput(
      { name: 'No Expect' } as any,
      0,
      'pod/web-0   1/1   Running',
    );

    assert.strictEqual(assertResult, undefined);
    assert.ok(
      !existsSync(logger.path),
      'no event (and therefore no log file) should be written',
    );

    cleanLogger(logger);
  });

  it('emits a passing assert_result when output matches expect', () => {
    const logger = makeLogger('verify-output-2');
    const ctrl = makeController(logger);

    const step = {
      name: 'Verify rollout',
      expect: { contains: 'successfully rolled out' },
    } as any;

    const { assertResult } = ctrl.verifyOutput(
      step,
      3,
      'deployment "web" successfully rolled out',
    );

    assert.ok(assertResult);
    assert.strictEqual(assertResult?.pass, true);

    const events = readEvents(logger).filter((e) => e.type === 'assert_result');
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].step, 3);
    assert.strictEqual(events[0].pass, true);
    assert.strictEqual(events[0].assertion_type, 'contains');
    assert.strictEqual(events[0].expected, 'successfully rolled out');

    cleanLogger(logger);
  });

  it('emits a failing assert_result when output does not match expect', () => {
    const logger = makeLogger('verify-output-3');
    const ctrl = makeController(logger);

    const step = {
      name: 'Verify rollout',
      expect: { contains: 'successfully rolled out' },
    } as any;

    const { assertResult } = ctrl.verifyOutput(step, 1, 'still progressing...');

    assert.ok(assertResult);
    assert.strictEqual(assertResult?.pass, false);

    const events = readEvents(logger).filter((e) => e.type === 'assert_result');
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].pass, false);
    assert.strictEqual(events[0].step, 1);

    cleanLogger(logger);
  });

  it('interpolates ${VAR} in expect via sessionState before asserting', () => {
    const logger = makeLogger('verify-output-4');
    const state = new SessionState();
    state.capture('WANT', 'Running');

    const opts: StepControllerOptions = {
      logger,
      tmux: null as any,
      sessionState: state,
      autoSend: false,
      autoExec: false,
    };
    const ctrl = new StepController(opts);

    const step = {
      name: 'Verify pod status',
      expect: { contains: '${WANT}' },
    } as any;

    const { assertResult } = ctrl.verifyOutput(step, 0, 'pod/web-0   Running');

    assert.ok(assertResult);
    assert.strictEqual(assertResult?.pass, true);
    assert.strictEqual(assertResult?.expected, 'Running');

    cleanLogger(logger);
  });
});

describe('StepController.verifyOutput — raw terminal capture cleaning', () => {
  function makeController(logger: EventLogger): StepController {
    const opts: StepControllerOptions = {
      logger,
      tmux: null as any,
      sessionState: null as any,
      autoSend: false,
      autoExec: false,
    };
    return new StepController(opts);
  }

  it('passes when expected text is interrupted by ANSI color codes', () => {
    const logger = makeLogger('verify-clean-1');
    const ctrl = makeController(logger);
    const step = {
      name: 'Verify rollout',
      expect: { contains: 'successfully rolled out' },
    } as any;

    const { assertResult } = ctrl.verifyOutput(
      step,
      0,
      'deployment "web" \u001b[32msuccessfully rolled out\u001b[0m\r\n',
    );

    assert.ok(assertResult);
    assert.strictEqual(assertResult?.pass, true);
    cleanLogger(logger);
  });

  it('passes equals check on \\r\\n-terminated pane output', () => {
    const logger = makeLogger('verify-clean-2');
    const ctrl = makeController(logger);
    const step = { name: 'Check', expect: { equals: 'healthy' } } as any;

    const { assertResult } = ctrl.verifyOutput(step, 0, 'healthy\r\n');

    assert.ok(assertResult);
    assert.strictEqual(assertResult?.pass, true);
    cleanLogger(logger);
  });
});

describe('renderAssertOutcome', () => {
  it('PASS outcome shows the expected value and no actual-output block', () => {
    const out = renderAssertOutcome({
      pass: true,
      actual: 'pod Running',
      expected: 'Running',
      type: 'contains',
    });
    assert.ok(out.includes('✅ PASS'));
    assert.ok(out.includes('expected "Running"'));
    assert.ok(!out.includes('Actual output'));
  });

  it('FAIL outcome includes a tail of the actual output', () => {
    const out = renderAssertOutcome({
      pass: false,
      actual: 'pod web-0 CrashLoopBackOff',
      expected: 'Running',
      type: 'contains',
    });
    assert.ok(out.includes('❌ FAIL'));
    assert.ok(out.includes('Actual output'));
    assert.ok(out.includes('CrashLoopBackOff'));
  });

  it('FAIL outcome truncates to the last lines of long output', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i + 1}`);
    const out = renderAssertOutcome({
      pass: false,
      actual: lines.join('\n'),
      expected: 'something',
      type: 'contains',
    });
    assert.ok(out.includes('line-30'), 'tail line must be shown');
    // tail is line-23..line-30, so the substring "line-1" must be gone entirely
    assert.ok(!out.includes('line-1'), 'early lines must be truncated away');
  });
});

describe('renderVerifyOutcome', () => {
  it('PASS: shows header, checklist, and highlights the matched text', () => {
    const expect = { contains: 'Running' };
    const output = 'pod/web-0   1/1   Running   0   10s';
    const detailed = assertOutputDetailed(output, expect);

    const out = renderVerifyOutcome(detailed, expect);

    assert.ok(out.includes('✅ PASS'));
    assert.ok(out.includes('✅'), 'checklist shows a passing check');
    assert.ok(out.includes('contains: Running'), 'shows the criterion text');
    // The matched text is wrapped in ANSI highlight codes, but a plain
    // `includes('Running')` must still succeed — the token stays contiguous.
    assert.ok(out.includes('Running'));
    // The highlight escape codes must actually be present
    assert.ok(out.includes('\x1b[32m'), 'green highlight applied');
    assert.ok(out.includes('\x1b[7m'), 'inverse highlight applied');
  });

  it('FAIL: shows the missing expected text', () => {
    const expect = { contains: 'Running' };
    const output = 'pod/web-0   0/1   CrashLoopBackOff   3   2m';
    const detailed = assertOutputDetailed(output, expect);

    const out = renderVerifyOutcome(detailed, expect);

    assert.ok(out.includes('❌ FAIL'));
    assert.ok(out.includes('❌'), 'checklist shows a failing check');
    assert.ok(out.includes('missing: Running'), 'shows the missing value');
    assert.ok(out.includes('CrashLoopBackOff'), 'shows captured output');
  });

  it('does not number appended "missing:" hint lines past the real output', () => {
    const expect = { contains: 'Running' };
    // 5-line output, none containing "Running" -> a "missing:" hint is appended
    // BELOW the captured output. That hint is not real output, so it must not
    // receive a gutter line number continuing past the last output line.
    const output = 'alpha\nbravo\ncharlie\ndelta\necho';
    const detailed = assertOutputDetailed(output, expect);

    const out = renderVerifyOutcome(detailed, expect);

    const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
    const strip = (s: string): string => s.replace(ansi, '');
    // Each rendered output line is `  │ <gutter>│ <content> │`; the gutter is
    // the text between the box-left `│` and the gutter-separator `│`.
    const gutterOf = (line: string): string => {
      const first = line.indexOf('│');
      const second = line.indexOf('│', first + 1);
      return first >= 0 && second > first ? line.slice(first + 1, second) : '';
    };
    const lines = out.split('\n').map(strip);

    const missingLine = lines.find((l) => l.includes('missing: Running'));
    assert.ok(missingLine, 'missing hint line present');
    assert.ok(
      !/\d/.test(gutterOf(missingLine as string)),
      `missing-hint line must have a blank gutter, got: "${gutterOf(missingLine as string)}"`,
    );

    // Real output lines stay numbered; none is numbered past the 5th line.
    const gutterNumbers = lines
      .map((l) => gutterOf(l).replace('→', '').trim())
      .filter((g) => /^\d+$/.test(g));
    assert.ok(gutterNumbers.length > 0, 'real output lines are numbered');
    assert.ok(
      !gutterNumbers.includes('6'),
      'no gutter numbered past the real output length',
    );
  });

  it('shows a per-check checklist for array expects', () => {
    const expect = [
      { contains: 'Running' },
      { not_contains: 'Error' },
      { not_contains: 'CrashLoopBackOff' },
    ];
    const output = 'pod/web-0   1/1   Running   0   10s';
    const detailed = assertOutputDetailed(output, expect);

    const out = renderVerifyOutcome(detailed, expect);

    assert.ok(out.includes('✅ PASS'));
    assert.ok(out.includes('contains: Running'));
    assert.ok(out.includes('does not contain: Error'));
    assert.ok(out.includes('does not contain: CrashLoopBackOff'));
    // 3 checks => 3 checklist lines, all passing
    const checklistLines = out
      .split('\n')
      .filter((l) => l.includes('✅') && !l.includes('PASS'));
    assert.strictEqual(checklistLines.length, 3);
  });

  it('array expect: highlights the offending match on a failing not_contains check', () => {
    const expect = [{ contains: 'Running' }, { not_contains: 'Error' }];
    const output = 'pod/web-0   1/1   Running   0   10s\nError: backoff';
    const detailed = assertOutputDetailed(output, expect);

    const out = renderVerifyOutcome(detailed, expect);

    assert.ok(out.includes('❌ FAIL'));
    assert.ok(out.includes('does not contain: Error'));
    // RED highlight applied around the offending "Error" match
    assert.ok(out.includes('\x1b[31m'), 'red highlight applied');
    assert.ok(out.includes('Error'));
  });

  it('PASS: highlights the matched line on a passing any_line_matches check', () => {
    const expect = { any_line_matches: '^pod/web-[0-9]+' };
    const output = 'starting\npod/web-12 ready\ndone';
    const detailed = assertOutputDetailed(output, expect);

    const out = renderVerifyOutcome(detailed, expect);

    assert.ok(out.includes('✅ PASS'));
    assert.ok(out.includes('any line matches: ^pod/web-[0-9]+'));
    assert.ok(out.includes('\x1b[32m'), 'green highlight applied');
    assert.ok(out.includes('pod/web-12'));
  });

  it('FAIL: highlights the offending match on a failing no_line_matches check', () => {
    const expect = { no_line_matches: 'ERROR|FATAL' };
    const output = 'all good\nFATAL: boom';
    const detailed = assertOutputDetailed(output, expect);

    const out = renderVerifyOutcome(detailed, expect);

    assert.ok(out.includes('❌ FAIL'));
    assert.ok(out.includes('no line matches: ERROR|FATAL'));
    assert.ok(out.includes('\x1b[31m'), 'red highlight applied');
    assert.ok(out.includes('FATAL'));
  });

  it('shows inline computed values for numeric checks', () => {
    const expect = [{ numeric_gte: 3 }, { not_empty: true }];
    const output = '2';
    const detailed = assertOutputDetailed(output, expect);

    const out = renderVerifyOutcome(detailed, expect);

    assert.ok(out.includes('❌ FAIL'));
    assert.ok(out.includes('found "2"'));
    assert.ok(out.includes('≥ 3'));
  });

  it('shows inline computed values for line_count checks', () => {
    const expect = { line_count: 3 };
    const output = 'a\nb';
    const detailed = assertOutputDetailed(output, expect);

    const out = renderVerifyOutcome(detailed, expect);

    assert.ok(out.includes('❌ FAIL'));
    assert.ok(out.includes('2'), 'shows the actual line count');
    assert.ok(out.includes('expected 3'), 'shows the expected line count');
  });

  it('shows the captured output on PASS (not just on FAIL)', () => {
    const expect = { contains: 'ok' };
    const output = 'health check: ok';
    const detailed = assertOutputDetailed(output, expect);

    const out = renderVerifyOutcome(detailed, expect);

    assert.ok(out.includes('✅ PASS'));
    assert.ok(out.includes('health check'), 'output block shown on PASS too');
  });

  it('truncates to a tail of output by default, shows full output when expand:true', () => {
    const expect = { contains: 'Running' };
    const lines = Array.from({ length: 20 }, (_, i) => `line-${i + 1}`);
    const output = `${lines.join('\n')}\nRunning`;
    const detailed = assertOutputDetailed(output, expect);

    const tailOut = renderVerifyOutcome(detailed, expect);
    assert.ok(
      !tailOut.includes('line-1\n'),
      'early lines truncated by default',
    );
    assert.ok(tailOut.includes('line-20'), 'recent lines kept in tail');

    const fullOut = renderVerifyOutcome(detailed, expect, { expand: true });
    assert.ok(fullOut.includes('line-1'), 'full output includes earliest line');
    assert.ok(fullOut.includes('line-20'));
  });

  it('keeps the output box aligned when highlight codes are present (stripAnsi-based padding)', () => {
    const expect = { contains: 'Running' };
    const output = 'pod/web-0   1/1   Running   0   10s';
    const detailed = assertOutputDetailed(output, expect);

    const out = renderVerifyOutcome(detailed, expect);
    const boxLines = out.split('\n').filter((l) => l.includes('│'));
    assert.ok(boxLines.length > 0, 'output block rendered as a box');

    // Strip ANSI codes and confirm every content line has the same visible
    // width (border alignment) despite the embedded highlight codes.
    const ANSI_RE_LOCAL = new RegExp(
      `${String.fromCharCode(27)}\\[[0-9;]*m`,
      'g',
    );
    const widths = boxLines.map((l) => l.replace(ANSI_RE_LOCAL, '').length);
    const uniqueWidths = new Set(widths);
    assert.strictEqual(
      uniqueWidths.size,
      1,
      `all box lines must have equal visible width, got: ${[...uniqueWidths]}`,
    );
  });

  describe('line-number gutter', () => {
    it('shows right-aligned line numbers and a → arrow on the matched line', () => {
      const expect = { contains: 'Running' };
      const output = 'line-1\nline-2\npod/web-0   1/1   Running   0   10s';
      const detailed = assertOutputDetailed(output, expect);

      const out = stripAnsi(renderVerifyOutcome(detailed, expect));
      const outputLines = out.split('\n');

      // 3 lines of output -> line numbers 1, 2, 3
      assert.ok(outputLines.some((l) => /\b1\s+│ line-1/.test(l)));
      assert.ok(outputLines.some((l) => /\b2\s+│ line-2/.test(l)));
      // The matched line gets a → arrow before the │ separator
      assert.ok(
        outputLines.some((l) => /\b3 →│ pod\/web-0/.test(l)),
        `expected an arrow on line 3, got: ${out}`,
      );
      // Non-matched lines do NOT get an arrow
      assert.ok(!outputLines.some((l) => /\b1 →│/.test(l)));
      assert.ok(!outputLines.some((l) => /\b2 →│/.test(l)));
    });

    it('uses absolute line numbers when the output is tail-truncated', () => {
      const expect = { contains: 'Running' };
      const lines = Array.from({ length: 20 }, (_, i) => `line-${i + 1}`);
      const output = `${lines.join('\n')}\nRunning`;
      const detailed = assertOutputDetailed(output, expect);

      // 21 total lines, tail shows the last 12 -> starts at line 10.
      const out = stripAnsi(renderVerifyOutcome(detailed, expect));
      assert.ok(out.includes('10 '), 'tail starts at absolute line 10');
      assert.ok(
        out.includes('21 →│ Running'),
        'the matched line keeps its absolute line number (21) and arrow',
      );
      assert.ok(!out.includes(' 1 '), 'line 1 is not shown in the tail');

      // When expanded, line numbers restart at 1 (right-padded to the
      // gutter width, e.g. " 1" when the max line number is "21").
      const fullOut = stripAnsi(
        renderVerifyOutcome(detailed, expect, { expand: true }),
      );
      assert.ok(/\b1\s+│ line-1/.test(fullOut));
      assert.ok(fullOut.includes('21 →│ Running'));
    });

    it('keeps box border alignment with the gutter present', () => {
      const expect = [{ contains: 'Running' }, { not_contains: 'Error' }];
      const output =
        'line-1\nline-2\npod/web-0   1/1   Running   0   10s\nError: backoff';
      const detailed = assertOutputDetailed(output, expect);

      const out = renderVerifyOutcome(detailed, expect);
      const boxLines = out.split('\n').filter((l) => l.includes('│'));
      assert.ok(boxLines.length > 0);

      const widths = boxLines.map((l) => stripAnsi(l).length);
      const uniqueWidths = new Set(widths);
      assert.strictEqual(
        uniqueWidths.size,
        1,
        `all box lines must have equal visible width, got: ${[...uniqueWidths]}`,
      );
    });

    it('keeps highlighted tokens contiguous so includes() still finds them with the gutter present', () => {
      const expect = { contains: 'Running' };
      const output = 'line-1\npod/web-0   1/1   Running   0   10s';
      const detailed = assertOutputDetailed(output, expect);

      const out = renderVerifyOutcome(detailed, expect);
      assert.ok(out.includes('Running'));
      assert.ok(stripAnsi(out).includes('Running'));
    });
  });
});

describe('responsive rendering (terminal size aware)', () => {
  // Temporarily pretend stdout is a TTY of a given size, restoring after.
  function withTerminal(
    cols: number | undefined,
    rows: number | undefined,
    fn: () => void,
  ): void {
    const out = process.stdout as unknown as {
      columns?: number;
      rows?: number;
    };
    const prevCols = out.columns;
    const prevRows = out.rows;
    out.columns = cols;
    out.rows = rows;
    try {
      fn();
    } finally {
      out.columns = prevCols;
      out.rows = prevRows;
    }
  }

  function visibleWidth(line: string): number {
    return stripAnsi(line).length;
  }

  it('getTerminalSize returns Infinity when stdout is not a sized TTY', () => {
    withTerminal(undefined, undefined, () => {
      const { columns, rows } = getTerminalSize();
      assert.strictEqual(columns, Number.POSITIVE_INFINITY);
      assert.strictEqual(rows, Number.POSITIVE_INFINITY);
    });
  });

  it('getTerminalSize reflects a known TTY size', () => {
    withTerminal(40, 12, () => {
      assert.deepStrictEqual(getTerminalSize(), { columns: 40, rows: 12 });
    });
  });

  it('clamps code-block width to a small terminal and truncates long lines', () => {
    withTerminal(40, 24, () => {
      const out = renderCodeBlock('a'.repeat(200));
      const lines = stripAnsi(out).split('\n');
      for (const line of lines) {
        assert.ok(
          visibleWidth(line) <= 40,
          `line exceeds 40 cols: ${visibleWidth(line)}`,
        );
      }
      assert.ok(
        out.includes('…'),
        'over-long line is truncated with an ellipsis',
      );
    });
  });

  it('does NOT truncate when stdout is unbounded (non-TTY/CI)', () => {
    withTerminal(undefined, undefined, () => {
      const longCmd = 'a'.repeat(200);
      const out = stripAnsi(renderCodeBlock(longCmd));
      assert.ok(out.includes(longCmd), 'full content preserved when unbounded');
    });
  });

  it('keeps highlighted-block borders aligned within a small terminal', () => {
    withTerminal(48, 24, () => {
      const styled = ['short', 'b'.repeat(120), 'tail'];
      const out = renderHighlightedBlock(styled, 'output');
      const boxLines = stripAnsi(out).split('\n');
      const widths = new Set(boxLines.map(visibleWidth));
      assert.strictEqual(
        widths.size,
        1,
        `all box lines must share one width, got ${[...widths]}`,
      );
      for (const w of widths) {
        assert.ok(w <= 48, `box width ${w} exceeds 48`);
      }
    });
  });

  it('shrinks the verify output tail on a short terminal', () => {
    const detailed = {
      pass: false,
      actual: Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n'),
      checks: [{ pass: false, type: 'contains', expected: 'nope', actual: '' }],
    };
    const expect = { contains: 'nope' };

    let shortTailRows = 0;
    withTerminal(80, 14, () => {
      shortTailRows = renderVerifyOutcome(detailed, expect).split('\n').length;
    });
    let tallTailRows = 0;
    withTerminal(80, 60, () => {
      tallTailRows = renderVerifyOutcome(detailed, expect).split('\n').length;
    });
    assert.ok(
      shortTailRows < tallTailRows,
      `short terminal (${shortTailRows}) should render fewer rows than tall (${tallTailRows})`,
    );
  });

  it('truncateToWidth is a no-op for unbounded width and preserves color reset', () => {
    assert.strictEqual(
      truncateToWidth('hello', Number.POSITIVE_INFINITY),
      'hello',
    );
    const colored = `${String.fromCharCode(27)}[32mgreen-text-here${String.fromCharCode(27)}[0m`;
    const cut = truncateToWidth(colored, 6);
    assert.ok(visibleWidth(cut) <= 6, 'visible width respected');
    assert.ok(
      cut.endsWith(`${String.fromCharCode(27)}[0m`),
      'trailing reset preserved',
    );
  });
});
