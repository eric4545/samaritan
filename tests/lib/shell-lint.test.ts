import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  formatFinding,
  isShellcheckAvailable,
  lintOperationCommands,
  parseShellcheckJson,
} from '../../src/lib/shell-lint';
import type { Operation } from '../../src/models/operation';

// A representative `shellcheck -f json -` payload (SC2086 on an unquoted var).
const SAMPLE_JSON = JSON.stringify([
  {
    file: '-',
    line: 1,
    endLine: 1,
    column: 4,
    endColumn: 9,
    level: 'info',
    code: 2086,
    message: 'Double quote to prevent globbing and word splitting.',
    fix: null,
  },
  {
    file: '-',
    line: 2,
    endLine: 2,
    column: 1,
    endColumn: 3,
    level: 'warning',
    code: 2164,
    message: 'Use cd ... || exit in case cd fails.',
    fix: null,
  },
]);

describe('parseShellcheckJson', () => {
  it('maps shellcheck JSON comments to annotated findings', () => {
    const findings = parseShellcheckJson(SAMPLE_JSON, 'Deploy', 'command');
    assert.strictEqual(findings.length, 2);
    assert.deepStrictEqual(findings[0], {
      stepName: 'Deploy',
      source: 'command',
      line: 1,
      level: 'info',
      code: 2086,
      message: 'Double quote to prevent globbing and word splitting.',
    });
    assert.strictEqual(findings[1].code, 2164);
    assert.strictEqual(findings[1].level, 'warning');
  });

  it('returns [] for empty, blank, invalid, or non-array input', () => {
    assert.deepStrictEqual(parseShellcheckJson('', 'S', 'command'), []);
    assert.deepStrictEqual(parseShellcheckJson('   ', 'S', 'command'), []);
    assert.deepStrictEqual(parseShellcheckJson('not json', 'S', 'command'), []);
    assert.deepStrictEqual(parseShellcheckJson('{"a":1}', 'S', 'command'), []);
  });
});

describe('formatFinding', () => {
  it('renders a single readable line with the SC code', () => {
    const line = formatFinding({
      stepName: 'Deploy',
      source: 'script',
      line: 7,
      level: 'warning',
      code: 2086,
      message: 'Double quote to prevent globbing.',
    });
    assert.strictEqual(
      line,
      'step "Deploy" (script) line 7: [SC2086] Double quote to prevent globbing.',
    );
  });
});

describe('isShellcheckAvailable', () => {
  it('returns a boolean without throwing', () => {
    assert.strictEqual(typeof isShellcheckAvailable(), 'boolean');
  });
});

describe('lintOperationCommands (integration)', () => {
  const available = isShellcheckAvailable();

  it(
    'flags an unquoted variable in an inline command',
    { skip: available ? false : 'shellcheck not installed' },
    () => {
      const operation = {
        steps: [
          { name: 'Bad', type: 'automatic', command: 'rm -rf $TARGET_DIR' },
          { name: 'NoCmd', type: 'manual', instruction: 'do it' },
        ],
      } as unknown as Operation;

      const findings = lintOperationCommands(operation, 'examples/op.yaml');
      assert.ok(
        findings.some((f) => f.code === 2086 && f.stepName === 'Bad'),
        'should report SC2086 for the unquoted variable',
      );
    },
  );
});
