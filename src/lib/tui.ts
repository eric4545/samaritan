import type { ExpectConfig, Step } from '../models/operation';
import {
  type AssertResult,
  assertOutput,
  cleanTerminalOutput,
  isPrimitiveExpectShorthand,
  renderExpectDescription,
} from './assertions';
import type { EventLogger } from './event-logger';
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
      const { assertResult } = this.verifyOutput(step, stepIndex, output);
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
  ): { assertResult?: ReturnType<typeof assertOutput> } {
    const { logger, sessionState } = this.opts;

    if (!step.expect) return {};

    const expect = sessionState
      ? interpolateExpect(step.expect, sessionState)
      : step.expect;
    // Pane captures are raw terminal bytes — strip ANSI codes and resolve
    // \r overwrites so assertions match what the operator actually sees.
    const result = assertOutput(cleanTerminalOutput(output), expect);

    logger.emit({
      type: 'assert_result',
      step: stepIndex,
      pass: result.pass,
      actual: result.actual,
      expected: result.expected,
      assertion_type: result.type,
    });

    return { assertResult: result };
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

export function renderCodeBlock(code: string, language = 'bash'): string {
  const rawLines = code.split('\n');
  while (rawLines.length > 0 && rawLines[rawLines.length - 1].trim() === '') {
    rawLines.pop();
  }
  const lines = rawLines.length > 0 ? rawLines : [''];

  const MIN_FILL = language.length + 4;
  const maxLineLen = Math.max(...lines.map((l) => l.length));
  const fillWidth = Math.max(maxLineLen + 2, MIN_FILL);

  const topDashes = '─'.repeat(fillWidth - language.length - 3);
  const top = `  ${DIM}╭─ ${RESET}${CYAN_BOLD}${language}${RESET}${DIM} ${topDashes}╮${RESET}`;
  const bottom = `  ${DIM}╰${'─'.repeat(fillWidth)}╯${RESET}`;

  const codeLines = lines.map((line) => {
    const padding = ' '.repeat(fillWidth - line.length - 2);
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
      .slice(-ASSERT_ACTUAL_TAIL_LINES)
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
