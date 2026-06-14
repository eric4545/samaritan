import type { ExpectConfig, Step } from '../models/operation';
import {
  type AssertResult,
  assertOutput,
  assertOutputDetailed,
  cleanTerminalOutput,
  compileRegex,
  isPrimitiveExpectShorthand,
  renderExpectDescription,
  renderExpectParts,
} from './assertions';
import type { EventLogger } from './event-logger';
import { extractRetryConfig, parseInterval, shouldRetry } from './retry-assert';
import type { SessionState } from './session-state';
import type { TmuxSession } from './tmux-session';
import { isLocalSession } from './tmux-session';

export type StepState =
  | 'pending'
  | 'sending'
  | 'waiting'
  | 'stuck'
  | 'verifying'
  | 'assert_result'
  | 'manual_verify'
  | 'complete'
  | 'rollback_pending'
  | 'rolled_back';

export interface StepControllerOptions {
  logger: EventLogger;
  tmux?: TmuxSession;
  sessionState: SessionState;
  autoSend: boolean;
  autoExec: boolean;
  sessions?: Record<string, { host?: string; user?: string }>;
  /** Override the delay used by `expect.retry` polling (injected in tests). */
  sleep?: (ms: number) => Promise<void>;
}

export class StepController {
  private opts: StepControllerOptions;

  constructor(opts: StepControllerOptions) {
    this.opts = opts;
  }

  async executeStep(step: Step, stepIndex: number): Promise<StepState> {
    const { logger, sessionState, autoSend } = this.opts;

    logger.emit({
      type: 'step_start',
      step: stepIndex,
      name: step.name,
      pic: step.pic,
      reviewer: step.reviewer,
    });

    const sessionName = step.session ?? 'default';
    const sessionConfig = this.opts.sessions?.[sessionName];
    const isSSH = !isLocalSession(sessionConfig);

    if (step.command) {
      const command = sessionState
        ? sessionState.interpolate(step.command)
        : step.command;

      if (autoSend) {
        await this.sendCommand(sessionName, command, stepIndex);
      }
      // if !autoSend, operator triggers [s] manually (handled by keypress handler)
    }

    // SSH sessions always require manual sign-off
    if (isSSH) {
      return 'manual_verify';
    }

    return 'waiting';
  }

  async sendCommand(
    sessionName: string,
    command: string,
    _stepIndex: number,
  ): Promise<void> {
    const { logger, tmux, autoExec } = this.opts;

    logger.emit({ type: 'command_sent', session: sessionName, command });

    if (tmux) {
      tmux.send(sessionName, command, autoExec);
    }
  }

  async runVerify(
    step: Step,
    stepIndex: number,
  ): Promise<{
    state: StepState;
    assertResult?: ReturnType<typeof assertOutput>;
  }> {
    const { logger, tmux, sessionState } = this.opts;

    if (!step.command) return { state: 'complete' };

    // No tmux session — nothing to send or verify
    if (!tmux) return { state: 'complete' };

    const sessionName = step.session ?? 'default';
    const sessionConfig = this.opts.sessions?.[sessionName];
    const isSSH = !isLocalSession(sessionConfig);

    const command = sessionState
      ? sessionState.interpolate(step.command)
      : step.command;

    logger.emit({
      type: 'command_sent',
      session: sessionName,
      command,
    });

    const offset = tmux.currentOffset(sessionName);
    tmux.send(sessionName, command);
    await tmux.waitForPrompt(sessionName, 30_000);
    const output = tmux.readOutput(sessionName, offset);

    logger.emit({
      type: 'pane_captured',
      session: sessionName,
      output,
    });

    if (!isSSH && step.expect) {
      let { assertResult } = this.verifyOutput(step, stepIndex, output);

      // expect.retry: poll for eventual consistency. On a failed assertion,
      // wait `interval` and re-capture/re-assert up to `max` times. A `while`
      // guard makes only transient failures retryable (otherwise fail fast).
      const retry = extractRetryConfig(step.expect);
      if (retry && assertResult && !assertResult.pass) {
        const sleep =
          this.opts.sleep ??
          ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
        let attempt = 0;
        let latest = output;
        while (
          assertResult &&
          !assertResult.pass &&
          shouldRetry(attempt, retry, cleanTerminalOutput(latest))
        ) {
          await sleep(parseInterval(retry.interval));
          await tmux.waitForPrompt(sessionName, 30_000);
          latest = tmux.readOutput(sessionName, offset);
          logger.emit({
            type: 'pane_captured',
            session: sessionName,
            output: latest,
          });
          assertResult = this.verifyOutput(
            step,
            stepIndex,
            latest,
          ).assertResult;
          attempt += 1;
        }
      }

      if (assertResult) return { state: 'assert_result', assertResult };
    }

    if (isSSH) return { state: 'manual_verify' };

    return { state: 'complete' };
  }

