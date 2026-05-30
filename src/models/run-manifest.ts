import type { EvidenceType } from './operation';

export type RunStatus = 'in_progress' | 'completed' | 'failed' | 'aborted';

export interface RunEvidenceItem {
  type: EvidenceType;
  file?: string; // relative to run manifest file
  content?: string; // inline text
  description?: string;
  captured_at?: string; // ISO 8601 timestamp
}

export interface RunStepEvidence {
  evidence: RunEvidenceItem[];
  captured_at?: string; // when this step's evidence was collected
  operator?: string; // who collected (may differ from run operator)
}

export interface RunManifest {
  id: string;
  operation: string; // relative path to operation YAML (from run manifest location)
  operation_hash?: string; // sha256:<hex> of operation file content at run time
  operation_commit?: string; // git commit hash at run time
  environment: string;
  started_at?: string; // ISO 8601 timestamp
  completed_at?: string; // ISO 8601 timestamp
  operator?: string;
  status: RunStatus;
  steps?: Record<string, RunStepEvidence>; // step.id (or slugified name) → evidence
}
