import type { CaptureBackend } from './capture-backend';
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
