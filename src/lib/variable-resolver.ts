/**
 * Resolves ${VAR} placeholders from operation context variables.
 *
 * Rules:
 *  - ${VAR} with curly braces and a plain identifier name → operation
 *    variable; resolved from `vars`.
 *  - $VAR without curly braces → shell runtime variable; left untouched.
 *  - Shell parameter expansions (${X:?}, ${X:-default}, ${X#pattern}, …) →
 *    shell constructs; left untouched for the shell to evaluate.
 *  - Throws with a clear error listing every unresolved ${VAR} so operators
 *    know exactly which variables are missing from the environment definition.
 */
const VAR_REF = /\$\{(\w+)\}/g;

/**
 * Expand `${VAR}` references INSIDE variable values against the same map, so
 * a value that points at another variable (a group variable set to an
 * environment variable, a `with:` value set to a group variable, …) carries
 * the final value, however long the chain and whatever the key order.
 *
 * - A reference to a name not in `vars` stays literal (it may be a shell
 *   variable such as `${HOME}`, left for the shell).
 * - A cycle (`A: ${B}`, `B: ${A}`, or `A: ${A}`) stays literal at the point
 *   it would repeat, instead of looping.
 * - Non-string values are untouched; a non-string referenced from inside a
 *   string is inserted via `String()`.
 *
 * Every substitution engine (manuals, the run TUI, `SessionState`) resolves
 * through this first, so they cannot disagree on chained values. Returns
 * `vars` itself when no value holds a reference to another key.
 */
export function resolveVariableChains(
  vars: Record<string, any>,
): Record<string, any> {
  const hasChain = Object.values(vars).some(
    (value) =>
      typeof value === 'string' &&
      [...value.matchAll(VAR_REF)].some(([, name]) =>
        Object.hasOwn(vars, name),
      ),
  );
  if (!hasChain) return vars;

  const done = new Map<string, any>();
  const resolveKey = (key: string, stack: Set<string>): any => {
    if (done.has(key)) return done.get(key);
    const value = vars[key];
    if (typeof value !== 'string') return value;
    stack.add(key);
    const resolved = value.replace(VAR_REF, (match, name) =>
      Object.hasOwn(vars, name) && !stack.has(name)
        ? String(resolveKey(name, stack))
        : match,
    );
    stack.delete(key);
    // Memoize only complete walks: mid-walk, a reference back up the stack
    // was left literal, so the result depends on where the walk started.
    if (stack.size === 0) done.set(key, resolved);
    return resolved;
  };

  const result: Record<string, any> = {};
  for (const key of Object.keys(vars)) {
    result[key] = resolveKey(key, new Set());
  }
  return result;
}

export function resolveVars(text: string, vars: Record<string, any>): string {
  vars = resolveVariableChains(vars);
  const unresolved: string[] = [];
  const result = text.replace(/\$\{(\w+)\}/g, (match, name) => {
    if (Object.hasOwn(vars, name)) {
      return String(vars[name]);
    }
    unresolved.push(name);
    return match;
  });
  if (unresolved.length > 0) {
    const keys = unresolved.join(', ');
    throw new Error(
      `Unresolved operation variable(s): ${keys}\n` +
        `  Add them to the variables: section for this environment, ` +
        `or pass --var ${unresolved[0]}=<value> on the CLI.`,
    );
  }
  return result;
}

/**
 * Like resolveVars but never throws — unresolved ${VAR} stay as-is.
 * Useful for display when you want best-effort resolution without aborting.
 */
export function resolveVarsSafe(
  text: string,
  vars: Record<string, any>,
): string {
  vars = resolveVariableChains(vars);
  return text.replace(/\$\{(\w+)\}/g, (match, name) => {
    if (Object.hasOwn(vars, name)) {
      return String(vars[name]);
    }
    return match;
  });
}

/**
 * Lists the names of every ${VAR} placeholder in `text` that has no value
 * in `vars` (deduplicated, in order of first appearance).
 */
export function listUnresolvedVars(
  text: string,
  vars: Record<string, any>,
): string[] {
  const unresolved: string[] = [];
  for (const match of text.matchAll(/\$\{(\w+)\}/g)) {
    const name = match[1];
    if (!Object.hasOwn(vars, name) && !unresolved.includes(name)) {
      unresolved.push(name);
    }
  }
  return unresolved;
}

/**
 * Returns true if `text` still contains any unresolved ${VAR} placeholders.
 */
export function hasUnresolvedVars(
  text: string,
  vars: Record<string, any>,
): boolean {
  return /\$\{(\w+)\}/.test(
    text.replace(/\$\{(\w+)\}/g, (match, name) =>
      Object.hasOwn(vars, name) ? '' : match,
    ),
  );
}
