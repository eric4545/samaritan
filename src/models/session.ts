import type { ApprovalRecord, EvidenceItem, RetryRecord } from './evidence';
import type { ExecutionMode, SessionStatus } from './operation';
import type { StepRecord } from './step-record';

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
  operation_file?: string; // Absolute path to the operation YAML — required for cross-process resume
  environment: string;
  group?: string; // Operation group this run was started for (`--group`) — re-applied on resume
  status: SessionStatus;
  current_step_index: number;
  current_step_label?: string; // The manual's number of that step (`1.2.1`), for `sessions`
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
  step_log?: StepRecord[]; // Structured per-step record derived from the JSONL event log
  attach_target?: string; // Sidecar tmux pane attached via --attach / [t] — re-attached on resume
  /**
   * The last `[p]` paste while it may still be un-run on the pane's input line
   * (`[p]` never presses Enter). Saved so `resume` can re-check that pane and
   * keep refusing to paste on top of it (`[u]` clears it). Removed once it
   * runs (`[y]`) or is cleared (`[u]`). See `restorePendingPaste`.
   */
  pending_paste?: SavedPaste;
}

/** A `[p]` paste as saved on the session (`src/lib/paste-guard.ts`). */
export interface SavedPaste {
  command: string;
  /** Stable `#{pane_id}` the paste went to. */
  pane_id: string;
  /** Capture backend key (`step.session ?? 'default'`). */
  session_name: string;
  /** Foreground program at paste time (the shell). */
  shell?: string;
  /** Flat step index the paste was made on. */
  step: number;
  /** Rollback context when pasted from a rollback entry. */
  context?: string;
}
