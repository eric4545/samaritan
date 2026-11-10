/**
 * Which step action keys the run loop's action bar SHOWS, and which it tucks
 * behind `?`. Every key keeps working whether shown or not — this only decides
 * the hint line, so muscle memory never breaks.
 *
 * Shown: the keys of the usual sidecar flow (`[p]` → `[y]` → `↵`, `[v]`), skip,
 * rollback, `[t]` while no pane is attached (attaching is the first thing
 * to do then) and `[e]` while required evidence is missing. Everything else (copy, note, evidence, back, jump, global
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
  /**
   * `evidence.required` and nothing captured yet: `[e]` moves into the bar,
   * since ↵ will refuse until it is used. Optional: absent = not required.
   */
  evidenceMissing?: boolean;
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
    ...when(!!ctx.evidenceMissing, { key: 'e', label: 'evidence' }),
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
    ...when(!ctx.evidenceMissing, { key: 'e', label: 'evidence' }),
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
 * The sidecar completion flow, spelled out once per run (the first time the
 * bar offers `[p]` with a pane attached): `p → y → ↵` is not guessable from
 * the bar alone. Undefined when the flow does not apply to this step.
 */
export function sidecarFlowLegend(ctx: StepActionContext): string | undefined {
  if (!ctx.sidecar || !ctx.hasCommand || !ctx.paneAttached) return undefined;
  const verify = ctx.hasExpect ? ' (verify follows)' : '';
  return `ℹ️  Flow: p pastes the command into the pane → y runs it${verify} → ↵ marks the step done. ? lists more keys.`;
}

/**
 * The inline warning when ↵ is refused because `evidence.required` has
 * nothing yet. With a pane attached it names the one-keystroke path — the
 * output is already in the pane, so retyping it is never needed.
 */
export function evidenceGateMessage(paneAttached: boolean): string {
  return paneAttached
    ? '⚠️  This step requires evidence — press [e] then ↵ to capture the pane output (f = file, t = typed text), or [s] to skip.'
    : '⚠️  This step requires evidence — press [e] to capture (typed text is fine) or [s] to skip.';
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

/**
 * Why an action key does nothing on this step, or `undefined` when the key is
 * not an unavailable action (↵, skip, rollback, free-text notes). The run loop
 * shows this and stays on the bar: a known key used to fall through to "done"
 * — `[v]` on a step without `expect` marked it complete (field report).
 */
export function unavailableKeyMessage(
  key: string,
  ctx: StepActionContext,
): string | undefined {
  const reason = ((): string | undefined => {
    switch (key) {
      case 'v':
        return ctx.hasExpect
          ? undefined
          : 'this step has no expect, so there is nothing to verify ([e] captures evidence)';
      case 'p':
        if (!ctx.sidecar)
          return '[p] pastes into a tmux pane in sidecar mode only';
        return ctx.hasCommand ? undefined : 'this step has no command to paste';
      case 'y':
        return ctx.sidecar
          ? undefined
          : '[y] runs a [p] paste in sidecar mode only';
      case 't':
        return ctx.sidecar
          ? undefined
          : '[t] attaches a tmux pane in sidecar mode only';
      case 'c':
        return ctx.hasCommand ? undefined : 'this step has no command to copy';
      case 'x':
        return ctx.hasEvidence
          ? undefined
          : 'this step has no evidence to remove';
      case 'b':
        return ctx.canGoBack ? undefined : 'this is the first step';
      case 'j':
        return ctx.canJump ? undefined : 'this is the last step';
      case 'g':
        return ctx.hasGlobalRollback
          ? undefined
          : 'this operation has no operation-level rollback';
      default:
        return undefined;
    }
  })();
  return reason
    ? `[${key}] — ${reason}. The step is not marked done (↵ does that).`
    : undefined;
}
