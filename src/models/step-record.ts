export interface StepCommandRecord {
  session: string;
  command: string;
  output?: string;
  displayed?: boolean;
}

export interface VerificationCheck {
  pass: boolean;
  actual?: string;
  expected?: string;
  type?: string;
}

export interface StepVerification {
  pass: boolean;
  checks: VerificationCheck[];
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

export interface RollbackRecord {
  step: number;
  triggeredBy: string;
  commands: Array<{ session: string; command: string; output?: string }>;
  status?: string;
}
