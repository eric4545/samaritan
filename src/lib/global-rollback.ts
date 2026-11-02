import type { RollbackPlan, RollbackStep, Step } from '../models/operation';
import { stepRollbackAnchor, stepRollbackHeadingText } from './anchor';
import { hasRollbackContent } from './rollback';
import { sortStepsByDependencies } from './step-deps';

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
  /**
   * Renderer-safe heading text for this folded entry (e.g. `Rollback for
   * "Deploy app"`), whose slug equals `sourceAnchor`. Set alongside
   * `sourceAnchor` so target renderers can emit the jump-link's heading without
   * re-deriving it from the source step. Same value for every sibling entry of
   * one source step (they share the anchor).
   */
  sourceHeading?: string;
}

/**
 * Resolve an operation's effective global rollback from its `RollbackPlan`:
 * the explicit `rollback.steps`, grouped with per-step rollbacks when
 * `aggregate_step_rollbacks` is set. Thin wrapper over `buildGlobalRollback`
 * so the four manual renderers and the run loop share one call shape instead
 * of repeating the plan→opts ternary. Returns `[]` when there is no plan.
 *
 * When `needs` dependencies are present, the aggregated per-step rollbacks are
 * ordered by REVERSE topological order (a dependent is undone before the step it
 * depends on). For a valid document (dependencies only ever point backward) the
 * topological order equals document order, so this is a no-op there — it only
 * matters for `needs`-reordered steps. `sortStepsByDependencies` is cycle-safe.
 */
export function buildEffectiveRollback(
  rollback: RollbackPlan | undefined,
  stepsToAggregate: Step[],
): EffectiveRollbackStep[] {
  if (!rollback) return [];
  return buildGlobalRollback(
    rollback.steps ?? [],
    sortStepsByDependencies(stepsToAggregate),
    {
      aggregate: rollback.aggregate_step_rollbacks,
    },
  );
}

/**
 * Build the effective global (operation-level) rollback by grouping per-step
 * rollbacks behind the explicit operation-level plan.
 *
 * The result is the explicit `globalSteps` as authored, followed — when
 * `opts.aggregate` is true — by every step's own `step.rollback` entries in
 * **reverse step order** (the most-recently-listed/completed step's rollback
 * first), so undoing proceeds in the opposite order of doing. Only the STEPS
 * are reversed: one step's own entries keep their authored order, because
 * they are a procedure (restore, then verify the restore), not a stack.
 * Sub-steps are walked too, since they can carry their own `rollback`.
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

  // Collect one group per step (its rollback entries in AUTHORED order) in
  // document order, recursing into sub-steps, then reverse the GROUPS so the
  // last step's rollback runs first. Reversing the flat entry list instead
  // flipped a step's own restore-then-verify into verify-then-restore.
  const groups: EffectiveRollbackStep[][] = [];
  const walk = (steps: Step[] | undefined): void => {
    if (!steps) return;
    for (const step of steps) {
      const anchor = stepRollbackAnchor(step);
      const heading = stepRollbackHeadingText(step);
      const entries = (step.rollback ?? [])
        .filter(hasRollbackContent)
        .map((rb) => withProvenance(rb, step.name, anchor, heading));
      if (entries.length > 0) groups.push(entries);
      walk(step.sub_steps);
    }
  };
  walk(stepsToAggregate);

  for (const group of groups.reverse()) result.push(...group);
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
  heading: string,
): EffectiveRollbackStep {
  const prefix = `↩ Rollback for "${stepName}"`;
  return {
    ...rb,
    name: rb.name ? `${prefix}: ${rb.name}` : prefix,
    sourceAnchor: anchor,
    sourceHeading: heading,
  };
}
