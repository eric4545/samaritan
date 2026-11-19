import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Read an IMAGE from the operator's clipboard into a PNG file.
 *
 * A terminal paste carries text only, so a screenshot on the clipboard never
 * reaches stdin. The image has to be fetched from the OS clipboard by a
 * helper program, which only works where samaritan runs on the machine that
 * owns the clipboard (not on a host reached over SSH).
 */

export interface ClipboardImageTool {
  name: string;
  command: string;
  args: (dest: string) => string[];
  /** Where the PNG bytes come out. */
  output: 'file' | 'stdout';
}

export interface ClipboardEnv {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  /** Whether a program is on PATH. */
  has: (binary: string) => boolean;
}

export type ClipboardImageResult =
  | { ok: true; tool: string; bytes: number }
  | { ok: false; reason: string };

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

// JavaScript for Automation over AppKit: write the clipboard image to the file
// given as argv[0]. Takes the PNG flavour, else converts the TIFF flavour (an
// image copied from Preview, Safari or Keynote often carries TIFF only).
// Plain ASCII on purpose: osascript decodes an -e argument by the locale it
// runs under, and the «class PNGf» of the AppleScript fallback below does not
// survive a non-UTF-8 one.
const JXA_LINES = [
  'function run(argv) {',
  "  ObjC.import('AppKit');",
  '  var pb = $.NSPasteboard.generalPasteboard;',
  "  var data = pb.dataForType('public.png');",
  '  if (data.isNil()) {',
  "    var tiff = pb.dataForType('public.tiff');",
  "    if (tiff.isNil()) throw new Error('the clipboard holds no image');",
  '    var rep = $.NSBitmapImageRep.imageRepWithData(tiff);',
  "    if (rep.isNil()) throw new Error('the clipboard holds no image');",
  '    data = rep.representationUsingTypeProperties(4, $({}));',
  '  }',
  "  if (!data.writeToFileAtomically(argv[0], true)) throw new Error('could not write ' + argv[0]);",
  '}',
];

// AppleScript fallback: write the clipboard's PNG flavour to the file given as
// argv. Fails (non-zero exit, -1700) when the clipboard holds no PNG.
const OSASCRIPT_LINES = [
  'on run argv',
  'set png to (the clipboard as «class PNGf»)',
  'set f to open for access (POSIX file (item 1 of argv)) with write permission',
  'set eof f to 0',
  'write png to f',
  'close access f',
  'end run',
];

/** The helpers to try, in order, on this machine. */
export function clipboardImageTools(ctx: ClipboardEnv): ClipboardImageTool[] {
  const tools: ClipboardImageTool[] = [];
  if (ctx.platform === 'darwin') {
    if (ctx.has('pngpaste')) {
      tools.push({
        name: 'pngpaste',
        command: 'pngpaste',
        args: (dest) => [dest],
        output: 'file',
      });
    }
    tools.push({
      name: 'osascript (AppKit)',
      command: 'osascript',
      args: (dest) => [
        '-l',
        'JavaScript',
        ...JXA_LINES.flatMap((l) => ['-e', l]),
        dest,
      ],
      output: 'file',
    });
    tools.push({
      name: 'osascript',
      command: 'osascript',
      args: (dest) => [...OSASCRIPT_LINES.flatMap((l) => ['-e', l]), dest],
      output: 'file',
    });
  }
  if (ctx.platform === 'linux') {
    if (ctx.env.WAYLAND_DISPLAY && ctx.has('wl-paste')) {
      tools.push({
        name: 'wl-paste',
        command: 'wl-paste',
        args: () => ['--no-newline', '--type', 'image/png'],
        output: 'stdout',
      });
    }
    if (ctx.env.DISPLAY && ctx.has('xclip')) {
      tools.push({
        name: 'xclip',
        command: 'xclip',
        args: () => ['-selection', 'clipboard', '-t', 'image/png', '-o'],
        output: 'stdout',
      });
    }
  }
  return tools;
}

/** Why no helper can be used here, in words the operator can act on. */
export function clipboardUnavailableReason(ctx: ClipboardEnv): string {
  if (ctx.env.SSH_CONNECTION || ctx.env.SSH_TTY) {
    return 'this run is on a host reached over SSH, and the clipboard is on your own computer. Save the screenshot, copy it to this host and give its path, or paste a link to it';
  }
  if (ctx.platform === 'linux') {
    return ctx.env.WAYLAND_DISPLAY || ctx.env.DISPLAY
      ? 'reading an image from the clipboard needs wl-paste (wl-clipboard) or xclip, and neither is installed'
      : 'there is no desktop session here (no DISPLAY or WAYLAND_DISPLAY) to read a clipboard from';
  }
  return `reading an image from the clipboard is not supported on ${ctx.platform}. Save the screenshot and give its path`;
}

export interface RunResult {
  status: number | null;
  stdout: Buffer;
  stderr?: Buffer;
  /** Killed after TOOL_TIMEOUT_MS. */
  timedOut?: boolean;
}

