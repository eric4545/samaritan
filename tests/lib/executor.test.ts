import assert from 'node:assert';
import { describe, it } from 'node:test';
import { createExecutor, ExecutorUtils } from '../../src/lib/executor';
import type { Operation } from '../../src/models/operation';

describe('Operation Executor', () => {
  const testOperation: Operation = {
    id: 'test-op-1',
    name: 'Test Operation',
    version: '1.0.0',
    description: 'Test operation for executor',
    environments: [
      {
        name: 'test',
        description: 'Test environment',
        variables: { TEST_VAR: 'test_value' },
        restrictions: [],
        approval_required: false,
        validation_required: false,
      },
    ],
    variables: {
      test: { TEST_VAR: 'test_value' },
    },
    steps: [
      {
        name: 'Automatic Step',
        type: 'automatic',
        description: 'Test automatic step',
        command: 'echo "hello world"',
      },
      {
        name: 'Manual Step',
        type: 'manual',
        description: 'Test manual step',
        instruction: 'Please verify the output',
      },
      {
        name: 'Evidence Step',
        type: 'automatic',
        description: 'Step requiring evidence',
        command: 'ls -la',
        evidence_required: true,
        evidence_types: ['screenshot', 'command_output'],
      },
    ],
    preflight: [],
    metadata: {
      created_at: new Date(),
      updated_at: new Date(),
      execution_count: 0,
    },
  };

  it('should create executor with initial state', () => {
    const context = ExecutorUtils.createContext(
      'test-op-1',
      'test',
      { TEST_VAR: 'test_value' },
      'test-user',
    );

    const executor = createExecutor(testOperation, context);
    const state = executor.getState();

    assert.strictEqual(state.operation.id, 'test-op-1');
    assert.strictEqual(state.context.environment, 'test');
    assert.strictEqual(state.status, 'pending');
    assert.strictEqual(state.currentStepIndex, 0);
    assert.strictEqual(state.totalSteps, 3);
    assert.strictEqual(state.completedSteps, 0);
    assert.strictEqual(state.failedSteps, 0);
    assert.strictEqual(state.skippedSteps, 0);
  });

  it('should initialize evidence collectors for steps requiring evidence', () => {
    const context = ExecutorUtils.createContext(
      'test-op-1',
      'test',
      { TEST_VAR: 'test_value' },
      'test-user',
    );

    const executor = createExecutor(testOperation, context);
    const state = executor.getState();

    // First two steps should not have evidence collectors
    assert.strictEqual(state.steps[0].evidenceCollector, undefined);
    assert.strictEqual(state.steps[1].evidenceCollector, undefined);

    // Third step should have evidence collector
    assert.ok(state.steps[2].evidenceCollector);
    assert.deepStrictEqual(
      state.steps[2].evidenceCollector.getState().requirements.types,
      ['screenshot', 'command_output'],
    );
  });

  it('should generate execution summary', () => {
    const context = ExecutorUtils.createContext(
      'test-op-1',
      'test',
      { TEST_VAR: 'test_value' },
      'test-user',
    );

    const executor = createExecutor(testOperation, context);
    const summary = executor.getSummary();

    assert.strictEqual(summary.operationId, 'test-op-1');
    assert.strictEqual(summary.operationName, 'Test Operation');
    assert.strictEqual(summary.environment, 'test');
    assert.strictEqual(summary.status, 'pending');
    assert.strictEqual(summary.progress, 0);
    assert.strictEqual(summary.totalSteps, 3);
    assert.strictEqual(summary.completedSteps, 0);
    assert.strictEqual(summary.failedSteps, 0);
    assert.strictEqual(summary.skippedSteps, 0);
    assert.strictEqual(summary.currentStep, 'Automatic Step');
  });

  it('should handle execution events', () => {
    const context = ExecutorUtils.createContext(
      'test-op-1',
      'test',
      { TEST_VAR: 'test_value' },
      'test-user',
    );

    const executor = createExecutor(testOperation, context);
    const events: any[] = [];

    executor.on('operation_started', (event) => {
      events.push(event);
    });

    executor.on('step_started', (event) => {
      events.push(event);
    });

    // Start execution (will be async but we're testing event emission)
    executor.start();

    // Allow some time for events to be emitted
    setTimeout(() => {
      assert.ok(events.length > 0);
      assert.strictEqual(events[0].type, 'operation_started');
    }, 10);
  });

  it('should support pause and resume', () => {
    const context = ExecutorUtils.createContext(
      'test-op-1',
      'test',
      { TEST_VAR: 'test_value' },
      'test-user',
    );

    const executor = createExecutor(testOperation, context);

    // Start and immediately pause
    executor.start();
    executor.pause();

    assert.strictEqual(executor.getState().status, 'paused');

    // Resume should change status back to running
    executor.resume();
    // Note: In real implementation, resume would continue execution
  });

  it('should support cancellation', () => {
    const context = ExecutorUtils.createContext(
      'test-op-1',
      'test',
      { TEST_VAR: 'test_value' },
      'test-user',
    );

    const executor = createExecutor(testOperation, context);

    executor.start();
    executor.cancel();

    const state = executor.getState();
    assert.strictEqual(state.status, 'cancelled');
    assert.ok(state.endTime);
  });

  it('should add evidence to steps', () => {
    const context = ExecutorUtils.createContext(
      'test-op-1',
      'test',
      { TEST_VAR: 'test_value' },
      'test-user',
    );

    const executor = createExecutor(testOperation, context);

    // Try to add evidence to step without evidence collector (should fail)
    const result1 = executor.addEvidence(0, {
      type: 'screenshot',
      content: 'test content',
      options: { filename: 'test.png' },
    });
    assert.strictEqual(result1, false);

    // Add evidence to step with evidence collector (should succeed)
    const result2 = executor.addEvidence(2, {
      type: 'screenshot',
      content: 'test screenshot content',
      options: {
        filename: 'test.png',
        metadata: { format: 'image/png' },
      },
    });
    assert.strictEqual(result2, true);

    // Verify evidence was added
    const evidenceState = executor
      .getState()
      .steps[2].evidenceCollector?.getState();
    assert.strictEqual(evidenceState?.collected.length, 1);
    assert.strictEqual(evidenceState?.collected[0].type, 'screenshot');
  });

  it('should handle dry run mode', () => {
    const context = ExecutorUtils.createContext(
      'test-op-1',
      'test',
      { TEST_VAR: 'test_value' },
      'test-user',
      { dryRun: true },
    );

    const executor = createExecutor(testOperation, context);
    assert.strictEqual(executor.getState().context.dryRun, true);
  });

  it('should handle auto vs manual mode', () => {
    const autoContext = ExecutorUtils.createContext(
      'test-op-1',
      'test',
      { TEST_VAR: 'test_value' },
      'test-user',
      { autoMode: true },
    );

    const manualContext = ExecutorUtils.createContext(
      'test-op-1',
      'test',
      { TEST_VAR: 'test_value' },
      'test-user',
      { autoMode: false },
    );

    const autoExecutor = createExecutor(testOperation, autoContext);
    const manualExecutor = createExecutor(testOperation, manualContext);

    assert.strictEqual(autoExecutor.getState().context.autoMode, true);
    assert.strictEqual(manualExecutor.getState().context.autoMode, false);
  });
});

