import type { ExpectConfig, Step } from '../models/operation';
import { isPrimitiveExpectShorthand } from './assertions';
import { resolveVariableChains } from './variable-resolver';

/** Escape regex metacharacters so a string can be matched literally. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Merge step-scoped variables over environment variables — the single
 * definition of how `step.variables` layer on top of env/common vars. Each
 * string step var is pre-resolved against the env vars in one pass (so a
 * foreach/matrix-injected `TEST_RECIPIENT: "${EMAIL_A}"` resolves to the env
 * value before merging); non-string values pass through untouched. The
 * pre-resolution pass does not itself receive `stepVariables`, so chaining
 * terminates.
 *
 * Returns `envVariables` unchanged (same reference) when there are no step
 * vars to layer, so callers on the hot display path don't pay for a spread.
 * Shared by `substituteVariables` and the interactive run loop so every path
 * resolves the same way.
 */
export function mergeStepVariables(
  envVariables: Record<string, any>,
  stepVariables?: Record<string, any>,
): Record<string, any> {
  if (!stepVariables || Object.keys(stepVariables).length === 0) {
    return envVariables;
  }
  const resolved: Record<string, any> = {};
  for (const [key, value] of Object.entries(stepVariables)) {
    resolved[key] =
      typeof value === 'string'
        ? substituteVariables(value, envVariables)
        : value;
  }
  return { ...envVariables, ...resolved };
}

/**
 * Resolve `${VAR}` placeholders, prioritizing step-scoped variables over
 * environment variables (see `mergeStepVariables` for the layering rule).
 *
 * Values that reference other variables are chain-resolved first
 * (`resolveVariableChains`), so the result does not depend on key order and
 * matches what the run loop pastes. Inserted values are never re-scanned, so
 * this never loops.
 */
export function substituteVariables(
  command: string,
  envVariables: Record<string, any>,
  stepVariables?: Record<string, any>,
): string {
  const mergedVariables = resolveVariableChains(
    mergeStepVariables(envVariables, stepVariables),
  );

  let result = command;
  for (const key in mergedVariables) {
    // Escape the key: variable names come from YAML and may contain regex
    // metacharacters that would otherwise change what gets replaced.
    const regex = new RegExp(`\\$\\{${escapeRegExp(key)}\\}`, 'g');
    // Function replacement: a value containing $& / $' must be inserted
    // literally, not treated as a replacement pattern.
    result = result.replace(regex, () => String(mergedVariables[key]));
  }

  return result;
}

/**
 * Prepare an operation for a `--resolve-vars` manual, in every format.
 *
 * - Each environment's variables (both `variables[env]` and
 *   `environments[].variables`) are chain-resolved, so the environments
 *   overview shows `cache.staging.example.com`, not the authored
 *   `cache.${NAMESPACE}.example.com`.
 * - With one environment selected (`--env`), the shared cells (step and
 *   rollback names, descriptions) resolve against THAT environment: the
 *   formats that keep the table layout for `--env` (ADF, Confluence, HTML)
 *   otherwise left `Deploy ${APP_ENV}` literal while the commands next to it
 *   were resolved.
 * - The operation description resolves the same way.
 *
 * Pure: returns a new operation, the input is not changed.
 */
export function resolveOperationVariablesForManual<
  T extends {
    description?: string;
    common_variables?: Record<string, any>;
    variables?: Record<string, Record<string, any>>;
    environments?: Array<{ name: string; variables?: Record<string, any> }>;
  },
>(operation: T, targetEnv?: string): T {
  const variables: Record<string, Record<string, any>> = {};
  for (const [envName, envVars] of Object.entries(operation.variables ?? {})) {
    variables[envName] = resolveVariableChains(envVars ?? {});
  }
  const environments = (operation.environments ?? []).map((env) => ({
    ...env,
    variables: resolveVariableChains(env.variables ?? {}),
  }));
  const selected = targetEnv ? variables[targetEnv] : undefined;
  const shared =
    selected ?? resolveVariableChains(operation.common_variables ?? {});
  return {
    ...operation,
    variables,
    environments,
    common_variables: shared,
    ...(operation.description
      ? { description: substituteVariables(operation.description, shared) }
      : {}),
  };
}

