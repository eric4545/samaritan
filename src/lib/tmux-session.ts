import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionConfig } from '../models/operation';
import type {
  CaptureBackend,
  CaptureCheck,
  PaneOwner,
} from './capture-backend';
import { listUnresolvedVars, resolveVars } from './variable-resolver';

export function isLocalSession(config: SessionConfig | undefined): boolean {
  return !config?.host;
}

/**
 * Normalize a command before it is pasted into a pane:
 *
 * - CRLF / lone CR → LF. tmux `paste-buffer` rewrites every LF to CR, so a
 *   stray `\r` (e.g. from a CRLF variable value) arrives as `\r\r`: readline
 *   renders a blank line after each line AND a `\` continuation now escapes
 *   the CR instead of the newline — the block splits into separate commands.
 * - Trailing newlines are stripped: a YAML `|` block always ends in `\n`, and
 *   in a shell without bracketed paste that final newline is an Enter — the
 *   `[p]` contract is that the operator presses Enter, never samaritan.
 */
export function normalizePasteText(command: string): string {
  return command.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
}

/** True when the (normalized) command spans more than one line. */
export function isMultiLinePaste(command: string): boolean {
  return normalizePasteText(command).includes('\n');
}

/**
 * Build the two tmux argv arrays used to paste a command into a pane.
 *
 * `set-buffer -- <command>` stores the WHOLE command (including any embedded
 * newlines) as a single argv element — never split line-by-line. `paste-buffer`
 * uses `-p` so tmux wraps the paste in bracketed-paste markers: a multi-line
 * command lands at the prompt as ONE atomic block and does NOT execute
 * (bracketed paste suppresses the intermediate newlines' Enter behavior),
 * matching the sidecar `[p]` contract — the operator reviews then runs it. `-d`
 * deletes samaritan's own buffer afterwards so operator buffers are untouched.
 */
export function buildPasteBufferArgs(
  target: string,
  command: string,
): { setArgs: string[]; pasteArgs: string[] } {
  return {
    setArgs: [
      'set-buffer',
      '-b',
      'samaritan-send',
      '--',
      normalizePasteText(command),
    ],
    pasteArgs: [
      'paste-buffer',
      '-d',
      '-p',
      '-b',
      'samaritan-send',
      '-t',
      target,
    ],
  };
}

/**
 * Paste a command into a tmux pane WITHOUT executing it (no Enter), via a named
 * paste buffer so the operator's own buffers are untouched. Used by the sidecar
 * `[p]` action — the operator reviews the command at their prompt and presses
 * Enter themselves. Never throws: when tmux is unavailable spawnSync returns an
 * error status and this is a no-op.
 */
function pasteBufferTo(target: string, command: string): void {
  try {
    const { setArgs, pasteArgs } = buildPasteBufferArgs(target, command);
    spawnSync('tmux', setArgs);
    spawnSync('tmux', pasteArgs);
  } catch {
    // tmux missing or pane gone — best effort, operator can copy/paste instead
  }
}

/** Scrollback depth for the screen fallback when the pipe slice is lost. */
const PANE_HISTORY_LINES = 2000;

/**
 * Capture the rendered screen of a tmux pane as clean text — `-p` prints to
 * stdout, `-J` joins wrapped lines and trims trailing whitespace, and the
 * absence of `-e` means NO escape sequences are emitted. Returns undefined when
 * tmux is unavailable or the target is gone. Used for the auto-captured verify
 * evidence so the report shows readable output instead of the raw pipe-pane
 * byte stream (ANSI/cursor-move/redraw noise).
 */
export function capturePaneScreen(
  target: string,
  historyLines?: number,
): string | undefined {
  try {
    const result = spawnSync('tmux', [
      'capture-pane',
      '-p',
      '-J',
      // -S -N: include N lines of scrollback above the visible screen.
      ...(historyLines ? ['-S', `-${historyLines}`] : []),
      '-t',
      target,
    ]);
    if (result.status !== 0) return undefined;
    return result.stdout?.toString('utf-8');
  } catch {
    return undefined;
  }
}

/**
 * Read the line the pane's cursor is on — the shell prompt (plus anything typed
 * after it) once a command has finished. `capture-pane -S y -E y` with the
 * cursor row from `#{cursor_y}`; no `-e`, so no escape sequences. Returns
 * undefined when tmux is unavailable or the target is gone.
 */
