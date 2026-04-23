/**
 * Resolves ${VAR} placeholders from operation context variables.
 *
 * Rules:
 *  - ${VAR} with curly braces → operation variable; resolved from `vars`.
 *  - $VAR without curly braces → shell runtime variable; left untouched.
 *  - Throws with a clear error listing every unresolved ${VAR} so operators
 *    know exactly which variables are missing from the environment definition.
 */
export function resolveVars(text: string, vars: Record<string, any>): string {
  const unresolved: string[] = [];
  const result = text.replace(/\$\{([^}]+)\}/g, (match, name) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
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
  return text.replace(/\$\{([^}]+)\}/g, (match, name) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      return String(vars[name]);
    }
    return match;
  });
}

/**
 * Returns true if `text` still contains any unresolved ${VAR} placeholders.
 */
export function hasUnresolvedVars(text: string, vars: Record<string, any>): boolean {
  return /\$\{([^}]+)\}/.test(
    text.replace(/\$\{([^}]+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? '' : match,
    ),
  );
}
