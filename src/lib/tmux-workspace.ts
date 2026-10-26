import { spawnSync } from 'node:child_process';
import { sanitizeSessionName } from './tmux-session';

/**
 * tmux workspace for sidecar runs: create or reuse a "work pane" beside
 * samaritan and attach capture to it, so `[p]` paste / `[v]` verify / `[e]`
 * pane evidence work from step 1 with no manual `[t]` pick.
 *
 * - Inside tmux: reuse the pane in the current window tagged with the
 *   `@samaritan` user option for this operation, else split one off.
 * - Outside tmux with `--tmux`: re-run samaritan inside a `samaritan-<op>`
 *   session (created, or reused via a new window) and attach the terminal.
 *
 * The work pane is the operator's shell — teardown only closes the capture
 * pipe, so the pane is still there to reuse on the next run.
 */

/** tmux user option marking a pane as samaritan's work pane for a tag. */
export const WORK_PANE_OPTION = '@samaritan';

export function workPaneTag(operationName: string): string {
  return sanitizeSessionName(operationName) || 'operation';
}

export function tmuxSessionName(tag: string): string {
  return `samaritan-${tag}`;
}

type TmuxRun = (args: string[]) => { status: number | null; stdout: string };

const runTmux: TmuxRun = (args) => {
  const r = spawnSync('tmux', args, { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout ?? '' };
};

/**
 * Pick the pane tagged `tag` out of `list-panes -F '#{pane_id}\t#{@samaritan}'`
 * output, never samaritan's own pane.
 */
export function findTaggedPane(
  listOutput: string,
  tag: string,
  selfPane?: string,
): string | undefined {
  for (const line of listOutput.split('\n')) {
    const [id, value] = line.split('\t');
    if (id && value?.trim() === tag && id !== selfPane) return id;
  }
  return undefined;
}

/** `split-window` beside `selfPane`, keeping focus on samaritan (`-d`). */
export function buildSplitArgs(selfPane: string, cwd: string): string[] {
  return [
    'split-window',
    '-h',
    '-d',
    '-P',
    '-F',
    '#{pane_id}',
    '-c',
    cwd,
    '-t',
    selfPane,
  ];
}

/**
 * Reuse this operation's tagged work pane in samaritan's window, or split a
 * new one and tag it. Returns undefined when tmux can't create a pane.
 */
export function ensureWorkPane(
  tag: string,
  opts: { selfPane: string; cwd: string; run?: TmuxRun },
): { paneId: string; reused: boolean } | undefined {
  const run = opts.run ?? runTmux;
  const listed = run([
    'list-panes',
    '-t',
    opts.selfPane,
    '-F',
    `#{pane_id}\t#{${WORK_PANE_OPTION}}`,
  ]);
  const existing =
    listed.status === 0
      ? findTaggedPane(listed.stdout, tag, opts.selfPane)
      : undefined;
  if (existing) return { paneId: existing, reused: true };

  const split = run(buildSplitArgs(opts.selfPane, opts.cwd));
  const paneId = split.stdout.trim();
  if (split.status !== 0 || !paneId) return undefined;
  run(['set-option', '-p', '-t', paneId, WORK_PANE_OPTION, tag]);
  return { paneId, reused: false };
}

/**
 * tmux commands that run `argv` (samaritan itself) inside session `name` and
 * attach the terminal: `new-session` attaches on its own; an existing session
 * is reused by opening a new window in it, then attaching.
 */
export function buildRelaunchCommands(
  name: string,
  cwd: string,
  argv: string[],
  sessionExists: boolean,
): string[][] {
  return sessionExists
    ? [
        ['new-window', '-t', `${name}:`, '-c', cwd, ...argv],
        ['attach-session', '-t', name],
      ]
    : [['new-session', '-s', name, '-c', cwd, ...argv]];
}

export function tmuxSessionExists(name: string): boolean {
  return (
    spawnSync('tmux', ['has-session', '-t', name], { stdio: 'ignore' })
      .status === 0
  );
}

/**
 * Re-run the current samaritan command inside tmux session `name` and attach
 * this terminal to it (argv only — no shell). Returns whether the session
 * already existed (reused). Blocks until the operator detaches or the session
 * ends.
 */
export function relaunchInTmux(name: string): { reused: boolean } {
  const reused = tmuxSessionExists(name);
  const argv = [
    process.execPath,
    ...process.execArgv,
    ...process.argv.slice(1),
  ];
  for (const args of buildRelaunchCommands(name, process.cwd(), argv, reused)) {
    spawnSync('tmux', args, { stdio: 'inherit' });
  }
  return { reused };
}

export type CaptureStrategy =
  | 'attach'
  | 'sessions'
  | 'work-pane'
  | 'relaunch'
  | 'none';

/**
 * Decide how a run gets its capture pane. Precedence: `--attach` (sidecar
 * only) → `sessions:` bootstrap → work pane (interactive sidecar inside tmux,
 * unless `--no-tmux`) → relaunch into tmux (`--tmux` outside tmux) → none.
 * Piped stdin never auto-creates panes (tests, CI).
 */
export function pickCaptureStrategy(opts: {
  attach?: string;
  hasSessions: boolean;
  mode: string;
  inTmux: boolean;
  interactive: boolean;
  /** `--tmux` → true, `--no-tmux` → false, neither → undefined (auto). */
  tmuxFlag?: boolean;
}): CaptureStrategy {
  const sidecar = opts.mode === 'sidecar';
  if (sidecar && opts.attach) return 'attach';
  if (opts.hasSessions) return 'sessions';
  if (!sidecar || opts.tmuxFlag === false || !opts.interactive) return 'none';
  if (opts.inTmux) return 'work-pane';
  if (opts.tmuxFlag === true) return 'relaunch';
  return 'none';
}

export type AttachHintInput =
  | { kind: 'work-pane'; target: string; reused: boolean }
  | { kind: 'relaunch'; target: string; reused: boolean }
  | { kind: 'sessions'; target: string; inTmux: boolean }
  | { kind: 'attach'; target: string };

/** One line telling the operator how to reach the capture pane/session. */
export function attachHint(input: AttachHintInput): string {
  switch (input.kind) {
    case 'work-pane':
      return `🔗 Work pane ${input.target} (${input.reused ? 'reused' : 'created'}) — beside this one; switch with Ctrl-b o, or: tmux select-pane -t ${input.target}`;
    case 'relaunch':
      return `🖥️  tmux session ${input.target} (${input.reused ? 'reused' : 'created'}) — after detaching (Ctrl-b d), come back with: tmux attach -t ${input.target}`;
    case 'sessions':
      return input.inTmux
        ? `🖥️  Switch with: tmux switch-client -t ${input.target}`
        : `🖥️  Attach with: tmux attach -t ${input.target}`;
    case 'attach':
      return `🔗 Capturing tmux pane ${input.target} — run commands there; [p] pastes, [v] verifies`;
  }
}