export type RunTool = (command: string, args: string[]) => RunResult;

const TOOL_TIMEOUT_MS = 5000;

const defaultRun: RunTool = (command, args) => {
  const r = spawnSync(command, args, {
    timeout: TOOL_TIMEOUT_MS,
    maxBuffer: MAX_IMAGE_BYTES,
  });
  const timedOut =
    (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  return {
    status: r.status,
    stdout: r.stdout ?? Buffer.alloc(0),
    stderr: r.error && !timedOut ? Buffer.from(r.error.message) : r.stderr,
    timedOut,
  };
};

export function defaultClipboardEnv(): ClipboardEnv {
  return {
    platform: process.platform,
    env: process.env,
    has: (binary) =>
      spawnSync('which', [binary], { stdio: 'ignore' }).status === 0,
  };
}

export function isPng(bytes: Buffer): boolean {
  return bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC);
}

function readIfPresent(path: string): Buffer {
  try {
    return readFileSync(path);
  } catch {
    return Buffer.alloc(0);
  }
}

// What a helper prints when the clipboard simply has no image in it: the
// AppKit reader's own message, AppleScript's coercion failure (-1700), and
// pngpaste's "No PNG/TIFF/PDF data".
const NO_IMAGE_ERROR =
  /holds no image|\(-1700\)|can.t make|no (png|image)|no .*data found|nothing to paste/i;

const NO_IMAGE_REASON =
  'the clipboard holds no image. Copy the screenshot (not the file) and try again, or give a file path';

const MAC_SCREENSHOT_HINT =
  'On a Mac, Cmd+Ctrl+Shift+4 copies a screenshot to the clipboard; Cmd+Shift+4 saves it as a file instead, which you can drag in';

/** The first non-empty line of a helper's stderr, trimmed. */
function firstLine(bytes: Buffer | undefined): string {
  return (
    (bytes ?? Buffer.alloc(0))
      .toString('utf-8')
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? ''
  );
}

/**
 * Save the clipboard image to `dest` as PNG. On any failure nothing is left
 * at `dest`. A helper that FAILS (not authorized, timed out, crashed) is
 * named with its own error, so a broken helper is never reported as an empty
 * clipboard.
 */
export function readClipboardImage(
  dest: string,
  ctx: ClipboardEnv = defaultClipboardEnv(),
  run: RunTool = defaultRun,
): ClipboardImageResult {
  const tools = clipboardImageTools(ctx);
  if (tools.length === 0) {
    return { ok: false, reason: clipboardUnavailableReason(ctx) };
  }
  const failures: string[] = [];
  for (const tool of tools) {
    const result = run(tool.command, tool.args(dest));
    const bytes =
      tool.output === 'stdout' ? result.stdout : readIfPresent(dest);
    if (result.status === 0 && isPng(bytes)) {
      if (tool.output === 'stdout') writeFileSync(dest, bytes);
      return { ok: true, tool: tool.name, bytes: bytes.length };
    }
    rmSync(dest, { force: true });
    if (result.timedOut) {
      failures.push(
        `${tool.name}: no answer within ${TOOL_TIMEOUT_MS / 1000} s`,
      );
      continue;
    }
    const error = firstLine(result.stderr);
    if (result.status !== 0 && error && !NO_IMAGE_ERROR.test(error)) {
      failures.push(`${tool.name}: ${error}`);
    }
  }
  if (failures.length > 0) {
    return {
      ok: false,
      reason: `could not read the clipboard (${failures.join('; ')}). Save the screenshot and give its path instead`,
    };
  }
  return {
    ok: false,
    reason:
      ctx.platform === 'darwin'
        ? `${NO_IMAGE_REASON}. ${MAC_SCREENSHOT_HINT}`
        : NO_IMAGE_REASON,
  };
}

// ─── What is on the clipboard (without taking it) ───────────────────────────
//
// A Mac terminal sends NOTHING for Cmd+V when the clipboard holds an image or
// a copied file (there is no text to paste), so the evidence prompt cannot
// wait for a paste. Instead the run looks at the clipboard itself: once when
// a step starts, again when [e] opens and when ↵ is pressed. Something copied
// in between is what the operator is trying to paste.

export interface ClipboardProbe {
  /** Changes whenever the clipboard's content changes. */
  fingerprint: string;
  kind: 'image' | 'file' | 'other' | 'empty';
  /** kind 'file': the copied file's path. */
  path?: string;
}

// JXA, ASCII only. Finder puts a file REFERENCE url (file:///.file/id=…) on
// the clipboard, so the path comes from NSURL.filePathURL. A copied file
// also carries its icon as TIFF: the file wins over the image.
const MAC_PROBE_LINES = [
  'function run() {',
  "  ObjC.import('AppKit');",
  '  var pb = $.NSPasteboard.generalPasteboard;',
  '  var types = ObjC.deepUnwrap(pb.types) || [];',
  '  var path = null;',
  "  var u = pb.stringForType('public.file-url');",
  '  if (!u.isNil()) {',
  '    var url = $.NSURL.URLWithString(u);',
  '    if (!url.isNil()) {',
  '      var fileUrl = url.filePathURL;',
  '      if (!fileUrl.isNil()) path = ObjC.unwrap(fileUrl.path);',
  '    }',
  '  }',
  '  return JSON.stringify({ changeCount: pb.changeCount, types: types, path: path });',
  '}',
];

