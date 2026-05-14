import assert from 'node:assert';
import { existsSync, unlinkSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { EventLogger } from '../../src/lib/event-logger';
import { createEventLogger } from '../../src/lib/event-logger';
import { StepController, type StepControllerOptions } from '../../src/lib/tui';

function makeLogger(id: string): EventLogger {
  return createEventLogger(id);
}

function cleanLogger(logger: EventLogger): void {
  logger.close();
  if (existsSync(logger.path)) unlinkSync(logger.path);
}

describe('Rollback support (issue #9)', () => {
  it('StepController has rollback method', () => {
    assert.strictEqual(typeof StepController.prototype.rollback, 'function');
  });

  it('rollback emits rollback_start and rollback_complete events', async () => {
    const logger = makeLogger('rb-test-1');
    const { readFileSync } = await import('node:fs');

    const opts: StepControllerOptions = {
      logger,
      tmux: null as any,
      sessionState: null as any,
      autoSend: false,
      autoExec: false,
    };

    const step = {
      name: 'Deploy App',
      session: 'execution',
      rollback: [
        {
          command: 'kubectl rollout undo deployment/web',
          session: 'execution',
        },
      ],
    } as any;

    const ctrl = new StepController(opts);
    await ctrl.rollback(step, 0, 'user_input');

    const content = readFileSync(logger.path, 'utf-8');
    const events = content
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));

    const starts = events.filter((e) => e.type === 'rollback_start');
    const completes = events.filter((e) => e.type === 'rollback_complete');

    assert.strictEqual(starts.length, 1, 'should have one rollback_start');
    assert.strictEqual(
      completes.length,
      1,
      'should have one rollback_complete',
    );
    assert.strictEqual(starts[0].step, 0);
    assert.strictEqual(starts[0].triggered_by, 'user_input');

    cleanLogger(logger);
  });

  it('rollback emits command_sent with rollback context', async () => {
    const logger = makeLogger('rb-test-2');
    const { readFileSync } = await import('node:fs');

    const opts: StepControllerOptions = {
      logger,
      tmux: null as any,
      sessionState: null as any,
      autoSend: false,
      autoExec: false,
    };

    const step = {
      name: 'Build',
      session: 'execution',
      rollback: [
        { command: 'docker rmi myapp:latest', session: 'execution' },
        { command: 'git checkout HEAD~1', session: 'execution' },
      ],
    } as any;

    const ctrl = new StepController(opts);
    await ctrl.rollback(step, 1, 'user_input');

    const content = readFileSync(logger.path, 'utf-8');
    const events = content
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));

    const sent = events.filter(
      (e) => e.type === 'command_sent' && e.context === 'rollback',
    );
    assert.strictEqual(
      sent.length,
      2,
      'should have two rollback command_sent events',
    );
    assert.strictEqual(sent[0].command, 'docker rmi myapp:latest');
    assert.strictEqual(sent[1].command, 'git checkout HEAD~1');

    cleanLogger(logger);
  });

  it('rollback on step with no rollback logs message but still emits start/complete', async () => {
    const logger = makeLogger('rb-test-3');
    const { readFileSync } = await import('node:fs');

    const opts: StepControllerOptions = {
      logger,
      tmux: null as any,
      sessionState: null as any,
      autoSend: false,
      autoExec: false,
    };

    const step = { name: 'No Rollback Step', session: 'execution' } as any;
    const ctrl = new StepController(opts);
    await ctrl.rollback(step, 2, 'user_input');

    const content = readFileSync(logger.path, 'utf-8');
    const events = content
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const starts = events.filter((e) => e.type === 'rollback_start');
    assert.strictEqual(starts.length, 1);

    cleanLogger(logger);
  });
});
