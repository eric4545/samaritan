import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';

const TSX = resolve('node_modules/.bin/tsx');
const CLI = resolve('src/cli/index.ts');

function init(cwd: string, ...args: string[]): string {
  return execFileSync(TSX, [CLI, 'init', ...args], { cwd, encoding: 'utf-8' });
}

describe('init: never overwrites existing files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'samaritan-init-'));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('creates missing files and keeps existing ones', () => {
    writeFileSync(join(dir, 'samaritan.config.yaml'), 'mine: true\n');
    writeFileSync(join(dir, '.gitignore'), 'dist/\n');

    const out = init(dir, '--existing');

    assert.ok(out.includes('Found existing: samaritan.config.yaml'), out);
    assert.strictEqual(
      readFileSync(join(dir, 'samaritan.config.yaml'), 'utf-8'),
      'mine: true\n',
    );
    const gitignore = readFileSync(join(dir, '.gitignore'), 'utf-8');
    assert.ok(gitignore.startsWith('dist/\n'), 'original lines kept');
    assert.ok(gitignore.includes('.samaritan/sessions/'), 'entries appended');
    assert.ok(
      readFileSync(join(dir, 'operations/example-deployment.yaml'), 'utf-8')
        .length > 0,
    );
  });

  it('is idempotent on a second run', () => {
    const example = join(dir, 'operations/example-deployment.yaml');
    writeFileSync(example, 'edited\n');
    const before = readFileSync(join(dir, '.gitignore'), 'utf-8');

    const out = init(dir, '--existing');

    assert.ok(!out.includes('Created: operations/example-deployment.yaml'));
    assert.strictEqual(readFileSync(example, 'utf-8'), 'edited\n');
    assert.strictEqual(readFileSync(join(dir, '.gitignore'), 'utf-8'), before);
  });
});
