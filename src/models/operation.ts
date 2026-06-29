// ─── Execution Engine Types (Phase 2) ─────────────────────────────────────────

export interface SessionConfig {
  host?: string;
  user?: string;
  env?: Record<string, string>;
}

export interface ExecRollbackStep {
  command: string;
  session?: string;
}

export interface CaptureRule {
  pattern?: string;
  group?: number;
  line?: 'last' | 'first';
}

export type CaptureConfig = Record<string, CaptureRule>;

export interface RetryAssertConfig {
  interval: string;
  max: number;
  /**
   * Optional "retryable" guard: only keep retrying while the captured output
   * matches this pattern (substring OR regex) — e.g. a transient marker like
   * `connection refused|timeout`. When the output stops matching, verification
   * fails fast instead of burning the remaining attempts. Omit to retry on any
   * failure up to `max`.
   */
  while?: string;
}

export interface ExpectConfig {
  contains?: string;
  not_contains?: string;
  equals?: string;
  matches?: string;
  not_empty?: boolean;
  any_line_contains?: string;
  no_line_contains?: string;
  all_lines_match?: string;
  any_line_matches?: string;
  no_line_matches?: string;
  line_count?: number;
  line_count_gte?: number;
  numeric_gte?: number;
  numeric_lte?: number;
  jsonpath?: string;
  equals_captured?: string;
  retry?: RetryAssertConfig;
}

export interface RunConfig {
  auto_send?: boolean;
  auto_exec?: boolean;
}

// ─── Supporting Types and Enums ───────────────────────────────────────────────

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
export type ExecutionMode = 'automatic' | 'manual' | 'hybrid' | 'sidecar';
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

export interface EvidenceResult {
  type: EvidenceType;
  file?: string; // File path reference (relative to operation file)
  content?: string; // Inline content (for text-based evidence)
  description?: string; // Optional description/context
}

export interface EvidenceConfig {
  required?: boolean;
  types?: EvidenceType[];
  results?: Record<string, EvidenceResult[]>; // Environment-keyed evidence results (e.g., { staging: [...], production: [...] })
}

export interface StepOptions {
  substitute_vars?: boolean; // Default: true - substitute ${VAR} in instruction and command
  show_command_separately?: boolean; // Default: false - show command inline with instruction
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

export interface StepContent {
  command?: string;
  script?: string;
  instruction?: string;
  timeout?: number;
  description?: string;
  evidence?: EvidenceConfig;
  options?: StepOptions;
  session?: string;
  pic?: string;
  reviewer?: string;
  expect?: ExpectConfig | ExpectConfig[] | string;
}

// A rollback step IS a step structurally — it reuses Step's field definitions
// instead of re-declaring them. Every inherited field is optional (rollback
// steps don't require `name`/`type` the way normal steps do), and `sub_steps`
// is overridden to nest RollbackSteps. The strict schema definition
// `#/definitions/rollbackStep` remains the runtime contract: it permits only the
// subset the rollback renderers actually support, so authoring an unsupported
// Step field (e.g. `foreach`) fails validation rather than being silently dropped.
export interface RollbackStep extends Omit<Partial<Step>, 'sub_steps'> {
  sub_steps?: RollbackStep[];
}

export interface RollbackPlan {
  steps: RollbackStep[];
  automatic?: boolean;
  conditions?: string[];
  // When true, the global rollback also groups every step's own `rollback`
  // (reverse step order — most-recently-completed first), appended after the
  // explicit `steps` above. Lets operators author rollback next to the step it
  // undoes while still seeing/running one consolidated recovery. Opt-in
  // (default false) so existing manuals are unchanged. See src/lib/global-rollback.ts.
  aggregate_step_rollbacks?: boolean;
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

export interface TimelineConfig {
  start?: string; // Absolute start time (e.g., "2024-01-15 09:00")
  duration?: string; // Duration (e.g., "30m", "2h", "1d")
  after?: string; // Dependency on another step name
  status?: 'active' | 'done' | 'crit'; // Mermaid status
}

export interface Step extends StepContent {
  id?: string;
  name: string;
  type: StepType;
  phase?: StepPhase;
  if?: string;
  estimated_duration?: number;
  env?: Record<string, any>;
  uses?: string; // Path to a file whose steps are expanded inline here
  with?: Record<string, any>; // Variables to pass to uses: (also used for parameterized steps)
  variables?: Record<string, any>; // Step-scoped variables (override env and common vars)
  capture?: CaptureConfig;
  continue_on_error?: boolean;
  retry?: RetryConfig;
  rollback?: RollbackStep[];
  needs?: string[];
  sub_steps?: Step[];
  manual_override?: boolean;
  manual_instructions?: string;
  approval?: ApprovalConfig;
  ticket?: string | string[]; // Bug/issue ticket references (e.g., "JIRA-123" or ["BUG-456", "TASK-789"])
  foreach?: StepForeach; // Loop/matrix support for repeatable steps
  section_heading?: boolean; // If true, render as a new markdown heading instead of table row
  timeline?: string | TimelineConfig; // Expected date/time or duration for this step
  when?: string[]; // Conditional rendering: only show for these environments
  variants?: Record<string, Partial<Omit<Step, 'variants' | 'when'>>>; // Environment-specific overrides
  // Internal: set by the parser when this step was expanded from a `uses:` block.
  // All steps from the same outermost `uses:` share one id, keeping the block
  // contiguous during phase grouping. Not authored in YAML.
  usesGroup?: { id: string; name?: string };
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
  overview?: Record<string, any>;
  sessions?: Record<string, SessionConfig>;
  run?: RunConfig; // Flexible overview/metadata section with custom fields
  environments: Environment[];
  variables: VariableMatrix;
  common_variables?: Record<string, any>; // Common variables shared across all environments
  env_file?: string; // Path to .env file for loading variables
  steps: Step[];
  rollback?: RollbackPlan;
  metadata: OperationMetadata;
  needs?: string[];
  template?: string;
  with?: Record<string, any>;
  matrix?: MatrixConfig;
  reporting?: ReportingConfig;
}
