/**
 * Where a parsed step was authored: the file (absolute path, or URL for a
 * remote `uses:` file) and the YAML path inside it, e.g.
 * `['steps', 2, 'rollback', 0]`.
 *
 * The parser stamps every step it builds (including steps expanded from
 * `uses:` files and `foreach`/`matrix`) so lint findings can point at a line
 * and honour `# samaritan-lint-disable` comments. The stamp is a
 * NON-ENUMERABLE symbol property: deep-equality checks, JSON output and object
 * spreads never see it, so no generator, snapshot or session file changes.
 */
export interface StepSource {
  file: string;
  path: (string | number)[];
}

const SOURCE = Symbol.for('samaritan.stepSource');

export function setStepSource(step: object, source: StepSource): void {
  Object.defineProperty(step, SOURCE, {
    value: source,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

export function getStepSource(step: object): StepSource | undefined {
  return (step as Record<symbol, StepSource | undefined>)[SOURCE];
}

/** Give `to` the same source as `from` (a copy made by spreading `from`). */
export function copyStepSource(from: object, to: object): void {
  const source = getStepSource(from);
  if (source) setStepSource(to, source);
}

/** Render a path as YAML-ish text: `steps[2].rollback[0]`. */
export function formatSourcePath(path: (string | number)[]): string {
  return path
    .map((part, k) =>
      typeof part === 'number' ? `[${part}]` : k === 0 ? part : `.${part}`,
    )
    .join('');
}
