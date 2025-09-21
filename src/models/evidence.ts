export interface EvidenceMetadata {
  file_size?: number;
  format?: string;
  source?: string;
  original_path?: string;
  checksum?: string;
}

export interface EvidenceItem {
  id: string;
  step_id: string;
  type: 'screenshot' | 'log' | 'command_output' | 'file' | 'photo' | 'video';
  content: string | Buffer;
  filename?: string;
  timestamp: Date;
  operator: string;
  automatic: boolean;
  validated: boolean;
  metadata: EvidenceMetadata;
}

export interface RetryRecord {
  step_id: string;
  attempt_number: number;
  failed_at: Date;
  failure_reason: string;
  retry_reason: string;
  operator: string;
}

export interface ApprovalRecord {
  step_id: string;
  approver: string;
  approved: boolean;
  timestamp: Date;
  rationale: string;
  jira_ticket?: string;
}