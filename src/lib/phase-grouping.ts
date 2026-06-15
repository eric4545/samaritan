import type { Step, StepPhase } from '../models/operation';

export interface PhaseBuckets<T> {
  preflight: T[];
  flight: T[];
  postflight: T[];
}

/**
 * Group steps into the three flight phases, **block-aware**.
 *
 * Standalone steps bucket by their own `phase` (defaulting to `flight`), so a
 * top-level `phase: preflight` step still hoists into the global Pre-Flight
 * section. Steps expanded from a single `uses:` block (sharing one
 * `usesGroup.id`) travel together into the block's effective phase, keeping the
 * block contiguous — a reused block's preflight checks stay local to the block
 * instead of jumping to the top global Pre-Flight section.
 *
 * Block effective phase: `flight` if any step in the block is `flight`, else
 * `postflight` if any is `postflight`, else `preflight`. (A mixed
 * preflight+flight block lands in `flight` so its leading preflight checks
 * render right before the block's main steps; a pure-check block lands in
 * `preflight`.)
 *
 * Document order is preserved within each bucket. Generic over the item type so
 * it serves both `Step[]` callers and `{ step, stepNumber }[]` callers.
 */
export function groupByPhase<T>(
  items: T[],
  getStep: (item: T) => Step,
): PhaseBuckets<T> {
  const buckets: PhaseBuckets<T> = {
    preflight: [],
    flight: [],
    postflight: [],
  };

  for (let i = 0; i < items.length; i++) {
    const step = getStep(items[i]);
    const groupId = step.usesGroup?.id;

    if (!groupId) {
      // Standalone step — bucket by its own phase.
      buckets[stepPhase(step)].push(items[i]);
      continue;
    }

    // Gather the contiguous run of items sharing this `uses:` group id.
    const block: T[] = [items[i]];
    while (
      i + 1 < items.length &&
      getStep(items[i + 1]).usesGroup?.id === groupId
    ) {
      block.push(items[i + 1]);
      i++;
    }

    const phase = blockPhase(block.map(getStep));
    for (const item of block) {
      buckets[phase].push(item);
    }
  }

  return buckets;
}

function stepPhase(step: Step): StepPhase {
  return step.phase ?? 'flight';
}

function blockPhase(steps: Step[]): StepPhase {
  const phases = steps.map(stepPhase);
  if (phases.includes('flight')) return 'flight';
  if (phases.includes('postflight')) return 'postflight';
  return 'preflight';
}