  /**
   * Assert previously-captured pane output against `step.expect`, emitting
   * the same `assert_result` event `runVerify` emits — without sending a
   * command. Lets manual steps (where the operator runs the command
   * themselves) verify output that's already in the pane.
   */
  verifyOutput(
    step: Step,
    stepIndex: number,
    output: string,
  ): {
    assertResult?: ReturnType<typeof assertOutput>;
    detailed?: ReturnType<typeof assertOutputDetailed>;
  } {
    const { logger, sessionState } = this.opts;

    if (!step.expect) return {};

    const expect = sessionState
      ? interpolateExpect(step.expect, sessionState)
      : step.expect;
    // Pane captures are raw terminal bytes — strip ANSI codes and resolve
    // \r overwrites so assertions match what the operator actually sees.
    const cleaned = cleanTerminalOutput(output);
    const result = assertOutput(cleaned, expect);
    const detailed = assertOutputDetailed(cleaned, expect);

    logger.emit({
      type: 'assert_result',
      step: stepIndex,
      pass: result.pass,
      actual: result.actual,
      expected: result.expected,
      assertion_type: result.type,
    });

    return { assertResult: result, detailed };
  }

  async rollback(
    step: Step,
    stepIndex: number,
    triggeredBy: string,
  ): Promise<void> {
    const { logger, tmux } = this.opts;

    logger.emit({
      type: 'rollback_start',
      step: stepIndex,
      triggered_by: triggeredBy,
    });

    const rollbackSteps = step.rollback ?? [];

    for (const rb of rollbackSteps) {
      const sessionName = rb.session ?? step.session ?? 'default';

      logger.emit({
        type: 'command_sent',
        session: sessionName,
        command: rb.command,
        context: 'rollback',
      });

      if (tmux) {
        tmux.send(sessionName, rb.command);
        // Wait for operator to confirm each rollback step
        await tmux.waitForPrompt(sessionName, 60_000);
        const output = tmux.readOutput(sessionName, 0);
        logger.emit({
          type: 'pane_captured',
          session: sessionName,
          output,
          context: 'rollback',
        });
      }
    }

    logger.emit({
      type: 'rollback_complete',
      step: stepIndex,
      status: 'success',
    });
  }

  async waitForCompletion(
    sessionName: string,
    timeoutMs: number,
    idleThresholdMs = 0,
  ): Promise<'done' | 'timeout' | 'idle'> {
    if (!this.opts.tmux) return 'done';
    return this.opts.tmux.waitForPrompt(
      sessionName,
      timeoutMs,
      undefined,
      idleThresholdMs,
    );
  }

  completeStep(stepIndex: number): void {
    this.opts.logger.emit({ type: 'step_complete', step: stepIndex });
  }

  failStep(stepIndex: number, reason: string): void {
    this.opts.logger.emit({ type: 'step_failed', step: stepIndex, reason });
  }
}

const EXPECT_STRING_FIELDS = [
  'contains',
  'not_contains',
  'equals',
  'matches',
  'any_line_contains',
  'no_line_contains',
  'all_lines_match',
  'jsonpath',
] as const satisfies ReadonlyArray<keyof ExpectConfig>;

