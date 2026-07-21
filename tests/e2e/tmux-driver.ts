// Real-tmux driver for sidecar e2e tests.
//
// These helpers run samaritan INSIDE a real tmux pane (a genuine TTY, so the
// raw-mode `readActionKey` path is exercised — not the readline fallback that
// piped stdin gets), drive it with `tmux send-keys`, and observe the rendered
// TUI with `tmux capture-pane`. Interactions wait on captured output
// (`waitFor`) rather than fixed sleeps, so tests stay deterministic.

import { spawnSync } from 'node:child_process';

export function tmux(args: string[]): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const r = spawnSync('tmux', args, { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** True only when real tmux is usable (Linux/macOS with a working binary). */
export function hasTmux(): boolean {
  return (
    process.platform !== 'win32' &&
    spawnSync('tmux', ['-V'], { encoding: 'utf8' }).status === 0
  );
}

const wait = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export class TmuxDriver {
  readonly session: string;
  /** Pane 0 — where samaritan (or an operator shell) runs. */
  readonly main: string;
  /** Pane 1 — the operator "work" pane (present only when split). */
  work?: string;

  private constructor(session: string) {
    this.session = session;
    this.main = `${session}:0.0`;
  }

  /** Create a detached session with a single pane running a shell. */
  static create(
    opts: { split?: boolean; width?: number; height?: number } = {},
  ): TmuxDriver {
    const { split = false, width = 200, height = 50 } = opts;
    const session = `sam-e2e-${process.pid}-${Date.now()}-${Math.floor(
      Math.random() * 1e4,
    )}`;
    tmux([
      'new-session',
      '-d',
      '-s',
      session,
      '-x',
      String(width),
      '-y',
      String(height),
    ]);
    const d = new TmuxDriver(session);
    if (split) {
      // Convention: pane .0 is the operator "work" pane, pane .1 runs samaritan.
      tmux(['split-window', '-t', `${session}:0`, '-h']);
      d.work = `${session}:0.0`;
      (d as { main: string }).main = `${session}:0.1`;
    }
    return d;
  }

  /** Send a single immediate action key (e.g. 'v', 'p', 't', 'g') — no Enter. */
  key(ch: string, pane?: string): void {
    tmux(['send-keys', '-t', pane ?? this.main, '-l', ch]);
  }

  /** Press Enter (the sidecar "done / complete step" action). */
  enter(pane?: string): void {
    tmux(['send-keys', '-t', pane ?? this.main, 'Enter']);
  }

  /** Type a line of text then press Enter (a shell command, or 'abort'). */
  type(text: string, pane?: string): void {
    const target = pane ?? this.main;
    tmux(['send-keys', '-t', target, '-l', text]);
    tmux(['send-keys', '-t', target, 'Enter']);
  }

  /** Capture a pane's rendered contents including scrollback. */
  capture(pane?: string): string {
    return tmux([
      'capture-pane',
      '-p',
      '-J',
      '-S',
      '-500',
      '-t',
      pane ?? this.main,
    ]).stdout;
  }

  /**
   * Poll a pane until `needle` (string or RegExp) appears, or reject on
   * timeout. Resolves with the capture that first matched.
   */
  async waitFor(
    needle: string | RegExp,
    opts: { pane?: string; timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<string> {
    const { pane = this.main, timeoutMs = 20_000, intervalMs = 300 } = opts;
    const match = (s: string): boolean =>
      typeof needle === 'string' ? s.includes(needle) : needle.test(s);
    const deadline = Date.now() + timeoutMs;
    let last = '';
    while (Date.now() < deadline) {
      last = this.capture(pane);
      if (match(last)) return last;
      await wait(intervalMs);
    }
    throw new Error(
      `waitFor timed out after ${timeoutMs}ms waiting for ${needle} in ${pane}.\n` +
        `Last capture (tail):\n${last.split('\n').slice(-25).join('\n')}`,
    );
  }

  /** List live tmux sessions (server-wide) — used to assert bootstrap/teardown. */
  static listSessions(): string[] {
    const out = tmux(['ls', '-F', '#{session_name}']);
    if (out.status !== 0) return [];
    return out.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }

  /** Kill this session (best-effort; safe to call twice). */
  kill(): void {
    tmux(['kill-session', '-t', this.session]);
  }
}