describe('Waiting step regression tests', () => {
  const makeOperation = (steps: Operation['steps']): Operation => ({
    id: 'regression-op',
    name: 'Regression Operation',
    version: '1.0.0',
    description: '',
    environments: [
      {
        name: 'test',
        description: '',
        variables: {},
        restrictions: [],
        approval_required: false,
        validation_required: false,
      },
    ],
    variables: { test: {} },
    steps,
    preflight: [],
    metadata: {
      created_at: new Date(),
      updated_at: new Date(),
      execution_count: 0,
    },
  });

  it('manual step without user input does not produce completed status', async () => {
    const op = makeOperation([
      { name: 'Manual Step', type: 'manual', instruction: 'Do it manually' },
    ]);
    const context = ExecutorUtils.createContext('regression-op', 'test', {}, 'user');
    const executor = createExecutor(op, context);

    await executor.execute();

    const state = executor.getState();
    assert.notStrictEqual(state.status, 'completed', 'operation must not be completed when manual step is pending');
    assert.strictEqual(state.status, 'paused');
    assert.strictEqual(state.waitingSteps, 1);
    assert.strictEqual(state.completedSteps, 0);
  });

  it('approval step without input does not produce completed status', async () => {
    const op = makeOperation([
      { name: 'Approve', type: 'approval', instruction: 'Approve the change' },
    ]);
    const context = ExecutorUtils.createContext('regression-op', 'test', {}, 'user');
    const executor = createExecutor(op, context);

    await executor.execute();

    const state = executor.getState();
    assert.notStrictEqual(state.status, 'completed');
    assert.strictEqual(state.status, 'paused');
    assert.strictEqual(state.waitingSteps, 1);
  });

  it('hybrid run with pending manual step does not complete subsequent steps', async () => {
    const op = makeOperation([
      { name: 'Auto Step', type: 'automatic', command: 'echo hi' },
      { name: 'Manual Gate', type: 'manual', instruction: 'Verify output' },
      { name: 'After Gate', type: 'automatic', command: 'echo done' },
    ]);
    // autoMode: false => automatic steps also require manual confirmation
    const context = ExecutorUtils.createContext('regression-op', 'test', {}, 'user', { autoMode: false });
    const executor = createExecutor(op, context);

    await executor.execute();

    const state = executor.getState();
    assert.strictEqual(state.status, 'paused');
    assert.strictEqual(state.waitingSteps, 1);
    // The step after the gate must not have run
    assert.strictEqual(state.steps[2].status, 'pending', 'step after manual gate must remain pending');
  });

  it('getSummary reflects waitingSteps count', async () => {
    const op = makeOperation([
      { name: 'Manual', type: 'manual', instruction: 'Do something' },
    ]);
    const context = ExecutorUtils.createContext('regression-op', 'test', {}, 'user');
    const executor = createExecutor(op, context);

    await executor.execute();

    const summary = executor.getSummary();
    assert.strictEqual(summary.status, 'paused');
    assert.strictEqual(summary.waitingSteps, 1);
    assert.strictEqual(summary.completedSteps, 0);
  });

  it('operation with only automatic steps in autoMode still completes', async () => {
    const op = makeOperation([
      { name: 'Step 1', type: 'automatic', command: 'echo a' },
      { name: 'Step 2', type: 'automatic', command: 'echo b' },
    ]);
    const context = ExecutorUtils.createContext('regression-op', 'test', {}, 'user', { autoMode: true });
    const executor = createExecutor(op, context);

    await executor.execute();

    const state = executor.getState();
    assert.strictEqual(state.status, 'completed');
    assert.strictEqual(state.waitingSteps, 0);
    assert.strictEqual(state.completedSteps, 2);
  });
});

