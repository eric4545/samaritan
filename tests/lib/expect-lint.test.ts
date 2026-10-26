import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  findShellVarRefs,
  formatExpectShellVarFinding,
  lintExpectShellVars,
} from '../../src/lib/expect-lint';
import type { Operation } from '../../src/models/operation';

function op(partial: Partial<Operation>): Operation {
  return {
    id: 'op',
    name: 'op',
    version: '1.0.0',
    description: '',
    environments: [{ name: 'dev' }],
    variables: { dev: {} },
    steps: [],
    ...partial,
  } as Operation;
}

describe('findShellVarRefs', () => {
  it('finds bare $NAME but not ${NAME}', () => {
    assert.deepStrictEqual(findShellVarRefs('$USER and ${HOME} and $USER'), [
      'USER',
    ]);
    assert.deepStrictEqual(findShellVarRefs('^ok$'), []);
  });
});

describe('lintExpectShellVars', () => {
  it('flags $USER in expect.contains (it is compared literally)', () => {
    const findings = lintExpectShellVars(
      op({
        steps: [
          {
            name: 'who',
            type: 'manual',
            command: 'echo $USER',
            expect: { contains: '$USER' },
          } as any,
        ],
      }),
    );
    assert.deepStrictEqual(findings, [
      { stepName: 'who', field: 'contains', name: 'USER' },
    ]);
    assert.match(
      formatExpectShellVarFinding(findings[0]),
      /"\$USER" is compared literally/,
    );
  });

  it('covers shorthand, arrays, sub-steps and rollback steps', () => {
    const findings = lintExpectShellVars(
      op({
        steps: [
          {
            name: 'parent',
            type: 'manual',
            sub_steps: [{ name: 'child', type: 'manual', expect: '$A' } as any],
            rollback: [{ command: 'x', expect: [{ matches: '$B' }] }],
          } as any,
        ],
        rollback: { steps: [{ command: 'y', expect: { equals: '$C' } }] },
      }),
    );
    assert.deepStrictEqual(
      findings.map((f) => `${f.stepName}:${f.field}:${f.name}`),
      ['child:contains:A', '(rollback):matches:B', '(rollback):equals:C'],
    );
  });

  it('does not flag $NAME that is an operation or step variable (resolved at verify)', () => {
    const findings = lintExpectShellVars(
      op({
        common_variables: { REGION: 'us' },
        variables: { dev: { CLUSTER: 'c1' } },
        steps: [
          {
            name: 's',
            type: 'manual',
            variables: { POD: 'web-0' },
            expect: { contains: '$REGION $CLUSTER $POD' },
          } as any,
        ],
      }),
    );
    assert.deepStrictEqual(findings, []);
  });
});
