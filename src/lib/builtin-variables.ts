import { formatDurationBetween } from '../manuals/postmortem-shared';

/**
 * Built-in run-time variables that SAMARITAN injects as low-priority defaults.
 *
 * They are resolved LATE (at run time in the interactive loop, or at generation
 * time for `--resolve-vars`), never baked at parse time. User-defined variables
 * with the same name always win (built-ins are merged UNDER user vars).
 *
 * - RUN_START_TIME / RUN_START_DATE — fixed at session start (resume-safe: they
 *   come from the persisted session.started_at, not a fresh clock)
 * - CURRENT_DATE / CURRENT_TIME / CURRENT_DATETIME — re-evaluated per step
 * - ELAPSED_TIME — humanized duration since run start (the "time to recover"),
 *   e.g. "1h 16m" / "4m" (omitted at generation time — a run-only value)
 */
export const BUILTIN_VARIABLE_NAMES = [
  'RUN_START_TIME',
  'RUN_START_DATE',
  'CURRENT_DATE',
  'CURRENT_TIME',
  'CURRENT_DATETIME',
  'ELAPSED_TIME',
] as const;

export type BuiltinVariableName = (typeof BUILTIN_VARIABLE_NAMES)[number];

/** Local YYYY-MM-DD. */
function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Local HH:MM:SS. */
function formatTime(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export interface BuiltinVariableOptions {
  /** Fixed run/session start time (source of RUN_START_* and ELAPSED_TIME). */
  startTime: Date;
  /** "Now" — defaults to a fresh Date(); injectable for tests/determinism. */
  now?: Date;
  /**
   * Omit ELAPSED_TIME (used at generation time, where a run-only elapsed value
   * would be misleading — it stays a literal `${ELAPSED_TIME}` in the manual).
   */
  includeElapsed?: boolean;
}

/**
 * Build the built-in variable map. Returns plain strings so it merges directly
 * into the existing `${VAR}` resolution scope.
 */
export function getBuiltinVariables(
  opts: BuiltinVariableOptions,
): Record<string, string> {
  const now = opts.now ?? new Date();
  const start = opts.startTime;
  const includeElapsed = opts.includeElapsed ?? true;

  const vars: Record<string, string> = {
    RUN_START_DATE: formatDate(start),
    RUN_START_TIME: formatTime(start),
    CURRENT_DATE: formatDate(now),
    CURRENT_TIME: formatTime(now),
    CURRENT_DATETIME: `${formatDate(now)} ${formatTime(now)}`,
  };

  if (includeElapsed) {
    vars.ELAPSED_TIME =
      formatDurationBetween(start.toISOString(), now.toISOString()) ?? '0m';
  }

  return vars;
}