export function capturePaneCursorLine(target: string): string | undefined {
  try {
    const pos = spawnSync('tmux', [
      'display-message',
      '-p',
      '-t',
      target,
      '#{cursor_y}',
    ]);
    if (pos.status !== 0) return undefined;
    const y = pos.stdout?.toString('utf-8').trim();
    if (!y || !/^\d+$/.test(y)) return undefined;
    const line = spawnSync('tmux', [
      'capture-pane',
      '-p',
      '-t',
      target,
      '-S',
      y,
      '-E',
      y,
    ]);
    if (line.status !== 0) return undefined;
    return line.stdout?.toString('utf-8').replace(/\n+$/, '');
  } catch {
    return undefined;
  }
}

/**
 * Validate that a tmux target string (e.g. "mysession:0.0" or "%12") refers to
 * an existing pane. Returns true when the target resolves, false otherwise.
 * Never throws — a bad target simply returns false.
 */
export function validateTmuxTarget(target: string): boolean {
  // Guard explicitly: tmux falls back to the current/first pane for an empty
  // target, and display-message exits 0 even for unknown targets when a
  // server is running — list-panes is the only form that reliably errors.
  if (!target.trim()) return false;
  try {
    const result = spawnSync('tmux', ['list-panes', '-t', target], {
      stdio: 'pipe',
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

export interface TmuxPaneInfo {
  /** Unique pane id, e.g. "%3" — stable even when windows are reordered */
  id: string;
  /** Addressable target, e.g. "mysession:0.1" */
  target: string;
  /** Command currently running in the pane, e.g. "zsh" */
  currentCommand: string;
  title: string;
  /** True when this is the pane samaritan itself is running in */
  isSelf: boolean;
}

/**
 * Field separator for tmux `-F` formats. tmux (3.4+) rewrites control
 * characters — including TAB — in format output to `_`, so a `\t`-separated
 * row arrives as ONE field. A printable multi-char token survives every
 * version and is vanishingly unlikely inside a pane title.
 */
const TMUX_FIELD_SEP = '<|>';

/**
 * Parse `list-panes -a -F <id SEP target SEP command SEP title>` output.
 * Pure (no tmux) so it can be unit tested. The title is the free-text field,
 * so it is LAST and re-joined — a title that happens to contain the separator
 * stays intact.
 */
export function parseTmuxPaneList(
  stdout: string,
  selfPane?: string,
): TmuxPaneInfo[] {
  return (
    stdout
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => {
        const [id, target, currentCommand = '', ...titleParts] =
          line.split(TMUX_FIELD_SEP);
        const title = titleParts.join(TMUX_FIELD_SEP);
        return { id, target, currentCommand, title, isSelf: id === selfPane };
      })
      // Drop malformed rows (e.g. a partial line from `list-panes` racing a
      // concurrent server teardown) so every returned pane has id + target.
      .filter(
        (pane): pane is TmuxPaneInfo =>
          Boolean(pane.id) && Boolean(pane.target),
      )
  );
}

/**
 * List all panes across all tmux sessions so the operator can pick one by
 * number instead of typing a target. Returns [] when tmux is unavailable or
 * no server is running — never throws.
 */
export function listTmuxPanes(): TmuxPaneInfo[] {
  try {
    const result = spawnSync(
      'tmux',
      [
        'list-panes',
        '-a',
        '-F',
        [
          '#{pane_id}',
          '#{session_name}:#{window_index}.#{pane_index}',
          '#{pane_current_command}',
          '#{pane_title}',
        ].join(TMUX_FIELD_SEP),
      ],
      { stdio: 'pipe' },
    );
    if (result.status !== 0) return [];
    return parseTmuxPaneList(
      result.stdout?.toString() ?? '',
      process.env.TMUX_PANE,
    );
  } catch {
    return [];
  }
}

export class TmuxSession implements CaptureBackend {
  private sessionId: string;
  private tmuxName: string;
  private owned: boolean;
  private paneMap: Map<string, string> = new Map();

  /**
   * @param owned true when samaritan created this tmux session (teardown kills
   *   it); false when it adopted an operator's existing session of the same
   *   name (teardown only closes samaritan's capture pipes — never kills).
   */
  constructor(sessionId: string, tmuxName: string, owned = true) {
    this.sessionId = sessionId;
    this.tmuxName = tmuxName;
    this.owned = owned;
  }

  /** The tmux session name — what the operator passes to `tmux attach -t`. */
  getTmuxName(): string {
    return this.tmuxName;
  }

  /** True when samaritan created the tmux session (and will kill it). */
  isOwned(): boolean {
    return this.owned;
  }

  /**
   * Pane for a session name. An unregistered name (a step with no `session:`
   * and no `run.default_session`) falls back to the FIRST declared session's
   * pane — never a bare `<tmux>:0.0`, which in a reused operator session could
   * be an unrelated window (and does not exist under `base-index 1`).
   */
  paneFor(sessionName: string): string {
    const pane =
      this.paneMap.get(sessionName) ?? this.paneMap.values().next().value;
    return pane ?? `${this.tmuxName}:0.0`;
  }

  getPipeFilePath(sessionName: string): string {
    // Sanitize both parts: the path is embedded in a shell command via pipe-pane
    return join(
      tmpdir(),
      `samaritan-${sanitizeSessionName(this.sessionId)}-${sanitizeSessionName(sessionName)}.pipe`,
    );
  }

  send(sessionName: string, command: string, sendEnter = true): void {
    const pane = this.paneFor(sessionName);
    const args = sendEnter
      ? ['send-keys', '-t', pane, command, 'Enter']
      : ['send-keys', '-t', pane, command];
    spawnSync('tmux', args);
  }

  /** Paste a command into the pane without executing it (no Enter). */
  pasteCommand(sessionName: string, command: string): void {
    const pane = this.paneFor(sessionName);
    pasteBufferTo(pane, command);
  }

  /** Capture the pane's rendered screen as clean text (no escape sequences). */
  captureScreen(sessionName: string): string | undefined {
    const pane = this.paneFor(sessionName);
    return capturePaneScreen(pane);
  }

  /** The pane's current cursor line (the prompt once a command finished). */
  promptLine(sessionName: string): string | undefined {
    const pane = this.paneFor(sessionName);
    return capturePaneCursorLine(pane);
  }

  hasTarget(sessionName: string): boolean {
    return this.paneMap.has(sessionName);
  }

  currentOffset(sessionName: string): number {
    try {
      return statSync(this.getPipeFilePath(sessionName)).size;
    } catch {
      return 0;
    }
  }

  readOutput(sessionName: string, fromOffset: number): string {
    try {
      const buf = readFileSync(this.getPipeFilePath(sessionName));
      return buf.slice(fromOffset).toString('utf-8');
    } catch {
      return '';
    }
  }

  describeTarget(sessionName: string): string {
    const pane = this.paneMap.get(sessionName);
    // Show the window by name too: bootstrap registers stable pane ids (%N).
    return pane
      ? `tmux pane ${this.tmuxName}:${sessionName} (${pane})`
      : `tmux session ${this.tmuxName}`;
  }

  async waitForPrompt(
    sessionName: string,
    timeoutMs: number,
    promptPattern?: string,
    idleThresholdMs = 0,
  ): Promise<'done' | 'timeout' | 'idle'> {
    const pane = this.paneFor(sessionName);
    const deadline = Date.now() + timeoutMs;
    const re = new RegExp(promptPattern ?? '\\$\\s*$', 'm');
    const pollMs = 200;

    let lastSize = idleThresholdMs > 0 ? this.currentOffset(sessionName) : 0;
    let lastChangeTime = Date.now();

    while (Date.now() < deadline) {
      const result = spawnSync('tmux', ['capture-pane', '-p', '-t', pane]);
      const output = result.stdout?.toString() ?? '';
      if (re.test(output)) return 'done';

      if (idleThresholdMs > 0) {
        const size = this.currentOffset(sessionName);
        if (size !== lastSize) {
          lastSize = size;
          lastChangeTime = Date.now();
        } else if (Date.now() - lastChangeTime >= idleThresholdMs) {
          return 'idle';
        }
      }

      await sleep(pollMs);
    }
    return 'timeout';
  }

  registerPane(sessionName: string, paneTarget: string): void {
    this.paneMap.set(sessionName, paneTarget);
  }

  getPaneMap(): ReadonlyMap<string, string> {
    return this.paneMap;
  }

  teardown(): void {
    try {
      if (this.owned) {
        spawnSync('tmux', ['kill-session', '-t', `=${this.tmuxName}`], {
          stdio: 'ignore',
        });
      } else {
        // Adopted operator session: close only samaritan's pipes (pipe-pane
        // with no command), leaving every window, pane and scrollback alive.
        for (const pane of this.paneMap.values()) {
          spawnSync('tmux', ['pipe-pane', '-t', pane], { stdio: 'ignore' });
        }
      }
    } catch {
      // session may already be gone
    }
    for (const name of this.paneMap.keys()) {
      try {
        unlinkSync(this.getPipeFilePath(name));
      } catch {
        // best effort
      }
    }
  }
}

/** Read a tmux format string for a pane; undefined when tmux/the pane is gone. */
function paneFormat(target: string, format: string): string | undefined {
  try {
    const r = spawnSync('tmux', [
      'display-message',
      '-p',
      '-t',
      target,
      format,
    ]);
    if (r.status !== 0) return undefined;
    return r.stdout?.toString('utf-8').trim();
  } catch {
    return undefined;
  }
}

/** True while `pid` is a running process (EPERM = alive, owned by another user). */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === 'EPERM';
  }
}

/**
 * The marker file recording which samaritan capture owns a pane's single
 * `pipe-pane` slot. It lives in a private per-user directory
 * (`~/.samaritan/panes`, mode 0700) — never the shared, world-writable temp
 * dir, where a predictable name invites a planted symlink. The key is the tmux
 * server's socket plus the stable pane id (`%3`): pane ids restart at `%0` on
 * every server, so the id alone would collide across servers.
 */
export function paneOwnerFile(paneKey: string): string {
  const dir = join(homedir(), '.samaritan', 'panes');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return join(dir, `${sanitizeSessionName(paneKey)}.owner`);
}

/** `<tmux socket>#<pane id>` — the pane's identity across tmux servers. */
function paneKeyOf(target: string): string | undefined {
  const key = paneFormat(target, '#{socket_path}#{pane_id}');
  return key?.includes('%') ? key : undefined;
}

/** Read a pane's owner marker (by `paneKeyOf`); undefined when absent/unreadable. */
export function readPaneOwner(paneKey: string): PaneOwner | undefined {
  try {
    const owner = JSON.parse(readFileSync(paneOwnerFile(paneKey), 'utf-8'));
    return typeof owner?.captureId === 'string' &&
      typeof owner?.pid === 'number'
      ? owner
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * TmuxPaneCapture — attach samaritan's capture pipe to an operator-owned pane.
 *
 * The operator pane is NEVER killed; teardown() only closes the pipe and
 * removes the temp file. Per-step `session:` routing is ignored in attach mode
 * (all reads come from the single attached pane).
 *
 * tmux allows ONE `pipe-pane` per pane, so a second samaritan run attached to
 * the same pane silently replaces ours. Ownership is recorded in a per-pane
 * marker (`paneOwnerFile`, private per-user dir), so `ensureCapture()` can tell the pipe was taken
 * (or closed) and re-attach, and `teardown()` never closes another run's pipe.
 */
export class TmuxPaneCapture implements CaptureBackend {
  private target: string;
  private pipeFile: string;
  private captureId: string;
  private paneId: string | undefined;
  private paneKey: string | undefined;

  constructor(captureId: string, target: string) {
    this.target = target;
    this.captureId = captureId;
    this.pipeFile = join(
      tmpdir(),
      `samaritan-${sanitizeSessionName(captureId)}-attached.pipe`,
    );
  }

  /**
   * Start piping the pane output to our temp file and record ownership.
   * No `-o` flag: any existing pipe on the pane is replaced so attach is
   * deterministic (`-o` would silently skip opening when a pipe exists).
   * Returns the live samaritan run that owned the pane before, if any, so the
   * caller can warn that it is taking the pane over.
   */
  attach(): { previousOwner?: PaneOwner } {
    const key = this.ownerKey();
    const previous = key ? readPaneOwner(key) : undefined;
    const previousOwner =
      previous &&
      previous.captureId !== this.captureId &&
      isProcessAlive(previous.pid)
        ? previous
        : undefined;
    spawnSync('tmux', [
      'pipe-pane',
      '-t',
      this.target,
      // Quoted: tmpdir() may contain spaces (e.g. macOS /var/folders/...)
      `cat >> '${this.pipeFile}'`,
    ]);
    if (key) {
      const owner: PaneOwner = {
        captureId: this.captureId,
        pid: process.pid,
        since: new Date().toISOString(),
      };
      try {
        writeFileSync(paneOwnerFile(key), JSON.stringify(owner), {
          mode: 0o600,
        });
      } catch {
        // best effort — without the marker we just can't detect a takeover
      }
    }
    return previousOwner ? { previousOwner } : {};
  }

  /**
   * Make sure our pipe still feeds this pane's output. When the pane's pipe
   * was closed (`#{pane_pipe}` = 0) or another samaritan run's marker replaced
   * ours, re-attach and report who had it — output produced while detached is
   * NOT in our pipe file. `unavailable` when tmux or the pane is gone.
   */
  ensureCapture(_sessionName: string): CaptureCheck {
    const pipe = paneFormat(this.target, '#{pane_pipe}');
    if (pipe === undefined) return { status: 'unavailable' };
    const key = this.ownerKey();
    const owner = key ? readPaneOwner(key) : undefined;
    const takenBy =
      owner && owner.captureId !== this.captureId ? owner : undefined;
    if (pipe === '1' && !takenBy) return { status: 'ok' };
    this.attach();
    return takenBy
      ? { status: 'reattached', takenBy }
      : { status: 'reattached' };
  }

  /**
   * The pane's stable id (`%3`). Unlike a positional target (`work:0.1`) it
   * never shifts to another pane when the window's panes are renumbered, so
   * it is what a session saves for `resume`. Undefined when tmux is gone.
   */
  resolvePaneId(): string | undefined {
    this.paneId ??= paneFormat(this.target, '#{pane_id}');
    return this.paneId;
  }

  /** The owner-marker key for this pane (`paneKeyOf`), resolved once. */
  private ownerKey(): string | undefined {
    this.paneKey ??= paneKeyOf(this.target);
    return this.paneKey;
  }

  /** Whether this capture still owns the pane's pipe (or nobody recorded one). */
  private ownsPane(): boolean {
    const key = this.ownerKey();
    if (!key) return true;
    const owner = readPaneOwner(key);
    return !owner || owner.captureId === this.captureId;
  }

  /** Always true — single capture target; session name is ignored. */
  hasTarget(_sessionName: string): boolean {
    return true;
  }

  currentOffset(_sessionName: string): number {
    try {
      return statSync(this.pipeFile).size;
    } catch {
      return 0;
    }
  }

  readOutput(_sessionName: string, fromOffset: number): string {
    try {
      const buf = readFileSync(this.pipeFile);
      return buf.slice(fromOffset).toString('utf-8');
    } catch {
      return '';
    }
  }

  describeTarget(_sessionName: string): string {
    return `tmux pane ${this.target}`;
  }

  /** Paste a command into the attached pane without executing it (no Enter). */
  pasteCommand(_sessionName: string, command: string): void {
    pasteBufferTo(this.target, command);
  }

  /** Capture the attached pane's rendered screen as clean text. */
  captureScreen(_sessionName: string): string | undefined {
    return capturePaneScreen(this.target);
  }

  /** The attached pane's cursor line (the prompt once a command finished). */
  promptLine(_sessionName: string): string | undefined {
    return capturePaneCursorLine(this.target);
  }

  /** Scrollback + screen of the attached pane as clean text (no escapes). */
  captureHistory(_sessionName: string): string | undefined {
    return capturePaneScreen(this.target, PANE_HISTORY_LINES);
  }

  /**
   * Close the pipe and remove the temp file — but only close the pipe while
   * we still own it: another samaritan run that took the pane over keeps its
   * capture. NEVER kills the tmux session — the pane belongs to the operator.
   */
  teardown(): void {
    if (this.ownsPane()) {
      // Close the pipe by running pipe-pane without a command argument
      try {
        spawnSync('tmux', ['pipe-pane', '-t', this.target]);
      } catch {
        // best effort
      }
      const key = this.ownerKey();
      if (key) {
        try {
          unlinkSync(paneOwnerFile(key));
        } catch {
          // best effort
        }
      }
    }
    try {
      if (existsSync(this.pipeFile)) {
        unlinkSync(this.pipeFile);
      }
    } catch {
      // best effort
    }
  }
}

export function sanitizeSessionName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Default tmux session name: unique per run so concurrent runs never collide.
 */
export const DEFAULT_TMUX_SESSION_TEMPLATE = 'samaritan-${SESSION_ID}';

/** Run-scoped variables available to `run.tmux_session` (user vars win). */
export const TMUX_SESSION_BUILTIN_VARS = [
  'SESSION_ID',
  'ENV',
  'OPERATION_ID',
] as const;

export interface TmuxSessionNameContext {
  sessionId: string;
  /** Target environment name, e.g. `sbx` — exposed as `${ENV}`. */
  env: string;
  operationId: string;
}

/**
 * `${VAR}` names in a `run.tmux_session` template that neither the run's
 * variables nor the run-scoped built-ins (SESSION_ID / ENV / OPERATION_ID)
 * define. Lets `run`/`resume` fail fast — before creating a session record —
 * and `validate` warn per environment.
 */
export function listUnresolvedTmuxSessionVars(
  template: string | undefined,
  vars: Record<string, any>,
): string[] {
  const builtins = Object.fromEntries(
    TMUX_SESSION_BUILTIN_VARS.map((name) => [name, '']),
  );
  return listUnresolvedVars(template ?? DEFAULT_TMUX_SESSION_TEMPLATE, {
    ...builtins,
    ...vars,
  });
}

/**
 * Resolve the tmux session name for a run from `run.tmux_session` (default
 * `samaritan-${SESSION_ID}`). Built-ins are merged UNDER the user's variables,
 * matching every other built-in. The result is sanitized to tmux-safe
 * characters (tmux forbids `.` and `:` in session names). Throws on an
 * unresolved `${VAR}` — a wrong name could route commands to the wrong pane.
 */
export function resolveTmuxSessionName(
  template: string | undefined,
  vars: Record<string, any>,
  ctx: TmuxSessionNameContext,
): string {
  const scope = {
    SESSION_ID: ctx.sessionId,
    ENV: ctx.env,
    OPERATION_ID: ctx.operationId,
    ...vars,
  };
  const raw = template ?? DEFAULT_TMUX_SESSION_TEMPLATE;
  let resolved: string;
  try {
    resolved = resolveVars(raw, scope);
  } catch (err: any) {
    throw new Error(`run.tmux_session "${raw}": ${err.message}`);
  }
  const name = sanitizeSessionName(resolved.trim());
  if (!name) throw new Error(`run.tmux_session "${raw}" resolved to empty`);
  return name;
}

/** Tmux user option marking which samaritan run created a tmux session. */
const OWNER_OPTION = '@samaritan_owner';

function tmuxHasSession(tmuxName: string): boolean {
  try {
    return (
      spawnSync('tmux', ['has-session', '-t', `=${tmuxName}`], {
        stdio: 'ignore',
      }).status === 0
    );
  } catch {
    return false;
  }
}

function tmuxSessionOwner(tmuxName: string): string {
  const r = spawnSync(
    'tmux',
    ['show-options', '-t', tmuxName, '-qv', OWNER_OPTION],
    { stdio: 'pipe' },
  );
  return r.status === 0 ? (r.stdout?.toString() ?? '').trim() : '';
}

/**
 * Parse `list-windows -F '#{window_name}<sep>#{pane_id}'` into
 * window name → active pane id. Pure for unit testing; first window wins on a
 * duplicate name (tmux's own `-t name:window` lookup is ambiguous there).
 */
export function parseWindowPanes(stdout: string): Map<string, string> {
  const windows = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const at = line.lastIndexOf(TMUX_FIELD_SEP);
    if (at <= 0) continue;
    const name = line.slice(0, at);
    const pane = line.slice(at + TMUX_FIELD_SEP.length).trim();
    if (pane && !windows.has(name)) windows.set(name, pane);
  }
  return windows;
}

function listWindowPanes(tmuxName: string): Map<string, string> {
  const r = spawnSync(
    'tmux',
    [
      'list-windows',
      '-t',
      `=${tmuxName}`,
      '-F',
      `#{window_name}${TMUX_FIELD_SEP}#{pane_id}`,
    ],
    { stdio: 'pipe' },
  );
  return r.status === 0
    ? parseWindowPanes(r.stdout?.toString() ?? '')
    : new Map();
}

/** Run tmux and return the trimmed stdout, throwing with stderr on failure. */
function tmuxOrThrow(args: string[]): string {
  const r = spawnSync('tmux', args, { stdio: 'pipe' });
  if (r.status !== 0) {
    const reason = r.error?.message ?? r.stderr?.toString().trim();
    throw new Error(`tmux ${args[0]} failed: ${reason || 'unknown error'}`);
  }
  return (r.stdout?.toString() ?? '').trim();
}

export interface BootstrapOptions {
  /** tmux session name (resolved `run.tmux_session`); default `samaritan-<id>`. */
  tmuxName?: string;
  promptPattern?: string;
}

export interface BootstrapResult {
  tmux: TmuxSession;
  /** True when an existing tmux session with that name was adopted. */
  reused: boolean;
  /** `sessions:` keys whose same-named window already existed (used as-is). */
  adopted: string[];
  /** `sessions:` keys samaritan opened a new window for. */
  created: string[];
}

/**
 * Bring up one tmux window per `sessions:` key, named after the key, inside
 * the tmux session `tmuxName`.
 *
 * - No such tmux session → create it, tag it with the run's id
 *   (`@samaritan_owner`), and kill it on teardown.
 * - It already exists (the operator's own, or this run's from before an
 *   abort) → REUSE it: a window already named after a key is adopted as-is
 *   (samaritan never types into it — no `ssh`, it's already connected); a
 *   missing one is added. Teardown kills it only when this run created it.
 */
export async function bootstrapSessions(
  sessionId: string,
  sessions: Record<string, SessionConfig>,
  opts: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const tmuxName = opts.tmuxName ?? `samaritan-${sessionId}`;
  const reused = tmuxHasSession(tmuxName);
  const owned = !reused || tmuxSessionOwner(tmuxName) === sessionId;
  const tmuxSession = new TmuxSession(sessionId, tmuxName, owned);
  const existing = reused ? listWindowPanes(tmuxName) : new Map();
  const adopted: string[] = [];
  const created: string[] = [];

  const sessionNames = Object.keys(sessions);
  for (let i = 0; i < sessionNames.length; i++) {
    const name = sanitizeSessionName(sessionNames[i]);
    const config = sessions[sessionNames[i]];

    let paneTarget = existing.get(name);
    const isAdopted = paneTarget !== undefined;
    if (paneTarget === undefined) {
      // -P -F prints the new pane's id (%N): stable however windows move.
      paneTarget =
        !reused && created.length === 0
          ? tmuxOrThrow([
              'new-session',
              '-d',
              '-s',
              tmuxName,
              '-n',
              name,
              '-P',
              '-F',
              '#{pane_id}',
            ])
          : tmuxOrThrow([
              'new-window',
              '-d',
              '-t',
              `=${tmuxName}:`,
              '-n',
              name,
              '-P',
              '-F',
              '#{pane_id}',
            ]);
      if (!reused && created.length === 0) {
        spawnSync('tmux', [
          'set-option',
          '-t',
          tmuxName,
          OWNER_OPTION,
          sessionId,
        ]);
      }
      created.push(name);
    } else {
      adopted.push(name);
    }

    // Start pipe-pane capture; pipeFile uses sanitized name so no shell
    // injection. No `-o`: replace any stale pipe (e.g. left by an aborted run)
    // so capture deterministically lands in THIS run's file.
    const pipeFile = tmuxSession.getPipeFilePath(name);
    spawnSync('tmux', ['pipe-pane', '-t', paneTarget, `cat >> '${pipeFile}'`]);

    tmuxSession.registerPane(name, paneTarget);

    // An adopted window is the operator's — already connected; never type.
    if (isAdopted) continue;

    // SSH connect if host defined
    if (config.host) {
      const userAtHost = config.user
        ? `${config.user}@${config.host}`
        : config.host;
      spawnSync('tmux', [
        'send-keys',
        '-t',
        paneTarget,
        `ssh ${userAtHost}`,
        'Enter',
      ]);
    }

    // Wait for prompt after connecting
    const pattern = opts.promptPattern ?? '\\$\\s*$';
    await tmuxSession.waitForPrompt(name, 10_000, pattern);
  }

  return { tmux: tmuxSession, reused, adopted, created };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