export function interpolateExpect(
  expect: ExpectConfig | ExpectConfig[] | string,
  state: SessionState,
): ExpectConfig | ExpectConfig[] | string {
  if (Array.isArray(expect)) {
    return expect.map((e) => interpolateExpect(e, state) as ExpectConfig);
  }
  if (typeof expect === 'string') {
    return state.interpolate(expect);
  }
  // There's nothing to interpolate inside a primitive shorthand value —
  // return it as-is rather than spreading it into an empty object and
  // losing the value.
  if (isPrimitiveExpectShorthand(expect)) return expect;
  const result: ExpectConfig = { ...expect };
  for (const field of EXPECT_STRING_FIELDS) {
    if (result[field]) result[field] = state.interpolate(result[field]);
  }
  if (result.equals_captured) {
    const val = state.get(result.equals_captured);
    if (val !== undefined) {
      result.equals = val;
      delete result.equals_captured;
    }
  }
  return result;
}

const DIM = '\x1b[2m';
const CYAN_BOLD = '\x1b[36;1m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const INVERSE = '\x1b[7m';

// Built via constructor so the control character never appears in a regex
// literal (biome noControlCharactersInRegex), matching the assertions.ts
// convention for ANSI-stripping regexes.
const ANSI_ESC = String.fromCharCode(0x1b);
const ANSI_RE = new RegExp(`${ANSI_ESC}\\[[0-9;]*m`, 'g');

/**
 * Strip ANSI SGR (color/style) escape sequences for VISIBLE-WIDTH
 * calculations — used when padding lines that contain highlight codes,
 * since `string.length` counts the invisible escape bytes too.
 */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

export function renderCodeBlock(code: string, language = 'bash'): string {
  const rawLines = code.split('\n');
  while (rawLines.length > 0 && rawLines[rawLines.length - 1].trim() === '') {
    rawLines.pop();
  }
  const lines = rawLines.length > 0 ? rawLines : [''];

  const MIN_FILL = language.length + 4;
  const { columns } = getTerminalSize();
  const maxFill = Math.max(MIN_FILL, columns - BOX_CHROME_COLS + 2);
  const maxLineLen = Math.max(...lines.map((l) => l.length));
  const fillWidth = Math.min(Math.max(maxLineLen + 2, MIN_FILL), maxFill);

  const topDashes = '─'.repeat(fillWidth - language.length - 3);
  const top = `  ${DIM}╭─ ${RESET}${CYAN_BOLD}${language}${RESET}${DIM} ${topDashes}╮${RESET}`;
  const bottom = `  ${DIM}╰${'─'.repeat(fillWidth)}╯${RESET}`;

  const codeLines = lines.map((raw) => {
    const line = truncateToWidth(raw, fillWidth - 2);
    const padding = ' '.repeat(
      Math.max(0, fillWidth - stripAnsi(line).length - 2),
    );
    return `  ${DIM}│${RESET} ${line}${padding} ${DIM}│${RESET}`;
  });

  return [top, ...codeLines, bottom].join('\n');
}

/**
 * Options for the optional line-number gutter rendered by
 * `renderHighlightedBlock`.
 */
export interface GutterOptions {
  /** 1-based line number of the FIRST rendered line. */
  startLineNo: number;
  /** 0-based indices (relative to the rendered lines) that contain a highlight. */
  arrowLines: Set<number>;
}

/**
 * Like `renderCodeBlock`, but pads using VISIBLE width (`stripAnsi(line).length`)
 * so lines containing highlight escape codes (from `renderVerifyOutcome`)
 * don't misalign the box border.
 *
 * When `opts.gutter` is provided, prefixes each line with a right-aligned
 * line number, a `→` arrow on lines containing a highlight (else a space),
 * and a `│` separator — e.g. ` 12 →│ pod web-0 Running`.
 */
export function renderHighlightedBlock(
  styledLines: string[],
  language = 'output',
  opts?: { gutter?: GutterOptions },
): string {
  const rawLines = styledLines.length > 0 ? [...styledLines] : [''];
  while (
    rawLines.length > 1 &&
    stripAnsi(rawLines[rawLines.length - 1]).trim() === ''
  ) {
    rawLines.pop();
  }

  const gutter = opts?.gutter;
  const gutterWidth = gutter
    ? String(gutter.startLineNo + rawLines.length - 1).length
    : 0;

  const decoratedLines = gutter
    ? rawLines.map((line, i) => {
        const lineNo = String(gutter.startLineNo + i).padStart(
          gutterWidth,
          ' ',
        );
        const arrow = gutter.arrowLines.has(i)
          ? `${BOLD}${GREEN}→${RESET}`
          : ' ';
        return `${DIM}${lineNo} ${RESET}${arrow}${DIM}│${RESET} ${line}`;
      })
    : rawLines;

  const MIN_FILL = language.length + 4;
  const { columns } = getTerminalSize();
  const maxFill = Math.max(MIN_FILL, columns - BOX_CHROME_COLS + 2);

  // Compute each decorated line's visible width once (stripAnsi is otherwise
  // re-run for both the max-width pass and the per-line padding pass).
  const rawWidths = decoratedLines.map((l) => stripAnsi(l).length);
  const maxLineLen = Math.max(...rawWidths);
  const fillWidth = Math.min(Math.max(maxLineLen + 2, MIN_FILL), maxFill);

  // Clamp content to the (possibly terminal-bounded) box width.
  const clippedLines = decoratedLines.map((line, i) =>
    rawWidths[i] > fillWidth - 2 ? truncateToWidth(line, fillWidth - 2) : line,
  );
  const visibleWidths = clippedLines.map((l) => stripAnsi(l).length);

  const topDashes = '─'.repeat(fillWidth - language.length - 3);
  const top = `  ${DIM}╭─ ${RESET}${CYAN_BOLD}${language}${RESET}${DIM} ${topDashes}╮${RESET}`;
  const bottom = `  ${DIM}╰${'─'.repeat(fillWidth)}╯${RESET}`;

  const codeLines = clippedLines.map((line, i) => {
    const padding = ' '.repeat(Math.max(0, fillWidth - visibleWidths[i] - 2));
    return `  ${DIM}│${RESET} ${line}${padding} ${DIM}│${RESET}`;
  });

  return [top, ...codeLines, bottom].join('\n');
}

export function renderKeyHints(
  hints: Array<{ key: string; label: string }>,
): string {
  const separator = `  ${DIM}·${RESET}  `;
  const parts = hints.map(
    ({ key, label }) => `${BOLD}${key}${RESET} ${DIM}${label}${RESET}`,
  );
  return `  ${parts.join(separator)}`;
}

const ASSERT_ACTUAL_TAIL_LINES = 8;
const ASSERT_ACTUAL_MAX_LINE_LEN = 200;
const VERIFY_OUTPUT_TAIL_LINES = 12;

// Rows reserved (header, checklist, borders, prompt) when scaling output tails
// to a small terminal; the captured-output tail shrinks to fit the remainder.
const TAIL_RESERVED_ROWS = 10;
const MIN_TAIL_LINES = 3;
// Visible columns consumed by a code-block line OUTSIDE the content area
// (`  │ ` prefix + ` │` suffix). Content fits in `columns - BOX_CHROME_COLS`.
const BOX_CHROME_COLS = 6;

const ANSI_SEQ_RE = new RegExp(`^${ANSI_ESC}\\[[0-9;]*m`);

/**
 * Current terminal size. Returns `Infinity` for either dimension when stdout
 * is NOT an interactive TTY (pipes, CI, redirected output) so rendering stays
 * unbounded and byte-for-byte identical to the pre-responsive behavior; only a
 * real terminal with a known small size triggers clamping/truncation.
 */
export function getTerminalSize(): { columns: number; rows: number } {
  const { columns, rows } = process.stdout;
  return {
    columns:
      typeof columns === 'number' && columns > 0
        ? columns
        : Number.POSITIVE_INFINITY,
    rows:
      typeof rows === 'number' && rows > 0 ? rows : Number.POSITIVE_INFINITY,
  };
}

/**
 * Truncate a (possibly ANSI-styled) line to `maxWidth` VISIBLE columns,
 * appending `…`. ANSI escape sequences pass through without counting toward
 * the width, and a trailing RESET is added when any style code survived so
 * colors don't bleed past the cut. No-op when `maxWidth` is non-finite.
 */
export function truncateToWidth(line: string, maxWidth: number): string {
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) return line;
  if (stripAnsi(line).length <= maxWidth) return line;

  const budget = Math.max(1, maxWidth - 1); // reserve a column for the ellipsis
  let out = '';
  let visible = 0;
  let i = 0;
  let sawAnsi = false;
  while (i < line.length && visible < budget) {
    const seq = line.slice(i).match(ANSI_SEQ_RE);
    if (seq) {
      out += seq[0];
      i += seq[0].length;
      sawAnsi = true;
      continue;
    }
    out += line[i];
    visible++;
    i++;
  }
  return `${out}…${sawAnsi ? RESET : ''}`;
}

