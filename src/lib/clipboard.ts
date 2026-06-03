import { exec, spawnSync } from 'node:child_process';

export async function copyToClipboard(text: string): Promise<boolean> {
  const cmd = detectClipboardCmd();
  if (!cmd) return false;
  return new Promise<boolean>((resolve) => {
    const proc = exec(cmd, (err) => resolve(!err));
    proc.stdin?.end(text);
  });
}

export function detectClipboardCmd(): string | null {
  switch (process.platform) {
    case 'darwin':
      return 'pbcopy';
    case 'win32':
      return 'clip';
    case 'linux': {
      const candidates: Array<[string, string]> = [
        ['xclip', 'xclip -selection clipboard'],
        ['xsel', 'xsel --clipboard --input'],
        ['wl-copy', 'wl-copy'],
      ];
      for (const [binary, cmd] of candidates) {
        if (spawnSync('which', [binary], { stdio: 'ignore' }).status === 0) {
          return cmd;
        }
      }
      return null;
    }
    default:
      return null;
  }
}
