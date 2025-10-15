// Supporting Types and Enums
export type EvidenceType =
  | 'screenshot'
  | 'file'
  | 'photo'
  | 'video'
  | 'log'
  | 'command_output';
export type SessionStatus =
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type ExecutionMode = 'automatic' | 'manual' | 'hybrid';
export type StepType = 'automatic' | 'manual' | 'approval' | 'conditional';
export type StepPhase = 'preflight' | 'flight' | 'postflight';
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';
export type QRHCategory = 'incident' | 'alert' | 'maintenance' | 'emergency';

// Configuration Interfaces
export interface RetryConfig {
  attempts: number;
  delay?: number;
  backoff?: 'linear' | 'exponential';
  on_failure_only?: boolean;
}

export interface ApprovalConfig {
  required: boolean;
  approvers?: string[];
  jira?: {
    project: string;
    issue_type: string;
    priority: 'Low' | 'Medium' | 'High' | 'Critical';
  };
  timeout?: string;
  auto_approve_on_success?: boolean;
}

export interface EvidenceConfig {
  required?: boolean;
  types?: EvidenceType[];
}

export interface StepOptions {
  substitute_vars?: boolean; // Default: true - substitute ${VAR} in instruction and command
  show_command_separately?: boolean; // Default: false - show command inline with instruction
}

export interface StepValidation {
  expect?: string;
  contains?: string;
  exit_code?: number;
  not_contains?: string;
}

export interface MatrixConfig {
  [key: string]: any[];
  include?: Array<Record<string, any>>;
  exclude?: Array<Record<string, any>>;
}

export interface ReportingConfig {
  confluence?: {
    space: string;
    parent_page?: string;
    template?: string;
  };
  notifications?: {
    slack?: {
      channel: string;
      on_success?: string;
      on_failure?: string;
    };
    email?: {
      recipients: string[];
      template?: string;
    };
  };
  evidence?: {
    retention_days?: number;
    auto_archive?: boolean;
    include_sensitive?: boolean;
  };
}

// Core Entity Interfaces
export interface PreflightCheck {
  name: string;
  type: 'command' | 'check' | 'manual';
  command?: string;
  condition?: string;
  description: string;
  timeout?: number;
  evidence?: EvidenceConfig;
  evidence_required?: boolean; // DEPRECATED: Use evidence.required instead
  // Legacy fields for backward compatibility
  expect_empty?: boolean;
}

export interface RollbackStep {
  command?: string;
  instruction?: string;
  timeout?: number;
  evidence?: EvidenceConfig;
  evidence_required?: boolean; // DEPRECATED: Use evidence.required instead
  options?: StepOptions;
}

export interface RollbackPlan {
  steps: RollbackStep[];
  automatic?: boolean;
  conditions?: string[];
}

export interface StepForeach {
  // Option 1: Single variable iteration (original syntax)
  var?: string; // Variable name to use in iteration
  values?: any[]; // Array of values to iterate over

  // Option 2: Matrix expansion (multiple variables, cartesian product)
  matrix?: {
    [key: string]: any[]; // Multiple variables with their value arrays
  };
  include?: Array<Record<string, any>>; // Add specific variable combinations
  exclude?: Array<Record<string, any>>; // Remove specific variable combinations
}

export interface Step {
  id?: string;
  name: string;
  type: StepType;
  phase?: StepPhase;
  description?: string;
  if?: string;
  command?: string;
  instruction?: string;
  condition?: string;
  timeout?: number;
  estimated_duration?: number;
  env?: Record<string, any>;
  with?: Record<string, any>;
  variables?: Record<string, any>; // Step-scoped variables (override env and common vars)
  evidence?: EvidenceConfig;
  evidence_required?: boolean; // DEPRECATED: Use evidence.required instead
  evidence_types?: EvidenceType[]; // DEPRECATED: Use evidence.types instead
  validation?: StepValidation;
  verify?: { command: string };
  continue_on_error?: boolean;
  retry?: RetryConfig;
  rollback?: RollbackStep;
  needs?: string[];
  sub_steps?: Step[];
  manual_override?: boolean;
  manual_instructions?: string;
  approval?: ApprovalConfig;
  ticket?: string | string[]; // Bug/issue ticket references (e.g., "JIRA-123" or ["BUG-456", "TASK-789"])
  foreach?: StepForeach; // Loop/matrix support for repeatable steps
  section_heading?: boolean; // If true, render as a new markdown heading instead of table row
  pic?: string; // Person In Charge for this step
  timeline?: string; // Expected date/time or duration for this step
  options?: StepOptions; // Step-level rendering and substitution options
}

export interface Environment {
  name: string;
  from?: string; // Inherit from environment manifest
  description: string;
  variables: Record<string, any>;
  restrictions: string[];
  approval_required: boolean;
  validation_required: boolean;
  targets?: string[];
}

export interface VariableMatrix {
  [environment: string]: Record<string, any>;
}

export interface OperationMetadata {
  git_hash?: string;
  git_branch?: string;
  created_at: Date;
  updated_at: Date;
  last_executed?: Date;
  execution_count?: number;
}

export interface Operation {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  category?: string;
  tags?: string[];
  emergency?: boolean;
  overview?: Record<string, any>; // Flexible overview/metadata section with custom fields
  environments: Environment[];
  variables: VariableMatrix;
  common_variables?: Record<string, any>; // Common variables shared across all environments
  env_file?: string; // Path to .env file for loading variables
  steps: Step[];
  preflight: PreflightCheck[];
  rollback?: RollbackPlan;
  metadata: OperationMetadata;
  needs?: string[];
  uses?: string;
  with?: Record<string, any>;
  matrix?: MatrixConfig;
  reporting?: ReportingConfig;
}
