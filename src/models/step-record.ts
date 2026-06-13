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
  status: 'completed' | 'failed' | 'skipped' | 'pending';
  started_at?: string;
  ended_at?: string;
  duration_ms?: number;
  inputs: {
    commands: StepCommandRecord[];
    instruction?: string;
  };
  outputs: StepCommandRecord[];
  verification?: StepVerification;
  approval?: StepApproval;
  notes: string[];
  evidence: StepEvidenceRef[];
  evidence_ids: string[];
  failedReason?: string;
  retry_count: number;
}

export interface RollbackRecord {
  step: number;
  triggeredBy: string;
  commands: Array<{ session: string; command: string; output?: string }>;
  status?: string;
}
