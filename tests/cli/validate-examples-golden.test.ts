import assert from 'node:assert';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { OperationValidator } from '../../src/cli/commands/validate';

/**
 * Golden record of `validate` over every example operation: whether it
 * passes (the exit code) and how many errors it reports. Lint rules feed
 * `validate` as warnings only, so adding or changing a rule must never
 * change this file. Regenerate deliberately with
 * `SAMARITAN_UPDATE_GOLDEN=1 npx tsx --test tests/cli/validate-examples-golden.test.ts`.
 */
const GOLDEN = 'tests/cli/validate-examples.golden.json';
const NOT_OPERATIONS = [
  'examples/postmortems',
  'examples/common',
  'examples/environments',
  'examples/templates',
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

describe('validate over examples/: golden exit status', () => {
  it('matches the committed golden file', async () => {
    const actual: Record<string, { valid: boolean; errors: number }> = {};
    const log = console.log;
    console.log = () => {};
    try {
      for (const file of exampleOperations()) {
        const result = await new OperationValidator().validateFileAndGroups(
          file,
          {},
        );
        actual[file] = { valid: result.valid, errors: result.errors.length };
      }
    } finally {
      console.log = log;
    }
    if (process.env.SAMARITAN_UPDATE_GOLDEN) {
      writeFileSync(GOLDEN, `${JSON.stringify(actual, null, 2)}\n`);
    }
    assert.deepStrictEqual(
      actual,
      JSON.parse(readFileSync(join(GOLDEN), 'utf8')),
    );
  });
});
