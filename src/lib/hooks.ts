import type {
  HookPosition,
  OperationHook,
  Step,
  StepPhase,
} from '../models/operation';

/**
 * Lifecycle hook injection.
 *
 * A hook names an ANCHOR and contributes steps on one side of it, so a shared
 * step library can add work to an operation without the operation reordering
 * its own list.
 *
 * The injection happens at PARSE time and produces ordinary `Step`s. That is
 * the whole design: every renderer and the run loop then see a normal step list
 * and need no hook-specific handling — the only thing that knows about hooks
 * downstream is the optional `hookSource` provenance stamp.
 *
 * `on_failure` hooks are the exception: their steps are collected separately
 * rather than injected, because they run only when a run aborts or a step fails.
 * They are deliberately distinct from `rollback` — rollback compensates work
 * that succeeded, `on_failure` notifies and cleans up after work that did not.
 */

const PHASE_ANCHORS: StepPhase[] = ['preflight', 'flight', 'postflight'];

export interface HookIssue {
  hookIndex: number;
  anchor: string;
  message: string;
}

export interface AppliedHooks {
  steps: Step[];
  onFailure: Step[];
  issues: HookIssue[];
}

function isPhaseAnchor(anchor: string): anchor is StepPhase {
  return (PHASE_ANCHORS as string[]).includes(anchor);
}

/**
 * Resolve an anchor to the index it attaches to, or -1.
 *
 * A step `id` resolves to that step. A phase name resolves to the FIRST step of
 * the phase for `before` and the LAST for `after`, so `after: preflight` lands
 * at the end of preflight rather than in the middle of it.
 */
function resolveAnchorIndex(
  steps: Step[],
  anchor: string,
  position: HookPosition,
): number {
  if (isPhaseAnchor(anchor)) {
    const matching = steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => (step.phase ?? 'flight') === anchor);
    if (matching.length === 0) return -1;
    return position === 'before'
      ? matching[0].index
      : matching[matching.length - 1].index;
  }
  return steps.findIndex((step) => step.id === anchor);
}

/**
 * Apply `hooks:` to a resolved step list.
 *
 * Insertion points are resolved against the ORIGINAL list and applied in one
 * pass, so several hooks anchored to the same step all attach relative to that
 * step (in declaration order) rather than to each other's injected output.
 *
 * Never throws — unresolvable anchors come back as `issues` so the caller
 * decides severity (the parser reports them as parse errors; `validate`
 * surfaces them alongside other document problems).
 */
export function applyHooks(
  steps: Step[],
  hooks: OperationHook[] | undefined,
): AppliedHooks {
  if (!hooks || hooks.length === 0) {
    return { steps, onFailure: [], issues: [] };
  }

  const before = new Map<number, Step[]>();
  const after = new Map<number, Step[]>();
  const onFailure: Step[] = [];
  const issues: HookIssue[] = [];

  hooks.forEach((hook, hookIndex) => {
    if (hook.on_failure) {
      onFailure.push(...hook.steps);
      return;
    }

    const position: HookPosition = hook.before ? 'before' : 'after';
    const anchor = (hook.before ?? hook.after) as string;
    const index = resolveAnchorIndex(steps, anchor, position);
    if (index < 0) {
      issues.push({
        hookIndex,
        anchor,
        message: `hooks[${hookIndex}]: anchor '${anchor}' matches no step id or phase`,
      });
      return;
    }

    const stamped = hook.steps.map((step) => ({
      ...step,
      hookSource: { anchor, position },
    }));
    const bucket = position === 'before' ? before : after;
    bucket.set(index, [...(bucket.get(index) ?? []), ...stamped]);
  });

  const result: Step[] = [];
  steps.forEach((step, index) => {
    result.push(...(before.get(index) ?? []));
    result.push(step);
    result.push(...(after.get(index) ?? []));
  });

  return { steps: result, onFailure, issues };
}
