import type { RollbackStep, Step } from '../models/operation';
import { hasRollbackContent } from './rollback';

/**
 * Build the effective global (operation-level) rollback by grouping per-step
 * rollbacks behind the explicit operation-level plan.
 *
 * The result is the explicit `globalSteps` as authored, followed — when
 * `opts.aggregate` is true — by every step's own `step.rollback` entries in
 * **reverse step order** (the most-recently-listed/completed step's rollback
 * first), so undoing proceeds in the opposite order of doing. Sub-steps are
 * walked too, since they can carry their own `rollback`.
 *
 * Each appended entry is shallow-cloned with a provenance-prefixed `name`
 * (e.g. `↩ Rollback for "Deploy app"`) so the existing operation-level rollback
 * renderers and the run-time rollback executor — all of which already consume a
 * plain `RollbackStep[]` — surface where each step came from with no extra
 * rendering code. The clone is non-destructive: source steps are untouched and
 * the entry's own nested `sub_steps` keep their original names.
 *
 * Pure and order-deterministic so callers (manual generation with ALL steps,
 * the run loop with only COMPLETED steps) get identical, testable grouping.
 */
export function buildGlobalRollback(
  globalSteps: RollbackStep[],
  stepsToAggregate: Step[],
  opts: { aggregate?: boolean } = {},
): RollbackStep[] {
  const result: RollbackStep[] = [...globalSteps];
  if (!opts.aggregate) return result;

  // Collect (step, rollbackEntry) pairs in document order, recursing into
  // sub-steps, then reverse so the last step's rollback runs first.
  const collected: Array<{ stepName: string; rollback: RollbackStep }> = [];
  const walk = (steps: Step[] | undefined): void => {
    if (!steps) return;
    for (const step of steps) {
      for (const rb of step.rollback ?? []) {
        if (hasRollbackContent(rb)) {
          collected.push({ stepName: step.name, rollback: rb });
        }
      }
      walk(step.sub_steps);
    }
  };
  walk(stepsToAggregate);

  for (const { stepName, rollback } of collected.reverse()) {
    result.push(withProvenance(rollback, stepName));
  }
  return result;
}

/**
 * Clone a rollback step, prefixing its `name` with the source step it undoes.
 * Keeps the original name (if any) so authored rollback labels survive.
 */
function withProvenance(rb: RollbackStep, stepName: string): RollbackStep {
  const prefix = `↩ Rollback for "${stepName}"`;
  return {
    ...rb,
    name: rb.name ? `${prefix}: ${rb.name}` : prefix,
  };
}
