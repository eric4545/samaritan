import assert from 'node:assert';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * `npm test` runs `tsx --test tests/**\/*.test.ts` through `sh`, where `**`
 * means `*`: only `tests/<dir>/<name>.test.ts` is reached. A test file one
 * level deeper silently never runs (in CI either), which once hid a whole
 * suite. Keep test files at that depth.
 */
function testFiles(dir: string, depth = 0): { path: string; depth: number }[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === 'fixtures' ? [] : testFiles(path, depth + 1);
    }
    return name.endsWith('.test.ts') ? [{ path, depth }] : [];
  });
}

describe('test layout', () => {
  it('every *.test.ts is where the npm test glob reaches it', () => {
    const unreachable = testFiles('tests')
      .filter((f) => f.depth !== 1)
      .map((f) => f.path);
    assert.deepStrictEqual(unreachable, []);
  });
});
