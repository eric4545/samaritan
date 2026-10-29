import assert from 'node:assert';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  preferencesPath,
  readPreferences,
  setPreference,
} from '../../src/lib/user-preferences';

describe('user preferences (~/.samaritan/preferences.json)', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'sam-prefs-'));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it('returns {} when no file exists', () => {
    assert.deepStrictEqual(readPreferences(home), {});
  });

  it('persists a preference so a later run reads it back', () => {
    setPreference('confirm_multiline_paste', false, home);
    assert.deepStrictEqual(readPreferences(home), {
      confirm_multiline_paste: false,
    });
    const path = preferencesPath(home);
    assert.strictEqual(statSync(path).mode & 0o777, 0o600);
    assert.strictEqual(statSync(join(home, '.samaritan')).mode & 0o777, 0o700);
    assert.match(
      readFileSync(path, 'utf8'),
      /"confirm_multiline_paste": false/,
    );
  });

  it('merges with keys already on disk', () => {
    setPreference('confirm_multiline_paste', false, home);
    const path = preferencesPath(home);
    const onDisk = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...onDisk, other: 1 }));
    setPreference('confirm_multiline_paste', true, home);
    assert.deepStrictEqual(readPreferences(home), {
      confirm_multiline_paste: true,
      other: 1,
    });
  });

  it('treats a corrupt or non-object file as empty (never throws)', () => {
    setPreference('confirm_multiline_paste', false, home);
    writeFileSync(preferencesPath(home), '{not json');
    assert.deepStrictEqual(readPreferences(home), {});
    writeFileSync(preferencesPath(home), '[1,2]');
    assert.deepStrictEqual(readPreferences(home), {});
  });
});
