import assert from 'node:assert';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  createEventLogger,
  type EventLogger,
} from '../../src/lib/event-logger';
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
});
