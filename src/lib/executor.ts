import { Operation, Step, StepType } from '../models/operation';
import { EvidenceCollector, createEvidenceRequirements } from '../evidence/collector';
import { EvidenceItem } from '../models/evidence';

/**
 * Execution status for operations and steps
 */
export type ExecutionStatus = 
  | 'pending'     // Not started
  | 'running'     // Currently executing
  | 'completed'   // Successfully completed
  | 'failed'      // Failed execution
  | 'skipped'     // Skipped (conditional)
  | 'cancelled'   // User cancelled
  | 'waiting'     // Waiting for approval/manual input
  | 'paused';     // Execution paused

/**
 * Step execution result
 */
export interface StepExecutionResult {
  stepId: string;
  status: ExecutionStatus;
  startTime: Date;
  endTime?: Date;
  output?: string;
  exitCode?: number;
  error?: string;
  evidence?: EvidenceItem[];
  manualNotes?: string;
}

/**
 * Operation execution context
 */
export interface ExecutionContext {
  operationId: string;
  environment: string;
  variables: Record<string, any>;
  operator: string;
  sessionId: string;
  dryRun: boolean;
  autoMode: boolean; // true = automatic where possible, false = all manual
}

/**
 * Step execution state
 */
export interface StepExecutionState {
  step: Step;
  status: ExecutionStatus;
  result?: StepExecutionResult;
  evidenceCollector?: EvidenceCollector;
  retryCount: number;
  lastError?: string;
}

/**
 * Operation execution state
 */
export interface OperationExecutionState {
  operation: Operation;
  context: ExecutionContext;
  status: ExecutionStatus;
  currentStepIndex: number;
  steps: StepExecutionState[];
  startTime: Date;
  endTime?: Date;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  skippedSteps: number;
}

/**
 * Execution event types for monitoring
 */
export type ExecutionEventType = 
  | 'operation_started'
  | 'operation_completed'
  | 'operation_failed'
  | 'operation_paused'
  | 'step_started'
  | 'step_completed'
  | 'step_failed'
  | 'step_skipped'
  | 'evidence_required'
  | 'approval_required'
  | 'user_input_required';

/**
 * Execution event data
 */
export interface ExecutionEvent {
  type: ExecutionEventType;
  timestamp: Date;
  operationId: string;
  stepId?: string;
  data?: any;
  message?: string;
}

/**
 * Operation executor - manages execution of SAMARITAN operations
 */
export class OperationExecutor {
  private state: OperationExecutionState;
  private eventHandlers: Map<ExecutionEventType, Array<(event: ExecutionEvent) => void>> = new Map();

  constructor(operation: Operation, context: ExecutionContext) {
    this.state = {
      operation,
      context,
      status: 'pending',
      currentStepIndex: 0,
      steps: operation.steps.map(step => ({
        step,
        status: 'pending',
        retryCount: 0
      })),
      startTime: new Date(),
      totalSteps: operation.steps.length,
      completedSteps: 0,
      failedSteps: 0,
      skippedSteps: 0
    };

    // Initialize evidence collectors for steps that require evidence
    this.initializeEvidenceCollectors();
  }

  /**
   * Get current execution state
   */
  getState(): OperationExecutionState {
    return { ...this.state };
  }

  /**
   * Get execution summary
   */
  getSummary() {
    const { status, totalSteps, completedSteps, failedSteps, skippedSteps } = this.state;
    const progress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

    return {
      operationId: this.state.operation.id,
      operationName: this.state.operation.name,
      environment: this.state.context.environment,
      status,
      progress,
      totalSteps,
      completedSteps,
      failedSteps,
      skippedSteps,
      currentStep: this.getCurrentStep()?.step.name,
      duration: this.getExecutionDuration(),
      lastError: this.getLastError()
    };
  }

  /**
   * Start operation execution
   */
  async start(): Promise<void> {
    if (this.state.status !== 'pending') {
      throw new Error(`Cannot start operation in ${this.state.status} state`);
    }

    this.state.status = 'running';
    this.state.startTime = new Date();

    this.emitEvent({
      type: 'operation_started',
      timestamp: new Date(),
      operationId: this.state.operation.id,
      message: `Started operation: ${this.state.operation.name}`
    });

    try {
      await this.executeSteps();
      
      if (this.state.failedSteps === 0) {
        this.state.status = 'completed';
        this.state.endTime = new Date();
        
        this.emitEvent({
          type: 'operation_completed',
          timestamp: new Date(),
          operationId: this.state.operation.id,
          message: `Operation completed successfully`
        });
      } else {
        this.state.status = 'failed';
        this.state.endTime = new Date();
        
        this.emitEvent({
          type: 'operation_failed',
          timestamp: new Date(),
          operationId: this.state.operation.id,
          message: `Operation failed with ${this.state.failedSteps} failed steps`
        });
      }
    } catch (error) {
      this.state.status = 'failed';
      this.state.endTime = new Date();
      
      this.emitEvent({
        type: 'operation_failed',
        timestamp: new Date(),
        operationId: this.state.operation.id,
        message: `Operation failed: ${(error as Error).message}`
      });
    }
  }

