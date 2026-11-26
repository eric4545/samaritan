import type { Operation, Step } from '../models/operation';

/**
 * A sub-step with no `session:` runs in the session of its nearest ancestor
 * that declares one; a `session:` on the sub-step itself always wins. A
 * top-level step with no `session:` keeps running in the default pane.
 *
 * This is the ONE resolution rule: the run loop (before flattening), every
 * manual generator and the lint engine (`StepInfo.inheritedSession`) use it,
 * so what lint reports, what the manual shows and where `[p]` pastes agree.
 *
 * (`variants.<env>` cannot set `session:`, so this needs no environment.)
 * Rollback steps are not touched.
 *
 * Returns copies only for the steps it fills in (and their parents); an
 * operation with nothing to inherit comes back unchanged (same references).
 */
export function inheritSubStepSessions(
  steps: Step[],
  inherited?: string,
): Step[] {
  let changed = false;
  const out = steps.map((step) => {
    const filled =
      step.session === undefined && inherited !== undefined
        ? { ...step, session: inherited }
        : step;
    const children = step.sub_steps?.length
      ? inheritSubStepSessions(step.sub_steps, filled.session)
      : step.sub_steps;
    if (children === step.sub_steps) {
      if (filled !== step) changed = true;
      return filled;
    }
    changed = true;
    return { ...filled, sub_steps: children };
  });
  return changed ? out : steps;
}

/** `inheritSubStepSessions` applied to an operation's forward steps. */
export function withInheritedSessions<T extends Pick<Operation, 'steps'>>(
  operation: T,
): T {
  const steps = inheritSubStepSessions(operation.steps ?? []);
  return steps === operation.steps ? operation : { ...operation, steps };
}
