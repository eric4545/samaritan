import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { dirname, resolve } from 'node:path';
import yaml from 'js-yaml';
import type {
  Environment,
  EvidenceConfig,
  EvidenceType,
  Operation,
  OperationMetadata,
  PreflightCheck,
  Step,
  StepPhase,
  StepType,
  VariableMatrix,
} from '../models/operation';
import {
  SchemaValidationError,
  type ValidationError,
  validateOperationSchemaStrict,
} from '../validation/schema-validator';
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

/**
 * Parse .env file and return key-value pairs
 * Supports basic .env format: KEY=value
 * Ignores comments (#) and empty lines
 */
function parseEnvFile(filePath: string): Record<string, any> {
  const envVars: Record<string, any> = {};

  if (!fs.existsSync(filePath)) {
    return envVars;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip empty lines and comments
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    // Parse KEY=value
    const equalsIndex = trimmedLine.indexOf('=');
    if (equalsIndex === -1) {
      continue; // Skip invalid lines
    }

    const key = trimmedLine.substring(0, equalsIndex).trim();
    let value = trimmedLine.substring(equalsIndex + 1).trim();

    // Remove quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.substring(1, value.length - 1);
    }

    // Try to parse as number or boolean
    if (value === 'true') {
      envVars[key] = true;
    } else if (value === 'false') {
      envVars[key] = false;
    } else if (!Number.isNaN(Number(value)) && value !== '') {
      envVars[key] = Number(value);
    } else {
      envVars[key] = value;
    }
  }

  return envVars;
}

