import assert from 'node:assert';
import { describe, it } from 'node:test';
import { lintRunConfig } from '../../src/lib/run-config-lint';
import type { Operation } from '../../src/models/operation';
import { validateOperationSchema } from '../../src/validation/schema-validator';

/** Minimal operation: two envs, only `sbx` defines TICKET. */
function op(over: Partial<Operation> = {}): Operation {
  return {
    id: 'op',
    name: 'Tmux Name',
    version: '1.0.0',
    description: 'd',
    environments: [
      { name: 'sbx', description: 's' },
      { name: 'dev', description: 'd' },
    ],
    variables: { sbx: { TICKET: 'T-1' }, dev: {} },
    sessions: { work: {}, aux: {} },
    steps: [],
    metadata: { created_at: new Date(), updated_at: new Date() },
    ...over,
  } as Operation;
}

describe('lintRunConfig (validate run.tmux_session / run.default_session)', () => {
  const cases: Array<{
    name: string;
    operation: Operation;
    errors: RegExp[];
    warnings: RegExp[];
  }> = [
    {
      name: 'no run: block → nothing',
      operation: op(),
      errors: [],
      warnings: [],
    },
    {
      name: 'declared default + name resolvable in every env → clean',
      operation: op({
        common_variables: { TICKET: 'T-1' },
        run: { tmux_session: '${TICKET}-${ENV}', default_session: 'work' },
      }),
      errors: [],
      warnings: [],
    },
    {
      name: 'undeclared default_session → error listing the declared keys',
      operation: op({ run: { default_session: 'wrok' } }),
      errors: [
        /^run\.default_session "wrok" is not declared in sessions: \(declared: work, aux\)$/,
      ],
      warnings: [],
    },
    {
      name: 'default_session with no sessions: → error',
      operation: op({ sessions: undefined, run: { default_session: 'work' } }),
      errors: [/\(no sessions: defined\)$/],
      warnings: [],
    },
    {
      name: 'a var only one env defines → warns for the OTHER env only',
      operation: op({ run: { tmux_session: '${TICKET}-${ENV}' } }),
      errors: [],
      warnings: [/uses \$\{TICKET\} not defined for environment 'dev'/],
    },
    {
      name: 'tmux_session without sessions: → "no effect" warning only',
      operation: op({ sessions: undefined, run: { tmux_session: '${NOPE}' } }),
      errors: [],
      warnings: [/^run\.tmux_session has no effect without sessions:/],
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const { errors, warnings } = lintRunConfig(c.operation);
      assert.strictEqual(errors.length, c.errors.length, errors.join('\n'));
      assert.strictEqual(
        warnings.length,
        c.warnings.length,
        warnings.join('\n'),
      );
      c.errors.forEach((re, i) => {
        assert.match(errors[i], re);
      });
      c.warnings.forEach((re, i) => {
        assert.match(warnings[i], re);
      });
    });
  }
});

describe('schema: run.tmux_session / run.default_session', () => {
  const doc = (run: Record<string, unknown>) => ({
    name: 'n',
    version: '1.0.0',
    environments: [{ name: 'sbx' }],
    steps: [{ name: 's', type: 'manual', instruction: 'i' }],
    run,
  });

  it('accepts both fields', () => {
    assert.deepStrictEqual(
      validateOperationSchema(
        doc({ tmux_session: '${TICKET}-${ENV}', default_session: 'work' }),
      ),
      [],
    );
  });

  for (const field of ['tmux_session', 'default_session']) {
    it(`rejects an empty ${field}`, () => {
      assert.deepStrictEqual(
        validateOperationSchema(doc({ [field]: '' })).map((e) => e.field),
        [`/run/${field}`],
      );
    });
  }
});
