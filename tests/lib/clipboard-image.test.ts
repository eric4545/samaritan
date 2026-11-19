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
  copiedSince,
  fileFromUriList,
  isPng,
  macProbeArgs,
  parseMacProbe,
  probeClipboard,
  type RunTool,
  type RunToolAsync,
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
  it('macOS: pngpaste when installed, then the AppKit reader, then AppleScript', () => {
    const names = (tools: string[]) =>
      clipboardImageTools(ctx({ platform: 'darwin', tools })).map(
        (t) => t.name,
      );
    assert.deepStrictEqual(names(['pngpaste']), [
      'pngpaste',
      'osascript (AppKit)',
      'osascript',
    ]);
    assert.deepStrictEqual(names([]), ['osascript (AppKit)', 'osascript']);
  });

  it('osascript gets the destination as an argument, never spliced into the script', () => {
    for (const tool of clipboardImageTools(ctx({ platform: 'darwin' }))) {
      const args = tool.args("/tmp/it's here.png");
      assert.strictEqual(args[args.length - 1], "/tmp/it's here.png");
      assert.ok(
        args.slice(0, -1).every((a) => !a.includes('here.png')),
        `${tool.name}: the path is not part of any -e line`,
      );
    }
  });

  it('the AppKit reader is JavaScript for Automation in plain ASCII, and converts TIFF', () => {
    const [jxa] = clipboardImageTools(ctx({ platform: 'darwin' }));
    const args = jxa.args('/tmp/x.png');
    assert.deepStrictEqual(args.slice(0, 2), ['-l', 'JavaScript']);
    const script = args.slice(2, -1).join('\n');
    // «» in an -e argument depends on the locale osascript runs under.
    assert.ok(/^[\x20-\x7e\n]*$/.test(script), 'script is ASCII only');
    assert.match(script, /public\.png/);
    assert.match(script, /public\.tiff/);
    assert.match(script, /representationUsingTypeProperties/);
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

  it('a helper error is reported, not hidden behind "holds no image"', () => {
    const run: RunTool = (command) => ({
      status: 1,
      stdout: Buffer.alloc(0),
      stderr: Buffer.from(
        `${command}: execution error: Not authorized to send Apple events. (-1743)\n`,
      ),
    });
    const result = readClipboardImage(dest, mac, run);
    assert.strictEqual(result.ok, false);
    const { reason } = result as { reason: string };
    assert.doesNotMatch(reason, /holds no image/);
    assert.match(reason, /Not authorized to send Apple events/);
  });

  it('"no image flavour" errors from every helper still read as no image, with the Mac screenshot shortcut', () => {
    const run: RunTool = () => ({
      status: 1,
      stdout: Buffer.alloc(0),
      stderr: Buffer.from(
        'execution error: Error: the clipboard holds no image (-2700)\n',
      ),
    });
    const { reason } = readClipboardImage(dest, mac, run) as {
      reason: string;
    };
    assert.match(reason, /holds no image/);
    assert.match(reason, /Cmd\+Ctrl\+Shift\+4/);
  });

  it('AppleScript -1700 (no PNG flavour) counts as no image', () => {
    const run: RunTool = () => ({
      status: 1,
      stdout: Buffer.alloc(0),
      stderr: Buffer.from(
        'execution error: Can’t make some data into the expected type. (-1700)\n',
      ),
    });
    const { reason } = readClipboardImage(dest, mac, run) as {
      reason: string;
    };
    assert.match(reason, /holds no image/);
  });

  it('a helper that times out says so', () => {
    const run: RunTool = () => ({
      status: null,
      stdout: Buffer.alloc(0),
      timedOut: true,
    });
    const { reason } = readClipboardImage(dest, x11, run) as {
      reason: string;
    };
    assert.match(reason, /xclip: no answer within 5 s/);
  });

  it('falls through to the next helper when the first fails', () => {
    const calls: string[] = [];
    const run: RunTool = (command, args) => {
      calls.push(`${command} ${args[0]}`);
      if (args[0] === '-l') {
        writeFileSync(args[args.length - 1], PNG);
        return { status: 0, stdout: Buffer.alloc(0) };
      }
      return { status: 1, stdout: Buffer.alloc(0) };
    };
    const result = readClipboardImage(
      dest,
      ctx({ platform: 'darwin', tools: ['pngpaste'] }),
      run,
    );
    assert.deepStrictEqual(result, {
      ok: true,
      tool: 'osascript (AppKit)',
      bytes: PNG.length,
    });
    assert.strictEqual(calls.length, 2);
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

describe('probeClipboard: what is on the clipboard, without taking it', () => {
  const ok = (stdout: string | Buffer) =>
    Promise.resolve({
      status: 0,
      stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout),
    });

  it('macOS: one ASCII JXA script, its JSON parsed', async () => {
    const args = macProbeArgs();
    assert.deepStrictEqual(args.slice(0, 2), ['-l', 'JavaScript']);
    assert.ok(/^[\x20-\x7e]*$/.test(args.join('')), 'ASCII only');
    const calls: string[][] = [];
    const run: RunToolAsync = (command, a) => {
      calls.push([command, ...a]);
      return ok(
        '{"changeCount":42,"types":["public.png","public.tiff"],"path":null}\n',
      );
    };
    assert.deepStrictEqual(
      await probeClipboard(ctx({ platform: 'darwin' }), run),
      { fingerprint: 'mac:42', kind: 'image' },
    );
    assert.strictEqual(calls[0][0], 'osascript');
  });

  it('macOS: a copied file wins over its icon (TIFF)', () => {
    assert.deepStrictEqual(
      parseMacProbe(
        '{"changeCount":7,"types":["public.file-url","public.tiff"],"path":"/Users/alice/Desktop/shot.png"}',
      ),
      {
        fingerprint: 'mac:7',
        kind: 'file',
        path: '/Users/alice/Desktop/shot.png',
      },
    );
  });

  it('macOS: text is other, nothing is empty, garbage is undefined', () => {
    assert.strictEqual(
      parseMacProbe('{"changeCount":1,"types":["public.utf8-plain-text"]}')
        ?.kind,
      'other',
    );
    assert.strictEqual(
      parseMacProbe('{"changeCount":1,"types":[]}')?.kind,
      'empty',
    );
    assert.strictEqual(parseMacProbe('execution error'), undefined);
  });

  it('a failing helper or SSH gives undefined (behave as before)', async () => {
    const fail: RunToolAsync = () =>
      Promise.resolve({ status: 1, stdout: Buffer.alloc(0) });
    assert.strictEqual(
      await probeClipboard(ctx({ platform: 'darwin' }), fail),
      undefined,
    );
    const never: RunToolAsync = () => {
      throw new Error('must not run');
    };
    assert.strictEqual(
      await probeClipboard(
        ctx({ platform: 'darwin', env: { SSH_TTY: '/dev/pts/0' } }),
        never,
      ),
      undefined,
    );
  });

  it('Linux X11: TARGETS, then the PNG bytes fingerprint the image', async () => {
    const x11 = ctx({ env: { DISPLAY: ':0' }, tools: ['xclip'] });
    const run: RunToolAsync = (_c, a) =>
      ok(a.includes('TARGETS') ? 'TARGETS\nimage/png\n' : PNG);
    const probe = await probeClipboard(x11, run);
    assert.strictEqual(probe?.kind, 'image');
    assert.match(probe?.fingerprint ?? '', /^image:[0-9a-f]{40}$/);
  });

  it('Linux: a copied file (text/uri-list) is the file', async () => {
    const x11 = ctx({ env: { DISPLAY: ':0' }, tools: ['xclip'] });
    const run: RunToolAsync = (_c, a) =>
      ok(
        a.includes('TARGETS')
          ? 'text/uri-list\nimage/png'
          : 'file:///home/alice/shot%201.png\r\n',
      );
    assert.deepStrictEqual(await probeClipboard(x11, run), {
      fingerprint: 'file:/home/alice/shot 1.png',
      kind: 'file',
      path: '/home/alice/shot 1.png',
    });
    assert.strictEqual(fileFromUriList('https://example.com/x'), undefined);
  });
});

describe('copiedSince', () => {
  const text = { fingerprint: 'mac:1', kind: 'other' as const };
  const shot = { fingerprint: 'mac:2', kind: 'image' as const };

  it('an image copied after the step started', () => {
    assert.deepStrictEqual(copiedSince(text, shot), shot);
  });
  it('not the image that was already there', () => {
    assert.strictEqual(copiedSince(shot, shot), undefined);
  });
  it('not text, and nothing when a probe is missing', () => {
    assert.strictEqual(
      copiedSince(shot, { fingerprint: 'mac:3', kind: 'other' }),
      undefined,
    );
    assert.strictEqual(copiedSince(undefined, shot), undefined);
    assert.strictEqual(copiedSince(text, undefined), undefined);
  });
});
