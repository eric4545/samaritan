import { exec, spawnSync } from 'node:child_process';
import { existsSync, statSync, writeFileSync } from 'node:fs';

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

/** One way of reading a PNG from the system clipboard. */
export interface ClipboardImageCommand {
  cmd: string;
  args: string[];
  /** true: PNG bytes arrive on stdout; false: the command writes `dest` itself. */
  toStdout: boolean;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/**
 * Candidate commands (in preference order) that read the clipboard's image as
 * PNG on `platform`. macOS and Windows use built-ins (osascript, PowerShell);
 * Linux needs wl-paste (Wayland) or xclip (X11), filtered by `hasBinary`.
 */
export function clipboardImageCommands(
  platform: NodeJS.Platform,
  dest: string,
  hasBinary: (binary: string) => boolean,
): ClipboardImageCommand[] {
  switch (platform) {
    case 'darwin': {
      const file = dest.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return [
        {
          cmd: 'osascript',
          args: [
            '-e',
            'set png to (the clipboard as «class PNGf»)',
            '-e',
            `set f to open for access POSIX file "${file}" with write permission`,
            '-e',
            'write png to f',
            '-e',
            'close access f',
          ],
          toStdout: false,
        },
      ];
    }
    case 'win32': {
      const file = dest.replace(/'/g, "''");
      return [
        {
          cmd: 'powershell',
          args: [
            '-NoProfile',
            '-Command',
            `Add-Type -AssemblyName System.Windows.Forms; $i = [System.Windows.Forms.Clipboard]::GetImage(); if ($i) { $i.Save('${file}') } else { exit 1 }`,
          ],
          toStdout: false,
        },
      ];
    }
    case 'linux': {
      const candidates: ClipboardImageCommand[] = [
        { cmd: 'wl-paste', args: ['--type', 'image/png'], toStdout: true },
        {
          cmd: 'xclip',
          args: ['-selection', 'clipboard', '-t', 'image/png', '-o'],
          toStdout: true,
        },
      ];
      return candidates.filter((c) => hasBinary(c.cmd));
    }
    default:
      return [];
  }
}

type RunCommand = (
  cmd: string,
  args: string[],
) => { status: number | null; stdout?: Buffer };

const defaultRun: RunCommand = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
  return { status: r.status, stdout: r.stdout ?? undefined };
};

const defaultHasBinary = (binary: string): boolean =>
  spawnSync('which', [binary], { stdio: 'ignore' }).status === 0;

/**
 * Save the clipboard's image to `dest` as PNG. Returns false — never throws —
 * when there is no image in the clipboard or no tool can read it, so the
 * caller can point the operator at the file-attach fallback.
 */
export function readClipboardImage(
  dest: string,
  deps: {
    platform?: NodeJS.Platform;
    run?: RunCommand;
    hasBinary?: (binary: string) => boolean;
  } = {},
): boolean {
  const run = deps.run ?? defaultRun;
  const commands = clipboardImageCommands(
    deps.platform ?? process.platform,
    dest,
    deps.hasBinary ?? defaultHasBinary,
  );
  for (const { cmd, args, toStdout } of commands) {
    try {
      const result = run(cmd, args);
      if (result.status !== 0) continue;
      if (toStdout) {
        const png = result.stdout;
        if (!png || !png.subarray(0, 4).equals(PNG_MAGIC)) continue;
        writeFileSync(dest, png);
      }
      if (existsSync(dest) && statSync(dest).size > 0) return true;
    } catch {
      // try the next tool
    }
  }
  return false;
}
