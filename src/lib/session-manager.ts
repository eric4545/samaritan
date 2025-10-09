import { randomUUID } from 'node:crypto';
import type {
  ApprovalRecord,
  EvidenceItem,
  RetryRecord,
} from '../models/evidence';
import type { ExecutionMode, SessionStatus } from '../models/operation';
import type { OperationSession, SessionCheckpoint } from '../models/session';
import type {
  ExecutionContext,
  OperationExecutionState,
  OperationExecutor,
} from './executor';

/**
 * Session management for operation execution with persistence and resume capability
 */
export class SessionManager {
  private sessions: Map<string, OperationSession> = new Map();
  private executors: Map<string, OperationExecutor> = new Map();

  /**
   * Create a new operation session
   */
  createSession(
    operationId: string,
    environment: string,
    operator: string,
    mode: ExecutionMode = 'automatic',
    variables?: Record<string, any>,
  ): OperationSession {
    const session: OperationSession = {
      id: randomUUID(),
      operation_id: operationId,
      environment,
      status: 'running',
      current_step_index: 0,
      started_at: new Date(),
      updated_at: new Date(),
      participants: [operator],
      evidence: [],
      retry_history: [],
      approvals: [],
      checkpoints: [],
      mode,
      variables,
      operator,
      completion_percentage: 0,
    };

    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): OperationSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Update session with executor state
   */
  updateSessionFromExecutor(
    sessionId: string,
    executorState: OperationExecutionState,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = this.mapExecutorStatusToSessionStatus(
      executorState.status,
    );
    session.current_step_index = executorState.currentStepIndex;
    session.updated_at = new Date();
    session.completion_percentage =
      this.calculateCompletionPercentage(executorState);

    // Collect evidence from completed steps
    session.evidence = this.collectEvidenceFromSteps(executorState);

    this.sessions.set(sessionId, session);
  }

  /**
   * Create checkpoint for session state
   */
  createCheckpoint(
    sessionId: string,
    confluencePageId?: string,
    versionNumber?: number,
  ): SessionCheckpoint {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const checkpoint: SessionCheckpoint = {
      step_index: session.current_step_index,
      confluence_page_id: confluencePageId || `confluence-${Date.now()}`,
      version_number: versionNumber || session.checkpoints.length + 1,
      timestamp: new Date(),
      state_snapshot: JSON.stringify(session),
    };

    session.checkpoints.push(checkpoint);
    session.updated_at = new Date();

    this.sessions.set(sessionId, session);
    return checkpoint;
  }

  /**
   * Resume session from checkpoint
   */
  resumeFromCheckpoint(
    sessionId: string,
    checkpointIndex?: number,
  ): OperationSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const checkpointIdx = checkpointIndex ?? session.checkpoints.length - 1;
    const checkpoint = session.checkpoints[checkpointIdx];

    if (!checkpoint) {
      throw new Error(
        `Checkpoint ${checkpointIdx} not found for session ${sessionId}`,
      );
    }

    // Restore session state from checkpoint
    const restoredSession: OperationSession = JSON.parse(
      checkpoint.state_snapshot,
    );
    restoredSession.id = sessionId; // Ensure ID consistency
    restoredSession.status = 'running'; // Resume as running
    restoredSession.updated_at = new Date();