function parseEvidence(data: any): EvidenceConfig | undefined {
  // New nested format
  if (data.evidence) {
    return {
      required: Boolean(data.evidence.required),
      types: data.evidence.types as EvidenceType[],
      results: data.evidence.results, // Pass through results array if present
    };
  }

  // Legacy format - convert to new format
  if (
    data.evidence_required !== undefined ||
    data.evidence_types !== undefined
  ) {
    return {
      required: Boolean(data.evidence_required),
      types: data.evidence_types as EvidenceType[],
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
function loadStepLibrary(
  filePath: string,
  importContext: ImportContext,
): StepLibrary {
  const resolvedPath = resolve(importContext.baseDirectory, filePath);

  // Check for circular imports
  if (importContext.loadedFiles.has(resolvedPath)) {
    throw new OperationParseError(`Circular import detected: ${filePath}`, [
      {
        field: 'imports',
        message: `File ${filePath} creates a circular dependency`,
      },
    ]);
  }

  // Check if file exists
  if (!fs.existsSync(resolvedPath)) {
    throw new OperationParseError(`Import file not found: ${filePath}`, [
      { field: 'imports', message: `File ${filePath} does not exist` },
    ]);
  }

  // Mark file as being loaded
  importContext.loadedFiles.add(resolvedPath);

  try {
    // Read and parse YAML
    const content = fs.readFileSync(resolvedPath, 'utf8');
    const data = yaml.load(content) as any;

    if (!data || !data.steps || !Array.isArray(data.steps)) {
      throw new OperationParseError(
        `Invalid step library format: ${filePath}`,
        [
          {
            field: 'imports',
            message: `File ${filePath} must contain a 'steps' array`,
          },
        ],
      );
    }

    // Parse steps
    const steps: Step[] = [];
    data.steps.forEach((stepData: any, index: number) => {
      try {
        const step = parseStep(stepData, index, importContext);
        steps.push(step);

        // Add to step library registry
        if (importContext.stepLibraries.has(step.name)) {
          throw new OperationParseError(
            `Duplicate step name in imports: ${step.name}`,
            [
              {
                field: 'imports',
                message: `Step name '${step.name}' is defined in multiple imported files`,
              },
            ],
          );
        }
        importContext.stepLibraries.set(step.name, step);
      } catch (error) {
        if (error instanceof OperationParseError) {
          throw error;
        }
        throw new OperationParseError(
          `Error parsing step ${index} in ${filePath}`,
          [
            {
              field: `imports.${filePath}.steps[${index}]`,
              message: (error as Error).message,
            },
          ],
        );
      }
    });

    return {
      steps,
      source: resolvedPath,
    };
  } catch (error) {
    if (error instanceof OperationParseError) {
      throw error;
    }
    throw new OperationParseError(`Failed to load step library: ${filePath}`, [
      { field: 'imports', message: (error as Error).message },
    ]);
  } finally {
    // Remove from loading set
    importContext.loadedFiles.delete(resolvedPath);
  }
}

/**
 * Process all imports and build step library
 */
function processImports(
  imports: string[],
  baseDirectory: string,
): ImportContext {
  const importContext: ImportContext = {
    stepLibraries: new Map(),
    loadedFiles: new Set(),
    baseDirectory,
  };

  if (!imports || imports.length === 0) {
    return importContext;
  }

  // Load all step libraries
  for (const importPath of imports) {
    if (typeof importPath !== 'string') {
      throw new OperationParseError('Invalid import format', [
        {
          field: 'imports',
          message: 'Import paths must be strings',
          value: importPath,
        },
      ]);
    }

    loadStepLibrary(importPath, importContext);
  }

  return importContext;
}

/**
 * Generate cartesian product of matrix variables
 * Example: { region: ['us', 'eu'], tier: ['web', 'api'] }
 * Returns: [
 *   { region: 'us', tier: 'web' },
 *   { region: 'us', tier: 'api' },
 *   { region: 'eu', tier: 'web' },
 *   { region: 'eu', tier: 'api' }
 * ]
 */
function generateMatrixCombinations(
  matrix: Record<string, any[]>,
): Array<Record<string, any>> {
  const keys = Object.keys(matrix);
  if (keys.length === 0) return [];

  // Start with the first variable
  let combinations: Array<Record<string, any>> = matrix[keys[0]].map(
    (value) => ({ [keys[0]]: value }),
  );

  // Add each subsequent variable
  for (let i = 1; i < keys.length; i++) {
    const key = keys[i];
    const values = matrix[key];
    const newCombinations: Array<Record<string, any>> = [];

    for (const combination of combinations) {
      for (const value of values) {
        newCombinations.push({ ...combination, [key]: value });
      }
    }

    combinations = newCombinations;
  }

  return combinations;
}

/**
 * Apply include/exclude filters to matrix combinations
 */
function filterMatrixCombinations(
  combinations: Array<Record<string, any>>,
  include?: Array<Record<string, any>>,
  exclude?: Array<Record<string, any>>,
): Array<Record<string, any>> {
  let filtered = [...combinations];

  // Add specific combinations from include
  if (include && include.length > 0) {
    for (const inc of include) {
      // Only add if not already present
      const exists = filtered.some((combo) => {
        return Object.keys(inc).every((key) => combo[key] === inc[key]);
      });
      if (!exists) {
        filtered.push(inc);
      }
    }
  }

  // Remove combinations from exclude
  if (exclude && exclude.length > 0) {
    filtered = filtered.filter((combo) => {
      return !exclude.some((exc) => {
        return Object.keys(exc).every((key) => combo[key] === exc[key]);
      });
    });
  }

  return filtered;
}

/**
 * Format variable combination for step name
 * Example: { region: 'us-east-1', tier: 'web' } => "us-east-1, web"
 */
function formatVariableCombination(vars: Record<string, any>): string {
  return Object.values(vars).join(', ');
}

/**
 * Load template file and extract steps
 * Supports both array format (just steps) and operation format (extract .steps)
 */
function loadTemplateSteps(templatePath: string, baseDirectory: string): any[] {
  const resolvedPath = resolve(baseDirectory, templatePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new OperationParseError(`Template file not found: ${templatePath}`, [
      { field: 'template', message: `File not found: ${resolvedPath}` },
    ]);
  }

  const templateContents = fs.readFileSync(resolvedPath, 'utf-8');
  let templateData: unknown;

  try {
    templateData = yaml.load(templateContents);
  } catch (error) {
    throw new OperationParseError(`Invalid YAML in template: ${templatePath}`, [
      { field: 'template', message: (error as Error).message },
    ]);
  }

  // Handle array format (just steps)
  if (Array.isArray(templateData)) {
    return templateData;
  }

  // Handle operation format (extract .steps)
  if (typeof templateData === 'object' && templateData !== null) {
    const templateObj = templateData as any;
    if (templateObj.steps && Array.isArray(templateObj.steps)) {
      return templateObj.steps;
    }
  }

  throw new OperationParseError(
    `Invalid template format: ${templatePath}. Expected array of steps or operation with 'steps' field`,
    [
      {
        field: 'template',
        message: 'Template must be array or object with steps field',
      },
    ],
  );
}

/**
 * Find all ${VAR} placeholders in an object (recursively)
 */
function extractVariables(
  obj: any,
  vars: Set<string> = new Set(),
): Set<string> {
  if (typeof obj === 'string') {
    // Match ${VAR} pattern
    const matches = obj.matchAll(/\$\{([^}]+)\}/g);
    for (const match of matches) {
      vars.add(match[1]);
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      extractVariables(item, vars);
    }
  } else if (typeof obj === 'object' && obj !== null) {
    for (const value of Object.values(obj)) {
      extractVariables(value, vars);
    }
  }
  return vars;
}

/**
 * Substitute ${VAR} placeholders with values from context
 */
function substituteVariables(obj: any, context: Record<string, any>): any {
  if (typeof obj === 'string') {
    // Check if the entire string is just a single variable reference
    const singleVarMatch = obj.match(/^\$\{([^}]+)\}$/);
    if (singleVarMatch) {
      const varName = singleVarMatch[1];
      if (varName in context) {
        // Return the value directly (preserving type)
        return context[varName];
      }
    }

    // Replace all ${VAR} with values (for strings with multiple vars or mixed content)
    return obj.replace(/\$\{([^}]+)\}/g, (match, varName) => {
      if (varName in context) {
        return String(context[varName]);
      }
      // Leave unmatched variables as-is (they might be env vars)
      return match;
    });
  } else if (Array.isArray(obj)) {
    return obj.map((item) => substituteVariables(item, context));
  } else if (typeof obj === 'object' && obj !== null) {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteVariables(value, context);
    }
    return result;
  }
  return obj;
}