/**
 * Scale an output-tail line count to the current terminal height: capped at
 * `maxTail`, never below `MIN_TAIL_LINES`, and unchanged when the height is
 * unknown (non-TTY).
 */
function scaleTailLines(maxTail: number): number {
  const { rows } = getTerminalSize();
  if (!Number.isFinite(rows)) return maxTail;
  return Math.max(MIN_TAIL_LINES, Math.min(maxTail, rows - TAIL_RESERVED_ROWS));
}

/**
 * Render a verify assertion outcome for the interactive loop. On failure the
 * tail of the actual captured output is included so the operator can see WHY
 * the assertion failed, not just what was expected.
 */
export function renderAssertOutcome(result: AssertResult): string {
  const icon = result.pass ? '✅ PASS' : '❌ FAIL';
  const lines = [
    `    ${icon} Assert (${result.type}): expected "${result.expected}"`,
  ];
  if (!result.pass && result.actual.trim()) {
    const tail = result.actual
      .split('\n')
      .slice(-scaleTailLines(ASSERT_ACTUAL_TAIL_LINES))
      .map((l) =>
        l.length > ASSERT_ACTUAL_MAX_LINE_LEN
          ? `${l.slice(0, ASSERT_ACTUAL_MAX_LINE_LEN)}…`
          : l,
      )
      .join('\n');
    lines.push('    Actual output (tail):');
    lines.push(renderCodeBlock(tail, 'output'));
  }
  return lines.join('\n');
}

