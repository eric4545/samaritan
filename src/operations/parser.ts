import fs from 'fs';
import yaml from 'js-yaml';
import { 
  Operation, 
  Environment, 
  VariableMatrix, 
  OperationMetadata, 
  Step, 
  PreflightCheck,
  StepType,
  EvidenceType 
} from '../models/operation';
import { randomUUID } from 'crypto';

interface ValidationError {
  field: string;
  message: string;
  value?: any;
}

export class OperationParseError extends Error {
  public errors: ValidationError[];
  
  constructor(message: string, errors: ValidationError[] = []) {
    super(message);
    this.name = 'OperationParseError';
    this.errors = errors;
  }
}

function validateStepType(type: string): StepType {
  const validTypes: StepType[] = ['automatic', 'manual', 'approval', 'conditional'];
  if (!validTypes.includes(type as StepType)) {
    throw new ValidationError(`Invalid step type: ${type}. Must be one of: ${validTypes.join(', ')}`);
  }
  return type as StepType;
}

function validateEvidenceTypes(types: string[]): EvidenceType[] {
  const validTypes: EvidenceType[] = ['screenshot', 'log', 'command_output', 'file', 'photo', 'video'];
  const invalidTypes = types.filter(type => !validTypes.includes(type as EvidenceType));
  if (invalidTypes.length > 0) {
    throw new ValidationError(`Invalid evidence types: ${invalidTypes.join(', ')}. Must be one of: ${validTypes.join(', ')}`);
  }
  return types as EvidenceType[];
}

function parseStep(stepData: any, stepIndex: number): Step {
  const errors: ValidationError[] = [];
  
  // Validate required fields
  if (!stepData.name || stepData.name.trim() === '') {
    errors.push({ field: `steps[${stepIndex}].name`, message: 'Step name is required' });
  }
  if (!stepData.type) {
    errors.push({ field: `steps[${stepIndex}].type`, message: 'Step type is required' });
  }

  // Validate step type
  let stepType: StepType = 'automatic';
  try {
    stepType = validateStepType(stepData.type);
  } catch (error) {
    errors.push({ field: `steps[${stepIndex}].type`, message: (error as Error).message, value: stepData.type });
  }

  // Validate type-specific requirements
  if (stepType === 'automatic' && !stepData.command) {
    errors.push({ field: `steps[${stepIndex}].command`, message: 'Automatic steps must have a command' });
  }
  if (stepType === 'manual' && !stepData.instruction && !stepData.command) {
    errors.push({ field: `steps[${stepIndex}].instruction`, message: 'Manual steps must have instruction or command' });
  }

  // Validate evidence types if provided
  let evidenceTypes: EvidenceType[] | undefined;
  if (stepData.evidence_types) {
    try {
      evidenceTypes = validateEvidenceTypes(stepData.evidence_types);
    } catch (error) {
      errors.push({ field: `steps[${stepIndex}].evidence_types`, message: (error as Error).message, value: stepData.evidence_types });
    }
  }

  // Parse sub-steps recursively
  let subSteps: Step[] | undefined;
  if (stepData.sub_steps && Array.isArray(stepData.sub_steps)) {
    subSteps = stepData.sub_steps.map((subStep: any, index: number) => 
      parseStep(subStep, index)
    );
  }

  // Validate estimated_duration if provided
  if (stepData.estimated_duration !== undefined && 
      (typeof stepData.estimated_duration !== 'number' || stepData.estimated_duration < 0)) {
    errors.push({ 
      field: `steps[${stepIndex}].estimated_duration`, 
      message: 'Estimated duration must be a positive number (seconds)',
      value: stepData.estimated_duration 
    });
  }

  // Validate timeout if provided
  if (stepData.timeout !== undefined && 
      (typeof stepData.timeout !== 'number' || stepData.timeout < 0)) {
    errors.push({ 
      field: `steps[${stepIndex}].timeout`, 
      message: 'Timeout must be a positive number (seconds)',
      value: stepData.timeout 
    });
  }

  if (errors.length > 0) {
    throw new OperationParseError(`Validation errors in step ${stepIndex}`, errors);
  }

  return {
    id: stepData.id,
    name: stepData.name,
    type: stepType,
    description: stepData.description,
    if: stepData.if,
    command: stepData.command,
    instruction: stepData.instruction,
    timeout: stepData.timeout,
    estimated_duration: stepData.estimated_duration,
    env: stepData.env,
    with: stepData.with,
    evidence_required: Boolean(stepData.evidence_required),
    evidence_types: evidenceTypes,
    validation: stepData.validation,
    verify: stepData.verify,
    continue_on_error: Boolean(stepData.continue_on_error),
    retry: stepData.retry,
    rollback: stepData.rollback,
    needs: stepData.needs,
    sub_steps: subSteps,
    manual_override: Boolean(stepData.manual_override),
    manual_instructions: stepData.manual_instructions,
    approval: stepData.approval
  };
}

function parsePreflightCheck(checkData: any, checkIndex: number): PreflightCheck {
  const errors: ValidationError[] = [];
  
  if (!checkData.name || checkData.name.trim() === '') {
    errors.push({ field: `preflight[${checkIndex}].name`, message: 'Preflight check name is required' });
  }
  if (!checkData.command) {
    errors.push({ field: `preflight[${checkIndex}].command`, message: 'Preflight check command is required' });
  }

  if (errors.length > 0) {
    throw new OperationParseError(`Validation errors in preflight check ${checkIndex}`, errors);
  }

  return {
    name: checkData.name,
    type: checkData.type || 'command',
    command: checkData.command,
    condition: checkData.condition,
    description: checkData.description || '',
    timeout: checkData.timeout,
    evidence_required: Boolean(checkData.evidence_required),
    // Legacy compatibility
    expect_empty: checkData.expect_empty
  };
}

