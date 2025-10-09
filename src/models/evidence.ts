import type { EvidenceType } from './operation';

export interface EvidenceMetadata {
  size: number; // File size in bytes
  format: string; // File format/MIME type
  source: string; // Source of evidence (manual, automatic, system)
  checksum?: string; // File integrity checksum
  original_filename?: string; // Original filename if uploaded
  capture_method?: string; // How evidence was captured
  resolution?: string; // For images/videos
  duration?: number; // For videos/audio in seconds
  original_path?: string; // Legacy field for backward compatibility
}

export interface EvidenceItem {
  id: string; // UUID for evidence item
  step_id: string; // Associated step identifier
  type: EvidenceType; // Type of evidence
  content: string | Buffer; // Evidence data (base64 for images, text for logs)
  filename?: string; // Display filename
  timestamp: Date; // When evidence was captured
  operator: string; // Who provided the evidence
  automatic: boolean; // Whether automatically captured
  validated: boolean; // Whether evidence passed validation
  metadata: EvidenceMetadata; // Additional evidence metadata
  description?: string; // Optional description/context
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

// Evidence validation result
export interface EvidenceValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  metadata: Partial<EvidenceMetadata>;
}

// Evidence collection requirements for a step
export interface EvidenceRequirement {
  types: EvidenceType[]; // Required evidence types
  minimum_count?: number; // Minimum number of evidence items
  description?: string; // What kind of evidence is needed
  auto_collect?: boolean; // Whether to try automatic collection
  validation_rules?: EvidenceValidationRule[];
}

// Evidence validation rules
export interface EvidenceValidationRule {
  type: EvidenceType;
  max_size?: number; // Maximum file size in bytes
  allowed_formats?: string[]; // Allowed MIME types/formats
  required_content?: string[]; // Required text content (for logs)
  forbidden_content?: string[]; // Forbidden text content
  min_resolution?: string; // Minimum resolution for images
  max_duration?: number; // Maximum duration for videos
}

// Evidence collection session state
export interface EvidenceCollectionState {
  step_id: string;
  requirements: EvidenceRequirement;
  collected: EvidenceItem[];
  missing: EvidenceType[];
  validation_errors: string[];
  completed: boolean;
}