/**
 * Resolve step references (use: step-name) to actual step definitions
 */
function resolveStepReferences(
  steps: any[],
  importContext: ImportContext,
): Step[] {
  const resolvedSteps: Step[] = [];

  for (let i = 0; i < steps.length; i++) {
    const stepData = steps[i];

    if (stepData.use) {
      // This is a step reference
      const stepName = stepData.use;
      const referencedStep = importContext.stepLibraries.get(stepName);

      if (!referencedStep) {
        throw new OperationParseError(`Step reference not found: ${stepName}`, [
          {
            field: `steps[${i}].use`,
            message: `Step '${stepName}' is not defined in any imported library`,
          },
        ]);
      }

      // Clone the referenced step and apply any overrides
      const clonedStep: Step = { ...referencedStep };

      // Allow overriding certain properties
      if (stepData.timeout !== undefined) clonedStep.timeout = stepData.timeout;
      if (stepData.phase !== undefined)
        clonedStep.phase = stepData.phase as StepPhase;
      if (stepData.env !== undefined)
        clonedStep.env = { ...clonedStep.env, ...stepData.env };
      if (stepData.with !== undefined)
        clonedStep.with = { ...clonedStep.with, ...stepData.with };
      if (stepData.variables !== undefined)
        clonedStep.variables = {
          ...clonedStep.variables,
          ...stepData.variables,
        };
      if (stepData.evidence_required !== undefined)
        clonedStep.evidence_required = stepData.evidence_required;
      if (stepData.continue_on_error !== undefined)
        clonedStep.continue_on_error = stepData.continue_on_error;

      // Allow overriding evidence (new format)
      if (stepData.evidence !== undefined) {
        const evidenceData = stepData.evidence;
        clonedStep.evidence = {
          required:
            evidenceData.required !== undefined
              ? Boolean(evidenceData.required)
              : (clonedStep.evidence?.required ?? false),
          types: evidenceData.types ?? clonedStep.evidence?.types ?? [],
          // Override results if provided, otherwise keep original
          results: evidenceData.results ?? clonedStep.evidence?.results,
        };
      }

      // Allow overriding timeline, pic, and reviewer (Bug fix: these were missing)
      if (stepData.timeline !== undefined)
        clonedStep.timeline = stepData.timeline;
      if (stepData.pic !== undefined) clonedStep.pic = stepData.pic;
      if (stepData.reviewer !== undefined)
        clonedStep.reviewer = stepData.reviewer;

      // Set default phase if not specified
      if (!clonedStep.phase) {
        clonedStep.phase = 'flight';
      }

      resolvedSteps.push(clonedStep);
    } else if (stepData.template) {
      // This is a template import
      try {
        const templatePath = stepData.template;
        const withVars = stepData.with || {};

        // Load template steps
        const templateSteps = loadTemplateSteps(
          templatePath,
          importContext.baseDirectory,
        );

        // Validate all template variables are provided
        const templateVars = extractVariables(templateSteps);
        const missingVars: string[] = [];
        for (const varName of templateVars) {
          if (!(varName in withVars)) {
            missingVars.push(varName);
          }
        }

        if (missingVars.length > 0) {
          throw new OperationParseError(
            `Missing template variables for ${templatePath}: ${missingVars.join(', ')}`,
            [
              {
                field: `steps[${i}].with`,
                message: `Required variables not provided: ${missingVars.join(', ')}`,
              },
            ],
          );
        }

        // Substitute variables in template steps
        const substitutedSteps = substituteVariables(templateSteps, withVars);

        // Parse and add each template step
        for (let j = 0; j < substitutedSteps.length; j++) {
          const templateStep = parseStep(substitutedSteps[j], j, importContext);

          // Set default phase if not specified
          if (!templateStep.phase) {
            templateStep.phase = 'flight';
          }

          resolvedSteps.push(templateStep);
        }
      } catch (error) {
        if (error instanceof OperationParseError) {
          throw error;
        }
        throw new OperationParseError(
          `Failed to load template: ${stepData.template}`,
          [
            {
              field: `steps[${i}].template`,
              message: (error as Error).message,
            },
          ],
        );
      }
    } else {
      // This is a regular step definition
      try {
        const step = parseStep(stepData, i, importContext);

        // Set default phase if not specified
        if (!step.phase) {
          step.phase = 'flight';
        }

        // Expand foreach loops (supports both single var and matrix)
        if (step.foreach) {
          let combinations: Array<Record<string, any>> = [];

          // Check which syntax is used
          if (step.foreach.matrix) {
            // Matrix expansion: cartesian product of multiple variables
            combinations = generateMatrixCombinations(step.foreach.matrix);

            // Apply include/exclude filters if present
            combinations = filterMatrixCombinations(
              combinations,
              step.foreach.include,
              step.foreach.exclude,
            );
          } else if (step.foreach.var && step.foreach.values) {
            // Single variable syntax (backward compatible)
            const foreachVar = step.foreach.var;
            const foreachValues = step.foreach.values;
            combinations = foreachValues.map((value) => ({
              [foreachVar]: value,
            }));
          } else {
            throw new OperationParseError(
              `Invalid foreach syntax in step "${step.name}"`,
              [
                {
                  field: `steps[${i}].foreach`,
                  message:
                    'foreach must have either (var + values) or (matrix)',
                },
              ],
            );
          }

          // Create an expanded step for each combination
          for (let j = 0; j < combinations.length; j++) {
            const combo = combinations[j];
            const varSuffix = formatVariableCombination(combo);

            // Clone step for this combination
            const expandedStep: Step = {
              ...step,
              id: step.id ? `${step.id}-${j}` : undefined,
              name: `${step.name} (${varSuffix})`,
              variables: {
                ...(step.variables || {}),
                ...combo, // Inject all matrix variables
              },
              foreach: undefined, // Remove foreach from expanded step
            };

            resolvedSteps.push(expandedStep);
          }
        } else {
          resolvedSteps.push(step);
        }
      } catch (error) {
        if (error instanceof OperationParseError) {
          throw error;
        }
        throw new OperationParseError(`Error parsing step ${i}`, [
          { field: `steps[${i}]`, message: (error as Error).message },
        ]);
      }
    }
  }

  return resolvedSteps;
}

