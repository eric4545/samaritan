import { test } from 'node:test';
import assert from 'node:assert';
import { SessionManager, SessionUtils } from '../../src/lib/session-manager.js';
import { OperationExecutor } from '../../src/lib/executor.js';
import { Operation } from '../../src/models/operation.js';

test('SessionManager - createSession', () => {
  const sessionManager = new SessionManager();
  
  const session = sessionManager.createSession(
    'test-operation-id',
    'production',
    'test-operator',
    'automatic',
    { key: 'value' }
  );

  assert.strictEqual(session.operation_id, 'test-operation-id');
  assert.strictEqual(session.environment, 'production');
  assert.strictEqual(session.operator, 'test-operator');
  assert.strictEqual(session.mode, 'automatic');
  assert.strictEqual(session.status, 'running');
  assert.strictEqual(session.current_step_index, 0);
  assert.strictEqual(session.completion_percentage, 0);
  assert.deepStrictEqual(session.variables, { key: 'value' });
  assert.strictEqual(session.participants.length, 1);
  assert.strictEqual(session.participants[0], 'test-operator');
  assert.ok(session.id);
});

test('SessionManager - getSession', () => {
  const sessionManager = new SessionManager();
  
  const session = sessionManager.createSession('test-op', 'prod', 'operator');
  const retrieved = sessionManager.getSession(session.id);
  
  assert.deepStrictEqual(retrieved, session);
  
  const notFound = sessionManager.getSession('non-existent');
  assert.strictEqual(notFound, undefined);
});

test('SessionManager - pauseSession and resumeSession', async () => {
  const sessionManager = new SessionManager();
  
  const session = sessionManager.createSession('test-op', 'prod', 'operator');
  
  sessionManager.pauseSession(session.id);
  const pausedSession = sessionManager.getSession(session.id);
  assert.strictEqual(pausedSession?.status, 'paused');
  
  await sessionManager.resumeSession(session.id);
  const resumedSession = sessionManager.getSession(session.id);
  assert.strictEqual(resumedSession?.status, 'running');
});

test('SessionManager - cancelSession', () => {
  const sessionManager = new SessionManager();
  
  const session = sessionManager.createSession('test-op', 'prod', 'operator');
  
  sessionManager.cancelSession(session.id);
  const cancelledSession = sessionManager.getSession(session.id);
  assert.strictEqual(cancelledSession?.status, 'cancelled');
});

test('SessionManager - completeSession', () => {
  const sessionManager = new SessionManager();
  
  const session = sessionManager.createSession('test-op', 'prod', 'operator');
  
  // Test successful completion
  sessionManager.completeSession(session.id, true);
  let completedSession = sessionManager.getSession(session.id);
  assert.strictEqual(completedSession?.status, 'completed');
  assert.strictEqual(completedSession?.completion_percentage, 100);
  
  // Reset and test failed completion
  const session2 = sessionManager.createSession('test-op-2', 'prod', 'operator');
  sessionManager.completeSession(session2.id, false);
  completedSession = sessionManager.getSession(session2.id);
  assert.strictEqual(completedSession?.status, 'failed');
  assert.strictEqual(completedSession?.completion_percentage, 0);
});

test('SessionManager - createCheckpoint and resumeFromCheckpoint', () => {
  const sessionManager = new SessionManager();
  
  const session = sessionManager.createSession('test-op', 'prod', 'operator');
  session.current_step_index = 5;
  
  const checkpoint = sessionManager.createCheckpoint(session.id, 'confluence-123', 1);
  
  assert.strictEqual(checkpoint.step_index, 5);
  assert.strictEqual(checkpoint.confluence_page_id, 'confluence-123');
  assert.strictEqual(checkpoint.version_number, 1);
  assert.ok(checkpoint.timestamp);
  assert.ok(checkpoint.state_snapshot);
  
  // Modify session state
  const modifiedSession = sessionManager.getSession(session.id)!;
  modifiedSession.current_step_index = 10;
  modifiedSession.status = 'failed';
  
  // Resume from checkpoint
  const restoredSession = sessionManager.resumeFromCheckpoint(session.id, 0);
  assert.strictEqual(restoredSession.current_step_index, 5);
  assert.strictEqual(restoredSession.status, 'running');
});

