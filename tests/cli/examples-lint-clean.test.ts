import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Every shipped example is copy-ready: `samaritan lint` (default rules)
 * reports nothing, including inside the files they include with `uses:`.
 * A finding that is right but cannot be fixed takes a reasoned
 * `# samaritan-lint-disable-next-line <rule> -- <why>` comment.
 */
const NOT_OPERATIONS = [
  'examples/templates',
  'examples/common',
  'examples/environments',
  'examples/postmortems',
  'examples/lint/presets',
];

function exampleOperations(dir = 'examples'): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = `${dir}/${name}`;
      if (statSync(path).isDirectory()) {
        return NOT_OPERATIONS.includes(path) ? [] : exampleOperations(path);
      }
      return name.endsWith('.yaml') && name !== 'samaritan.config.yaml'
        ? [path]
        : [];
    });
}

describe('examples/ are lint-clean', () => {
  it('samaritan lint reports no problem in any example', () => {
    const files = exampleOperations();
    const result = spawnSync(
      join('node_modules', '.bin', 'tsx'),
      ['src/cli/index.ts', 'lint', ...files],
      { encoding: 'utf8', timeout: 120_000 },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /No problems in \d+ file\(s\)/);
  });
});