function parseStep(
  stepData: any,
  _stepIndex: number,
  importContext?: ImportContext,
): Step {
  // Parse sub-steps recursively
  let subSteps: Step[] | undefined;
  if (stepData.sub_steps && Array.isArray(stepData.sub_steps)) {
    // If we have an import context, use resolveStepReferences to handle use:/template: directives
    if (importContext) {
      subSteps = resolveStepReferences(stepData.sub_steps, importContext);
    } else {
      // Fallback for cases without import context (shouldn't happen in normal flow)
      subSteps = stepData.sub_steps.map((subStep: any, index: number) =>
        parseStep(subStep, index),
      );
    }
  }

  // Parse options
  const options = stepData.options
    ? {
        substitute_vars: stepData.options.substitute_vars ?? true,
        show_command_separately:
          stepData.options.show_command_separately ?? false,
      }
    : undefined;

  // Parse rollback with options
  const rollback = stepData.rollback
    ? {
        command: stepData.rollback.command,
        instruction: stepData.rollback.instruction,
        timeout: stepData.rollback.timeout,
        evidence: parseEvidence(stepData.rollback),
        evidence_required: Boolean(stepData.rollback.evidence_required),
        options: stepData.rollback.options
          ? {
              substitute_vars:
                stepData.rollback.options.substitute_vars ?? true,
              show_command_separately:
                stepData.rollback.options.show_command_separately ?? false,
            }
          : undefined,
      }
    : undefined;

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
    template: stepData.template,
    with: stepData.with,
    variables: stepData.variables,
    evidence: parseEvidence(stepData),
    evidence_required: Boolean(stepData.evidence_required), // DEPRECATED: Use evidence.required instead
    evidence_types: stepData.evidence_types as EvidenceType[], // DEPRECATED: Use evidence.types instead
    validation: stepData.validation,
    verify: stepData.verify,
    continue_on_error: Boolean(stepData.continue_on_error),
    retry: stepData.retry,
    rollback: rollback,
    needs: stepData.needs,
    sub_steps: subSteps,
    manual_override: Boolean(stepData.manual_override),
    manual_instructions: stepData.manual_instructions,
    approval: stepData.approval,
    ticket: stepData.ticket,
    foreach: stepData.foreach,
    section_heading: Boolean(stepData.section_heading),
    pic: stepData.pic,
    reviewer: stepData.reviewer,
    timeline: stepData.timeline,
    options: options,
    when: stepData.when,
    variants: stepData.variants,
  };
}

