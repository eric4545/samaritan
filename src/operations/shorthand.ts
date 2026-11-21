/**
 * YAML shorthands, expanded before a step is parsed so that everything after
 * the parser (manuals, validate, lint, the run loop, reports) sees exactly the
 * object the long form produces. Pure and non-breaking: each shorthand is a
 * form the schema rejected before, and every long form is returned unchanged.
 *
 * - A step written as a bare command string is a `manual` step named after
 *   the command's first line: `- kubectl get pods`.
 * - A step object without `type:` is `manual` (a `uses:` entry is left alone).
 * - `when:` may name one environment as a plain string: `when: production`.
 * - A rollback entry written as a bare command string is `{ command }`.
 */

/** The first non-empty line of a command, trimmed: the name of a bare step. */
export function bareCommandName(command: string): string {
  return (
    command
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? command.trim()
  );
}

function whenAsList<T extends Record<string, unknown>>(entry: T): T {
  return typeof entry.when === 'string'
    ? { ...entry, when: [entry.when] }
    : entry;
}

/** Expand the shorthands of one entry of `steps:` or `sub_steps:`. */
export function expandStepShorthand(entry: unknown): any {
  if (typeof entry === 'string') {
    return { name: bareCommandName(entry), type: 'manual', command: entry };
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return entry;
  }
  const step = entry as Record<string, unknown>;
  if (step.uses !== undefined) return step;
  return whenAsList(
    step.type === undefined ? { ...step, type: 'manual' } : step,
  );
}

/** Expand the shorthands of one rollback entry (step-level or operation-level). */
export function expandRollbackShorthand(entry: unknown): any {
  if (typeof entry === 'string') return { command: entry };
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return entry;
  }
  return whenAsList(entry as Record<string, unknown>);
}
