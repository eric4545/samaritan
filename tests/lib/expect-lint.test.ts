import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  findShellVarRefs,
  formatExpectMatchFinding,
  formatExpectShellVarFinding,
  lintExpectMatches,
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

describe('lintExpectMatches', () => {
  it('flags expect.contains text that also appears in the command (self-match)', () => {
    const findings = lintExpectMatches(
      op({
        steps: [
          {
            name: 'Build',
            type: 'manual',
            command: 'npm run build && ls -la dist/main.js',
            expect: { contains: 'dist/main.js' },
          },
        ],
      }),
    );
    assert.deepStrictEqual(findings, [
      {
        stepName: 'Build',
        field: 'contains',
        value: 'dist/main.js',
        kind: 'self-match',
      },
    ]);
    assert.match(formatExpectMatchFinding(findings[0]), /echoed command/);
  });

  it('covers the string shorthand, arrays, any_line_contains, sub-steps and rollback entries', () => {
    const findings = lintExpectMatches(
      op({
        steps: [
          {
            name: 'Parent',
            type: 'manual',
            sub_steps: [
              {
                name: 'Child',
                type: 'manual',
                command: 'grep READY status.txt',
                expect: 'READY',
              },
            ],
            rollback: [
              {
                name: 'Undo',
                command: 'kubectl get pods | grep web',
                expect: [{ any_line_contains: 'web' }, { contains: 'Running' }],
              },
            ],
          } as any,
        ],
      }),
    );
    assert.deepStrictEqual(
      findings.map((f) => `${f.stepName}:${f.field}:${f.value}`),
      ['Child:contains:READY', 'Undo:any_line_contains:web'],
    );
  });

  it('does not flag expect text that is absent from the command', () => {
    const findings = lintExpectMatches(
      op({
        steps: [
          {
            name: 'Status',
            type: 'manual',
            command: 'kubectl get deployment web-server -n web-staging',
            expect: { contains: '3/3' },
          },
        ],
      }),
    );
    assert.deepStrictEqual(findings, []);
  });

  it('flags a bare short number in contains (2 also matches 12 and 20)', () => {
    const findings = lintExpectMatches(
      op({
        steps: [
          {
            name: 'Count',
            type: 'manual',
            command:
              'kubectl get deploy web -o jsonpath={.status.readyReplicas}',
            expect: { contains: 2 as unknown as string },
          },
        ],
      }),
    );
    assert.deepStrictEqual(findings, [
      { stepName: 'Count', field: 'contains', value: '2', kind: 'bare-number' },
    ]);
    assert.match(formatExpectMatchFinding(findings[0]), /\\b2\\b/);
  });

  it('does not flag a number that is part of longer text', () => {
    const findings = lintExpectMatches(
      op({
        steps: [
          {
            name: 'Count',
            type: 'manual',
            command: 'echo',
            expect: { contains: 'replicas: 2' },
          },
        ],
      }),
    );
    assert.deepStrictEqual(findings, []);
  });
});
