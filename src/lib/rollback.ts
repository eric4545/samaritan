import type { RollbackStep, Step } from '../models/operation';
import type { StepDepGraph } from './step-deps';

/**
 * True when a rollback step has any renderable content — its own body
 * (command / instruction / script / expect) or nested sub_steps. Used to gate
 * rollback rendering uniformly across every manual format, replacing the
 * copy-pasted `rb && (rb.command || rb.instruction || ...)` guards. Acts as a
 * type guard so callers narrow `RollbackStep | undefined` to `RollbackStep`.
 */
export function hasRollbackContent(
  rb: RollbackStep | undefined,
): rb is RollbackStep {
  return (
    !!rb &&
    (!!rb.command ||
      !!rb.instruction ||
      !!rb.script ||
      rb.expect != null ||
      (rb.sub_steps != null && rb.sub_steps.length > 0))
  );
}

/** True when a step has at least one rollback entry with content. */
function stepHasRollback(step: Step): boolean {
  return (step.rollback ?? []).some(hasRollbackContent);
}

/**
 * Find the nearest EARLIER step that has a usable rollback, for the run loop's
 * `[r]` fallback when the current step has none of its own.
 *
 * Search order:
 *  1. If a dependency graph is supplied and `fromIndex` has `needs`, walk the
 *     needs chain (breadth-first, nearest — highest index — first) looking for a
 *     step with rollback content.
 *  2. Otherwise (or if the chain yields nothing) scan `fromIndex-1 … 0` in
 *     document order.
 *
 * `isCandidate` (e.g. "status === completed") further filters which steps may be
 * offered — the run loop only offers undoing steps that actually ran.
 * Returns the matched step index + its content-bearing rollback entries, or
 * undefined when nothing qualifies anywhere.
 */
export function findNearestRollbackSource(
  steps: Step[],
  fromIndex: number,
  opts: {
    graph?: StepDepGraph;
    isCandidate?: (index: number) => boolean;
  } = {},
): { stepIndex: number; rollback: RollbackStep[] } | undefined {
  const isCandidate = opts.isCandidate ?? (() => true);
  const qualifies = (idx: number): boolean =>
    idx >= 0 &&
    idx < steps.length &&
    stepHasRollback(steps[idx]) &&
    isCandidate(idx);

  const pick = (idx: number) => ({
    stepIndex: idx,
    rollback: (steps[idx].rollback ?? []).filter(hasRollbackContent),
  });

  // 1. Needs-chain BFS (nearest dependency first).
  if (opts.graph) {
    const seen = new Set<number>();
    // Direct needs, nearest (highest index) first.
    let frontier = [...opts.graph.needsByIndex[fromIndex]].sort(
      (a, b) => b - a,
    );
    while (frontier.length > 0) {
      const next: number[] = [];
      for (const idx of frontier) {
        if (seen.has(idx)) continue;
        seen.add(idx);
        if (qualifies(idx)) return pick(idx);
        next.push(...opts.graph.needsByIndex[idx]);
      }
      frontier = next.sort((a, b) => b - a);
    }
  }

  // 2. Document-order scan backwards.
  for (let idx = fromIndex - 1; idx >= 0; idx--) {
    if (qualifies(idx)) return pick(idx);
  }

  return undefined;
}
