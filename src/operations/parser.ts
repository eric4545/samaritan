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
  RollbackStep,
  Step,
  StepForeach,
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
  commonVariables: Record<string, any>; // Globals available for foreach/matrix value resolution
}

const FORBIDDEN_VARIABLE_KEYS = ['__proto__', 'constructor', 'prototype'];

/**
 * Reject variable names that collide with object prototype machinery —
 * they can never be resolved safely and invite prototype-pollution bugs
 * in downstream merges.
 */
function assertSafeVariableKeys(
  vars: Record<string, any> | undefined,
  context: string,
): void {
  for (const key of Object.keys(vars ?? {})) {
    if (FORBIDDEN_VARIABLE_KEYS.includes(key)) {
      throw new OperationParseError(`Forbidden variable name '${key}'`, [
        {
          field: context,
          message: `Variable name '${key}' is reserved and cannot be used`,
        },
      ]);
    }
  }
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
  if (data.evidence) {
    return {
      required: Boolean(data.evidence.required),
      types: data.evidence.types as EvidenceType[],
      results: data.evidence.results, // Pass through results array if present
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
 * Recursively inject a foreach loop combination into a step's `variables`,
 * its `sub_steps` (at every nesting level), and its `variants`.
 *
 * Returns a NEW step object (and new sub_steps/variants arrays/objects) so
 * that each expanded combination gets its own independent tree - without
 * this, all expanded combos would share the same `sub_steps` array
 * reference and resolve against only the parent's (combo-injected)
 * `variables`, leaving `${VAR}` placeholders inside sub_steps unresolved.
 *
 * `combo` always wins over an existing same-named variable on the step
 * (consistent with the parent injection). Note: if a sub_step has its own
 * nested `foreach` using the same variable name, that inner foreach is
 * expanded separately (parseStep recursion happens after this), and this
 * outer combo injection would be overwritten by the inner combo for that
 * sub_step - this is a degenerate edge case (shadowing the same loop
 * variable name in nested foreach) and is not specially handled here.
 */
function injectComboVariables(step: Step, combo: Record<string, any>): Step {
  const result: Step = {
    ...step,
    variables: { ...(step.variables || {}), ...combo },
  };

  if (step.sub_steps) {
    result.sub_steps = step.sub_steps.map((subStep) =>
      injectComboVariables(subStep, combo),
    );
  }

  if (step.variants) {
    const newVariants: Record<
      string,
      Partial<Omit<Step, 'variants' | 'when'>>
    > = {};
    for (const [envName, variant] of Object.entries(step.variants)) {
      const newVariant: Partial<Omit<Step, 'variants' | 'when'>> = {
        ...variant,
      };
      // mergeStepVariant does `{ ...step, ...variant }`, so a variant that
      // defines its own `variables` would otherwise replace the base
      // step's combo-injected `variables` entirely - merge combo back in.
      if (variant.variables) {
        newVariant.variables = { ...variant.variables, ...combo };
      }
      if (variant.sub_steps) {
        newVariant.sub_steps = variant.sub_steps.map((subStep) =>
          injectComboVariables(subStep, combo),
        );
      }
      newVariants[envName] = newVariant;
    }
    result.variants = newVariants;
  }

  return result;
}

/**
 * Expand a `foreach` loop (single-var or matrix) on any step-like item into one
 * clone per combination — the SINGLE expansion path shared by normal steps AND
 * rollback steps (both concepts). A rollback step IS a normal step, so it must
 * expand the same way; keeping this in one helper is what stops the two from
 * drifting apart again.
 *
 * `contextVars` resolves `${VAR}` inside the foreach block before combinations
 * are generated (so include/exclude comparisons and name suffixes see resolved
 * values). Each clone gets the combo injected into `variables`/`sub_steps`/
 * `variants` (via `injectComboVariables`), a per-combo name suffix (bare suffix
 * when the item is nameless, as rollback steps may be), and `foreach` cleared.
 * Items without a `foreach` pass through unchanged.
 */
function expandForeachItem<
  T extends {
    foreach?: StepForeach;
    variables?: Record<string, any>;
    sub_steps?: unknown;
    variants?: unknown;
    id?: string;
    name?: string;
  },
>(item: T, contextVars: Record<string, any>, label: string): T[] {
  if (!item.foreach) return [item];

  const foreach = substituteVariables(item.foreach, contextVars) as StepForeach;

  let combinations: Array<Record<string, any>> = [];
  if (foreach.matrix) {
    combinations = filterMatrixCombinations(
      generateMatrixCombinations(foreach.matrix),
      foreach.include,
      foreach.exclude,
    );
  } else if (foreach.var && foreach.values) {
    const foreachVar = foreach.var;
    combinations = foreach.values.map((value) => ({ [foreachVar]: value }));
  } else {
    throw new OperationParseError(`Invalid foreach syntax in ${label}`, [
      {
        field: `${label}.foreach`,
        message: 'foreach must have either (var + values) or (matrix)',
      },
    ]);
  }

  return combinations.map((combo, j) => {
    const varSuffix = formatVariableCombination(combo);
    // injectComboVariables is typed to Step; rollback steps are structurally
    // compatible (variables/sub_steps/variants), so cast through.
    const injected = injectComboVariables(
      item as unknown as Step,
      combo,
    ) as unknown as T;
    // A foreach loop value is a parse-time constant, so it must render in the
    // expanded step's CONTENT (command/script/instruction/expect/sub_steps),
    // not just its title — otherwise the manual shows "Step: … (build-check)"
    // next to a literal `${SPEC_DIR}` command unless the user passes
    // `--resolve-vars`. Only bake in combo values that are themselves literals;
    // values still holding a `${VAR}` reference (e.g. a matrix value pulled from
    // an env var) stay deferred to generation-time `--resolve-vars` (unchanged
    // behaviour). The full combo is still injected into `variables` above, so
    // `--resolve-vars` and the run loop keep working. Unmatched `${VAR}`s pass
    // through untouched (partial substitution).
    const literalCombo = Object.fromEntries(
      Object.entries(combo).filter(
        ([, value]) => typeof value !== 'string' || !value.includes('${'),
      ),
    );
    const resolved = substituteVariables(injected, literalCombo) as T;
    return {
      ...resolved,
      id: item.id ? `${item.id}-${j}` : undefined,
      name: item.name ? `${item.name} (${varSuffix})` : varSuffix,
      foreach: undefined,
    };
  });
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

      return {
        steps: templateObj.steps,
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

          // Tag every expanded step with one group id for this `uses:` block so
          // generators keep the block contiguous during phase grouping. Stamp
          // unconditionally so the OUTERMOST `uses:` wins for nested templates
          // (recursion expands inner blocks first, then this overwrites).
          const usesGroup = {
            id: randomUUID(),
            name: typeof stepData.name === 'string' ? stepData.name : undefined,
          };
          for (const templateStep of expandedSteps) {
            if (!templateStep.phase) {
              templateStep.phase = 'flight';
            }
            templateStep.usesGroup = usesGroup;
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

        // Expand foreach loops (supports both single var and matrix) via the
        // shared helper — resolves ${VAR} in the foreach block against
        // common_variables + step.variables BEFORE generating combinations, so
        // include/exclude comparisons and name suffixes see resolved values.
        if (step.foreach) {
          resolvedSteps.push(
            ...expandForeachItem(
              step,
              { ...importContext.commonVariables, ...(step.variables ?? {}) },
              `step "${step.name}"`,
            ),
          );
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

function extractExpect(stepData: any): any {
  if (stepData.expect != null) return stepData.expect;
  // Backward compat: lift verify.expect or string verify shorthand
  if (stepData.verify != null) {
    if (typeof stepData.verify === 'string') return stepData.verify;
    if (stepData.verify.expect != null) return stepData.verify.expect;
  }
  return undefined;
}

// Normalize one rollback step (array or object YAML form) into a RollbackStep.
// A rollback step IS a normal step, so this is a SPREAD pass-through: it carries
// EVERY authored field (name, sub_steps, foreach, variables, if, ...) and only
// reshapes the few that need it (evidence/expect/options/sub_steps). The old
// field-by-field allowlist silently dropped anything not explicitly listed —
// which is exactly how name, then sub_steps, then foreach kept vanishing before
// they reached the renderers. The schema (#/definitions/rollbackStep,
// additionalProperties:false) remains the gate on what is authorable, so the
// spread cannot smuggle in junk. `verify` is folded into `expect` and dropped.
function normalizeRollbackStep(r: any): RollbackStep {
  const { verify: _verify, ...rest } = r ?? {};
  return {
    ...rest,
    evidence: r.evidence ? parseEvidence(r) : undefined,
    expect: extractExpect(r),
    options: r.options
      ? {
          substitute_vars: r.options.substitute_vars ?? true,
          show_command_separately: r.options.show_command_separately ?? false,
        }
      : undefined,
    sub_steps: Array.isArray(r.sub_steps)
      ? r.sub_steps.map(normalizeRollbackStep)
      : undefined,
  };
}

// Expand `foreach`/`matrix` on a list of already-normalized rollback steps,
// recursing into `sub_steps` — the SAME expansion a normal step gets, via the
// shared `expandForeachItem`. Runs after normalization so every rollback step
// (step-level and operation-level) is a flat, pre-expanded RollbackStep[] by the
// time the renderers and the run loop see it — they need no foreach awareness.
function expandRollbackForeach(
  steps: RollbackStep[],
  contextVars: Record<string, any>,
): RollbackStep[] {
  const expanded: RollbackStep[] = [];
  for (const step of steps) {
    const withExpandedSubs: RollbackStep = step.sub_steps
      ? {
          ...step,
          sub_steps: expandRollbackForeach(step.sub_steps, contextVars),
        }
      : step;
    expanded.push(
      ...expandForeachItem(
        withExpandedSubs,
        contextVars,
        `rollback step "${step.name ?? '(unnamed)'}"`,
      ),
    );
  }
  return expanded;
}

function assertNoDeprecatedEvidenceFields(data: any, stepName?: string): void {
  if (!data || typeof data !== 'object') return;
  const removed = ['evidence_required', 'evidence_types'].filter(
    (key) => key in data,
  );
  if (removed.length === 0) return;

  const where = stepName ? ` in step "${stepName}"` : '';
  throw new OperationParseError(
    `Removed field(s) ${removed.join(', ')}${where} are no longer supported. ` +
      'Migrate to the nested evidence format:\n' +
      '  evidence:\n    required: true\n    types: [command_output]',
    removed.map((field) => ({
      field,
      message: 'removed — use evidence.required / evidence.types instead',
    })),
  );
}

async function parseStep(
  stepData: any,
  _stepIndex: number,
  importContext?: ImportContext,
): Promise<Step> {
  assertNoDeprecatedEvidenceFields(stepData, stepData?.name);
  if (Array.isArray(stepData?.rollback)) {
    for (const r of stepData.rollback) {
      assertNoDeprecatedEvidenceFields(r, stepData?.name);
    }
  } else if (stepData?.rollback) {
    assertNoDeprecatedEvidenceFields(stepData.rollback, stepData?.name);
  }

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

  // Parse rollback: normalize both object and array YAML formats to
  // RollbackStep[], then expand any foreach/matrix — a rollback step IS a step,
  // so it loops the same way. Resolve ${VAR} in the foreach block against the
  // owning step's variables plus common variables.
  let rollback: RollbackStep[] | undefined;
  if (stepData.rollback) {
    const normalized = Array.isArray(stepData.rollback)
      ? stepData.rollback.map(normalizeRollbackStep)
      : [normalizeRollbackStep(stepData.rollback)];
    rollback = expandRollbackForeach(normalized, {
      ...(importContext?.commonVariables ?? {}),
      ...(stepData.variables ?? {}),
    });
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
    timeout: stepData.timeout,
    estimated_duration: stepData.estimated_duration,
    env: stepData.env,
    uses: stepData.uses,
    with: stepData.with,
    variables: stepData.variables,
    evidence: parseEvidence(stepData),
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

/**
 * Load the raw environment entries from a shared environments file referenced
 * by `environments: [{ uses: ./file.yaml }]`. Accepts both a
 * `kind: EnvironmentManifest` file and a plain `{ environments: [...] }`
 * (or operation-style) file — both expose a top-level `environments` array.
 */
function loadSharedEnvironments(absolutePath: string, refPath: string): any[] {
  let content: string;
  try {
    content = fs.readFileSync(absolutePath, 'utf8');
  } catch (_error) {
    throw new OperationParseError(`Environment file '${refPath}' not found`, [
      {
        field: 'environments.uses',
        message: `Cannot read environment file: ${refPath}`,
      },
    ]);
  }

  let parsed: any;
  try {
    parsed = yaml.load(content);
  } catch (error) {
    throw new OperationParseError(
      `Invalid YAML in environment file '${refPath}'`,
      [{ field: 'environments.uses', message: (error as Error).message }],
    );
  }

  if (!parsed || !Array.isArray(parsed.environments)) {
    throw new OperationParseError(
      `Environment file '${refPath}' must contain an 'environments' array`,
      [
        {
          field: 'environments.uses',
          message: `No 'environments' array found in ${refPath}`,
        },
      ],
    );
  }

  for (const env of parsed.environments) {
    if (!env || typeof env.name !== 'string' || env.name.length === 0) {
      throw new OperationParseError(
        `Environment file '${refPath}' has an entry without a 'name'`,
        [
          {
            field: 'environments.uses',
            message: `Every environment in ${refPath} must have a name`,
          },
        ],
      );
    }
  }

  return parsed.environments;
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
  // Priority: common_variables > top-level variables: > env_file
  const commonVariables = {
    ...envFileVariables,
    ...(rawOperation.variables || {}),
    ...(rawOperation.common_variables || {}),
  };

  // Parse environments (supports both inline and manifest inheritance)
  let environments: Environment[] = [];
  try {
    if (rawOperation.environments && Array.isArray(rawOperation.environments)) {
      const environmentLoader = new EnvironmentLoader(baseDirectory);
      const envIndexByName = new Map<string, number>();

      // Add an environment, or merge it onto an existing one of the same name
      // (e.g. an inline override entry following a `uses:` wholesale import).
      // `hasApproval`/`hasValidation` indicate whether the source entry set
      // those booleans explicitly, so a variables-only override doesn't reset
      // them.
      const upsertEnv = (
        env: Environment,
        hasApproval: boolean,
        hasValidation: boolean,
      ): void => {
        const existingIdx = envIndexByName.get(env.name);
        if (existingIdx === undefined) {
          envIndexByName.set(env.name, environments.length);
          environments.push(env);
          return;
        }
        const existing = environments[existingIdx];
        existing.variables = { ...existing.variables, ...env.variables };
        if (env.from) existing.from = env.from;
        if (env.description) existing.description = env.description;
        if (env.restrictions.length)
          existing.restrictions = [
            ...existing.restrictions,
            ...env.restrictions,
          ];
        if (env.targets.length)
          existing.targets = [...existing.targets, ...env.targets];
        if (hasApproval) existing.approval_required = env.approval_required;
        if (hasValidation)
          existing.validation_required = env.validation_required;
      };

      for (const envData of rawOperation.environments) {
        if (envData.uses) {
          // Wholesale import: expand ALL environments from the referenced file
          // inline (reuses the `uses:` inline-expansion model). Common
          // variables remain the base layer for each imported environment.
          const importedEnvs = loadSharedEnvironments(
            resolve(baseDirectory, envData.uses),
            envData.uses,
          );
          for (const importedEnv of importedEnvs) {
            const parsedEnv = parseEnvironment(
              importedEnv,
              environments.length,
            );
            parsedEnv.variables = {
              ...commonVariables,
              ...parsedEnv.variables,
            };
            upsertEnv(
              parsedEnv,
              importedEnv.approval_required !== undefined,
              importedEnv.validation_required !== undefined,
            );
          }
        } else if (envData.from) {
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

          upsertEnv(
            environment,
            envData.approval_required !== undefined,
            envData.validation_required !== undefined,
          );
        } else {
          // Regular inline environment - merge with common variables
          const parsedEnv = parseEnvironment(envData, environments.length);
          parsedEnv.variables = { ...commonVariables, ...parsedEnv.variables };
          upsertEnv(
            parsedEnv,
            envData.approval_required !== undefined,
            envData.validation_required !== undefined,
          );
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
    commonVariables,
  };

  const steps: Step[] = [];

  // Process steps
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

  // Throw all collected errors if any
  if (errors.length > 0) {
    throw new OperationParseError('Operation validation failed', errors);
  }

  // Build variable matrix from environments
  const variables: VariableMatrix = {};
  environments.forEach((env) => {
    assertSafeVariableKeys(
      env.variables,
      `environments[${env.name}].variables`,
    );
    variables[env.name] = env.variables;
  });
  assertSafeVariableKeys(commonVariables, 'common_variables');

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
    // Normalize the operation-level rollback plan's steps through the same
    // recursive normalizer as step-level rollback, then expand foreach/matrix
    // the same way normal steps do — so name/sub_steps/expect shorthand AND
    // loops are handled identically in both (no raw-vs-normalized split).
    rollback: rawOperation.rollback
      ? {
          ...rawOperation.rollback,
          steps: Array.isArray(rawOperation.rollback.steps)
            ? expandRollbackForeach(
                rawOperation.rollback.steps.map(normalizeRollbackStep),
                commonVariables,
              )
            : [],
        }
      : undefined,
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
export { parseStep, parseEnvironment };
