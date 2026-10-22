import assert from 'node:assert';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { EventLogger } from '../../src/lib/event-logger';
import { createEventLogger } from '../../src/lib/event-logger';
import { findNearestRollbackSource } from '../../src/lib/rollback';
import { buildStepDepGraph } from '../../src/lib/step-deps';
import { StepController, type StepControllerOptions } from '../../src/lib/tui';
import type { Step } from '../../src/models/operation';

function makeLogger(id: string): EventLogger {
  return createEventLogger(id, join(tmpdir(), 'op.yaml'));
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

  it('without tmux, rollback records commands as displayed and NOT as a success', async () => {
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

    // Nothing could deliver the commands: they are displayed, never "sent",
    // and the rollback is never reported as a success.
    assert.strictEqual(
      events.filter((e) => e.type === 'command_sent').length,
      0,
      'no command_sent without a tmux backend',
    );
    const shown = events.filter(
      (e) => e.type === 'command_displayed' && e.context === 'rollback',
    );
    assert.strictEqual(shown.length, 2);
    assert.strictEqual(shown[0].command, 'docker rmi myapp:latest');
    assert.strictEqual(shown[1].command, 'git checkout HEAD~1');
    const done = events.find((e) => e.type === 'rollback_complete');
    assert.strictEqual(done.status, 'not_executed');

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

  it('runRollbackSteps without tmux reports not_executed, never success', async () => {
    const logger = makeLogger('rb-test-4');
    const { readFileSync } = await import('node:fs');
    const ctrl = new StepController({
      logger,
      tmux: undefined,
      sessionState: null as any,
      autoSend: false,
      autoExec: false,
    });
    await ctrl.runRollbackSteps(
      [{ command: 'echo undo', sub_steps: [{ command: 'echo nested' }] }],
      0,
      'alice',
      'global',
    );
    const events = readFileSync(logger.path, 'utf-8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.deepStrictEqual(
      events
        .filter((e) => e.type === 'command_displayed')
        .map((e) => [e.command, e.context]),
      [
        ['echo undo', 'global'],
        ['echo nested', 'global'],
      ],
    );
    assert.strictEqual(
      events.find((e) => e.type === 'rollback_complete').status,
      'not_executed',
    );
    cleanLogger(logger);
  });

  it('runRollbackSteps with tmux sends each command and reports success', async () => {
    const logger = makeLogger('rb-test-5');
    const { readFileSync } = await import('node:fs');
    const sent: string[] = [];
    const tmux = {
      send: (_s: string, cmd: string) => sent.push(cmd),
      waitForPrompt: async () => 'done',
      readOutput: () => 'ok',
    } as any;
    const ctrl = new StepController({
      logger,
      tmux,
      sessionState: null as any,
      autoSend: false,
      autoExec: false,
    });
    await ctrl.runRollbackSteps([{ command: 'echo undo' }], 0, 'alice');
    assert.deepStrictEqual(sent, ['echo undo']);
    const events = readFileSync(logger.path, 'utf-8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.strictEqual(
      events.find((e) => e.type === 'rollback_complete').status,
      'success',
    );
    cleanLogger(logger);
  });

  it('StepController has waitForCompletion method', () => {
    assert.strictEqual(
      typeof StepController.prototype.waitForCompletion,
      'function',
      'StepController must have waitForCompletion method',
    );
  });
});

describe('findNearestRollbackSource', () => {
  function step(
    name: string,
    opts: { id?: string; needs?: string[]; rollback?: boolean } = {},
  ): Step {
    return {
      name,
      type: 'manual',
      id: opts.id,
      needs: opts.needs,
      rollback: opts.rollback ? [{ command: `undo ${name}` }] : undefined,
    } as Step;
  }

  it('scans earlier steps in document order', () => {
    const steps = [step('A', { rollback: true }), step('B'), step('C')];
    const found = findNearestRollbackSource(steps, 2);
    assert.strictEqual(found?.stepIndex, 0);
    assert.strictEqual(found?.rollback[0].command, 'undo A');
  });

  it('prefers the needs chain over document order', () => {
    // C needs A (has rollback); B (nearer in doc order) also has rollback,
    // but the needs chain wins.
    const steps = [
      step('A', { id: 'a', rollback: true }),
      step('B', { rollback: true }),
      step('C', { needs: ['a'] }),
    ];
    const graph = buildStepDepGraph(steps);
    const found = findNearestRollbackSource(steps, 2, { graph });
    assert.strictEqual(
      found?.stepIndex,
      0,
      'should follow the needs chain to A',
    );
  });

  it('follows a transitive needs chain', () => {
    const steps = [
      step('A', { id: 'a', rollback: true }),
      step('B', { id: 'b', needs: ['a'] }),
      step('C', { needs: ['b'] }),
    ];
    const graph = buildStepDepGraph(steps);
    const found = findNearestRollbackSource(steps, 2, { graph });
    assert.strictEqual(found?.stepIndex, 0, 'B has no rollback → hop to A');
  });

  it('respects the isCandidate filter', () => {
    const steps = [
      step('A', { rollback: true }),
      step('B', { rollback: true }),
      step('C'),
    ];
    // Only step 1 (B) is a candidate.
    const found = findNearestRollbackSource(steps, 2, {
      isCandidate: (i) => i === 1,
    });
    assert.strictEqual(found?.stepIndex, 1);
  });

  it('returns undefined when nothing qualifies', () => {
    const steps = [step('A'), step('B'), step('C')];
    assert.strictEqual(findNearestRollbackSource(steps, 2), undefined);
  });
});
