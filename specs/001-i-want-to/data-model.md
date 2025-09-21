# Data Model: SAMARITAN Operations Platform

**Generated**: 2025-09-09  
**Source**: Feature specification entities and functional requirements

## Core Entities

### Operation
**Purpose**: Complete procedure definition with environment support and version control

```typescript
interface Operation {
  id: string;                    // UUID for tracking
  name: string;                  // Human-readable identifier
  version: string;               // Semantic version (MAJOR.MINOR.BUILD)
  description: string;           // Brief description of operation purpose
  author?: string;               // Operation creator
  category?: string;             // Operation category (deploy, backup, incident, maintenance)
  tags?: string[];               // Searchable tags
  emergency?: boolean;           // Emergency operation flag (skips normal approvals)
  environments: Environment[];   // Supported environments (preprod, prod, etc.)
  variables: VariableMatrix;     // Environment-specific variable definitions
  steps: Step[];                 // Ordered execution steps
  preflight: PreflightCheck[];   // Prerequisites validation
  rollback?: RollbackPlan;       // Failure recovery procedures
  metadata: OperationMetadata;   // Git history, author, timestamps
  needs?: string[];              // Required operation IDs (dependencies)
  uses?: string;                 // Reference to marketplace operation
  with?: Record<string, any>;    // Parameters for marketplace operation
  matrix?: MatrixConfig;         // Multi-environment execution config
  reporting?: ReportingConfig;   // Post-execution reporting configuration
}
```

**Validation Rules**:
- `name` must be unique within repository
- `version` must follow semantic versioning
- At least one environment required
- Steps cannot be empty array
- All variable references in steps must be defined in variables

**State Transitions**:
- `draft` → `validated` → `executed` → `completed`
- `executed` → `failed` → `rolled_back`

### Step  
**Purpose**: Individual action within operation, supporting both automation and manual execution

```typescript
interface Step {
  id?: string;                   // Optional step identifier within operation
  name: string;                  // Human-readable step name  
  type: 'automatic' | 'manual' | 'approval' | 'conditional';
  description?: string;          // Detailed step description
  if?: string;                   // Conditional execution expression (GitHub Actions style)
  command?: string;              // Automated command (for automatic steps)
  instruction?: string;          // Human instructions (for manual steps)
  timeout?: number;              // Step timeout in seconds
  estimated_duration?: number;   // Estimated duration for the step in seconds
  env?: Record<string, any>;     // Step-specific environment variables
  with?: Record<string, any>;    // Step parameters
  evidence_required?: boolean;   // Whether evidence collection is mandatory
  evidence_types?: EvidenceType[]; // Types of evidence to collect
  validation?: StepValidation;   // Expected outcomes validation
  verify?: { command: string; }; // An explicit command to verify the step's outcome
  continue_on_error?: boolean;   // Don't fail operation on step failure
  retry?: RetryConfig;           // Retry configuration
  rollback?: RollbackStep;       // Step-specific rollback procedure
  needs?: string[];              // Prerequisite step IDs (within same operation)
  sub_steps?: Step[];            // A list of sub-steps to group related actions
  manual_override?: boolean;     // Can be executed manually if automation fails
  manual_instructions?: string;  // Instructions for manual execution
  approval?: ApprovalConfig;     // Approval workflow configuration
}
```

**Validation Rules**:
- `automatic` steps must have `command`
- `manual` steps must have `instruction`
- `approval` steps must specify approval mechanism
- `conditional` steps must have valid `condition` expression
- `depends_on` references must exist within same operation

### Environment
**Purpose**: Target deployment context with specific configuration

```typescript
interface Environment {
  name: string;                  // Environment identifier (preprod, prod)
  description: string;           // Environment description
  variables: Record<string, any>; // Environment-specific values
  restrictions: string[];        // Access or execution constraints
  approval_required: boolean;    // Whether manager approval needed
  validation_required: boolean;  // Whether preprod validation required before this env
}
```

### Evidence
**Purpose**: Digital proof of step completion with metadata

```typescript
interface EvidenceItem {
  id: string;                    // UUID for evidence item
  step_id: string;              // Associated step identifier
  type: 'screenshot' | 'log' | 'command_output' | 'file' | 'photo';
  content: string | Buffer;      // Evidence data (base64 for images)
  filename?: string;            // Original filename if applicable  
  timestamp: Date;              // When evidence was captured
  operator: string;             // Who provided the evidence
  automatic: boolean;           // Whether automatically captured
  validated: boolean;           // Whether evidence passed validation
  metadata: EvidenceMetadata;   // Size, format, source info
}
```

### Operation Session
**Purpose**: Persistent execution state with resume capability

```typescript
interface OperationSession {
  id: string;                   // Session UUID
  operation_id: string;        // Reference to operation definition
  environment: string;         // Target environment
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  current_step_index: number;  // Index of current/next step
  started_at: Date;            // Session start timestamp
  updated_at: Date;            // Last activity timestamp  
  participants: string[];      // Operators and approvers involved
  evidence: EvidenceItem[];    // Collected evidence items
  retry_history: RetryRecord[]; // Step retry attempts and reasons
  approvals: ApprovalRecord[]; // Approval decisions and rationale
  checkpoints: SessionCheckpoint[]; // Confluence page versions
  mode: 'automatic' | 'manual' | 'hybrid'; // Execution mode
}
```

**State Transitions**:
- `running` → `paused` (manual interrupt)
- `paused` → `running` (resume)
- `running` → `completed` (successful finish)
- `running` → `failed` (step failure)
- `failed` → `running` (retry/rollback)

### Quick Reference Handbook (QRH) Entry
**Purpose**: Emergency procedure lookup for on-call scenarios

