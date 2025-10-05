import fs from 'fs';
import yaml from 'js-yaml';
import { join, dirname, resolve } from 'path';
import {
  Operation,
  Environment,
  VariableMatrix,
  OperationMetadata,
  Step,
  PreflightCheck,
  StepType,
  StepPhase,
  EvidenceType,
  EvidenceConfig
} from '../models/operation';
import { randomUUID } from 'crypto';
import { validateOperationSchemaStrict, SchemaValidationError, ValidationError } from '../validation/schema-validator';
import { EnvironmentLoader } from './environment-loader';

interface StepLibrary {
  steps: Step[];
  source: string;
}

interface ImportContext {
  stepLibraries: Map<string, Step>; // step name -> step definition
  loadedFiles: Set<string>; // Prevent circular imports
  baseDirectory: string; // Directory of the main operation file
}

function parseEvidence(data: any): EvidenceConfig | undefined {
  // New nested format
  if (data.evidence) {
    return {
      required: Boolean(data.evidence.required),
      types: data.evidence.types as EvidenceType[]
    };
  }

  // Legacy format - convert to new format
  if (data.evidence_required !== undefined || data.evidence_types !== undefined) {
    return {
      required: Boolean(data.evidence_required),
      types: data.evidence_types as EvidenceType[]
    };
  }

  return undefined;
}

export class OperationParseError extends Error {
  public errors: ValidationError[];
  
  constructor(message: string, errors: ValidationError[] = []) {
    super(message);
    this.name = 'OperationParseError';
    this.errors = errors;
  }
}

/**
 * Load and parse a step library file
 */
function loadStepLibrary(filePath: string, importContext: ImportContext): StepLibrary {
  const resolvedPath = resolve(importContext.baseDirectory, filePath);
  
  // Check for circular imports
  if (importContext.loadedFiles.has(resolvedPath)) {
    throw new OperationParseError(`Circular import detected: ${filePath}`, [
      { field: 'imports', message: `File ${filePath} creates a circular dependency` }
    ]);
  }
  
  // Check if file exists
  if (!fs.existsSync(resolvedPath)) {
    throw new OperationParseError(`Import file not found: ${filePath}`, [
      { field: 'imports', message: `File ${filePath} does not exist` }
    ]);
  }
  
  // Mark file as being loaded
  importContext.loadedFiles.add(resolvedPath);
  
  try {
    // Read and parse YAML
    const content = fs.readFileSync(resolvedPath, 'utf8');
    const data = yaml.load(content) as any;
    
    if (!data || !data.steps || !Array.isArray(data.steps)) {
      throw new OperationParseError(`Invalid step library format: ${filePath}`, [
        { field: 'imports', message: `File ${filePath} must contain a 'steps' array` }
      ]);
    }
    
    // Parse steps
    const steps: Step[] = [];
    data.steps.forEach((stepData: any, index: number) => {
      try {
        const step = parseStep(stepData, index);
        steps.push(step);
        
        // Add to step library registry
        if (importContext.stepLibraries.has(step.name)) {
          throw new OperationParseError(`Duplicate step name in imports: ${step.name}`, [
            { field: 'imports', message: `Step name '${step.name}' is defined in multiple imported files` }
          ]);
        }
        importContext.stepLibraries.set(step.name, step);
        
      } catch (error) {
        if (error instanceof OperationParseError) {
          throw error;
        }
        throw new OperationParseError(`Error parsing step ${index} in ${filePath}`, [
          { field: `imports.${filePath}.steps[${index}]`, message: (error as Error).message }
        ]);
      }
    });
    
    return {
      steps,
      source: resolvedPath
    };
    
  } catch (error) {
    if (error instanceof OperationParseError) {
      throw error;
    }
    throw new OperationParseError(`Failed to load step library: ${filePath}`, [
      { field: 'imports', message: (error as Error).message }
    ]);
  } finally {
    // Remove from loading set
    importContext.loadedFiles.delete(resolvedPath);
  }
}

/**
 * Process all imports and build step library
 */
function processImports(imports: string[], baseDirectory: string): ImportContext {
  const importContext: ImportContext = {
    stepLibraries: new Map(),
    loadedFiles: new Set(),
    baseDirectory
  };
  
  if (!imports || imports.length === 0) {
    return importContext;
  }
  
  // Load all step libraries
  for (const importPath of imports) {
    if (typeof importPath !== 'string') {
      throw new OperationParseError('Invalid import format', [
        { field: 'imports', message: 'Import paths must be strings', value: importPath }
      ]);
    }
    
    loadStepLibrary(importPath, importContext);
  }
  
  return importContext;
}

/**
 * Resolve step references (use: step-name) to actual step definitions
 */
