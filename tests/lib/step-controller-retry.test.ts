import assert from 'node:assert';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  createEventLogger,
  type EventLogger,
} from '../../src/lib/event-logger';
import { SessionState } from '../../src/lib/session-state';
import { StepController, type StepControllerOptions } from '../../src/lib/tui';

function makeLogger(id: string): EventLogger {
  return createEventLogger(id, join(tmpdir(), 'op.yaml'));
}
function cleanLogger(logger: EventLogger): void {
  logger.close();
  if (existsSync(logger.path)) unlinkSync(logger.path);
}

/**
 * Minimal TmuxSession stub that returns a scripted sequence of `readOutput`
 * values (one per capture), so retry polling can be exercised deterministically
 * with no real tmux and no real waiting.
 */
function stubTmux(outputs: string[]): { tmux: any; reads: () => number } {
  let i = 0;
  const tmux = {
    currentOffset: () => 0,
    send: () => {},
    waitForPrompt: async () => 'done',
    readOutput: () => outputs[Math.min(i++, outputs.length - 1)],
  };
  return { tmux, reads: () => i };
}

function makeController(logger: EventLogger, tmux: any): StepController {
  const opts: StepControllerOptions = {
    logger,
    tmux,
    sessionState: null as any,
    autoSend: false,
    autoExec: false,
    sleep: async () => {}, // no real delay in tests
  };
  return new StepController(opts);
}

function makeControllerWithState(
  logger: EventLogger,
  tmux: any,
  state: SessionState,
): StepController {
  const opts: StepControllerOptions = {
    logger,
    tmux,
    sessionState: state,
    autoSend: false,
    autoExec: false,
    sleep: async () => {},
  };
  return new StepController(opts);
}

describe('StepController.runVerify — expect.retry polling', () => {
  it('retries until the output eventually passes', async () => {
    const logger = makeLogger('retry-pass');
    const { tmux } = stubTmux([
      'connection refused',
      'connection refused',
      'pod/web-0  Running',
    ]);
    const ctrl = makeController(logger, tmux);

    const step = {
      name: 'Wait for pod',
      command: 'kubectl get pods',
      expect: { contains: 'Running', retry: { interval: '1s', max: 5 } },
    } as any;

    const { state, assertResult } = await ctrl.runVerify(step, 0);
    assert.strictEqual(state, 'assert_result');
    assert.strictEqual(assertResult?.pass, true);
    cleanLogger(logger);
  });

  it('stops after max retries when it never passes', async () => {
    const logger = makeLogger('retry-exhaust');
    const { tmux, reads } = stubTmux(['nope', 'nope', 'nope', 'nope', 'nope']);
    const ctrl = makeController(logger, tmux);

    const step = {
      name: 'Never ready',
      command: 'check',
      expect: { contains: 'Ready', retry: { interval: '1s', max: 2 } },
    } as any;

    const { assertResult } = await ctrl.runVerify(step, 0);
    assert.strictEqual(assertResult?.pass, false);
    // 1 initial capture + 2 retries = 3 reads.
    assert.strictEqual(reads(), 3);
    cleanLogger(logger);
  });

  it('fails fast when the failure is not retryable (while guard)', async () => {
    const logger = makeLogger('retry-failfast');
    const { tmux, reads } = stubTmux([
      'fatal: permission denied',
      'should-not-be-read',
    ]);
    const ctrl = makeController(logger, tmux);

    const step = {
      name: 'Deploy',
      command: 'deploy',
      expect: {
        contains: 'Succeeded',
        retry: { interval: '1s', max: 5, while: 'connection refused|timeout' },
      },
    } as any;

    const { assertResult } = await ctrl.runVerify(step, 0);
    assert.strictEqual(assertResult?.pass, false);
    // Only the initial capture — the non-transient failure isn't retried.
    assert.strictEqual(reads(), 1);
    cleanLogger(logger);
  });

  it('keeps retrying a transient failure that matches the while guard', async () => {
    const logger = makeLogger('retry-transient');
    const { tmux } = stubTmux([
      'Error: i/o timeout',
      'Error: i/o timeout',
      'deployment succeeded',
    ]);
    const ctrl = makeController(logger, tmux);

    const step = {
      name: 'Deploy',
      command: 'deploy',
      expect: {
        contains: 'succeeded',
        retry: { interval: '500ms', max: 5, while: 'timeout' },
      },
    } as any;

    const { assertResult } = await ctrl.runVerify(step, 0);
    assert.strictEqual(assertResult?.pass, true);
    cleanLogger(logger);
  });

  it('expands ${VAR} in retry.while before applying the guard (live path)', async () => {
    // Regression: extractRetryConfig used step.expect directly (uninterpolated),
    // so ${TRANSIENT_PATTERN} in retry.while was never resolved and the guard
    // never matched — causing non-transient failures to be retried and transient
    // ones to fail fast (the opposite of the intended behaviour).
    const logger = makeLogger('retry-while-var');
    const { tmux, reads } = stubTmux([
      // First capture: transient error that matches the pattern stored in the var.
      'Error: connection timeout',
      // Second capture: passes the assertion.
      'deployment succeeded',
    ]);

    const state = new SessionState();
    state.capture('TRANSIENT_PATTERN', 'timeout');

    const ctrl = makeControllerWithState(logger, tmux, state);

    const step = {
      name: 'Deploy',
      command: 'deploy',
      expect: {
        contains: 'succeeded',
        // The while guard is a captured variable — must be substituted before use.
        retry: { interval: '500ms', max: 5, while: '${TRANSIENT_PATTERN}' },
      },
    } as any;

    const { assertResult } = await ctrl.runVerify(step, 0);
    // The transient failure was retried (guard matched after var expansion) and
    // the second capture passes the assertion.
    assert.strictEqual(assertResult?.pass, true);
    assert.strictEqual(
      reads(),
      2,
      'expected exactly 2 tmux reads (initial + 1 retry)',
    );
    cleanLogger(logger);
  });

  it('does not retry when ${VAR} in retry.while expands to a non-matching pattern', async () => {
    // Ensures var expansion produces the right pattern — a var that expands to a
    // pattern that does NOT match the failure output should stop retries fast.
    const logger = makeLogger('retry-while-var-nomatch');
    const { tmux, reads } = stubTmux([
      'fatal: permission denied',
      'should-not-be-read',
    ]);

    const state = new SessionState();
    state.capture('TRANSIENT_PATTERN', 'connection refused|timeout');

    const ctrl = makeControllerWithState(logger, tmux, state);

    const step = {
      name: 'Deploy',
      command: 'deploy',
      expect: {
        contains: 'succeeded',
        retry: { interval: '500ms', max: 5, while: '${TRANSIENT_PATTERN}' },
      },
    } as any;

    const { assertResult } = await ctrl.runVerify(step, 0);
    assert.strictEqual(assertResult?.pass, false);
    // Only the initial capture — non-transient failure should not be retried.
    assert.strictEqual(reads(), 1, 'expected exactly 1 tmux read (no retries)');
    cleanLogger(logger);
  });
});
