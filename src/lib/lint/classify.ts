import type { NormalizedCommand } from './command-model';
import { BUILTIN_TOOLS, type ToolRegistry } from './tools/registry';

/*
 * Generic command helpers. Nothing here names a tool: what a tool's verbs,
 * options and outputs mean lives in its profile (`./tools/`), and rules ask
 * the `ToolRegistry` in their context.
 */

/**
 * A backup: the program's profile says so, or (any program) a word names a
 * backup or snapshot (`… > db.bak`, `cp app.conf app.conf.backup`).
 */
export function isBackup(
  cmd: NormalizedCommand,
  tools: ToolRegistry = BUILTIN_TOOLS,
): boolean {
  if (tools.isBackup(cmd)) return true;
  return [...cmd.operands, ...cmd.redirects.map((r) => r.target)].some((w) =>
    /backup|snapshot|\.bak\b/i.test(w),
  );
}

/** Shell variable names (not SAMARITAN ones) referenced in a word. */
export function shellVarsIn(
  word: string,
  declared: ReadonlySet<string>,
): string[] {
  const names: string[] = [];
  for (const m of word.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (!declared.has(m[1])) names.push(m[1]);
  }
  return names;
}

/** Last path component, without quotes. */
export function baseName(path: string): string {
  const clean = path.replace(/^["']|["']$/g, '');
  return clean.slice(clean.lastIndexOf('/') + 1);
}

/** `kubectl delete`, `aws rds delete-db-instance`: program + action, no values. */
export function describeCommand(
  cmd: NormalizedCommand,
  tools: ToolRegistry = BUILTIN_TOOLS,
): string {
  const words = cmd.operands
    .slice(0, tools.verbDepth(cmd))
    .filter((w) => !w.includes('$') && !w.includes('…'));
  return [cmd.executable, ...words].join(' ');
}

/** Does `cmd` mention any of `ids` (as an option value or a word)? */
export function mentionsAny(cmd: NormalizedCommand, ids: string[]): boolean {
  const words = [
    ...cmd.operands,
    ...cmd.options.map((o) => o.value ?? ''),
    ...cmd.redirects.map((r) => r.target),
  ];
  return ids.some((id) => words.some((w) => w === id || w.includes(id)));
}

/** Levenshtein distance, for "did you mean" suggestions. */
export function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return dp[b.length];
}
