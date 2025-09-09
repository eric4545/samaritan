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
  environments: Environment[];   // Supported environments (preprod, prod, etc.)
  variables: VariableMatrix;     // Environment-specific variable definitions
  steps: Step[];                 // Ordered execution steps
  preflight: PreflightCheck[];   // Prerequisites validation
  rollback: RollbackPlan;        // Failure recovery procedures
  metadata: OperationMetadata;   // Git history, author, timestamps
  dependencies: string[];        // Required operation IDs or modules
  uses?: string;                 // Reference to marketplace operation
  matrix?: MatrixConfig;         // Multi-environment execution config
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
  id: string;                    // Step identifier within operation
  name: string;                  // Human-readable step name  
  type: 'automatic' | 'manual' | 'approval' | 'conditional';
  description: string;           // Detailed step description
  command?: string;              // Automated command (for automatic steps)
  instruction?: string;          // Human instructions (for manual steps)
  condition?: string;            // Execution condition (for conditional steps)
  timeout?: number;              // Step timeout in seconds
  retryable: boolean;           // Whether step can be retried
  evidence_required: boolean;    // Whether evidence collection is mandatory
  rollback?: RollbackStep;       // Step-specific rollback procedure
  depends_on?: string[];         // Prerequisite step IDs
  manual_override?: boolean;     // Can be executed manually if automation fails
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