    this.sessions.set(sessionId, restoredSession);
    return restoredSession;
  }

  /**
   * Pause session
   */
  pauseSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'paused';
      session.updated_at = new Date();
      this.sessions.set(sessionId, session);
    }

    // Pause associated executor
    const executor = this.executors.get(sessionId);
    if (executor) {
      executor.pause();
    }
  }

  /**
   * Resume session
   */
  async resumeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'running';
      session.updated_at = new Date();
      this.sessions.set(sessionId, session);
    }

    // Resume associated executor
    const executor = this.executors.get(sessionId);
    if (executor) {
      await executor.resume();
    }
  }

  /**
   * Cancel session
   */
  cancelSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'cancelled';
      session.updated_at = new Date();
      this.sessions.set(sessionId, session);
    }

    // Cancel associated executor
    const executor = this.executors.get(sessionId);
    if (executor) {
      executor.cancel();
    }
  }

  /**
   * Complete session
   */
  completeSession(sessionId: string, success: boolean = true): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = success ? 'completed' : 'failed';
      session.updated_at = new Date();
      session.completion_percentage = success
        ? 100
        : session.completion_percentage;
      this.sessions.set(sessionId, session);
    }
  }

  /**
   * Add evidence to session
   */
  addEvidence(sessionId: string, evidence: EvidenceItem): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.evidence.push(evidence);
      session.updated_at = new Date();
      this.sessions.set(sessionId, session);
    }
  }

  /**
   * Add retry record to session
   */
  addRetryRecord(sessionId: string, retry: RetryRecord): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.retry_history.push(retry);
      session.updated_at = new Date();
      this.sessions.set(sessionId, session);
    }
  }

  /**
   * Add approval record to session
   */
  addApprovalRecord(sessionId: string, approval: ApprovalRecord): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.approvals.push(approval);
      session.updated_at = new Date();
      this.sessions.set(sessionId, session);
    }
  }

  /**
   * Associate executor with session
   */
  associateExecutor(sessionId: string, executor: OperationExecutor): void {
    this.executors.set(sessionId, executor);

    // Set up event handlers to update session automatically
    executor.on('step_completed', (_event) => {
      this.updateSessionFromExecutor(sessionId, executor.getState());
    });

    executor.on('step_failed', (_event) => {
      this.updateSessionFromExecutor(sessionId, executor.getState());
    });

    executor.on('operation_completed', (_event) => {
      this.completeSession(sessionId, true);
    });

    executor.on('operation_failed', (_event) => {
      this.completeSession(sessionId, false);
    });

    executor.on('operation_paused', (_event) => {
      this.pauseSession(sessionId);
    });
  }

  /**
   * Get executor for session
   */
  getExecutor(sessionId: string): OperationExecutor | undefined {
    return this.executors.get(sessionId);
  }

  /**
   * List all sessions
   */
  listSessions(): OperationSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * List sessions by status
   */
  listSessionsByStatus(status: SessionStatus): OperationSession[] {
    return this.listSessions().filter((session) => session.status === status);
  }

  /**
   * List sessions by operation
   */
  listSessionsByOperation(operationId: string): OperationSession[] {
    return this.listSessions().filter(
      (session) => session.operation_id === operationId,
    );
  }

  /**
   * Get session summary
   */
  getSessionSummary(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const executor = this.executors.get(sessionId);
    const executorSummary = executor?.getSummary();

    return {
      id: session.id,
      operationId: session.operation_id,
      environment: session.environment,
      status: session.status,
      mode: session.mode,
      operator: session.operator,
      progress: session.completion_percentage || 0,
      startedAt: session.started_at,
      updatedAt: session.updated_at,
      currentStepIndex: session.current_step_index,
      participantsCount: session.participants.length,
      evidenceCount: session.evidence.length,
      retryCount: session.retry_history.length,
      approvalCount: session.approvals.length,
      checkpointCount: session.checkpoints.length,
      duration: executorSummary?.duration,
      lastError: executorSummary?.lastError,
    };
  }

  /**
   * Cleanup completed sessions older than specified days
   */
  cleanupOldSessions(daysOld: number = 30): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    let cleaned = 0;
    for (const [sessionId, session] of this.sessions.entries()) {
      if (
        (session.status === 'completed' ||
          session.status === 'failed' ||
          session.status === 'cancelled') &&
        session.updated_at < cutoffDate
      ) {
        this.sessions.delete(sessionId);
        this.executors.delete(sessionId);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Export session data for persistence
   */
  exportSession(sessionId: string): string | null {
    const session = this.sessions.get(sessionId);
    return session ? JSON.stringify(session, null, 2) : null;
  }

  /**
   * Import session data from persistence
   */
  importSession(sessionData: string): OperationSession {
    const session: OperationSession = JSON.parse(sessionData);
    this.sessions.set(session.id, session);
    return session;
  }

  // Private helper methods

  private mapExecutorStatusToSessionStatus(
    executorStatus: string,
  ): SessionStatus {
    switch (executorStatus) {
      case 'pending':
      case 'running':
        return 'running';
      case 'paused':
        return 'paused';
      case 'completed':
        return 'completed';
      case 'failed':
        return 'failed';
      case 'cancelled':
        return 'cancelled';
      default:
        return 'running';
    }
  }

  private calculateCompletionPercentage(
    executorState: OperationExecutionState,
  ): number {
    if (executorState.totalSteps === 0) return 0;
    return Math.round(
      (executorState.completedSteps / executorState.totalSteps) * 100,
    );
  }

  private collectEvidenceFromSteps(
    executorState: OperationExecutionState,
  ): EvidenceItem[] {
    const evidence: EvidenceItem[] = [];

    for (const stepState of executorState.steps) {
      if (stepState.evidenceCollector) {
        evidence.push(...stepState.evidenceCollector.getState().collected);
      }
    }

    return evidence;
  }
}

/**
 * Global session manager instance
 */
export const sessionManager = new SessionManager();

/**
 * Session utilities
 */
export const SessionUtils = {
  /**
   * Create execution context from session
   */
  createExecutionContextFromSession(
    session: OperationSession,
  ): ExecutionContext {
    return {
      operationId: session.operation_id,
      environment: session.environment,
      variables: session.variables || {},
      operator: session.operator || 'unknown',
      sessionId: session.id,
      dryRun: false,
      autoMode: session.mode === 'automatic',
    };
  },

  /**
   * Format session duration
   */
  formatSessionDuration(session: OperationSession): string {
    const endTime =
      session.status === 'running' ? new Date() : session.updated_at;
    const duration = endTime.getTime() - session.started_at.getTime();

    const hours = Math.floor(duration / (1000 * 60 * 60));
    const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((duration % (1000 * 60)) / 1000);

    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  },

  /**
   * Get session status emoji
   */
  getSessionStatusEmoji(status: SessionStatus): string {
    switch (status) {
      case 'running':
        return '🔄';
      case 'paused':
        return '⏸️';
      case 'completed':
        return '✅';
      case 'failed':
        return '❌';
      case 'cancelled':
        return '🚫';
      default:
        return '❓';
    }
  },
};