```typescript
interface QRHEntry {
  id: string;                   // Unique identifier
  title: string;               // Procedure title
  category: 'incident' | 'alert' | 'maintenance' | 'emergency';
  keywords: string[];          // Search terms (error codes, service names)
  priority: 'P0' | 'P1' | 'P2' | 'P3'; // Incident priority
  procedure: Step[];           // Emergency response steps
  related_operations: string[]; // Links to full operations
  last_updated: Date;          // Maintenance timestamp
  author: string;              // Responsible engineer
  pagerduty_alerts: string[];  // Associated PagerDuty alert patterns
}
```

### Operation Marketplace Entry
**Purpose**: Reusable operation components for sharing

```typescript
interface MarketplaceOperation {
  id: string;                  // Unique marketplace identifier
  name: string;                // Operation name
  version: string;             // Semantic version
  author: string;              // Creator/maintainer
  description: string;         // Detailed description
  category: string;           // Classification (deploy, backup, incident)
  tags: string[];             // Searchable tags
  downloads: number;          // Usage statistics
  rating: number;             // Community rating (1-5)
  repository_url: string;     // Source code location
  documentation_url: string;  // Usage documentation
  compatible_versions: string[]; // Supported SAMARITAN versions
  dependencies: string[];     // Required marketplace operations
  examples: OperationExample[]; // Usage examples
}
```

## Supporting Data Structures

### Variable Matrix
```typescript
interface VariableMatrix {
  [environment: string]: Record<string, any>;
}
```

### Matrix Configuration
```typescript
interface MatrixConfig {
  [key: string]: any[];        // Matrix variables and their values
  include?: Array<Record<string, any>>; // Specific combinations to include
  exclude?: Array<Record<string, any>>; // Specific combinations to exclude
}
```

### Step Validation
```typescript
interface StepValidation {
  expect?: string;             // Expected output/result
  contains?: string;           // Output should contain this text
  exit_code?: number;          // Expected exit code
  not_contains?: string;       // Output should not contain this text
}
```

### Retry Configuration
```typescript
interface RetryConfig {
  attempts: number;            // Maximum retry attempts
  delay?: number;              // Delay between retries in seconds
  backoff?: 'linear' | 'exponential'; // Backoff strategy
  on_failure_only?: boolean;   // Only retry on failure (not timeout)
}
```

### Approval Configuration
```typescript
interface ApprovalConfig {
  required: boolean;
  approvers?: string[];        // User/group identifiers
  jira?: {
    project: string;
    issue_type: string;
    priority: 'Low' | 'Medium' | 'High' | 'Critical';
  };
  timeout?: string;            // Approval timeout (e.g., "24h", "2d")
  auto_approve_on_success?: boolean; // Auto-approve if previous steps succeeded
}
```

### Reporting Configuration
```typescript
interface ReportingConfig {
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
```

### Evidence Type Enum
```typescript
type EvidenceType = 'screenshot' | 'log' | 'command_output' | 'file' | 'photo' | 'video';
```

### Preflight Check
```typescript
interface PreflightCheck {
  name: string;
  type: 'command' | 'check' | 'manual';
  command?: string;            // Command to execute
  condition?: string;          // Expected result/condition
  description: string;         // Human-readable description
  timeout?: number;            // Check timeout in seconds
  evidence_required?: boolean; // Require evidence for manual checks
}
```

### Retry Record  
```typescript
interface RetryRecord {
  step_id: string;
  attempt_number: number;
  failed_at: Date;
  failure_reason: string;
  retry_reason: string;        // Operator's rationale for retry
  operator: string;
}
```

### Approval Record
```typescript
interface ApprovalRecord {
  step_id: string;
  approver: string;
  approved: boolean;
  timestamp: Date;
  rationale: string;
  jira_ticket?: string;       // Associated Jira ticket
}
```

### Session Checkpoint
```typescript  
interface SessionCheckpoint {
  step_index: number;
  confluence_page_id: string;
  version_number: number;
  timestamp: Date;
  state_snapshot: string;     // JSON serialized session state
}
```

## Data Relationships

```
Operation (1) ←→ (N) OperationSession
Operation (1) ←→ (N) Step
OperationSession (1) ←→ (N) EvidenceItem
OperationSession (1) ←→ (N) RetryRecord  
OperationSession (1) ←→ (N) ApprovalRecord
Step (1) ←→ (N) EvidenceItem
MarketplaceOperation (1) ←→ (N) Operation (via uses field)
QRHEntry (N) ←→ (N) Operation (via related_operations)
```

## Storage Strategy

### Local Storage (Git Repository)
- Operation definitions: `operations/*.yaml`
- QRH entries: `qrh/*.yaml`  
- Templates: `templates/*.yaml`
- Session state: `.samaritan/sessions/*.json`

### Remote Storage (Confluence Integration)
- Generated documentation: Confluence pages
- Session checkpoints: Page version history
- Release reports: Confluence page attachments

### API Integration Storage
- Approval records: Jira tickets + local cache
- Marketplace data: Remote API + local cache
- AI conversation history: Local encrypted storage

## Data Validation

### Operation Definition Validation
1. YAML schema validation against operation structure
2. Variable reference validation (all variables used in steps must be defined)
3. Dependency validation (referenced operations must exist)
4. Environment consistency validation
5. Step ordering validation (dependencies cannot create cycles)

### Runtime Validation  
1. Evidence completeness validation per step requirements
2. Approval validation against configured approval matrix
3. Session state consistency validation
4. Checkpoint integrity validation

This data model supports all functional requirements while maintaining flexibility for future extensions and enterprise-scale operations.