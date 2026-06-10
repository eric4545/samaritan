import { execFileSync, execSync } from 'node:child_process';

/**
 * tmux session names are generated internally (samaritan-<uuid>) but are
 * embedded in shell command strings passed to tmux — refuse anything that
 * could carry shell metacharacters.
 */
function assertSafeTmuxName(name: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error(`Invalid tmux session name: ${name}`);
  }
}

export function isIterm2(): boolean {
  return process.env.TERM_PROGRAM === 'iTerm.app';
}

export function isTmuxAvailable(): boolean {
  try {
    execSync('tmux -V', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function openIterm2Split(command: string, title: string): void {
  // Escape double quotes for embedding in AppleScript string
  const safeCommand = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const safeTitle = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const script = `
    tell application "iTerm2"
      tell current window
        tell current session
          split vertically with default profile command "${safeCommand}"
          set name to "${safeTitle}"
        end tell
      end tell
    end tell
  `;

  // Pass the script as an argument — no shell, so no quote-escaping games.
  execFileSync('osascript', ['-e', script]);
}

export type DisplayStrategy = 'iterm2' | 'tmux_split' | 'print_instructions';

export function detectDisplayStrategy(): DisplayStrategy {
  if (isIterm2()) return 'iterm2';
  if (isTmuxAvailable()) return 'tmux_split';
  return 'print_instructions';
}

export interface SplitOptions {
  sessionId: string;
  tmuxName: string;
  sessions: Record<string, { host?: string; user?: string }>;
}

export function openDisplaySplits(opts: SplitOptions): void {
  assertSafeTmuxName(opts.tmuxName);
  const strategy = detectDisplayStrategy();
  const sessionNames = Object.keys(opts.sessions);

  switch (strategy) {
    case 'iterm2': {
      sessionNames.forEach((name, i) => {
        const cfg = opts.sessions[name];
        const host = cfg?.host ?? 'local';
        const title = `samaritan: ${name} (${host})`;
        const attachCmd = `tmux attach-session -t ${opts.tmuxName} \\; select-pane -t 0.${i}`;
        try {
          openIterm2Split(attachCmd, title);
        } catch (err) {
          console.error(
            `⚠ Could not open iTerm2 split for ${name}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });
      break;
    }

    case 'tmux_split': {
      sessionNames.forEach((name, i) => {
        if (i === 0) return; // first pane already exists in current window
        const cfg = opts.sessions[name];
        const host = cfg?.host ?? 'local';
        try {
          // Arg arrays keep YAML-supplied session names/hosts out of a shell.
          execFileSync('tmux', [
            'split-window',
            '-h',
            '-t',
            opts.tmuxName,
            `tmux attach-session -t ${opts.tmuxName} \\; select-pane -t 0.${i}`,
          ]);
          execFileSync('tmux', [
            'select-pane',
            '-T',
            `samaritan: ${name} (${host})`,
          ]);
        } catch (err) {
          console.error(
            `⚠ Could not open tmux split for ${name}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });
      break;
    }

    case 'print_instructions': {
      console.log('');
      console.log(
        '📺 To view execution panes, attach tmux in separate terminals:',
      );
      sessionNames.forEach((name, i) => {
        console.log(
          `  ${name}: tmux attach-session -t ${opts.tmuxName} \\; select-pane -t 0.${i}`,
        );
      });
      console.log('');
      break;
    }
  }
}
