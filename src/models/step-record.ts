export interface StepCommandRecord {
  session: string;
  command: string;
  output?: string;
  displayed?: boolean;
  /** Enter pressed in the pane by samaritan (`[y]`, after a guarded `[p]`). */
  enterSent?: boolean;
}

export interface VerificationCheck {
  pass: boolean;
  actual?: string;
  expected?: string;
  type?: string;
}

/** An operator's decision to accept a failed verification (`o` override). */
export interface VerificationOverride {
  by: string;
  at: string;
  reason?: string;
}

export interface StepVerification {
  /** Final state: the LATEST verify attempt's result. */
  pass: boolean;
  /** The latest attempt's checklist (every check, no short-circuit). */
  checks: VerificationCheck[];
  /** The cleaned output the latest attempt was checked against. */
  output?: string;
  /** How many verify attempts ran (`[v]`, re-verify, `expect.retry` polls). */
  attempts?: number;
  /** How many of those attempts failed. */
  failedAttempts?: number;
  /** Set when the operator overrode a failed verification (`o` + reason). */
  override?: VerificationOverride;
  verifiedBy?: string;
  verifiedAt?: string;
}

export interface StepApproval {
  approver: string;
  approved: boolean;
  rationale?: string;
  timestamp: string;
}

export interface StepEvidenceRef {
  id?: string;
  type: string;
  description?: string;
  content?: string;
  filename?: string;
  path?: string;
}

export interface StepRecord {
  index: number;
  id?: string;
  name: string;
  phase?: string;
  pic?: string;
  reviewer?: string;
  /**
   * Who actually executed this step. Set when merging several operators'
   * partial runs of the same operation (`report merge`) so each step is
   * attributed to the session that ran it; left unset for a single-session run.
   */
  executed_by?: string;
  status: 'completed' | 'failed' | 'skipped' | 'pending';
  started_at?: string;
  ended_at?: string;
  duration_ms?: number;
  // Each command record carries the input (`command`) and its captured
  // `output` — the per-step input/output trail.
  commands: StepCommandRecord[];
  verification?: StepVerification;
  approval?: StepApproval;
  notes: string[];
  evidence: StepEvidenceRef[];
  failedReason?: string;
}

export interface RollbackCommandRecord {
  session: string;
  command: string;
  output?: string;
  /** Rollback entry name (e.g. `↩ Rollback for "Deploy"`). */
  name?: string;
  /** Shown to the operator (operator-driven) rather than sent by samaritan. */
  displayed?: boolean;
  /** An instruction-only entry (no command). */
  instruction?: boolean;
  /** Pasted into the attached pane with `[p]` (never with Enter). */
  pasted?: boolean;
  /** Enter pressed in the pane by samaritan (`[y]`, after a guarded `[p]`). */
  enterSent?: boolean;
  /** The operator's answer: ran it (`executed`), `skipped`, or `aborted`. */
  outcome?: 'executed' | 'skipped' | 'aborted';
  /** Result of `[v]` against this entry's `expect`, when verified. */
  verified?: boolean;
}

export interface RollbackRecord {
  step: number;
  triggeredBy: string;
  /** `rollback` (step `[r]`), `nearest` (upstream fallback) or `global` (`[g]`). */
  context?: string;
  commands: RollbackCommandRecord[];
  /**
   * `completed` | `partial` | `not_executed` for operator-driven rollbacks;
   * `success` when samaritan sent every command itself (spawn-own tmux).
   */
  status?: string;
  executed?: number;
  skipped?: number;
  total?: number;
}