function parseEnvironment(envData: any, envIndex: number): Environment {
  const errors: ValidationError[] = [];
  
  if (!envData.name || envData.name.trim() === '') {
    errors.push({ field: `environments[${envIndex}].name`, message: 'Environment name is required' });
  }

  if (errors.length > 0) {
    throw new OperationParseError(`Validation errors in environment ${envIndex}`, errors);
  }

  return {
    name: envData.name,
    description: envData.description || '',
    variables: envData.variables || {},
    restrictions: envData.restrictions || [],
    approval_required: Boolean(envData.approval_required),
    validation_required: Boolean(envData.validation_required),
    targets: envData.targets || []
  };
}

export function parseOperation(filePath: string): Operation {
  let fileContents: string;
  
  try {
    fileContents = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new OperationParseError(`Failed to read file: ${filePath}`, [
      { field: 'file', message: (error as Error).message }
    ]);
  }

  let data: unknown;
  try {
    data = yaml.load(fileContents);
  } catch (error) {
    throw new OperationParseError('Invalid YAML format', [
      { field: 'yaml', message: (error as Error).message }
    ]);
  }

  if (typeof data !== 'object' || data === null) {
    throw new OperationParseError('Invalid YAML: root must be an object');
  }

  const rawOperation = data as any;
  const errors: ValidationError[] = [];
  
  // Validate required top-level fields
  if (!rawOperation.name || rawOperation.name.trim() === '') {
    errors.push({ field: 'name', message: 'Operation name is required' });
  }
  if (!rawOperation.version) {
    errors.push({ field: 'version', message: 'Operation version is required' });
  }
  if (!rawOperation.steps || !Array.isArray(rawOperation.steps)) {
    errors.push({ field: 'steps', message: 'Operation steps array is required' });
  }

  // Validate version format (basic semantic versioning)
  if (rawOperation.version && !/^\d+\.\d+\.\d+/.test(rawOperation.version)) {
    errors.push({ 
      field: 'version', 
      message: 'Version must follow semantic versioning (e.g., 1.0.0)',
      value: rawOperation.version 
    });
  }

  // Don't throw yet - collect step errors too

  // Parse environments
  let environments: Environment[] = [];
  if (rawOperation.environments && Array.isArray(rawOperation.environments)) {
    try {
      environments = rawOperation.environments.map((env: any, index: number) => 
        parseEnvironment(env, index)
      );
    } catch (error) {
      if (error instanceof OperationParseError) {
        throw error;
      }
      throw new OperationParseError('Failed to parse environments', [
        { field: 'environments', message: (error as Error).message }
      ]);
    }
  } else {
    // Create default environment if none specified
    environments = [{
      name: 'default',
      description: 'Default environment',
      variables: {},
      restrictions: [],
      approval_required: false,
      validation_required: false,
      targets: []
    }];
  }

  // Parse steps and collect errors
  let steps: Step[] = [];
  if (rawOperation.steps && Array.isArray(rawOperation.steps)) {
    rawOperation.steps.forEach((step: any, index: number) => {
      try {
        steps.push(parseStep(step, index));
      } catch (error) {
        if (error instanceof OperationParseError) {
          errors.push(...error.errors);
        } else {
          errors.push({ field: `steps[${index}]`, message: (error as Error).message });
        }
      }
    });
  }

  // Parse preflight checks and collect errors
  let preflight: PreflightCheck[] = [];
  if (rawOperation.preflight && Array.isArray(rawOperation.preflight)) {
    rawOperation.preflight.forEach((check: any, index: number) => {
      try {
        preflight.push(parsePreflightCheck(check, index));
      } catch (error) {
        if (error instanceof OperationParseError) {
          errors.push(...error.errors);
        } else {
          errors.push({ field: `preflight[${index}]`, message: (error as Error).message });
        }
      }
    });
  }

  // Throw all collected errors if any
  if (errors.length > 0) {
    throw new OperationParseError('Operation validation failed', errors);
  }

  // Build variable matrix from environments
  const variables: VariableMatrix = {};
  environments.forEach(env => {
    variables[env.name] = env.variables;
  });

  // Create metadata
  const now = new Date();
  const metadata: OperationMetadata = {
    created_at: now,
    updated_at: now,
    execution_count: 0,
    git_hash: rawOperation.git_hash,
    git_branch: rawOperation.git_branch,
    last_executed: rawOperation.last_executed ? new Date(rawOperation.last_executed) : undefined
  };

  // Construct full operation
  const operation: Operation = {
    id: rawOperation.id || randomUUID(),
    name: rawOperation.name,
    version: rawOperation.version,
    description: rawOperation.description || '',
    author: rawOperation.author,
    category: rawOperation.category,
    tags: rawOperation.tags || [],
    emergency: Boolean(rawOperation.emergency),
    environments,
    variables,
    steps,
    preflight,
    rollback: rawOperation.rollback,
    metadata,
    needs: rawOperation.needs,
    uses: rawOperation.uses,
    with: rawOperation.with,
    matrix: rawOperation.matrix,
    reporting: rawOperation.reporting
  };

  return operation;
}

// Export for testing
export { ValidationError, parseStep, parsePreflightCheck, parseEnvironment };