/**
 * Flatten an `expect` (string / primitive shorthand / single config / array)
 * into single-field criterion descriptions, in the SAME field order
 * `buildChecks` evaluates them in — so `parts[i]` describes `checks[i]` for
 * a `assertOutputDetailed` result built from the same `expect`.
 *
 * `equals_captured` has no `renderExpectParts` entry (it's a runtime-only
 * field, dropped from static docs) — callers fall back to `check.expected`
 * for that one.
 */
function describeChecksInOrder(
  expect: ExpectConfig | ExpectConfig[] | string,
): string[] {
  if (typeof expect === 'string')
    return renderExpectParts({ contains: expect });
  if (isPrimitiveExpectShorthand(expect))
    return renderExpectParts({ contains: String(expect) });
  if (Array.isArray(expect)) return expect.flatMap(describeChecksInOrder);
  return renderExpectParts(expect);
}

/**
 * One highlight span to apply to the captured output: `[start, end)` byte
 * range plus the color to wrap it in. Spans are computed against the
 * UNSTYLED `actual` text, then applied (longest-first, non-overlapping) when
 * building the styled lines.
 */
interface HighlightSpan {
  start: number;
  end: number;
  color: typeof GREEN | typeof RED;
}

/**
 * Compute highlight spans for a single check against the unstyled `actual`
 * output:
 * - passing `contains` / `any_line_contains` / `matches`: GREEN+INVERSE
 *   around the first match.
 * - failing `not_contains` / `no_line_contains`: RED around the offending
 *   match (the text that should NOT have been there).
 */
function highlightSpansForCheck(
  actual: string,
  check: AssertResult,
): HighlightSpan[] {
  if (check.pass) {
    if (check.type === 'contains' || check.type === 'any_line_contains') {
      const idx = actual.indexOf(check.expected);
      if (idx === -1 || !check.expected) return [];
      return [{ start: idx, end: idx + check.expected.length, color: GREEN }];
    }
    if (check.type === 'matches') {
      const re = compileRegex(check.expected);
      const match = re?.exec(actual);
      if (!match || match[0].length === 0) return [];
      return [
        {
          start: match.index,
          end: match.index + match[0].length,
          color: GREEN,
        },
      ];
    }
    return [];
  }

  if (check.type === 'not_contains' || check.type === 'no_line_contains') {
    const needle = check.needle;
    if (!needle) return [];
    const idx = actual.indexOf(needle);
    if (idx === -1) return [];
    return [{ start: idx, end: idx + needle.length, color: RED }];
  }

  return [];
}