describe('Executor Utils', () => {
  it('should create execution context with defaults', () => {
    const context = ExecutorUtils.createContext(
      'op-1',
      'prod',
      { VAR1: 'value1' },
      'user1',
    );

    assert.strictEqual(context.operationId, 'op-1');
    assert.strictEqual(context.environment, 'prod');
    assert.deepStrictEqual(context.variables, { VAR1: 'value1' });
    assert.strictEqual(context.operator, 'user1');
    assert.strictEqual(context.dryRun, false);
    assert.strictEqual(context.autoMode, true);
    assert.ok(context.sessionId.startsWith('session-'));
  });

  it('should create execution context with custom options', () => {
    const context = ExecutorUtils.createContext(
      'op-1',
      'prod',
      { VAR1: 'value1' },
      'user1',
      {
        dryRun: true,
        autoMode: false,
        sessionId: 'custom-session-123',
      },
    );

    assert.strictEqual(context.dryRun, true);
    assert.strictEqual(context.autoMode, false);
    assert.strictEqual(context.sessionId, 'custom-session-123');
  });

  it('should format duration correctly', () => {
    assert.strictEqual(ExecutorUtils.formatDuration(1000), '1s');
    assert.strictEqual(ExecutorUtils.formatDuration(65000), '1m 5s');
    assert.strictEqual(ExecutorUtils.formatDuration(3665000), '1h 1m 5s');
    assert.strictEqual(ExecutorUtils.formatDuration(500), '0s');
  });

  it('should provide status emojis', () => {
    assert.strictEqual(ExecutorUtils.getStatusEmoji('pending'), '⏳');
    assert.strictEqual(ExecutorUtils.getStatusEmoji('running'), '🔄');
    assert.strictEqual(ExecutorUtils.getStatusEmoji('completed'), '✅');
    assert.strictEqual(ExecutorUtils.getStatusEmoji('failed'), '❌');
    assert.strictEqual(ExecutorUtils.getStatusEmoji('skipped'), '⏭️');
    assert.strictEqual(ExecutorUtils.getStatusEmoji('cancelled'), '🚫');
    assert.strictEqual(ExecutorUtils.getStatusEmoji('waiting'), '⏸️');
    assert.strictEqual(ExecutorUtils.getStatusEmoji('paused'), '⏸️');
  });
});
