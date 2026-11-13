import assert from 'node:assert';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  type ClipboardEnv,
  clipboardImageTools,
  clipboardUnavailableReason,
  isPng,
  type RunTool,
  readClipboardImage,
} from '../../src/lib/clipboard-image';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

function ctx(over: Partial<ClipboardEnv> & { tools?: string[] }): ClipboardEnv {
  const tools = over.tools ?? [];
  return {
    platform: over.platform ?? 'linux',
    env: over.env ?? {},
    has: (binary) => tools.includes(binary),
  };
}

describe('clipboardImageTools', () => {
  it('macOS: pngpaste when installed, then the built-in osascript', () => {
    const names = (tools: string[]) =>
      clipboardImageTools(ctx({ platform: 'darwin', tools })).map(
        (t) => t.name,
      );
    assert.deepStrictEqual(names(['pngpaste']), ['pngpaste', 'osascript']);
    assert.deepStrictEqual(names([]), ['osascript']);
  });

  it('osascript gets the destination as an argument, never spliced into the script', () => {
    const [tool] = clipboardImageTools(ctx({ platform: 'darwin' }));
    const args = tool.args("/tmp/it's here.png");
    assert.strictEqual(args[args.length - 1], "/tmp/it's here.png");
    assert.ok(
      args.slice(0, -1).every((a) => !a.includes('here.png')),
      'the path is not part of any -e line',
    );
    assert.ok(args.includes('set png to (the clipboard as «class PNGf»)'));
  });

  it('Linux: wl-paste under Wayland, xclip under X11, only when installed', () => {
    const names = (env: Record<string, string>, tools: string[]) =>
      clipboardImageTools(ctx({ env, tools })).map((t) => t.name);
    const both = ['wl-paste', 'xclip'];
    assert.deepStrictEqual(names({ WAYLAND_DISPLAY: 'wayland-0' }, both), [
      'wl-paste',
    ]);
    assert.deepStrictEqual(names({ DISPLAY: ':0' }, both), ['xclip']);
    assert.deepStrictEqual(names({ DISPLAY: ':0' }, []), []);
    assert.deepStrictEqual(names({}, both), []);
  });
});

describe('clipboardUnavailableReason', () => {
  it('over SSH: the clipboard is on the operator machine', () => {
    assert.match(
      clipboardUnavailableReason(
        ctx({ env: { SSH_CONNECTION: '192.0.2.1 1 192.0.2.2 22' } }),
      ),
      /reached over SSH, and the clipboard is on your own computer/,
    );
  });
  it('Linux desktop without a helper names the packages', () => {
    assert.match(
      clipboardUnavailableReason(ctx({ env: { DISPLAY: ':0' } })),
      /wl-paste \(wl-clipboard\) or xclip/,
    );
  });
  it('Linux without a desktop session says so', () => {
    assert.match(clipboardUnavailableReason(ctx({})), /no desktop session/);
  });
  it('another platform asks for a file path', () => {
    assert.match(
      clipboardUnavailableReason(ctx({ platform: 'win32' })),
      /not supported on win32/,
    );
  });
});

describe('readClipboardImage', () => {
  let dir: string;
  let dest: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'samaritan-clip-'));
    dest = join(dir, 'clipboard.png');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const x11 = ctx({ env: { DISPLAY: ':0' }, tools: ['xclip'] });
  const mac = ctx({ platform: 'darwin' });

  it('writes the PNG a stdout helper prints', () => {
    const calls: string[][] = [];
    const run: RunTool = (command, args) => {
      calls.push([command, ...args]);
      return { status: 0, stdout: PNG };
    };
    const result = readClipboardImage(dest, x11, run);
    assert.deepStrictEqual(result, {
      ok: true,
      tool: 'xclip',
      bytes: PNG.length,
    });
    assert.ok(readFileSync(dest).equals(PNG));
    assert.deepStrictEqual(calls, [
      ['xclip', '-selection', 'clipboard', '-t', 'image/png', '-o'],
    ]);
  });

  it('accepts the file a file-writing helper leaves at the destination', () => {
    const run: RunTool = (_command, args) => {
      writeFileSync(args[args.length - 1], PNG);
      return { status: 0, stdout: Buffer.alloc(0) };
    };
    const result = readClipboardImage(dest, mac, run);
    assert.strictEqual(result.ok, true);
    assert.ok(isPng(readFileSync(dest)));
  });

  it('text on the clipboard is not an image, and nothing is left behind', () => {
    const run: RunTool = () => ({
      status: 0,
      stdout: Buffer.from('just text'),
    });
    const result = readClipboardImage(dest, x11, run);
    assert.strictEqual(result.ok, false);
    assert.match((result as { reason: string }).reason, /holds no image/);
    assert.ok(!existsSync(dest));
  });

  it('a failing helper (no image flavour) leaves no partial file', () => {
    const run: RunTool = (_command, args) => {
      writeFileSync(args[args.length - 1], 'partial');
      return { status: 1, stdout: Buffer.alloc(0) };
    };
    assert.strictEqual(readClipboardImage(dest, mac, run).ok, false);
    assert.ok(!existsSync(dest));
  });

  it('with no helper it runs nothing and says why', () => {
    const run: RunTool = () => {
      throw new Error('must not run');
    };
    const result = readClipboardImage(
      dest,
      ctx({ env: { SSH_TTY: '/dev/pts/0' } }),
      run,
    );
    assert.strictEqual(result.ok, false);
    assert.match((result as { reason: string }).reason, /over SSH/);
  });
});