/**
 * Apply highlight spans to `actual` text, returning styled lines split on
 * `\n`. Spans are sorted and applied without overlap so the entire
 * matched/expected token stays contiguous — a plain `String.includes(...)`
 * over the rendered (un-stripped) output still finds the literal substring,
 * just wrapped in color codes around it rather than split in the middle.
 */
function applyHighlights(actual: string, spans: HighlightSpan[]): string[] {
  if (spans.length === 0) return actual.split('\n');

  // Sort by start, then drop spans that overlap an already-placed span —
  // keeps each highlighted token contiguous and unambiguous.
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const kept: HighlightSpan[] = [];
  let lastEnd = -1;
  for (const span of sorted) {
    if (span.start >= lastEnd) {
      kept.push(span);
      lastEnd = span.end;
    }
  }

  let styled = '';
  let pos = 0;
  for (const span of kept) {
    styled += actual.slice(pos, span.start);
    const colorCode = span.color === GREEN ? `${GREEN}${INVERSE}` : RED;
    styled += `${colorCode}${actual.slice(span.start, span.end)}${RESET}`;
    pos = span.end;
  }
  styled += actual.slice(pos);

  return styled.split('\n');
}

/**
 * Compute the 0-based line indices (within `actual`, split on `\n`) that
 * contain any part of the given highlight spans — used to mark the
 * line-number gutter with a `→` arrow. A span spanning multiple lines marks
 * every line it touches.
 */
function lineIndicesForSpans(
  actual: string,
  spans: HighlightSpan[],
): Set<number> {
  const result = new Set<number>();
  if (spans.length === 0) return result;

  // Precompute the cumulative character offset at the START of each line.
  const lineStarts: number[] = [0];
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] === '\n') lineStarts.push(i + 1);
  }

  const lineIndexForOffset = (offset: number): number => {
    // Find the last lineStart <= offset.
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  for (const span of spans) {
    const startLine = lineIndexForOffset(span.start);
    // `end` is exclusive — for a zero-length span fall back to startLine.
    const endLine = lineIndexForOffset(Math.max(span.start, span.end - 1));
    for (let i = startLine; i <= endLine; i++) result.add(i);
  }

  return result;
}

/**
 * Render a richer sidecar-mode verify outcome: a PASS/FAIL header, a
 * per-check checklist (with inline computed values), and the captured
 * output (tail by default, full when `opts.expand`) with matches/failures
 * highlighted in-line.
 */
export function renderVerifyOutcome(
  detailed: { pass: boolean; actual: string; checks: AssertResult[] },
  expect: ExpectConfig | ExpectConfig[] | string | undefined,
  opts?: { expand?: boolean },
): string {
  const expand = opts?.expand ?? false;
  const icon = detailed.pass ? '✅ PASS' : '❌ FAIL';
  const lines = [`    ${icon}`];

  const criteria = expect !== undefined ? describeChecksInOrder(expect) : [];
  detailed.checks.forEach((check, i) => {
    const criterion = criteria[i] ?? check.expected;
    const computed = describeComputedValue(check);
    const checkIcon = check.pass ? '✅' : '❌';
    lines.push(
      `    ${checkIcon} ${criterion}${computed ? ` (${computed})` : ''}`,
    );
  });

  if (detailed.actual.trim() || expand) {
    const allLines = detailed.actual.split('\n');
    const tailLines = expand
      ? allLines
      : allLines.slice(-scaleTailLines(VERIFY_OUTPUT_TAIL_LINES));
    const truncated = tailLines
      .map((l) =>
        l.length > ASSERT_ACTUAL_MAX_LINE_LEN
          ? `${l.slice(0, ASSERT_ACTUAL_MAX_LINE_LEN)}…`
          : l,
      )
      .join('\n');

    const spans = detailed.checks.flatMap((check) =>
      highlightSpansForCheck(truncated, check),
    );
    const arrowLines = lineIndicesForSpans(truncated, spans);
    const styledLines = applyHighlights(truncated, spans);

    // Append a "missing: <expected>" hint for failing string-based checks
    // whose expected value couldn't be highlighted (it isn't IN the output).
    for (const check of detailed.checks) {
      if (check.pass) continue;
      if (
        check.type === 'contains' ||
        check.type === 'equals' ||
        check.type === 'matches' ||
        check.type === 'any_line_contains'
      ) {
        styledLines.push(`${DIM}${RED}missing: ${check.expected}${RESET}`);
      }
    }

    const startLineNo = expand ? 1 : allLines.length - tailLines.length + 1;

    const label = expand ? 'output (full)' : 'output (tail)';
    lines.push(
      renderHighlightedBlock(styledLines, label, {
        gutter: { startLineNo, arrowLines },
      }),
    );
  }

  return lines.join('\n');
}