/**
 * Resolve a display string (step name, description, …) shown in the shared
 * name cell of multi-env tables: substitutes common + step variables when
 * `resolveVariables` is on, leaving env-specific placeholders literal (they
 * resolve per-environment in the row cells). A no-op when resolution is off.
 */
export function resolveDisplayText(
  value: string,
  resolveVariables: boolean | undefined,
  envVariables: Record<string, any> | undefined,
  stepVariables?: Record<string, any>,
): string {
  return resolveVariables
    ? substituteVariables(value, envVariables ?? {}, stepVariables)
    : value;
}

/**
 * Merge step variants for a specific environment with base step properties.
 * Returns the merged step (base + variant overrides) for the given environment.
 */
export function mergeStepVariant(step: Step, environmentName: string): Step {
  if (!step.variants || !step.variants[environmentName]) {
    return step;
  }

  const variant = step.variants[environmentName];
  return {
    ...step,
    ...variant,
    // Preserve base properties that shouldn't be overridden
    when: step.when,
    variants: step.variants,
    // Merge variables instead of letting the variant replace them wholesale.
    // A variant that defines its own `variables` should layer on top of the
    // base step's vars (variant wins on key conflicts), not discard them -
    // otherwise base vars needed to resolve command/instruction/expect are lost.
    variables:
      step.variables || variant.variables
        ? { ...step.variables, ...variant.variables }
        : undefined,
  };
}

/**
 * Check if a step should be rendered for a specific environment.
 * Returns true if the step applies to this environment (no `when` means all environments).
 */
export function shouldRenderStepForEnvironment(
  step: Step,
  environmentName: string,
): boolean {
  if (!step.when || step.when.length === 0) {
    return true;
  }

  return step.when.includes(environmentName);
}

/**
 * `ExpectConfig` fields whose values are strings (or template-substitutable
 * primitives) and therefore eligible for `${VAR}` substitution.
 */
export const EXPECT_STRING_FIELDS = [
  'contains',
  'not_contains',
  'equals',
  'matches',
  'any_line_contains',
  'no_line_contains',
  'all_lines_match',
  'any_line_matches',
  'no_line_matches',
  'jsonpath',
] as const satisfies ReadonlyArray<keyof ExpectConfig>;

/**
 * Apply `${VAR}` substitution to every string field of an `expect` config
 * (including string-shorthand and array-of-checks forms), so manuals render
 * resolved values in `expect.contains`/`equals`/etc the same way they do for
 * `command` and `instruction`.
 */
export function substituteExpectVars(
  expect: ExpectConfig | ExpectConfig[] | string,
  envVars: Record<string, any>,
  stepVars?: Record<string, any>,
): ExpectConfig | ExpectConfig[] | string {
  if (typeof expect === 'string')
    return substituteVariables(expect, envVars, stepVars);
  // There's nothing to substitute inside a primitive shorthand value —
  // return it as-is rather than spreading it into an empty object and
  // losing the value.
  if (isPrimitiveExpectShorthand(expect)) return expect;
  if (Array.isArray(expect))
    return expect.map(
      (e) => substituteExpectVars(e, envVars, stepVars) as ExpectConfig,
    );
  const result: ExpectConfig = { ...expect };
  for (const field of EXPECT_STRING_FIELDS) {
    const raw = result[field];
    if (raw === undefined || raw === null) continue;
    // A field value may be a number/boolean when the parser's type-preserving
    // template substitution resolved "${VAR}" to a non-string (e.g. an AWS
    // account ID).  Convert to string instead of passing a non-string to
    // substituteVariables (which calls String.prototype.replace internally).
    result[field] =
      typeof raw === 'string'
        ? substituteVariables(raw, envVars, stepVars)
        : String(raw);
  }
  // retry.while is a string pattern (substring or regex) and participates in
  // the same ${VAR} substitution as the other expect string fields.
  if (result.retry?.while !== undefined) {
    result.retry = {
      ...result.retry,
      while: substituteVariables(result.retry.while, envVars, stepVars),
    };
  }
  return result;
}
