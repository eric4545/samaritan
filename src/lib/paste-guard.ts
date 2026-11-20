import type { CaptureBackend } from './capture-backend';
import type { PaneState } from './pane-enter-guard';
import { normalizePasteText } from './tmux-session';

/**
 * Below this length a cursor line that is only a SUFFIX of the pasted command
 * (a long command wrapped across screen rows) is not trusted: a short bare
 * prompt or output line could end the command by chance.
 */
const MIN_WRAPPED_TAIL = 16;

/**
 * A command `[p]` pasted into a pane. `[p]` never presses Enter, so until the
 * operator runs (or clears) it, the text sits on the pane's input line.
 */
export interface PendingPaste {
  backend: CaptureBackend;
  sessionName: string;
  command: string;
  /** Flat step index the paste was made on. */
  step: number;
  /** Rollback context (`step` / `global`) when pasted from a rollback. */
  context?: string;
  /** Stable `#{pane_id}` the paste went to, when the pane state was readable. */
  paneId?: string;
  /** Foreground program at paste time (the shell, or `ssh` over a hop). */
  shell?: string;
}

/**
 * Whether the pane's cursor line still holds the pasted command, i.e. it was
 * never run. Once it runs, the cursor moves on to its output or a fresh prompt;
 * once cleared (Ctrl+U / Ctrl+C), the line is a bare prompt again.
 *
 * Compares the command's LAST line, since a multi-line bracketed paste leaves
 * the cursor after it. A long line wraps, so the cursor row can hold only its
 * tail: a long enough suffix counts too. Unknown cursor line → false (never
 * block on what cannot be read).
 */
export function pasteStillOnInputLine(
  cursorLine: string | undefined,
  command: string,
): boolean {
  const cursor = cursorLine?.trimEnd();
  const last = normalizePasteText(command).split('\n').pop()?.trimEnd();
  if (!cursor || !last) return false;
  if (cursor.endsWith(last)) return true;
  return cursor.length >= MIN_WRAPPED_TAIL && last.endsWith(cursor);
}

/** The paste when it is still un-run on its pane, else undefined. */
export function unrunPaste(
  paste: PendingPaste | undefined,
): PendingPaste | undefined {
  if (!paste?.backend.hasTarget(paste.sessionName)) return undefined;
  const cursor = paste.backend.promptLine?.(paste.sessionName);
  return pasteStillOnInputLine(cursor, paste.command) ? paste : undefined;
}

/** One-line preview of a pasted command for warnings. */
export function pastePreview(command: string, max = 60): string {
  const flat = normalizePasteText(command).replace(/\s*\n\s*/g, ' ⏎ ');
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Guard for the sidecar `[u]` action: press Ctrl+U in the pane to clear an
 * un-run `[p]` paste from the shell's input line. Returns the reason to
 * refuse, or `undefined` when the pane provably still holds THAT paste at the
 * prompt it was pasted at.
 *
 * Ctrl+U is only harmless at a shell prompt: in copy-mode it scrolls, with
 * synchronize-panes it reaches every pane in the window, and in another
 * foreground program (an editor, a pager) it means something else. So: same
 * live pane, accepting input, not in a mode, not synchronized, the same
 * foreground program as at paste time, and the pasted text still at the
 * cursor.
 */
export function checkClearSafe(
  paste: PendingPaste,
  now: PaneState | undefined,
): string | undefined {
  if (!now) return 'the pane is gone or tmux is not reachable';
  if (paste.paneId && now.paneId !== paste.paneId)
    return `the attached pane is now ${now.paneId}; the command was pasted into ${paste.paneId}`;
  if (now.dead) return 'the pane is dead';
  if (now.inMode) return 'the pane is in copy/view mode — leave it (q) first';
  if (now.synchronized)
    return 'synchronize-panes is on — Ctrl+U would reach every pane in the window';
  if (now.inputOff) return 'the pane has input disabled (select-pane -d)';
  if (paste.shell && now.currentCommand !== paste.shell)
    return `the pane now runs ${now.currentCommand || 'another program'}, not ${paste.shell} where the command was pasted`;
  if (!pasteStillOnInputLine(now.cursorLine, paste.command))
    return 'the pasted command is no longer at the cursor (run, edited or cleared already)';
  return undefined;
}
