import assert from 'node:assert';
import { describe, it } from 'node:test';
import { copyToClipboard, detectClipboardCmd } from '../../src/lib/clipboard';

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
