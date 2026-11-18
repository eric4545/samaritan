import assert from 'node:assert';
import { describe, it } from 'node:test';
import { defaultLintConfig } from '../../src/lib/lint/config';
import { lintOperation } from '../../src/lib/lint/engine';
import { parseOperation } from '../../src/operations/parser';
import { getFixturePath } from '../fixtures/fixtures';

const FILE = getFixturePath('lintSuppression');
const USES_FILE = FILE.replace(
  'lint-suppression.yaml',
  'lint-suppression-steps.yaml',
);

async function findings() {
  return lintOperation(await parseOperation(FILE), {
    operationFile: FILE,
    config: defaultLintConfig(),
  });
}

describe('lint positions and suppression comments', () => {
  it('reports file:line:col, a multi-line command at its own line', async () => {
    const exits = (await findings()).filter(
      (f) => f.ruleId === 'shell/exit-verbs',
    );
    assert.deepStrictEqual(
      exits.map((f) => [
        f.location?.file,
        f.location?.line,
        f.location?.column,
      ]),
      [
        [FILE, 19, 7], // `exit 1`, second line of a `command: |` block
        [FILE, 39, 7], // a `#` line inside the block is shell, not a directive
        [FILE, 43, 14], // another rule's directive does not apply
        [FILE, 54, 14], // foreach copy 1, at the authored entry
        [FILE, 54, 14], // foreach copy 2
        [USES_FILE, 6, 5], // a step from a `uses:` file, in that file
      ],
    );
  });

  it('honours disable (step + sub-steps), disable-next-line above the key, disable-line', async () => {
    const lines = (await findings())
      .filter((f) => f.location?.file === FILE)
      .map((f) => f.location?.line);
    for (const suppressed of [14, 23, 27, 31, 34]) {
      assert.ok(
        !lines.includes(suppressed),
        `line ${suppressed} should be suppressed`,
      );
    }
  });

  it('scopes a disable above the first sequence item to that item only', async () => {
    const names = (await findings()).map((f) => f.message);
    assert.ok(!names.some((m) => m.includes('First step')));
    assert.ok(names.some((m) => m.includes('Multi-line')));
  });

  it('applies directives in a uses: file to that file', async () => {
    const usesLines = (await findings())
      .filter((f) => f.location?.file === USES_FILE)
      .map((f) => f.location?.line);
    assert.deepStrictEqual(usesLines, [6]);
  });

  it('reports a directive naming an unknown rule', async () => {
    const bad = (await findings()).filter(
      (f) => f.ruleId === 'lint/invalid-directive',
    );
    assert.strictEqual(bad.length, 1);
    assert.deepStrictEqual(bad[0].location, {
      file: FILE,
      line: 46,
      column: 5,
    });
    assert.match(bad[0].message, /no\/such-rule/);
  });
});

describe('lint suppression: whole file', () => {
  it('a disable comment before the first key covers the whole file', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const file = join(
      mkdtempSync(join(tmpdir(), 'samaritan-disable-')),
      'op.yaml',
    );
    writeFileSync(
      file,
      `# samaritan-lint-disable shell/exit-verbs
name: whole-file
version: 1.0.0
description: x
environments: [{ name: staging, description: s }]
steps:
  - name: A
    type: manual
    command: exit 1
  - name: B
    type: manual
    sub_steps:
      - name: C
        type: manual
        command: exit 2
`,
    );
    const found = lintOperation(await parseOperation(file), {
      operationFile: file,
      config: defaultLintConfig(),
    }).filter((f) => f.ruleId === 'shell/exit-verbs');
    assert.deepStrictEqual(found, []);
  });
});