  /**
   * Pause operation execution
   */
  pause(): void {
    if (this.state.status === 'running') {
      this.state.status = 'paused';
      
      this.emitEvent({
        type: 'operation_paused',
        timestamp: new Date(),
        operationId: this.state.operation.id,
        message: 'Operation paused by user'
      });
    }
  }

  /**
   * Resume operation execution
   */
  async resume(): Promise<void> {
    if (this.state.status === 'paused') {
      this.state.status = 'running';
      await this.executeSteps();
    }
  }

  /**
   * Cancel operation execution
   */
  cancel(): void {
    this.state.status = 'cancelled';
    this.state.endTime = new Date();
    
    // Cancel current step if running
    const currentStep = this.getCurrentStep();
    if (currentStep && currentStep.status === 'running') {
      currentStep.status = 'cancelled';
    }
  }

  /**
   * Execute a specific step manually
   */
  async executeStepManually(stepIndex: number, userInput?: string): Promise<StepExecutionResult> {
    const stepState = this.state.steps[stepIndex];
    if (!stepState) {
      throw new Error(`Step ${stepIndex} not found`);
    }

    return this.executeStep(stepState, userInput);
  }

  /**
   * Add evidence to a step
   */
  addEvidence(stepIndex: number, evidenceData: any): boolean {
    const stepState = this.state.steps[stepIndex];
    if (!stepState?.evidenceCollector) {
      return false;
    }

    const result = stepState.evidenceCollector.addEvidence(
      evidenceData.type,
      evidenceData.content,
      this.state.context.operator,
      evidenceData.options
    );

    return result.success;
  }

  /**
   * Get current step being executed
   */
  getCurrentStep(): StepExecutionState | undefined {
    return this.state.steps[this.state.currentStepIndex];
  }

