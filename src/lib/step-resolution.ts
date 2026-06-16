import type { ExpectConfig, Step } from '../models/operation';
import { isPrimitiveExpectShorthand } from './assertions';

/** Escape regex metacharacters so a string can be matched literally. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve `${VAR}` placeholders, prioritizing step-scoped variables over environment variables.
 *
 * Step variables are pre-resolved against environment variables (one pass) before merging,
 * so a step variable like `TEST_RECIPIENT: "${EMAIL_A}"` (injected by foreach/matrix expansion
 * with an unresolved env-specific reference) fully resolves to the env value of `EMAIL_A`
 * before being substituted into `command`. Non-string step variable values pass through
 * untouched. The pre-resolution pass does not itself receive stepVariables, so chaining
 * terminates; substitution iterates keys in insertion order over the working string, so a
 * value inserted by an earlier key may still be expanded by a later key, but never loops.
 */
export function substituteVariables(
  command: string,
  envVariables: Record<string, any>,
  stepVariables?: Record<string, any>,
): string {
  const resolvedStepVariables: Record<string, any> = {};
  for (const [key, value] of Object.entries(stepVariables || {})) {
    resolvedStepVariables[key] =
      typeof value === 'string'
        ? substituteVariables(value, envVariables)
        : value;
  }

  const mergedVariables = { ...envVariables, ...resolvedStepVariables };

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
  return result;
}