function parsePreflightCheck(
  checkData: any,
  _checkIndex: number,
): PreflightCheck {
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
    expect_empty: checkData.expect_empty,
  };
}

function parseEnvironment(envData: any, _envIndex: number): Environment {
  return {
    name: envData.name,
    from: envData.from,
    description: envData.description || '',
    variables: envData.variables || {},
    restrictions: envData.restrictions || [],
    approval_required: Boolean(envData.approval_required),
    validation_required: Boolean(envData.validation_required),
    targets: envData.targets || [],
  };
}

export async function parseOperation(filePath: string): Promise<Operation> {
  let fileContents: string;

  try {
    fileContents = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new OperationParseError(`Failed to read file: ${filePath}`, [
      { field: 'file', message: (error as Error).message },
    ]);
  }

  let data: unknown;
  try {
    data = yaml.load(fileContents);
  } catch (error) {
    throw new OperationParseError('Invalid YAML format', [
      { field: 'yaml', message: (error as Error).message },
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
      { field: 'schema', message: (error as Error).message },
    ]);
  }

  const errors: ValidationError[] = [];

  // Get base directory for resolving imports and environments
  const baseDirectory = dirname(filePath);

  // Load variables from .env file if specified (lowest priority)
  let envFileVariables: Record<string, any> = {};
  if (rawOperation.env_file) {
    const envFilePath = resolve(baseDirectory, rawOperation.env_file);
    envFileVariables = parseEnvFile(envFilePath);
  }

  // Parse common variables (shared across all environments)
  // Priority: common_variables > env_file
  const commonVariables = {
    ...envFileVariables,
    ...(rawOperation.common_variables || {}),
  };

  // Parse environments (supports both inline and manifest inheritance)
  let environments: Environment[] = [];
  try {
    if (rawOperation.environments && Array.isArray(rawOperation.environments)) {
      const environmentLoader = new EnvironmentLoader(baseDirectory);

      for (const envData of rawOperation.environments) {
        if (envData.from) {
          // Inherit from manifest and merge with local overrides
          const manifest = await environmentLoader.loadEnvironmentManifest(
            envData.from,
          );
          const manifestEnv = manifest.environments.find(
            (e) => e.name === envData.name,
          );

          if (!manifestEnv) {
            throw new OperationParseError(
              `Environment '${envData.name}' not found in manifest '${envData.from}'`,
              [
                {
                  field: `environments[${envData.name}].from`,
                  message: `Environment '${envData.name}' not found in manifest '${envData.from}'`,
                },
              ],
            );
          }

          // Merge manifest environment with overrides and common variables
          const environment: Environment = {
            name: envData.name,
            from: envData.from,
            description: envData.description || manifestEnv.description,
            variables: {
              ...commonVariables,
              ...manifestEnv.variables,
              ...(envData.variables || {}),
            },
            restrictions: [
              ...(manifestEnv.restrictions || []),
              ...(envData.restrictions || []),
            ],
            approval_required:
              envData.approval_required !== undefined
                ? envData.approval_required
                : manifestEnv.approval_required,
            validation_required:
              envData.validation_required !== undefined
                ? envData.validation_required
                : manifestEnv.validation_required,
            targets: [
              ...(manifestEnv.targets || []),
              ...(envData.targets || []),
            ],
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
      environments = [
        {
          name: 'default',
          description: 'Default environment',
          variables: { ...commonVariables },
          restrictions: [],
          approval_required: false,
          validation_required: false,
          targets: [],
        },
      ];
    }
  } catch (error) {
    if (error instanceof OperationParseError) {
      errors.push(...error.errors);
    } else {
      errors.push({ field: 'environments', message: (error as Error).message });
    }
    // Fallback to default environment with common variables
    environments = [
      {
        name: 'default',
        description: 'Default environment',
        variables: { ...commonVariables },
        restrictions: [],
        approval_required: false,
        validation_required: false,
        targets: [],
      },
    ];
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
      baseDirectory,
    };
  }

  // Parse unified steps (includes migrated preflight checks + regular steps)
  const steps: Step[] = [];

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
        errors.push({
          field: `preflight[${index}]`,
          message: `Error converting preflight check: ${(error as Error).message}`,
        });
      }
    });
  }

  // Then process regular steps
  if (rawOperation.steps && Array.isArray(rawOperation.steps)) {
    try {
      const regularSteps = resolveStepReferences(
        rawOperation.steps,
        importContext,
      );
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
        errors.push({
          field: `needs[${index}]`,
          message: 'Dependency must be a string operation ID',
        });
      }
    });
  }

  // Process marketplace operation usage if present
  if (rawOperation.uses) {
    if (typeof rawOperation.uses !== 'string') {
      errors.push({
        field: 'uses',
        message: 'Marketplace operation reference must be a string',
      });
    }
    // In a full implementation, you'd resolve and merge the marketplace operation
  }

  // Note: Preflight checks are now migrated to unified steps with phase: 'preflight'
  // Keep empty array for backward compatibility
  const preflight: PreflightCheck[] = [];

  // Throw all collected errors if any
  if (errors.length > 0) {
    throw new OperationParseError('Operation validation failed', errors);
  }

  // Build variable matrix from environments
  const variables: VariableMatrix = {};
  environments.forEach((env) => {
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
    last_executed: rawOperation.last_executed
      ? new Date(rawOperation.last_executed)
      : undefined,
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
    overview: rawOperation.overview,
    environments,
    variables,
    common_variables: commonVariables,
    env_file: rawOperation.env_file,
    steps,
    preflight,
    rollback: rawOperation.rollback,
    metadata,
    needs: rawOperation.needs,
    template: rawOperation.template,
    with: rawOperation.with,
    matrix: rawOperation.matrix,
    reporting: rawOperation.reporting,
  };

  return operation;
}

// Export for testing
export { parseStep, parsePreflightCheck, parseEnvironment };
