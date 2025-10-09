import type { ApprovalRecord, EvidenceItem, RetryRecord } from './evidence';
import type { ExecutionMode, SessionStatus } from './operation';

export interface SessionCheckpoint {
  step_index: number;
  confluence_page_id: string;
  version_number: number;
  timestamp: Date;
  state_snapshot: string; // JSON serialized session state
}

export interface OperationSession {
  id: string;
  operation_id: string;
  environment: string;
  status: SessionStatus;
  current_step_index: number;
  started_at: Date;
  updated_at: Date;
  participants: string[];
  evidence: EvidenceItem[];
  retry_history: RetryRecord[];
  approvals: ApprovalRecord[];
  checkpoints: SessionCheckpoint[];
  mode: ExecutionMode;
  variables?: Record<string, any>; // Runtime variable overrides
  operator?: string; // Primary operator running the session
  completion_percentage?: number; // Calculated progress
}
