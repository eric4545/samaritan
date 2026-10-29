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

/** What `[y]` watches to know the command it started has finished. */
export interface RunWatch {
  /** The pane's cursor row BEFORE the paste — its bare shell prompt. */
  promptRow?: string;
  /** Foreground program at paste time (the shell, or `ssh` over a hop). */
  shell: string;
  /** Capture pipe offset when Enter was sent. */
  offsetAtEnter: number;
}

/** A prompt row compared loosely: clocks, exit codes and spacing may differ. */
function normalizePromptRow(row: string): string {
  return row.trim().replace(/\d/g, '0').replace(/\s+/g, ' ');
}

/** Quiet time that confirms a finish when the prompt row matches. */
export const FINISH_QUIET_MS = 300;
/** Fallback quiet time when the prompt is not recognised (e.g. `cd` changed it). */
export const FINISH_FALLBACK_QUIET_MS = 3000;

/**
 * Has the command `[y]` started finished?
 *
 * - `running` — no output since Enter yet, output still arriving, or a
 *   different program is in the foreground (a silent `kubectl rollout status`).
 * - `prompt` — quiet for `FINISH_QUIET_MS` AND the cursor is back on the same
 *   bare prompt the pane showed before the paste (digits normalized).
 * - `quiet` — the prompt is not recognised, but the shell is in the foreground
 *   and the pane has been quiet for `FINISH_FALLBACK_QUIET_MS`.
 * - `gone` — the pane state can't be read any more.
 */
export function commandFinished(
  watch: RunWatch,
  now: PaneState | undefined,
  offsetNow: number,
  quietMs: number,
): 'running' | 'prompt' | 'quiet' | 'gone' {
  if (!now) return 'gone';
  if (offsetNow <= watch.offsetAtEnter || quietMs < FINISH_QUIET_MS)
    return 'running';
  if (now.currentCommand !== watch.shell) return 'running';
  if (
    watch.promptRow?.trim() &&
    normalizePromptRow(now.cursorLine) === normalizePromptRow(watch.promptRow)
  )
    return 'prompt';
  return quietMs >= FINISH_FALLBACK_QUIET_MS ? 'quiet' : 'running';
}
