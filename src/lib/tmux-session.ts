import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionConfig } from '../models/operation';
import type { CaptureBackend } from './capture-backend';

export function isLocalSession(config: SessionConfig | undefined): boolean {
  return !config?.host;
}

/**
 * Validate that a tmux target string (e.g. "mysession:0.0" or "%12") refers to
 * an existing pane. Returns true when the target resolves, false otherwise.
 * Never throws — a bad target simply returns false.
 */
export function validateTmuxTarget(target: string): boolean {
  try {
    const result = spawnSync(
      'tmux',
      ['display-message', '-p', '-t', target, '#{pane_id}'],
      { stdio: 'pipe' },
    );
    return result.status === 0;
  } catch {
    return false;
  }
}

export class TmuxSession implements CaptureBackend {
  private sessionId: string;
  private tmuxName: string;
  private paneMap: Map<string, string> = new Map();

  constructor(sessionId: string, tmuxName: string) {
    this.sessionId = sessionId;
    this.tmuxName = tmuxName;
  }

  getPipeFilePath(sessionName: string): string {
    return join(tmpdir(), `samaritan-${this.sessionId}-${sessionName}.pipe`);
  }

  send(sessionName: string, command: string, sendEnter = true): void {
    const pane = this.paneMap.get(sessionName) ?? `${this.tmuxName}:0.0`;
    const args = sendEnter
      ? ['send-keys', '-t', pane, command, 'Enter']
      : ['send-keys', '-t', pane, command];
    spawnSync('tmux', args);
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
    return pane ? `tmux pane ${pane}` : `tmux session ${this.tmuxName}`;
  }

  async waitForPrompt(
    sessionName: string,
    timeoutMs: number,
    promptPattern?: string,
    idleThresholdMs = 0,
  ): Promise<'done' | 'timeout' | 'idle'> {
    const pane = this.paneMap.get(sessionName) ?? `${this.tmuxName}:0.0`;
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
      spawnSync('tmux', ['kill-session', '-t', this.tmuxName], {
        stdio: 'ignore',
      });
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

/**
 * TmuxPaneCapture — attach samaritan's capture pipe to an operator-owned pane.
 *
 * The operator pane is NEVER killed; teardown() only closes the pipe and
 * removes the temp file. Per-step `session:` routing is ignored in attach mode
 * (all reads come from the single attached pane).
 */
export class TmuxPaneCapture implements CaptureBackend {
  private target: string;
  private pipeFile: string;

  constructor(captureId: string, target: string) {
    this.target = target;
    this.pipeFile = join(tmpdir(), `samaritan-${captureId}-attached.pipe`);
  }

  /**
   * Start piping the pane output to our temp file.
   * No `-o` flag: any existing pipe on the pane is replaced so attach is
   * deterministic (`-o` would silently skip opening when a pipe exists).
   */
  attach(): void {
    spawnSync('tmux', [
      'pipe-pane',
      '-t',
      this.target,
      `cat >> ${this.pipeFile}`,
    ]);
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

  /**
   * Close the pipe and remove the temp file.
   * NEVER kills the tmux session — the pane belongs to the operator.
   */
  teardown(): void {
    // Close the pipe by running pipe-pane without a command argument
    try {
      spawnSync('tmux', ['pipe-pane', '-t', this.target]);
    } catch {
      // best effort
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

export async function bootstrapSessions(
  sessionId: string,
  sessions: Record<string, SessionConfig>,
  promptPattern?: string,
): Promise<TmuxSession> {
  const tmuxName = `samaritan-${sessionId}`;
  const tmuxSession = new TmuxSession(sessionId, tmuxName);

  spawnSync('tmux', ['new-session', '-d', '-s', tmuxName]);

  const sessionNames = Object.keys(sessions);
  for (let i = 0; i < sessionNames.length; i++) {
    const name = sanitizeSessionName(sessionNames[i]);
    const config = sessions[sessionNames[i]];
    // Each session gets its own window; the first pane in window i is :i.0
    const paneTarget = `${tmuxName}:${i}.0`;

    if (i > 0) {
      spawnSync('tmux', ['new-window', '-t', tmuxName]);
    }

    // Start pipe-pane capture; pipeFile uses sanitized name so no shell injection
    const pipeFile = tmuxSession.getPipeFilePath(name);
    spawnSync('tmux', [
      'pipe-pane',
      '-t',
      paneTarget,
      '-o',
      `cat >> ${pipeFile}`,
    ]);

    tmuxSession.registerPane(name, paneTarget);

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
    const pattern = promptPattern ?? '\\$\\s*$';
    await tmuxSession.waitForPrompt(name, 10_000, pattern);
  }

  return tmuxSession;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
