import type { Operation, RollbackStep, Step } from '../models/operation';

/**
 * Which session a step runs in when it sets no `session:` of its own — ONE
 * rule, used by the run loop (before flattening), every manual generator and
 * the lint engine (`StepInfo.inheritedSession`), so what lint reports, what
 * the manual shows and where `[p]` pastes agree:
 *
 * - a sub-step runs in the session of its nearest ancestor that sets one;
 * - a step's `rollback` entries run in that step's session, and a rollback
 *   entry's sub-steps in their nearest rollback ancestor's;
 * - operation-level `rollback.steps` have no owner: only their sub-steps
 *   inherit, from the nearest rollback ancestor;
 * - a `session:` written on the step itself always wins; a top-level step
 *   without one keeps the run's default pane.
 *
 * (`variants.<env>` cannot set `session:`, so this needs no environment; a
 * variant's own `rollback` list inherits the step's session too.)
 *
 * Returns copies only for what it fills in (and their parents); an operation
 * with nothing to inherit comes back unchanged (same references).
 */
export function inheritSubStepSessions(
  steps: Step[],
  inherited?: string,
): Step[] {
  return mapChanged(steps, (step) => {
    const filled = fillSession(step, inherited);
    const session = filled.session;
    const sub_steps = step.sub_steps?.length
      ? inheritSubStepSessions(step.sub_steps, session)
      : step.sub_steps;
    const rollback = inheritRollbackSessions(step.rollback, session);
    const variants = inheritVariantRollbacks(step.variants, session);
    if (
      sub_steps === step.sub_steps &&
      rollback === step.rollback &&
      variants === step.variants
    ) {
      return filled;
    }
    return {
      ...filled,
      ...(sub_steps !== step.sub_steps && { sub_steps }),
      ...(rollback !== step.rollback && { rollback }),
      ...(variants !== step.variants && { variants }),
    };
  });
}

/** A rollback list: each entry, then its sub-steps, inherit `inherited`. */
export function inheritRollbackSessions(
  steps: RollbackStep[] | undefined,
  inherited?: string,
): RollbackStep[] | undefined {
  if (!steps?.length) return steps;
  return mapChanged(steps, (rb) => {
    const filled = fillSession(rb, inherited);
    const sub_steps = inheritRollbackSessions(rb.sub_steps, filled.session);
    return sub_steps === rb.sub_steps ? filled : { ...filled, sub_steps };
  });
}

/** The inheritance rule applied to an operation's steps and rollback plan. */
export function withInheritedSessions<
  T extends Pick<Operation, 'steps'> & Partial<Pick<Operation, 'rollback'>>,
>(operation: T): T {
  const steps = inheritSubStepSessions(operation.steps ?? []);
  const planSteps = inheritRollbackSessions(operation.rollback?.steps);
  if (steps === operation.steps && planSteps === operation.rollback?.steps) {
    return operation;
  }
  return {
    ...operation,
    steps,
    ...(operation.rollback &&
      planSteps !== operation.rollback.steps && {
        rollback: { ...operation.rollback, steps: planSteps ?? [] },
      }),
  };
}

function fillSession<T extends { session?: string }>(
  step: T,
  inherited: string | undefined,
): T {
  return step.session === undefined && inherited !== undefined
    ? { ...step, session: inherited }
    : step;
}

function inheritVariantRollbacks(
  variants: Step['variants'],
  session: string | undefined,
): Step['variants'] {
  if (!variants || session === undefined) return variants;
  let changed = false;
  const out: NonNullable<Step['variants']> = {};
  for (const [env, variant] of Object.entries(variants)) {
    const rollback = Array.isArray(variant?.rollback)
      ? inheritRollbackSessions(variant.rollback, session)
      : variant?.rollback;
    if (rollback !== variant?.rollback) {
      changed = true;
      out[env] = { ...variant, rollback };
    } else {
      out[env] = variant;
    }
  }
  return changed ? out : variants;
}

/** `items.map(fn)`, but the same array back when `fn` changed nothing. */
function mapChanged<T>(items: T[], fn: (item: T) => T): T[] {
  let changed = false;
  const out = items.map((item) => {
    const next = fn(item);
    if (next !== item) changed = true;
    return next;
  });
  return changed ? out : items;
}