function resolveStepReferences(steps: any[], importContext: ImportContext): Step[] {
  const resolvedSteps: Step[] = [];
  
  for (let i = 0; i < steps.length; i++) {
    const stepData = steps[i];
    
    if (stepData.use) {
      // This is a step reference
      const stepName = stepData.use;
      const referencedStep = importContext.stepLibraries.get(stepName);
      
      if (!referencedStep) {
        throw new OperationParseError(`Step reference not found: ${stepName}`, [
          { field: `steps[${i}].use`, message: `Step '${stepName}' is not defined in any imported library` }
        ]);
      }
      
      // Clone the referenced step and apply any overrides
      const clonedStep: Step = { ...referencedStep };

      // Allow overriding certain properties
      if (stepData.timeout !== undefined) clonedStep.timeout = stepData.timeout;
      if (stepData.phase !== undefined) clonedStep.phase = stepData.phase as StepPhase;
      if (stepData.env !== undefined) clonedStep.env = { ...clonedStep.env, ...stepData.env };
      if (stepData.with !== undefined) clonedStep.with = { ...clonedStep.with, ...stepData.with };
      if (stepData.variables !== undefined) clonedStep.variables = { ...clonedStep.variables, ...stepData.variables };
      if (stepData.evidence_required !== undefined) clonedStep.evidence_required = stepData.evidence_required;
      if (stepData.continue_on_error !== undefined) clonedStep.continue_on_error = stepData.continue_on_error;

      // Set default phase if not specified
      if (!clonedStep.phase) {
        clonedStep.phase = 'flight';
      }
      
      resolvedSteps.push(clonedStep);
      
    } else {
      // This is a regular step definition
      try {
        const step = parseStep(stepData, i);

        // Set default phase if not specified
        if (!step.phase) {
          step.phase = 'flight';
        }

        resolvedSteps.push(step);
      } catch (error) {
        if (error instanceof OperationParseError) {
          throw error;
        }
        throw new OperationParseError(`Error parsing step ${i}`, [
          { field: `steps[${i}]`, message: (error as Error).message }
        ]);
      }
    }
  }
  
  return resolvedSteps;
}


function parseStep(stepData: any, stepIndex: number): Step {
  // Parse sub-steps recursively
  let subSteps: Step[] | undefined;
  if (stepData.sub_steps && Array.isArray(stepData.sub_steps)) {
    subSteps = stepData.sub_steps.map((subStep: any, index: number) =>
      parseStep(subStep, index)
    );
  }

  return {
    id: stepData.id,
    name: stepData.name,
    type: stepData.type as StepType,
    phase: stepData.phase as StepPhase,
    description: stepData.description,
    if: stepData.if,
    command: stepData.command,
    instruction: stepData.instruction,
    condition: stepData.condition,
    timeout: stepData.timeout,
    estimated_duration: stepData.estimated_duration,
    env: stepData.env,
    with: stepData.with,
    variables: stepData.variables,
    evidence: parseEvidence(stepData),
    evidence_required: Boolean(stepData.evidence_required), // DEPRECATED: Use evidence.required instead
    evidence_types: stepData.evidence_types as EvidenceType[], // DEPRECATED: Use evidence.types instead
    validation: stepData.validation,
    verify: stepData.verify,
    continue_on_error: Boolean(stepData.continue_on_error),
    retry: stepData.retry,
    rollback: stepData.rollback,
    needs: stepData.needs,
    sub_steps: subSteps,
    manual_override: Boolean(stepData.manual_override),
    manual_instructions: stepData.manual_instructions,
    approval: stepData.approval,
    ticket: stepData.ticket
  };
}

function parsePreflightCheck(checkData: any, checkIndex: number): PreflightCheck {
  return {
    name: checkData.name,
    type: checkData.type || 'command',
    command: checkData.command,
    condition: checkData.condition,
    description: checkData.description || '',
    timeout: checkData.timeout,
    evidence: parseEvidence(checkData),
    evidence_required: Boolean(checkData.evidence_required), // DEPRECATED: Use evidence.required instead
    // Legacy compatibility
    expect_empty: checkData.expect_empty
  };
}

function parseEnvironment(envData: any, envIndex: number): Environment {
  return {
    name: envData.name,
    from: envData.from,
    description: envData.description || '',
    variables: envData.variables || {},
    restrictions: envData.restrictions || [],
    approval_required: Boolean(envData.approval_required),
    validation_required: Boolean(envData.validation_required),
    targets: envData.targets || []
  };
}

