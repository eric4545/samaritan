import type { RollbackPlan, RollbackStep, Step } from '../models/operation';
import { stepRollbackAnchor } from './anchor';
import { hasRollbackContent } from './rollback';

/**
 * A rollback step as it appears in the effective operation-level plan. Adds
 * `sourceAnchor`, set ONLY on entries folded in from a step's own `rollback`
 * under `aggregate_step_rollbacks`. Renderers use it to emit the jump-link
 * target that each step's inline rollback link points to. Optional, so a plain
 * `RollbackStep` (explicit plan step, nested sub_step) is assignable and the run
 * loop / renderers that ignore it are unaffected.
 */
export interface EffectiveRollbackStep extends RollbackStep {
  sourceAnchor?: string;
}

/**
 * Resolve an operation's effective global rollback from its `RollbackPlan`:
 * the explicit `rollback.steps`, grouped with per-step rollbacks when
 * `aggregate_step_rollbacks` is set. Thin wrapper over `buildGlobalRollback`
 * so the four manual renderers and the run loop share one call shape instead
 * of repeating the plan→opts ternary. Returns `[]` when there is no plan.
 */
export function buildEffectiveRollback(
  rollback: RollbackPlan | undefined,
  stepsToAggregate: Step[],
): EffectiveRollbackStep[] {
  if (!rollback) return [];
  return buildGlobalRollback(rollback.steps ?? [], stepsToAggregate, {
    aggregate: rollback.aggregate_step_rollbacks,
  });
}

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
): EffectiveRollbackStep[] {
  const result: EffectiveRollbackStep[] = [...globalSteps];
  if (!opts.aggregate) return result;

  // Collect (step, rollbackEntry) pairs in document order, recursing into
  // sub-steps, then reverse so the last step's rollback runs first. Each pair
  // carries the source step's anchor so the folded entry can advertise the
  // jump-link target its inline rollback link points to.
  const collected: Array<{
    stepName: string;
    anchor: string;
    rollback: RollbackStep;
  }> = [];
  const walk = (steps: Step[] | undefined): void => {
    if (!steps) return;
    for (const step of steps) {
      for (const rb of step.rollback ?? []) {
        if (hasRollbackContent(rb)) {
          collected.push({
            stepName: step.name,
            anchor: stepRollbackAnchor(step),
            rollback: rb,
          });
        }
      }
      walk(step.sub_steps);
    }
  };
  walk(stepsToAggregate);

  for (const { stepName, anchor, rollback } of collected.reverse()) {
    result.push(withProvenance(rollback, stepName, anchor));
  }
  return result;
}

/**
 * Clone a rollback step, prefixing its `name` with the source step it undoes and
 * tagging it with that step's `sourceAnchor` (the jump-link target). Keeps the
 * original name (if any) so authored rollback labels survive.
 */
function withProvenance(
  rb: RollbackStep,
  stepName: string,
  anchor: string,
): EffectiveRollbackStep {
  const prefix = `↩ Rollback for "${stepName}"`;
  return {
    ...rb,
    name: rb.name ? `${prefix}: ${rb.name}` : prefix,
    sourceAnchor: anchor,
  };
}
