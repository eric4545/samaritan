import type { RollbackStep } from '../models/operation';

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
