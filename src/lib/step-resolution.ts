import type { Step } from '../models/operation';

/**
 * Resolve `${VAR}` placeholders, prioritizing step-scoped variables over environment variables.
 */
export function substituteVariables(
  command: string,
  envVariables: Record<string, any>,
  stepVariables?: Record<string, any>,
): string {
  const mergedVariables = { ...envVariables, ...(stepVariables || {}) };

  let result = command;
  for (const key in mergedVariables) {
    const regex = new RegExp(`\\$\\{${key}\\}`, 'g');
    result = result.replace(regex, mergedVariables[key]);
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
