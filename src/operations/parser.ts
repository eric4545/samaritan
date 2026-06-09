import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { dirname, resolve } from 'node:path';
import yaml from 'js-yaml';
import {
  fetchRemoteTemplate,
  isRemoteTemplate,
  resolveGithubUrl,
} from '../lib/template-fetcher';
import type {
  Environment,
  EvidenceConfig,
  EvidenceType,
  Operation,
  OperationMetadata,
  PreflightCheck,
  RollbackStep,
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

interface ImportContext {
  templateFiles: Set<string>; // Prevent circular uses: imports
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
 * Parse template YAML content and extract steps + default variables.
 * For bare step arrays: no defaults. For operation-format files: common_variables
 * become defaults and legacy preflight steps are migrated to phase: preflight.
 * The returned steps are still raw any[] — they go through resolveStepReferences
 * in the caller so foreach, nested templates, and imports all work normally.
 */
async function parseTemplateContent(
  yamlContent: string,
  sourcePath: string,
): Promise<{ steps: any[]; defaultVars: Record<string, any> }> {
  let templateData: unknown;
  try {
    templateData = yaml.load(yamlContent);
  } catch (error) {
    throw new OperationParseError(`Invalid YAML in file: ${sourcePath}`, [
      { field: 'uses', message: (error as Error).message },
    ]);
  }

  // Bare array format — no defaults available
  if (Array.isArray(templateData)) {
    return { steps: templateData, defaultVars: {} };
  }

  // Operation format — extract steps and common_variables
  if (typeof templateData === 'object' && templateData !== null) {
    const templateObj = templateData as any;
    if (templateObj.steps && Array.isArray(templateObj.steps)) {
      const defaultVars: Record<string, any> =
        templateObj.common_variables || {};

      // Migrate legacy preflight array to phase: preflight steps
      const legacyPreflight: any[] = (templateObj.preflight || []).map(
        (p: any) => ({ ...p, phase: 'preflight' }),
      );

      return {
        steps: [...legacyPreflight, ...templateObj.steps],
        defaultVars,
      };
    }
  }

  throw new OperationParseError(
    `Invalid file format: ${sourcePath}. Expected array of steps or operation with 'steps' field`,
    [
      {
        field: 'uses',
        message: 'File must be array of steps or object with steps field',
      },
    ],
  );
}

/**
 * Load file content (local file, HTTPS URL, or github: shorthand) and
 * extract its steps + default variable values.
 */
async function loadTemplateSteps(
  templatePath: string,
  baseDirectory: string,
): Promise<{ steps: any[]; defaultVars: Record<string, any> }> {
  let templateContents: string;
  let resolvedKey: string; // stable key for circular detection

  if (isRemoteTemplate(templatePath)) {
    const url = templatePath.startsWith('github:')
      ? resolveGithubUrl(templatePath)
      : templatePath;
    resolvedKey = url;

    try {
      templateContents = await fetchRemoteTemplate(url);
    } catch (error) {
      throw new OperationParseError(
        `Failed to fetch remote file: ${templatePath}`,
        [{ field: 'uses', message: (error as Error).message }],
      );
    }
  } else {
    const resolvedPath = resolve(baseDirectory, templatePath);
    resolvedKey = resolvedPath;

    try {
      templateContents = fs.readFileSync(resolvedPath, 'utf-8');
    } catch {
      throw new OperationParseError(`File not found: ${templatePath}`, [
        { field: 'uses', message: `File not found: ${resolvedPath}` },
      ]);
    }
  }

  return parseTemplateContent(templateContents, resolvedKey);
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
 * Collect variable names that are self-declared by foreach in a step list.
 * These are injected at expansion time and must NOT be required in with:.
 */
function extractForeachVars(
  steps: any[],
  vars: Set<string> = new Set(),
): Set<string> {
  for (const step of steps) {
    if (step.foreach) {
      if (typeof step.foreach.var === 'string') {
        vars.add(step.foreach.var);
      }
      if (step.foreach.matrix && typeof step.foreach.matrix === 'object') {
        for (const key of Object.keys(step.foreach.matrix)) {
          vars.add(key);
        }
      }
    }
    if (Array.isArray(step.sub_steps)) {
      extractForeachVars(step.sub_steps, vars);
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
async function resolveStepReferences(
  steps: any[],
  importContext: ImportContext,
): Promise<Step[]> {
  const resolvedSteps: Step[] = [];

  for (let i = 0; i < steps.length; i++) {
    const stepData = steps[i];

    if (stepData.use !== undefined) {
      throw new OperationParseError(
        `'use:' has been removed — use 'uses: ./path/to/file.yaml' to include steps from a file`,
        [
          {
            field: `steps[${i}].use`,
            message: `'use: ${stepData.use}' is no longer supported. Replace with 'uses: ./path/to/file.yaml'`,
          },
        ],
      );
    } else if (stepData.template !== undefined) {
      throw new OperationParseError(
        `'template:' was renamed to 'uses:' — update your operation file`,
        [
          {
            field: `steps[${i}].template`,
            message: `Replace 'template: ${stepData.template}' with 'uses: ${stepData.template}'`,
          },
        ],
      );
    } else if (stepData.uses !== undefined) {
      // Inline step composition — expand all steps from the referenced file here
      try {
        const templatePath = stepData.uses;
        const withVars: Record<string, any> = stepData.with || {};

        // Resolve canonical key for circular detection (URL or absolute path)
        const resolvedKey = isRemoteTemplate(templatePath)
          ? templatePath.startsWith('github:')
            ? resolveGithubUrl(templatePath)
            : templatePath
          : resolve(importContext.baseDirectory, templatePath);

        if (importContext.templateFiles.has(resolvedKey)) {
          throw new OperationParseError(
            `Circular uses: detected: ${templatePath}`,
            [
              {
                field: `steps[${i}].uses`,
                message: `File "${templatePath}" is already being expanded (circular dependency)`,
              },
            ],
          );
        }

        importContext.templateFiles.add(resolvedKey);
        // For local files, update baseDirectory so nested relative paths
        // inside the file resolve relative to its own location.
        // Remote files keep the parent baseDirectory.
        const prevBaseDir = importContext.baseDirectory;
        if (!isRemoteTemplate(templatePath)) {
          importContext.baseDirectory = resolve(resolvedKey, '..');
        }
        try {
          // Load template steps + default variable values
          const { steps: templateSteps, defaultVars } = await loadTemplateSteps(
            templatePath,
            prevBaseDir,
          );

          // Composition: template defaults are the base; with: overrides them
          const mergedVars = { ...defaultVars, ...withVars };

          // Validate — only vars absent from BOTH defaults and with: are errors.
          // Foreach loop variables are self-declared and injected at expansion time;
          // they must NOT be required in with:.
          const templateVars = extractVariables(templateSteps);
          const foreachVars = extractForeachVars(templateSteps);
          const missingVars = [...templateVars].filter(
            (v) => !(v in mergedVars) && !foreachVars.has(v),
          );

          if (missingVars.length > 0) {
            throw new OperationParseError(
              `Missing variables for ${templatePath}: ${missingVars.join(', ')}`,
              [
                {
                  field: `steps[${i}].with`,
                  message: `Required variables not provided: ${missingVars.join(', ')}`,
                },
              ],
            );
          }

          // Substitute merged variables in template steps
          const substitutedSteps = substituteVariables(
            templateSteps,
            mergedVars,
          );

          // Recursively resolve nested uses:, foreach, etc. through the
          // full pipeline — circular-detection guard above prevents infinite loops.
          // importContext.baseDirectory is now the file's own directory so any
          // relative paths inside it resolve correctly.
          const expandedSteps = await resolveStepReferences(
            substitutedSteps,
            importContext,
          );

          for (const templateStep of expandedSteps) {
            if (!templateStep.phase) {
              templateStep.phase = 'flight';
            }
            resolvedSteps.push(templateStep);
          }
        } finally {
          importContext.baseDirectory = prevBaseDir;
          importContext.templateFiles.delete(resolvedKey);
        }
      } catch (error) {
        if (error instanceof OperationParseError) {
          throw error;
        }
        throw new OperationParseError(`Failed to load file: ${stepData.uses}`, [
          {
            field: `steps[${i}].uses`,
            message: (error as Error).message,
          },
        ]);
      }
    } else {
      // This is a regular step definition
      try {
        const step = await parseStep(stepData, i, importContext);

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

const KNOWN_EXPECT_FIELDS = new Set([
  'contains',
  'not_contains',
  'equals',
  'matches',
  'not_empty',
  'any_line_contains',
  'no_line_contains',
  'all_lines_match',
  'line_count',
  'line_count_gte',
  'numeric_gte',
  'numeric_lte',
  'jsonpath',
  'equals_captured',
  'retry',
]);

function validateExpectFields(expect: any, stepName?: string): void {
  if (expect == null || typeof expect !== 'object' || Array.isArray(expect))
    return;
  for (const key of Object.keys(expect)) {
    if (!KNOWN_EXPECT_FIELDS.has(key)) {
      const suggestions = [...KNOWN_EXPECT_FIELDS].filter(
        (f) => f.startsWith(key) || key.startsWith(f.slice(0, -1)),
      );
      const hint =
        suggestions.length > 0 ? ` — did you mean '${suggestions[0]}'?` : '';
      throw new OperationParseError(
        `Unknown field '${key}' in expect${stepName ? ` for step '${stepName}'` : ''}${hint}`,
        [
          {
            field: stepName
              ? `steps[${stepName}].expect.${key}`
              : `expect.${key}`,
            message: `'${key}' is not a valid expect field${hint}`,
          },
        ],
      );
    }
  }
}

function extractExpect(stepData: any): any {
  if (stepData.expect != null) {
    validateExpectFields(stepData.expect, stepData.name);
    return stepData.expect;
  }
  // Backward compat: lift verify.expect or string verify shorthand
  if (stepData.verify != null) {
    if (typeof stepData.verify === 'string') return stepData.verify;
    if (stepData.verify.expect != null) {
      validateExpectFields(stepData.verify.expect, stepData.name);
      return stepData.verify.expect;
    }
  }
  return undefined;
}

async function parseStep(
  stepData: any,
  _stepIndex: number,
  importContext?: ImportContext,
): Promise<Step> {
  // Parse sub-steps recursively
  let subSteps: Step[] | undefined;
  if (stepData.sub_steps && Array.isArray(stepData.sub_steps)) {
    // If we have an import context, use resolveStepReferences to handle use:/template: directives
    if (importContext) {
      subSteps = await resolveStepReferences(stepData.sub_steps, importContext);
    } else {
      // Fallback for cases without import context (shouldn't happen in normal flow)
      subSteps = await Promise.all(
        stepData.sub_steps.map((subStep: any, index: number) =>
          parseStep(subStep, index),
        ),
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

  // Parse rollback: normalize both object and array YAML formats to RollbackStep[]
  let rollback: RollbackStep[] | undefined;
  if (stepData.rollback) {
    if (Array.isArray(stepData.rollback)) {
      rollback = stepData.rollback.map((r: any) => ({
        command: r.command,
        script: r.script,
        session: r.session,
        instruction: r.instruction,
        description: r.description,
        timeout: r.timeout,
        pic: r.pic,
        reviewer: r.reviewer,
        evidence: r.evidence ? parseEvidence(r) : undefined,
        expect: extractExpect(r),
        options: r.options
          ? {
              substitute_vars: r.options.substitute_vars ?? true,
              show_command_separately:
                r.options.show_command_separately ?? false,
            }
          : undefined,
      }));
    } else {
      rollback = [
        {
          command: stepData.rollback.command,
          script: stepData.rollback.script,
          instruction: stepData.rollback.instruction,
          description: stepData.rollback.description,
          timeout: stepData.rollback.timeout,
          pic: stepData.rollback.pic,
          reviewer: stepData.rollback.reviewer,
          evidence: parseEvidence(stepData.rollback),
          evidence_required: Boolean(stepData.rollback.evidence_required),
          expect: extractExpect(stepData.rollback),
          options: stepData.rollback.options
            ? {
                substitute_vars:
                  stepData.rollback.options.substitute_vars ?? true,
                show_command_separately:
                  stepData.rollback.options.show_command_separately ?? false,
              }
            : undefined,
        },
      ];
    }
  }

  return {
    id: stepData.id,
    name: stepData.name,
    type: stepData.type as StepType,
    phase: stepData.phase as StepPhase,
    description: stepData.description,
    if: stepData.if,
    command: stepData.command,
    script: stepData.script,
    instruction: stepData.instruction,
    condition: stepData.condition,
    timeout: stepData.timeout,
    estimated_duration: stepData.estimated_duration,
    env: stepData.env,
    uses: stepData.uses,
    with: stepData.with,
    variables: stepData.variables,
    evidence: parseEvidence(stepData),
    evidence_required: Boolean(stepData.evidence_required), // DEPRECATED: Use evidence.required instead
    evidence_types: stepData.evidence_types as EvidenceType[], // DEPRECATED: Use evidence.types instead
    validation: stepData.validation,
    session: stepData.session,
    expect: extractExpect(stepData),
    capture: stepData.capture,
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

  const importContext: ImportContext = {
    templateFiles: new Set(),
    baseDirectory,
  };

  // Parse unified steps (includes migrated preflight checks + regular steps)
  const steps: Step[] = [];

  // First, migrate preflight checks to steps with phase: preflight
  if (rawOperation.preflight && Array.isArray(rawOperation.preflight)) {
    rawOperation.preflight.forEach((checkData: any, index: number) => {
      try {
        const preflightStep: Step = {
          id: checkData.id || randomUUID(),
          name: checkData.name,
          type: checkData.type === 'manual' ? 'manual' : 'automatic',
          phase: 'preflight',
          description: checkData.description || '',
          instruction: checkData.instruction,
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
      const regularSteps = await resolveStepReferences(
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
    sessions: rawOperation.sessions,
    run: rawOperation.run,
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
