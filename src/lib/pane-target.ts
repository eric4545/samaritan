/**
 * Per-step pane target (`target:` on a step or rollback entry).
 *
 * A runbook that moves between a `staging` shell and a `production` shell can
 * name the tmux window each command belongs in. In sidecar mode the run loop
 * checks the attached pane before every `[p]` / `[!]` / re-run paste and asks
 * before pasting into a pane in another window. Pure functions, so every
 * match and message is unit-testable without tmux; `readPaneIdentity` in
 * `tmux-session.ts` does the I/O.
 *
 * Forms: `window` matches that window name in any session; `session:window`
 * matches both. Exact, case-sensitive, compared on the LIVE names (a window
 * renamed after attaching is seen as renamed).
 */

/** The names of the pane `[p]` would paste into, as tmux reports them now. */
export interface PaneIdentity {
  session: string;
  windowName: string;
  /** Picker name (`session:window.pane` or positional), for messages. */
  displayName: string;
}

/** A parsed `target:` value. */
export interface PaneTargetSpec {
  session?: string;
  window: string;
}

/**
 * Parse a `target:` value: split on the FIRST `:` (window names may hold one
 * only after it). Undefined for a blank value or an empty window part.
 */
export function parsePaneTarget(
  target: string | undefined,
): PaneTargetSpec | undefined {
  const raw = target?.trim();
  if (!raw) return undefined;
  const colon = raw.indexOf(':');
  if (colon < 0) return { window: raw };
  const session = raw.slice(0, colon).trim();
  const window = raw.slice(colon + 1).trim();
  if (!window) return undefined;
  return session ? { session, window } : { window };
}

/** Whether the pane is in the step's target window. */
export function paneMatchesTarget(
  pane: PaneIdentity,
  spec: PaneTargetSpec,
): boolean {
  if (pane.windowName !== spec.window) return false;
  return spec.session === undefined || pane.session === spec.session;
}

/** `window "production"` / `window "ops:production"` for messages. */
export function describePaneTarget(spec: PaneTargetSpec): string {
  return spec.session
    ? `window "${spec.session}:${spec.window}"`
    : `window "${spec.window}"`;
}

/**
 * The outcome of checking one paste against the step's target:
 * - `none`: the step has no `target:` (or the backend cannot name panes —
 *   spawned `sessions:` windows are routed by `session:` instead).
 * - `match`: the attached pane is in the target window.
 * - `mismatch`: another window — ask before pasting.
 * - `unknown`: the pane's names could not be read — ask too; never paste
 *   blind into a pane the step names a window for.
 */
export type TargetCheck =
  | { status: 'none' }
  | { status: 'match'; spec: PaneTargetSpec; pane: PaneIdentity }
  | { status: 'mismatch'; spec: PaneTargetSpec; pane: PaneIdentity }
  | { status: 'unknown'; spec: PaneTargetSpec };

/**
 * Check a paste. `canName` = the backend can report pane names at all
 * (`CaptureBackend.paneIdentity` exists); `pane` = what it reported.
 */
export function checkPaneTarget(
  target: string | undefined,
  canName: boolean,
  pane: PaneIdentity | undefined,
): TargetCheck {
  const spec = parsePaneTarget(target);
  if (!spec || !canName) return { status: 'none' };
  if (!pane) return { status: 'unknown', spec };
  return paneMatchesTarget(pane, spec)
    ? { status: 'match', spec, pane }
    : { status: 'mismatch', spec, pane };
}

/**
 * The line under the step's command: where it must run, and whether the
 * attached pane is there. Undefined when the step has no target.
 */
export function targetStatusLine(
  target: string | undefined,
  check: TargetCheck,
): string | undefined {
  const spec = parsePaneTarget(target);
  if (!spec) return undefined;
  const where = describePaneTarget(spec);
  switch (check.status) {
    case 'match':
      return `🎯 Run in ${where} — attached pane ${check.pane.displayName} ✓`;
    case 'mismatch':
      return `⚠️  Run in ${where} — the attached pane ${check.pane.displayName} is in window "${check.pane.windowName}". [t] attaches the right pane.`;
    case 'unknown':
      return `⚠️  Run in ${where} — could not read the attached pane's window name.`;
    default:
      return `🎯 Run in ${where}`;
  }
}

/**
 * The warning before a paste that would land outside the target. The caller
 * asks `Paste into it anyway?` after it.
 */
export function targetMismatchMessage(
  check: Extract<TargetCheck, { status: 'mismatch' | 'unknown' }>,
): string {
  const where = describePaneTarget(check.spec);
  return check.status === 'mismatch'
    ? `🛑 This command belongs in ${where}, but the attached pane ${check.pane.displayName} is in window "${check.pane.windowName}".`
    : `🛑 This command belongs in ${where}, and the attached pane's window name could not be read.`;
}
