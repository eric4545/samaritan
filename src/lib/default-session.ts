import type { Operation, RollbackStep, Step } from '../models/operation';

/**
 * Apply `run.default_session` to every step that names no `session:` of its
 * own, so the run loop can send / paste (`[p]`) / verify (`[v]`) it in that
 * pane instead of falling through to the unregistered `'default'` target.
 *
 * Run-time only: `run`/`resume` call this on their freshly parsed copy of the
 * operation; `generate` never does, so manuals show exactly what was authored.
 *
 * Sub-steps are steps: one without `session:` gets the default too (not its
 * parent's session). Rollback entries keep their existing inheritance — an
 * entry without `session:` belongs to its step's session — made explicit here
 * so the aggregated global rollback (which only sees the entry) routes it the
 * same way. Operation-level `rollback.steps` fall back to the default.
 * Mutates in place; no-op when `default_session` is unset.
 */
export function applyDefaultSession(operation: Operation): void {
  const fallback = operation.run?.default_session;
  if (!fallback) return;

  const fillRollback = (
    entries: RollbackStep[] | undefined,
    inherit: string,
  ) => {
    for (const rb of entries ?? []) {
      rb.session ??= inherit;
      fillRollback(rb.sub_steps, inherit);
    }
  };

  const fillSteps = (steps: Step[] | undefined) => {
    for (const step of steps ?? []) {
      step.session ??= fallback;
      fillRollback(step.rollback, step.session);
      fillSteps(step.sub_steps);
    }
  };

  fillSteps(operation.steps);
  fillRollback(operation.rollback?.steps, fallback);
}
