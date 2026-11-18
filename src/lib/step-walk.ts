import type { Operation, RollbackStep, Step } from '../models/operation';

export type AnyStep = Step | RollbackStep;

/** Every step under `steps`: each step, its sub-steps and its own rollback. */
export function* walkSteps(steps: AnyStep[] | undefined): Generator<AnyStep> {
  for (const step of steps ?? []) {
    yield step;
    yield* walkSteps(step.sub_steps);
    yield* walkSteps((step as Step).rollback);
  }
}

/**
 * Every step a lint pass must see: steps, sub-steps, each step's `rollback`
 * and the operation-level `rollback.steps`. Lint passes share this walker so
 * none of them silently skips a rollback command or expect.
 */
export function* walkOperationSteps(
  operation: Pick<Operation, 'steps' | 'rollback'>,
): Generator<AnyStep> {
  yield* walkSteps(operation.steps);
  yield* walkSteps(operation.rollback?.steps);
}

/** Display name for a step; rollback steps may have none. */
export function stepDisplayName(step: AnyStep): string {
  return step.name || '(rollback)';
}

/**
 * Top-level step IDs used by more than one step, each with the 1-based
 * positions of the steps that carry it.
 */
export function duplicateStepIds(
  steps: Pick<Step, 'id'>[],
): { id: string; positions: number[] }[] {
  const byId = new Map<string, number[]>();
  steps.forEach((step, i) => {
    if (step.id) byId.set(step.id, [...(byId.get(step.id) ?? []), i + 1]);
  });
  return [...byId]
    .filter(([, positions]) => positions.length > 1)
    .map(([id, positions]) => ({ id, positions }));
}

export function formatDuplicateStepId(dup: {
  id: string;
  positions: number[];
}): string {
  return `Duplicate step ID: ${dup.id} (steps ${dup.positions.join(', ')})`;
}
