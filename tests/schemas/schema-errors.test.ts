import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import {
  formatValidationError,
  validateOperationSchema,
} from '../../src/validation/schema-validator';
import { getFixturePath } from '../fixtures/fixtures';

// Regression for #118: one wrong value inside a step failed every branch of
// the step `oneOf`, so validate printed six lines led by the unrelated
// "must have required property 'uses'", and generate/run printed only
// "Schema validation failed" with no field at all.

const base = {
  name: 'T',
  version: '1.0.0',
  description: 'd',
  environments: [{ name: 'sbx', description: 's' }],
};

function errorsFor(steps: unknown[]): string[] {
  return validateOperationSchema({ ...base, steps }).map(formatValidationError);
}

describe('schema errors name the offending field (#118)', () => {
  it('reports only the wrong-typed expect field, with step name and value', () => {
    const errors = errorsFor([
      {
        name: 'Step A',
        type: 'manual',
        command: 'echo a',
        expect: { any_line_contains: 123 },
      },
    ]);
    assert.deepStrictEqual(errors, [
      'steps[0] "Step A" → expect.any_line_contains: must be string (got number 123)',
    ]);
  });

  it('keeps a real missing required field next to a deeper error', () => {
    const errors = errorsFor([
      { name: 'A', command: 'echo a', expect: { contains: 5 } },
    ]);
    assert.deepStrictEqual(errors, [
      `steps[0] "A": must have required property 'type'`,
      'steps[0] "A" → expect.contains: must be string (got number 5)',
    ]);
  });

  it('a uses: step reports its own branch, not name/type', () => {
    assert.deepStrictEqual(errorsFor([{ uses: './t.yaml', with: 5 }]), [
      'steps[0].with: must be object (got number 5)',
    ]);
  });

  it('keeps errors inside an expect list (shared $ref with the object branch)', () => {
    assert.deepStrictEqual(
      errorsFor([
        {
          name: 'A',
          type: 'manual',
          expect: [{ contains: 'ok' }, { nope: 1 }],
        },
      ]),
      [`steps[0] "A" → expect[1]: must NOT have additional properties: 'nope'`],
    );
  });

  it('reaches into sub_steps and rollback', () => {
    assert.deepStrictEqual(
      errorsFor([
        {
          name: 'A',
          type: 'manual',
          sub_steps: [
            { name: 'A1', type: 'manual', expect: [{ contains: 1 }] },
          ],
          rollback: { command: 5 },
        },
      ]),
      [
        'steps[0] "A" → sub_steps[0].expect[0].contains: must be string (got number 1)',
        'steps[0] "A" → rollback.command: must be string (got number 5)',
      ],
    );
  });

  it('keeps the oneOf error when no branch can be singled out', () => {
    // Neither `uses` nor name/type present: nothing to prune against.
    const errors = errorsFor([{ command: 'echo a' }]);
    assert.ok(errors.length > 0);
    assert.ok(errors.some((e) => /uses/.test(e)));
    assert.ok(errors.some((e) => /'name'/.test(e)));
  });
});

const CLI = 'node_modules/.bin/tsx';
const INDEX = 'src/cli/index.ts';
const FIELD_LINE =
  'steps[0] "Check pods" → expect.any_line_contains: must be string (got number 123)';

function cli(args: string[]): string {
  const r = spawnSync(CLI, [INDEX, ...args], {
    encoding: 'utf8',
    timeout: 20_000,
    input: '',
  });
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
}

describe('every command prints the field, not just validate (#118)', () => {
  const file = getFixturePath('expectShapeMismatch');

  it('validate: one error line, no oneOf noise', () => {
    const out = cli(['validate', file]);
    assert.ok(out.includes(FIELD_LINE), out);
    assert.ok(!out.includes("required property 'uses'"), out);
    assert.ok(!out.includes('must match exactly one schema'), out);
  });

  for (const args of [
    ['generate', 'manual', file],
    ['generate', 'manual', file, '--env', 'staging'],
    ['run', file, '--env', 'staging'],
  ]) {
    it(args.filter((a) => a !== file).join(' '), () => {
      const out = cli(args);
      assert.match(out, /Schema validation failed/);
      assert.ok(out.includes(FIELD_LINE), out);
    });
  }
});