export async function parseOperation(filePath: string): Promise<Operation> {
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

  // Schema validation (replaces all custom validation)
  try {
    validateOperationSchemaStrict(rawOperation);
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      throw new OperationParseError('Schema validation failed', error.errors);
    }
    throw new OperationParseError('Validation failed', [
      { field: 'schema', message: (error as Error).message }
    ]);
  }

  const errors: ValidationError[] = [];

  // Get base directory for resolving imports and environments
  const baseDirectory = dirname(filePath);

  // Parse common variables (shared across all environments)
  const commonVariables = rawOperation.common_variables || {};

  // Parse environments (supports both inline and manifest inheritance)
  let environments: Environment[] = [];
  try {
    if (rawOperation.environments && Array.isArray(rawOperation.environments)) {
      const environmentLoader = new EnvironmentLoader(baseDirectory);

      for (const envData of rawOperation.environments) {
        if (envData.from) {
          // Inherit from manifest and merge with local overrides
          const manifest = await environmentLoader.loadEnvironmentManifest(envData.from);
          const manifestEnv = manifest.environments.find(e => e.name === envData.name);

          if (!manifestEnv) {
            throw new OperationParseError(`Environment '${envData.name}' not found in manifest '${envData.from}'`, [
              { field: `environments[${envData.name}].from`, message: `Environment '${envData.name}' not found in manifest '${envData.from}'` }
            ]);
          }

          // Merge manifest environment with overrides and common variables
          const environment: Environment = {
            name: envData.name,
            from: envData.from,
            description: envData.description || manifestEnv.description,
            variables: { ...commonVariables, ...manifestEnv.variables, ...(envData.variables || {}) },
            restrictions: [...(manifestEnv.restrictions || []), ...(envData.restrictions || [])],
            approval_required: envData.approval_required !== undefined ? envData.approval_required : manifestEnv.approval_required,
            validation_required: envData.validation_required !== undefined ? envData.validation_required : manifestEnv.validation_required,
            targets: [...(manifestEnv.targets || []), ...(envData.targets || [])]
          };

          environments.push(environment);
        } else {
          // Regular inline environment - merge with common variables
          const parsedEnv = parseEnvironment(envData, environments.length);
          parsedEnv.variables = { ...commonVariables, ...parsedEnv.variables };
          environments.push(parsedEnv);
        }
      }
    } else {
      // Create default environment if none specified - include common variables
      environments = [{
        name: 'default',
        description: 'Default environment',
        variables: { ...commonVariables },
        restrictions: [],
        approval_required: false,
        validation_required: false,
        targets: []
      }];
    }
  } catch (error) {
    if (error instanceof OperationParseError) {
      errors.push(...error.errors);
    } else {
      errors.push({ field: 'environments', message: (error as Error).message });
    }
    // Fallback to default environment with common variables
    environments = [{
      name: 'default',
      description: 'Default environment',
      variables: { ...commonVariables },
      restrictions: [],
      approval_required: false,
      validation_required: false,
      targets: []
    }];
  }

  // Process imports first
  let importContext: ImportContext;
  try {
    importContext = processImports(rawOperation.imports, baseDirectory);
  } catch (error) {
    if (error instanceof OperationParseError) {
      errors.push(...error.errors);
    } else {
      errors.push({ field: 'imports', message: (error as Error).message });
    }
    // Create empty import context to continue parsing
    importContext = {
      stepLibraries: new Map(),
      loadedFiles: new Set(),
      baseDirectory
    };
  }

  // Parse unified steps (includes migrated preflight checks + regular steps)
  let steps: Step[] = [];

  // First, migrate preflight checks to steps with phase: preflight
  if (rawOperation.preflight && Array.isArray(rawOperation.preflight)) {
    rawOperation.preflight.forEach((checkData: any, index: number) => {
      try {
        const preflightStep: Step = {
          id: checkData.id || randomUUID(),
          name: checkData.name,
          type: 'automatic', // Preflight checks are automatic
          phase: 'preflight',
          description: checkData.description || '',
          command: checkData.command,
          condition: checkData.condition,
          timeout: checkData.timeout,
          evidence: parseEvidence(checkData),
          evidence_required: Boolean(checkData.evidence_required), // DEPRECATED
        };
        steps.push(preflightStep);
      } catch (error) {
        errors.push({ field: `preflight[${index}]`, message: `Error converting preflight check: ${(error as Error).message}` });
      }
    });
  }

  // Then process regular steps
  if (rawOperation.steps && Array.isArray(rawOperation.steps)) {
    try {
      const regularSteps = resolveStepReferences(rawOperation.steps, importContext);
      steps.push(...regularSteps);
    } catch (error) {
      if (error instanceof OperationParseError) {
        errors.push(...error.errors);
      } else {
        errors.push({ field: 'steps', message: (error as Error).message });
      }
    }
  }

  // Process operation dependencies if present
  if (rawOperation.needs && Array.isArray(rawOperation.needs)) {
    // For now, just validate that dependencies are strings
    // In a full implementation, you'd resolve and include the dependent operations
    rawOperation.needs.forEach((dep: any, index: number) => {
      if (typeof dep !== 'string') {
        errors.push({ field: `needs[${index}]`, message: 'Dependency must be a string operation ID' });
      }
    });
  }

  // Process marketplace operation usage if present
  if (rawOperation.uses) {
    if (typeof rawOperation.uses !== 'string') {
      errors.push({ field: 'uses', message: 'Marketplace operation reference must be a string' });
    }
    // In a full implementation, you'd resolve and merge the marketplace operation
  }

  // Note: Preflight checks are now migrated to unified steps with phase: 'preflight'
  // Keep empty array for backward compatibility
  let preflight: PreflightCheck[] = [];

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
    common_variables: commonVariables,
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
export { parseStep, parsePreflightCheck, parseEnvironment };