import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  collectUnresolvedVars,
  hasUnresolvedVars,
  resolveVars,
  resolveVarsSafe,
} from '../../src/lib/variable-resolver';
import type { Operation, RollbackPlan, Step } from '../../src/models/operation';

describe('resolveVars', () => {
  it('replaces ${VAR} from context', () => {
    assert.strictEqual(
      resolveVars('kubectl scale --replicas=${REPLICAS}', { REPLICAS: '3' }),
      'kubectl scale --replicas=3',
    );
  });

  it('resolves multiple vars in one string', () => {
    assert.strictEqual(
      resolveVars('ssh ${PREFIX}$USER@access.${ENV}.example.com', {
        PREFIX: 'admin-',
        ENV: 'dev',
      }),
      'ssh admin-$USER@access.dev.example.com',
    );
  });

  it('leaves $VAR (no braces) untouched for shell vars', () => {
    const result = resolveVars('echo $HOME and ${OP_VAR}', { OP_VAR: 'hello' });
    assert.ok(result.includes('$HOME'), 'Shell $HOME must stay untouched');
    assert.ok(result.includes('hello'), '${OP_VAR} must be resolved');
  });

  it('throws with a clear error listing unresolved ${VAR}', () => {
    assert.throws(
      () =>
        resolveVars('deploy to ${ENV} with key ${MISSING}', { ENV: 'prod' }),
      (err: Error) => {
        assert.ok(
          err.message.includes('MISSING'),
          'Error must name the missing var',
        );
        return true;
      },
    );
  });

  it('throws listing ALL unresolved vars', () => {
    assert.throws(
      () => resolveVars('${A} and ${B}', {}),
      (err: Error) => {
        assert.ok(err.message.includes('A'), 'Must list A');
        assert.ok(err.message.includes('B'), 'Must list B');
        return true;
      },
    );
  });

  it('returns unchanged string when no ${VAR} patterns present', () => {
    const input = 'kubectl get pods -n staging';
    assert.strictEqual(resolveVars(input, {}), input);
  });

  it('leaves shell parameter expansions (${X:?}, ${X:-…}) untouched without throwing', () => {
    const result = resolveVars(
      'kubectl delete "${POD:?no pod}" --region ${REGION:-us-east-1} in ${ENV}',
      { ENV: 'prod' },
    );
    assert.ok(result.includes('${POD:?no pod}'), '${POD:?} is a shell guard');
    assert.ok(result.includes('${REGION:-us-east-1}'), '${REGION:-} is shell');
    assert.ok(result.includes('in prod'), '${ENV} must still resolve');
  });
});

describe('resolveVarsSafe', () => {
  it('resolves known vars, leaves unknown as-is without throwing', () => {
    const result = resolveVarsSafe('${KNOWN} and ${UNKNOWN}', { KNOWN: 'yes' });
    assert.ok(result.includes('yes'), 'Known var must be resolved');
    assert.ok(result.includes('${UNKNOWN}'), 'Unknown var must stay as-is');
  });
});

describe('hasUnresolvedVars', () => {
  it('returns true when ${VAR} present and not in context', () => {
    assert.strictEqual(hasUnresolvedVars('${MISSING}', {}), true);
  });

  it('returns false when all ${VAR} resolved', () => {
    assert.strictEqual(hasUnresolvedVars('${ENV}', { ENV: 'prod' }), false);
  });

  it('returns false for plain strings with no vars', () => {
    assert.strictEqual(hasUnresolvedVars('kubectl get pods', {}), false);
  });

  it('returns false for shell parameter expansions like ${X:?}', () => {
    assert.strictEqual(hasUnresolvedVars('echo "${X:?unset}"', {}), false);
  });
});

describe('collectUnresolvedVars', () => {
  const step = (overrides: Partial<Step>): Step => ({
    name: 'step',
    type: 'manual',
    ...overrides,
  });

  it('returns [] when every ${VAR} in steps/rollback is already resolved', () => {
    const operation: Pick<Operation, 'steps' | 'rollback'> = {
      steps: [step({ command: 'echo ${ENV}' })],
      rollback: { steps: [step({ command: 'echo ${ENV}' })] } as RollbackPlan,
    };
    assert.deepStrictEqual(
      collectUnresolvedVars(operation, { ENV: 'prod' }),
      [],
    );
  });

  it('finds a var referenced only in command/instruction/expect', () => {
    const operation: Pick<Operation, 'steps' | 'rollback'> = {
      steps: [
        step({
          command: 'echo ${CMD_VAR}',
          instruction: 'Do ${INSTR_VAR}',
          expect: { contains: '${EXPECT_VAR}' },
        }),
      ],
    };
    const missing = collectUnresolvedVars(operation, {});
    assert.ok(missing.includes('CMD_VAR'));
    assert.ok(missing.includes('INSTR_VAR'));
    assert.ok(missing.includes('EXPECT_VAR'));
  });

  it('finds a var referenced only inside nested sub_steps and operation-level rollback (incl. nested rollback sub_steps)', () => {
    const operation: Pick<Operation, 'steps' | 'rollback'> = {
      steps: [
        step({
          sub_steps: [step({ command: 'echo ${SUB_STEP_VAR}' })],
        }),
      ],
      rollback: {
        steps: [
          {
            name: 'rollback',
            command: 'echo ${ROLLBACK_VAR}',
            sub_steps: [
              { name: 'nested', command: 'echo ${NESTED_ROLLBACK_VAR}' },
            ],
          },
        ],
      },
    };
    const missing = collectUnresolvedVars(operation, {});
    assert.ok(missing.includes('SUB_STEP_VAR'));
    assert.ok(missing.includes('ROLLBACK_VAR'));
    assert.ok(missing.includes('NESTED_ROLLBACK_VAR'));
  });

  it('dedups repeats and preserves order of first appearance', () => {
    const operation: Pick<Operation, 'steps' | 'rollback'> = {
      steps: [
        step({ command: 'echo ${B} and ${A}' }),
        step({ command: 'echo ${A} and ${C}' }),
      ],
    };
    assert.deepStrictEqual(collectUnresolvedVars(operation, {}), [
      'B',
      'A',
      'C',
    ]);
  });
});