/**
 * Inline computed-value suffix for a checklist line, e.g.
 * `found "1", need ≥ 3` or `2 lines, expected 3`. Returns undefined when
 * the check type has no useful computed value to show inline.
 */
function describeComputedValue(check: AssertResult): string | undefined {
  // `expected` for comparison checks is pre-formatted as `>= N` / `<= N`;
  // strip the operator to recover the bare threshold for inline display.
  const threshold = check.expected.replace(/^(?:>=|<=)\s*/, '');
  switch (check.type) {
    case 'numeric_gte':
      return `found "${check.actual}", need ≥ ${threshold}`;
    case 'numeric_lte':
      return `found "${check.actual}", need ≤ ${threshold}`;
    case 'line_count':
      return `${check.actual} lines, expected ${check.expected}`;
    case 'line_count_gte':
      return `${check.actual} lines, expected ≥ ${threshold}`;
    case 'jsonpath':
      return check.pass ? undefined : `found "${check.actual}"`;
    case 'equals': {
      if (check.pass) return undefined;
      // `actual` is the full trimmed output for `equals` — keep the
      // checklist line single-line/readable; the full text is visible in
      // the output block below.
      const firstLine = check.actual.split('\n')[0];
      const snippet =
        firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
      return `found "${snippet}"`;
    }
    default:
      return undefined;
  }
}

export function renderTuiPending(
  step: Step,
  stepIndex: number,
  total: number,
  autoSend: boolean,
): string {
  const lines: string[] = [
    '─'.repeat(49),
    ` SAMARITAN  step ${stepIndex + 1}/${total}`,
    '─'.repeat(49),
    ` Name:      ${step.name}`,
  ];
  if (step.session) lines.push(` Session:   ${step.session}`);
  if (step.pic) lines.push(` PIC:       ${step.pic}`);
  if (step.reviewer) lines.push(` Reviewer:  ${step.reviewer}`);
  if (step.command) {
    lines.push('');
    lines.push(renderCodeBlock(step.command));
  }
  if (step.expect) {
    lines.push('');
    lines.push(` Expected: ${renderExpectDescription(step.expect)}`);
  }
  lines.push('─'.repeat(49));
  if (autoSend) {
    lines.push(' ⟳ Sending command...');
  } else {
    lines.push(renderKeyHints([{ key: 's', label: 'send' }]));
  }
  lines.push('─'.repeat(49));
  return lines.join('\n');
}

export function renderTuiWaiting(elapsed: number, timeout: number): string {
  return [
    '─'.repeat(49),
    ` ⏳ Running... (${elapsed}s / timeout: ${timeout}s)`,
    '─'.repeat(49),
    ' [d] mark done    [k] kill & rollback',
    '─'.repeat(49),
  ].join('\n');
}

export function renderTuiAssertResult(
  result: ReturnType<typeof assertOutput>,
): string {
  const icon = result.pass ? '✅ PASS' : '❌ FAIL';
  return [
    '─'.repeat(49),
    ` ${icon} — ${result.type} "${result.expected}"`,
    ` Output: ${result.actual}`,
    '─'.repeat(49),
    ' [c] confirm    [o] override    [r] rollback',
    '─'.repeat(49),
  ].join('\n');
}

export function renderTuiManualVerify(): string {
  return [
    '─'.repeat(49),
    ' Check execution pane and verify manually.',
    '─'.repeat(49),
    ' [v] verify OK    [f] verify FAIL    [r] rollback',
    '─'.repeat(49),
  ].join('\n');
}
