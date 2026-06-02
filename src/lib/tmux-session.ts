import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionConfig } from '../models/operation';

export function isLocalSession(config: SessionConfig | undefined): boolean {
  return !config?.host;
}

export class TmuxSession {
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

  send(sessionName: string, command: string): void {
    const pane = this.paneMap.get(sessionName) ?? `${this.tmuxName}:0.0`;
    spawnSync('tmux', ['send-keys', '-t', pane, command, 'Enter']);
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
      execSync(`tmux kill-session -t ${this.tmuxName}`, { stdio: 'ignore' });
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

export async function bootstrapSessions(
  sessionId: string,
  sessions: Record<string, SessionConfig>,
  promptPattern?: string,
): Promise<TmuxSession> {
  const tmuxName = `samaritan-${sessionId}`;
  const tmuxSession = new TmuxSession(sessionId, tmuxName);

  execSync(`tmux new-session -d -s ${tmuxName}`);

  const sessionNames = Object.keys(sessions);
  for (let i = 0; i < sessionNames.length; i++) {
    const name = sessionNames[i];
    const config = sessions[name];
    // Each session gets its own window; the first pane in window i is :i.0
    const paneTarget = `${tmuxName}:${i}.0`;

    if (i > 0) {
      execSync(`tmux new-window -t ${tmuxName}`);
    }

    // Start pipe-pane capture
    const pipeFile = tmuxSession.getPipeFilePath(name);
    execSync(`tmux pipe-pane -t ${paneTarget} -o 'cat >> ${pipeFile}'`);

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
