/**
 * Guard for the sidecar `[y]` action: press Enter in the attached pane for a
 * command samaritan just pasted with `[p]`.
 *
 * Sending Enter executes whatever sits at the pane's prompt, so it is only
 * allowed while the pane is provably in the state the paste left it in:
 *
 * 1. Right after the paste settles, `armEnter` snapshots the pane and checks
 *    the paste landed at a prompt — the cursor line holds the command's last
 *    line. Nothing is armed otherwise.
 * 2. When the operator presses `[y]`, `checkEnterSafe` re-reads the pane and
 *    refuses unless it is the SAME live pane, accepts input, is not in a tmux
 *    mode (copy-mode would swallow Enter), is not synchronized (Enter would
 *    reach every pane in the window), runs the same foreground program, and
 *    has produced NO output since the snapshot (pipe offset + cursor
 *    unchanged) — i.e. nothing was typed, edited, run or redrawn.
 *
 * Pure functions over `PaneState` so every refusal is unit-testable without
 * tmux; `readPaneState` / `sendEnterTo` in `tmux-session.ts` do the I/O.
 */

/** A tmux pane's state, as read by `readPaneState()`. */
export interface PaneState {
  /** Stable `#{pane_id}` (e.g. `%3`). */
  paneId: string;
  dead: boolean;
  /** In copy-mode / view-mode (`#{pane_in_mode}`). */
  inMode: boolean;
  /** `synchronize-panes` on (`#{pane_synchronized}`). */
  synchronized: boolean;
  /** Input disabled with `select-pane -d` (`#{pane_input_off}`). */
  inputOff: boolean;
  /** Foreground program (`#{pane_current_command}`, e.g. `bash`). */
  currentCommand: string;
  cursorX: number;
  cursorY: number;
  historySize: number;
  /** Text of the row under the cursor. */
  cursorLine: string;
}

/** What `[y]` may press Enter for: one pasted command in one pane state. */
export interface ArmedEnter {
  command: string;
  /** The pane snapshot taken once the paste settled. */
  state: PaneState;
  /** Capture pipe offset at that snapshot. */
  offset: number;
}

/** Last non-blank line of the command as the shell echoes it. */
function lastCommandLine(command: string): string {
  const lines = command
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.at(-1) ?? '';
}

/**
 * Arm `[y]` after a paste, or explain why not. The paste must have landed at
 * the prompt: the cursor line contains the command's last line. A long line
 * wraps, so the cursor row may hold only its tail — accept that too.
 */
export function armEnter(
  command: string,
  state: PaneState | undefined,
  offset: number,
): ArmedEnter | { reason: string } {
  if (!state) return { reason: 'could not read the pane state' };
  const last = lastCommandLine(command);
  const row = state.cursorLine.trim();
  const landed =
    last.length > 0 &&
    row.length > 0 &&
    (row.includes(last) || last.endsWith(row));
  if (!landed) {
    return {
      reason: 'the pasted command is not at the cursor (did it run already?)',
    };
  }
  return { command, state, offset };
}

/**
 * Re-check the pane right before sending Enter. Returns the reason to refuse,
 * or `undefined` when the pane is exactly as the paste left it.
 */
export function checkEnterSafe(
  armed: ArmedEnter,
  now: PaneState | undefined,
  offsetNow: number,
): string | undefined {
  if (!now) return 'the pane is gone or tmux is not reachable';
  const was = armed.state;
  if (now.paneId !== was.paneId)
    return `the target is now a different pane (${now.paneId}, pasted into ${was.paneId})`;
  if (now.dead) return 'the pane is dead';
  if (now.inMode) return 'the pane is in copy/view mode — leave it (q) first';
  if (now.synchronized)
    return 'synchronize-panes is on — Enter would reach every pane in the window';
  if (now.inputOff) return 'the pane has input disabled (select-pane -d)';
  if (now.currentCommand !== was.currentCommand)
    return `the pane now runs ${now.currentCommand || 'another program'}, not ${was.currentCommand}`;
  if (offsetNow !== armed.offset)
    return 'the pane printed output since the paste (typed, edited or already run)';
  if (
    now.cursorX !== was.cursorX ||
    now.cursorY !== was.cursorY ||
    now.historySize !== was.historySize ||
    now.cursorLine !== was.cursorLine
  )
    return 'the prompt changed since the paste';
  return undefined;
}
