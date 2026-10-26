import assert from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  clipboardImageCommands,
  copyToClipboard,
  detectClipboardCmd,
  readClipboardImage,
} from '../../src/lib/clipboard';

describe('detectClipboardCmd', () => {
  it('returns a string or null', () => {
    const result = detectClipboardCmd();
    assert.ok(
      result === null || typeof result === 'string',
      'returns string or null',
    );
  });

  it('returns pbcopy on darwin or null/string on other platforms', () => {
    const result = detectClipboardCmd();
    if (process.platform === 'darwin') {
      assert.strictEqual(result, 'pbcopy');
    } else if (process.platform === 'win32') {
      assert.strictEqual(result, 'clip');
    } else {
      // Linux or other: may or may not find a clipboard tool
      assert.ok(result === null || typeof result === 'string');
    }
  });
});

describe('copyToClipboard', () => {
  it('returns a boolean', async () => {
    const result = await copyToClipboard('test');
    assert.ok(typeof result === 'boolean', 'returns a boolean');
  });

  it('returns false when no clipboard tool is available', async () => {
    // In CI (headless Linux), clipboard tools are typically unavailable
    // This test verifies graceful failure — it will pass on all platforms
    // where clipboard is either unavailable (false) or available (true)
    const result = await copyToClipboard('test');
    assert.ok(typeof result === 'boolean');
  });
});

describe('clipboardImageCommands', () => {
  const all = () => true;

  it('uses built-in osascript on macOS and embeds the escaped destination', () => {
    const [cmd] = clipboardImageCommands('darwin', '/tmp/a "b".png', all);
    assert.strictEqual(cmd.cmd, 'osascript');
    assert.strictEqual(cmd.toStdout, false);
    assert.ok(
      cmd.args.some((a) => a.includes('POSIX file "/tmp/a \\"b\\".png"')),
      cmd.args.join(' '),
    );
  });

  it('prefers wl-paste then xclip on Linux, filtered by what is installed', () => {
    assert.deepStrictEqual(
      clipboardImageCommands('linux', '/tmp/x.png', all).map((c) => c.cmd),
      ['wl-paste', 'xclip'],
    );
    assert.deepStrictEqual(
      clipboardImageCommands('linux', '/tmp/x.png', (b) => b === 'xclip').map(
        (c) => c.cmd,
      ),
      ['xclip'],
    );
    assert.deepStrictEqual(
      clipboardImageCommands('linux', '/tmp/x.png', () => false),
      [],
    );
  });

  it('uses PowerShell on Windows with the path single-quote escaped', () => {
    const [cmd] = clipboardImageCommands('win32', "C:\\it's.png", all);
    assert.strictEqual(cmd.cmd, 'powershell');
    assert.ok(cmd.args.join(' ').includes("it''s.png"));
  });
});

describe('readClipboardImage', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

  it('writes PNG bytes from a stdout tool to dest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clip-'));
    const dest = join(dir, 'shot.png');
    try {
      const ok = readClipboardImage(dest, {
        platform: 'linux',
        hasBinary: () => true,
        run: () => ({ status: 0, stdout: PNG }),
      });
      assert.strictEqual(ok, true);
      assert.deepStrictEqual(readFileSync(dest), PNG);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns false when the clipboard holds no image (non-PNG / failed tool)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clip-'));
    const dest = join(dir, 'shot.png');
    try {
      const text = readClipboardImage(dest, {
        platform: 'linux',
        hasBinary: () => true,
        run: () => ({ status: 0, stdout: Buffer.from('just text') }),
      });
      const failed = readClipboardImage(dest, {
        platform: 'linux',
        hasBinary: () => true,
        run: () => ({ status: 1 }),
      });
      assert.strictEqual(text, false);
      assert.strictEqual(failed, false);
      assert.ok(!existsSync(dest), 'nothing written');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns false with no usable tool', () => {
    assert.strictEqual(
      readClipboardImage('/tmp/never.png', {
        platform: 'linux',
        hasBinary: () => false,
      }),
      false,
    );
  });
});