test('SessionManager - addEvidence', () => {
  const sessionManager = new SessionManager();
  
  const session = sessionManager.createSession('test-op', 'prod', 'operator');
  
  const evidence = {
    id: 'evidence-1',
    step_id: 'step-1',
    type: 'log' as const,
    content: 'Test log content',
    timestamp: new Date(),
    operator: 'test-operator',
    automatic: true,
    validated: false,
    metadata: { size: 100, format: 'text' }
  };
  
  sessionManager.addEvidence(session.id, evidence);
  
  const updatedSession = sessionManager.getSession(session.id);
  assert.strictEqual(updatedSession?.evidence.length, 1);
  assert.deepStrictEqual(updatedSession?.evidence[0], evidence);
});

test('SessionManager - addRetryRecord', () => {
  const sessionManager = new SessionManager();
  
  const session = sessionManager.createSession('test-op', 'prod', 'operator');
  
  const retry = {
    step_id: 'step-1',
    attempt_number: 2,
    failed_at: new Date(),
    failure_reason: 'Connection timeout',
    retry_reason: 'Network issue resolved',
    operator: 'test-operator'
  };
  
  sessionManager.addRetryRecord(session.id, retry);
  
  const updatedSession = sessionManager.getSession(session.id);
  assert.strictEqual(updatedSession?.retry_history.length, 1);
  assert.deepStrictEqual(updatedSession?.retry_history[0], retry);
});

test('SessionManager - addApprovalRecord', () => {
  const sessionManager = new SessionManager();
  
  const session = sessionManager.createSession('test-op', 'prod', 'operator');
  
  const approval = {
    step_id: 'step-1',
    approver: 'manager-1',
    approved: true,
    timestamp: new Date(),
    rationale: 'Change approved for production deployment',
    jira_ticket: 'PROJ-123'
  };
  
  sessionManager.addApprovalRecord(session.id, approval);
  
  const updatedSession = sessionManager.getSession(session.id);
  assert.strictEqual(updatedSession?.approvals.length, 1);
  assert.deepStrictEqual(updatedSession?.approvals[0], approval);
});

test('SessionManager - associateExecutor integration', () => {
  const sessionManager = new SessionManager();
  
  const operation: Operation = {
    id: 'test-operation',
    name: 'Test Operation',
    version: '1.0.0',
    description: 'Test operation',
    environments: [{
      name: 'production',
      description: 'Production environment',
      variables: {},
      restrictions: [],
      approval_required: false,
      validation_required: false
    }],
    variables: { production: {} },
    steps: [
      {
        name: 'Test Step',
        type: 'automatic',
        command: 'echo "test"'
      }
    ],
    preflight: [],
    metadata: {
      created_at: new Date(),
      updated_at: new Date()
    }
  };
  
  const context = {
    operationId: 'test-operation',
    environment: 'production',
    variables: {},
    operator: 'test-operator',
    sessionId: 'test-session',
    dryRun: false,
    autoMode: true
  };
  
  const executor = new OperationExecutor(operation, context);
  const session = sessionManager.createSession('test-operation', 'production', 'test-operator');
  
  sessionManager.associateExecutor(session.id, executor);
  
  const retrievedExecutor = sessionManager.getExecutor(session.id);
  assert.strictEqual(retrievedExecutor, executor);
});

test('SessionManager - listSessions and filtering', () => {
  const sessionManager = new SessionManager();
  
  const session1 = sessionManager.createSession('op-1', 'prod', 'operator1');
  const session2 = sessionManager.createSession('op-2', 'staging', 'operator2');
  const session3 = sessionManager.createSession('op-1', 'prod', 'operator3');
  
  sessionManager.completeSession(session1.id);
  sessionManager.pauseSession(session2.id);
  
  const allSessions = sessionManager.listSessions();
  assert.strictEqual(allSessions.length, 3);
  
  const completedSessions = sessionManager.listSessionsByStatus('completed');
  assert.strictEqual(completedSessions.length, 1);
  assert.strictEqual(completedSessions[0].id, session1.id);
  
  const pausedSessions = sessionManager.listSessionsByStatus('paused');
  assert.strictEqual(pausedSessions.length, 1);
  assert.strictEqual(pausedSessions[0].id, session2.id);
  
  const op1Sessions = sessionManager.listSessionsByOperation('op-1');
  assert.strictEqual(op1Sessions.length, 2);
});

test('SessionManager - getSessionSummary', () => {
  const sessionManager = new SessionManager();
  
  const session = sessionManager.createSession('test-op', 'prod', 'operator');
  session.completion_percentage = 50;
  
  const summary = sessionManager.getSessionSummary(session.id);
  
  assert.ok(summary);
  assert.strictEqual(summary.id, session.id);
  assert.strictEqual(summary.operationId, 'test-op');
  assert.strictEqual(summary.environment, 'prod');
  assert.strictEqual(summary.operator, 'operator');
  assert.strictEqual(summary.progress, 50);
  assert.strictEqual(summary.status, 'running');
  
  const nonExistentSummary = sessionManager.getSessionSummary('non-existent');
  assert.strictEqual(nonExistentSummary, null);
});