  /**
   * Register event handler
   */
  on(eventType: ExecutionEventType, handler: (event: ExecutionEvent) => void): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }
    this.eventHandlers.get(eventType)!.push(handler);
  }

  /**
   * Emit execution event
   */
  private emitEvent(event: ExecutionEvent): void {
    const handlers = this.eventHandlers.get(event.type);
    if (handlers) {
      handlers.forEach(handler => handler(event));
    }
  }

  /**
   * Initialize evidence collectors for steps
   */
  private initializeEvidenceCollectors(): void {
    this.state.steps.forEach(stepState => {
      const { step } = stepState;
      if (step.evidence_required) {
        const requirements = createEvidenceRequirements(
          step.evidence_required,
          step.evidence_types,
          {
            description: `Evidence required for step: ${step.name}`
          }
        );

        if (requirements) {
          stepState.evidenceCollector = new EvidenceCollector(
            step.id || `step-${this.state.steps.indexOf(stepState)}`,
            requirements
          );
        }
      }
    });
  }

  /**
   * Execute all steps in sequence
   */
  private async executeSteps(): Promise<void> {
    while (this.state.currentStepIndex < this.state.steps.length) {
      if (this.state.status === 'paused' || this.state.status === 'cancelled') {
        break;
      }

      const stepState = this.state.steps[this.state.currentStepIndex];
      
      // Check if step should be skipped (conditional execution)
      if (await this.shouldSkipStep(stepState)) {
        stepState.status = 'skipped';
        this.state.skippedSteps++;
        this.emitEvent({
          type: 'step_skipped',
          timestamp: new Date(),
          operationId: this.state.operation.id,
          stepId: stepState.step.id,
          message: `Step skipped: ${stepState.step.name}`
        });
        this.state.currentStepIndex++;
        continue;
      }

      try {
        const result = await this.executeStep(stepState);
        
        if (result.status === 'completed') {
          this.state.completedSteps++;
        } else if (result.status === 'failed') {
          this.state.failedSteps++;
          
          // Check if we should continue on error
          if (!stepState.step.continue_on_error) {
            break; // Stop execution
          }
        }
      } catch (error) {
        stepState.status = 'failed';
        stepState.lastError = (error as Error).message;
        this.state.failedSteps++;
        
        if (!stepState.step.continue_on_error) {
          break; // Stop execution
        }
      }

      this.state.currentStepIndex++;
    }
  }

  /**
   * Execute a single step
   */
  private async executeStep(stepState: StepExecutionState, userInput?: string): Promise<StepExecutionResult> {
    const { step } = stepState;
    stepState.status = 'running';

    const result: StepExecutionResult = {
      stepId: step.id || `step-${this.state.steps.indexOf(stepState)}`,
      status: 'running',
      startTime: new Date()
    };

    this.emitEvent({
      type: 'step_started',
      timestamp: new Date(),
      operationId: this.state.operation.id,
      stepId: result.stepId,
      message: `Started step: ${step.name}`
    });

    try {
      // Handle different step types
      switch (step.type) {
        case 'automatic':
          if (this.state.context.autoMode) {
            result.status = 'completed'; // TODO: Execute command
            result.output = 'Command executed successfully';
            result.exitCode = 0;
          } else {
            // In manual mode, require user confirmation
            result.status = 'waiting';
            this.emitEvent({
              type: 'user_input_required',
              timestamp: new Date(),
              operationId: this.state.operation.id,
              stepId: result.stepId,
              message: `Manual execution required for: ${step.name}`
            });
            return result;
          }
          break;

        case 'manual':
          result.status = 'waiting';
          this.emitEvent({
            type: 'user_input_required',
            timestamp: new Date(),
            operationId: this.state.operation.id,
            stepId: result.stepId,
            message: `Manual step: ${step.name}`
          });
          
          // In a real implementation, this would wait for user input
          if (userInput) {
            result.status = 'completed';
            result.manualNotes = userInput;
          } else {
            return result; // Wait for user input
          }
          break;

        case 'approval':
          result.status = 'waiting';
          this.emitEvent({
            type: 'approval_required',
            timestamp: new Date(),
            operationId: this.state.operation.id,
            stepId: result.stepId,
            message: `Approval required for: ${step.name}`
          });
          return result; // Wait for approval

        default:
          result.status = 'completed';
      }

      // Handle evidence collection
      if (step.evidence_required && stepState.evidenceCollector) {
        this.emitEvent({
          type: 'evidence_required',
          timestamp: new Date(),
          operationId: this.state.operation.id,
          stepId: result.stepId,
          message: `Evidence required for step: ${step.name}`
        });

        // Check if evidence collection is complete
        if (!stepState.evidenceCollector.isComplete()) {
          result.status = 'waiting';
          return result;
        }

        result.evidence = stepState.evidenceCollector.getState().collected;
      }

      result.endTime = new Date();
      stepState.status = result.status;
      stepState.result = result;

      this.emitEvent({
        type: result.status === 'completed' ? 'step_completed' : 'step_failed',
        timestamp: new Date(),
        operationId: this.state.operation.id,
        stepId: result.stepId,
        message: `Step ${result.status}: ${step.name}`
      });

      return result;

    } catch (error) {
      result.status = 'failed';
      result.error = (error as Error).message;
      result.endTime = new Date();
      
      stepState.status = 'failed';
      stepState.lastError = result.error;
      stepState.result = result;

      this.emitEvent({
        type: 'step_failed',
        timestamp: new Date(),
        operationId: this.state.operation.id,
        stepId: result.stepId,
        message: `Step failed: ${step.name} - ${result.error}`
      });

      return result;
    }
  }

  /**
   * Check if step should be skipped based on conditions
   */
  private async shouldSkipStep(stepState: StepExecutionState): Promise<boolean> {
    const { step } = stepState;
    
    // TODO: Implement conditional logic evaluation
    // For now, just return false (don't skip)
    if (step.if) {
      // Parse and evaluate condition expression
      // This would involve evaluating expressions like ${{ success() }}
      return false;
    }

    return false;
  }

  /**
   * Get execution duration in milliseconds
   */
  private getExecutionDuration(): number {
    const endTime = this.state.endTime || new Date();
    return endTime.getTime() - this.state.startTime.getTime();
  }

  /**
   * Get last error message
   */
  private getLastError(): string | undefined {
    const failedStep = this.state.steps.find(s => s.status === 'failed');
    return failedStep?.lastError;
  }
}

/**
 * Create a new operation executor
 */
export function createExecutor(operation: Operation, context: ExecutionContext): OperationExecutor {
  return new OperationExecutor(operation, context);
}

/**
 * Execution utilities
 */
export const ExecutorUtils = {
  /**
   * Create execution context
   */
  createContext(
    operationId: string,
    environment: string,
    variables: Record<string, any>,
    operator: string,
    options: {
      dryRun?: boolean;
      autoMode?: boolean;
      sessionId?: string;
    } = {}
  ): ExecutionContext {
    return {
      operationId,
      environment,
      variables,
      operator,
      sessionId: options.sessionId || `session-${Date.now()}`,
      dryRun: options.dryRun || false,
      autoMode: options.autoMode !== false // Default to true
    };
  },

  /**
   * Format execution duration
   */
  formatDuration(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  },

  /**
   * Get status emoji for display
   */
  getStatusEmoji(status: ExecutionStatus): string {
    switch (status) {
      case 'pending': return '⏳';
      case 'running': return '🔄';
      case 'completed': return '✅';
      case 'failed': return '❌';
      case 'skipped': return '⏭️';
      case 'cancelled': return '🚫';
      case 'waiting': return '⏸️';
      case 'paused': return '⏸️';
      default: return '❓';
    }
  }
};