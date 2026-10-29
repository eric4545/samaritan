import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Per-operator preferences remembered across runs, in
 * `~/.samaritan/preferences.json` (dir 0700, file 0600 — same private home as
 * sessions/pipes/panes). Only answers the operator explicitly gave (e.g. `[a]`
 * "don't ask again") are written here; deleting the file restores defaults.
 */
export interface UserPreferences {
  /** `false` = paste multi-line commands with `[p]` without the bracketed-paste confirm. */
  confirm_multiline_paste?: boolean;
  [key: string]: unknown;
}

export function preferencesPath(home: string = homedir()): string {
  return join(home, '.samaritan', 'preferences.json');
}

/** Read preferences; a missing, unreadable or malformed file is `{}`. */
export function readPreferences(home: string = homedir()): UserPreferences {
  const path = preferencesPath(home);
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as UserPreferences)
      : {};
  } catch {
    return {};
  }
}

/** Set one preference, keeping the rest. Written atomically (tmp + rename). */
export function setPreference<K extends keyof UserPreferences>(
  key: K,
  value: UserPreferences[K],
  home: string = homedir(),
): void {
  const path = preferencesPath(home);
  mkdirSync(join(home, '.samaritan'), { recursive: true, mode: 0o700 });
  const next = { ...readPreferences(home), [key]: value };
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}