test('SessionManager - cleanupOldSessions', () => {
  const sessionManager = new SessionManager();
  
  const session1 = sessionManager.createSession('op-1', 'prod', 'operator');
  const session2 = sessionManager.createSession('op-2', 'prod', 'operator');
  const session3 = sessionManager.createSession('op-3', 'prod', 'operator');
  
  sessionManager.completeSession(session1.id);
  sessionManager.completeSession(session2.id);
  // session3 remains running
  
  // Manually set old dates
  const oldDate = new Date();
  oldDate.setDate(oldDate.getDate() - 40);
  
  const completedSession1 = sessionManager.getSession(session1.id)!;
  completedSession1.updated_at = oldDate;
  
  const cleaned = sessionManager.cleanupOldSessions(30);
  
  assert.strictEqual(cleaned, 1);
  assert.strictEqual(sessionManager.getSession(session1.id), undefined);
  assert.ok(sessionManager.getSession(session2.id)); // Recent completed
  assert.ok(sessionManager.getSession(session3.id)); // Still running
});

test('SessionManager - exportSession and importSession', () => {
  const sessionManager = new SessionManager();
  
  const session = sessionManager.createSession('test-op', 'prod', 'operator');
  session.completion_percentage = 75;
  
  const exportedData = sessionManager.exportSession(session.id);
  assert.ok(exportedData);
  
  const parsedData = JSON.parse(exportedData);
  assert.strictEqual(parsedData.id, session.id);
  assert.strictEqual(parsedData.completion_percentage, 75);
  
  // Test import
  const newSessionManager = new SessionManager();
  const importedSession = newSessionManager.importSession(exportedData);
  
  assert.strictEqual(importedSession.id, session.id);
  assert.strictEqual(importedSession.completion_percentage, 75);
  
  const nullExport = sessionManager.exportSession('non-existent');
  assert.strictEqual(nullExport, null);
});

test('SessionManager - SessionUtils.createExecutionContextFromSession', () => {
  const sessionManager = new SessionManager();
  
  const session = sessionManager.createSession(
    'test-op',
    'production',
    'test-operator',
    'automatic',
    { key1: 'value1', key2: 'value2' }
  );
  
  const context = SessionUtils.createExecutionContextFromSession(session);
  
  assert.strictEqual(context.operationId, 'test-op');
  assert.strictEqual(context.environment, 'production');
  assert.strictEqual(context.operator, 'test-operator');
  assert.strictEqual(context.sessionId, session.id);
  assert.strictEqual(context.dryRun, false);
  assert.strictEqual(context.autoMode, true);
  assert.deepStrictEqual(context.variables, { key1: 'value1', key2: 'value2' });
});

test('SessionManager - SessionUtils.formatSessionDuration', () => {
  const sessionManager = new SessionManager();
  
  const session = sessionManager.createSession('test-op', 'prod', 'operator');
  
  // Mock different durations
  const now = new Date();
  
  // Test hours, minutes, seconds
  session.started_at = new Date(now.getTime() - (2 * 60 * 60 * 1000 + 30 * 60 * 1000 + 45 * 1000));
  session.updated_at = now;
  session.status = 'completed';
  let duration = SessionUtils.formatSessionDuration(session);
  assert.strictEqual(duration, '2h 30m 45s');
  
  // Test minutes, seconds
  session.started_at = new Date(now.getTime() - (5 * 60 * 1000 + 30 * 1000));
  duration = SessionUtils.formatSessionDuration(session);
  assert.strictEqual(duration, '5m 30s');
  
  // Test seconds only
  session.started_at = new Date(now.getTime() - 30 * 1000);
  duration = SessionUtils.formatSessionDuration(session);
  assert.strictEqual(duration, '30s');
});

test('SessionManager - SessionUtils.getSessionStatusEmoji', () => {
  assert.strictEqual(SessionUtils.getSessionStatusEmoji('running'), '🔄');
  assert.strictEqual(SessionUtils.getSessionStatusEmoji('paused'), '⏸️');
  assert.strictEqual(SessionUtils.getSessionStatusEmoji('completed'), '✅');
  assert.strictEqual(SessionUtils.getSessionStatusEmoji('failed'), '❌');
  assert.strictEqual(SessionUtils.getSessionStatusEmoji('cancelled'), '🚫');
});