/**
 * Which step action keys the run loop's action bar SHOWS, and which it tucks
 * behind `?`. Every key keeps working whether shown or not — this only decides
 * the hint line, so muscle memory never breaks.
 *
 * Shown: the keys of the usual sidecar flow (`[p]` → `[y]` → `↵`, `[v]`), skip,
 * rollback, and `[t]` while no pane is attached (attaching is the first thing
 * to do then). Everything else (copy, note, evidence, back, jump, global
 * rollback, abort, and `[t]` to swap an attached pane) is listed by `?`.
 */

export interface KeyHint {
  key: string;
  label: string;
}

export interface StepActionContext {
  /** `--mode sidecar` (the default). */
  sidecar: boolean;
  /** A `[p]` paste from this step is armed for `[y]`. */
  armed: boolean;
  /** The step has something runnable (command or `bash <script>`). */
  hasCommand: boolean;
  hasExpect: boolean;
  /** A tmux pane is attached for this step's session. */
  paneAttached: boolean;
  /** Evidence already captured on this step (`[x]` can remove it). */
  hasEvidence: boolean;
  canGoBack: boolean;
  canJump: boolean;
  hasGlobalRollback: boolean;
}

export const MORE_KEY: KeyHint = { key: '?', label: 'more' };

export function stepActionHints(ctx: StepActionContext): {
  primary: KeyHint[];
  more: KeyHint[];
} {
  const when = (cond: boolean, hint: KeyHint): KeyHint[] =>
    cond ? [hint] : [];
  const primary: KeyHint[] = [
    ...when(ctx.sidecar && ctx.armed, { key: 'y', label: 'run it' }),
    { key: '↵', label: 'done' },
    ...when(ctx.sidecar && ctx.hasCommand, { key: 'p', label: 'paste' }),
    ...when(ctx.hasExpect, { key: 'v', label: 'verify' }),
    ...when(ctx.sidecar && !ctx.paneAttached, {
      key: 't',
      label: 'attach pane',
    }),
    { key: 's', label: 'skip' },
    { key: 'r', label: 'rollback' },
    MORE_KEY,
  ];
  const more: KeyHint[] = [
    ...when(ctx.hasCommand, { key: 'c', label: 'copy' }),
    { key: 'n', label: 'note' },
    { key: 'e', label: 'evidence' },
    ...when(ctx.hasEvidence, { key: 'x', label: 'remove evidence' }),
    ...when(ctx.sidecar && ctx.paneAttached, {
      key: 't',
      label: 'attach another pane',
    }),
    ...when(ctx.canGoBack, { key: 'b', label: 'back' }),
    ...when(ctx.canJump, { key: 'j', label: 'jump' }),
    ...when(ctx.hasGlobalRollback, { key: 'g', label: 'global rollback' }),
    { key: 'abort', label: 'abort' },
  ];
  return { primary, more };
}

/**
 * The step-heading line above the command box. With a pane attached in sidecar
 * mode it points at the fast path (`[p]`) instead of "your terminal".
 */
export function runCommandHeader(opts: {
  /** `undefined` = no pane attached. */
  paneTarget?: string;
  script?: boolean;
}): string {
  const what = opts.script ? 'Run' : 'Command';
  if (opts.paneTarget)
    return `${what} — [p] pastes it into ${opts.paneTarget}:`;
  return `Run this ${opts.script ? '' : 'command '}in your terminal ([t] attaches a pane for [p]/[v]):`;
}