export function macProbeArgs(): string[] {
  return ['-l', 'JavaScript', ...MAC_PROBE_LINES.flatMap((l) => ['-e', l])];
}

const IMAGE_TYPES = new Set(['public.png', 'public.tiff', 'image/png']);

/** Parse what the macOS probe script prints. */
export function parseMacProbe(stdout: string): ClipboardProbe | undefined {
  let parsed: { changeCount?: unknown; types?: unknown; path?: unknown };
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return undefined;
  }
  if (typeof parsed?.changeCount !== 'number') return undefined;
  const types = Array.isArray(parsed.types) ? parsed.types.map(String) : [];
  const fingerprint = `mac:${parsed.changeCount}`;
  if (typeof parsed.path === 'string' && parsed.path)
    return { fingerprint, kind: 'file', path: parsed.path };
  if (types.some((t) => IMAGE_TYPES.has(t)))
    return { fingerprint, kind: 'image' };
  return { fingerprint, kind: types.length ? 'other' : 'empty' };
}

/** The first `file://` entry of a text/uri-list, as a path. */
export function fileFromUriList(text: string): string | undefined {
  const uri = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith('file://'));
  if (!uri) return undefined;
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}

export type RunToolAsync = (
  command: string,
  args: string[],
) => Promise<RunResult>;

const defaultRunAsync: RunToolAsync = (command, args) =>
  new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        encoding: 'buffer',
        timeout: TOOL_TIMEOUT_MS,
        maxBuffer: MAX_IMAGE_BYTES,
      },
      (error, stdout, stderr) => {
        const err = error as
          | (Error & { code?: unknown; killed?: boolean })
          | null;
        resolve({
          status: err ? (typeof err.code === 'number' ? err.code : null) : 0,
          stdout: stdout ?? Buffer.alloc(0),
          stderr,
          timedOut: !!err?.killed,
        });
      },
    );
  });

/**
 * Look at the clipboard without taking anything from it. Undefined where
 * there is no clipboard to look at (SSH, no helper, another platform) or the
 * helper failed: callers then behave as before.
 */
export async function probeClipboard(
  ctx: ClipboardEnv = defaultClipboardEnv(),
  run: RunToolAsync = defaultRunAsync,
): Promise<ClipboardProbe | undefined> {
  if (ctx.env.SSH_CONNECTION || ctx.env.SSH_TTY) return undefined;
  if (ctx.platform === 'darwin') {
    const r = await run('osascript', macProbeArgs());
    return r.status === 0
      ? parseMacProbe(r.stdout.toString('utf-8'))
      : undefined;
  }
  if (ctx.platform !== 'linux') return undefined;

  const read: ((type: string) => [string, string[]]) | undefined =
    ctx.env.WAYLAND_DISPLAY && ctx.has('wl-paste')
      ? (type) =>
          type === 'TARGETS'
            ? ['wl-paste', ['--list-types']]
            : ['wl-paste', ['--no-newline', '--type', type]]
      : ctx.env.DISPLAY && ctx.has('xclip')
        ? (type) => ['xclip', ['-selection', 'clipboard', '-t', type, '-o']]
        : undefined;
  if (!read) return undefined;
  const get = async (type: string): Promise<Buffer | undefined> => {
    const r = await run(...read(type));
    return r.status === 0 ? r.stdout : undefined;
  };

  const listed = await get('TARGETS');
  if (!listed) return { fingerprint: 'empty', kind: 'empty' };
  const types = listed
    .toString('utf-8')
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (types.includes('text/uri-list')) {
    const path = fileFromUriList(
      (await get('text/uri-list'))?.toString() ?? '',
    );
    if (path) return { fingerprint: `file:${path}`, kind: 'file', path };
  }
  if (types.includes('image/png')) {
    const bytes = await get('image/png');
    if (bytes && isPng(bytes))
      return {
        fingerprint: `image:${createHash('sha1').update(bytes).digest('hex')}`,
        kind: 'image',
      };
  }
  return { fingerprint: `other:${types.join(',')}`, kind: 'other' };
}

/**
 * The image or file copied since `before` was taken, if any. A probe that is
 * missing on either side (no clipboard, helper failed) offers nothing.
 */
export function copiedSince(
  before: ClipboardProbe | undefined,
  now: ClipboardProbe | undefined,
): ClipboardProbe | undefined {
  if (!before || !now) return undefined;
  if (now.kind !== 'image' && now.kind !== 'file') return undefined;
  return now.fingerprint !== before.fingerprint ? now : undefined;
}
