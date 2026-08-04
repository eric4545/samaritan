import assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runMockExpect } from '../../src/lib/mock-run';
import type { Operation, Step } from '../../src/models/operation';

function makeOperation(
  steps: Step[],
  variables: Record<string, any> = {},
): Operation {
  return {
    id: 'mock-op',
    name: 'Mock Op',
    version: '1.0.0',
    description: 'mock',
    environments: [
      {
        name: 'staging',
        description: 'staging',
        variables,
        restrictions: [],
        approval_required: false,
        validation_required: false,
      },
    ],
    variables: { staging: variables },
    steps,
    metadata: {
      created_at: new Date(),
      updated_at: new Date(),
      execution_count: 0,
    },
  } as unknown as Operation;
}

describe('runMockExpect', () => {
  it('passes when expect matches the captured evidence output', () => {
    const op = makeOperation([
      {
        name: 'Deploy',
        type: 'automatic',
        command: 'kubectl apply -f d.yaml',
        expect: { any_line_contains: 'Running' },
        evidence: {
          required: true,
          results: {
            staging: [
              { type: 'command_output', content: 'pod/web-0  1/1  Running' },
            ],
          },
        },
      } as Step,
    ]);

    const result = runMockExpect(op, 'staging', '/tmp');
    assert.strictEqual(result.passed, 1);
    assert.strictEqual(result.failed, 0);
    assert.strictEqual(result.results[0].status, 'pass');
  });

  it('fails when expect does not match the captured output', () => {
    const op = makeOperation([
      {
        name: 'Deploy',
        type: 'automatic',
        expect: { contains: 'Succeeded' },
        evidence: {
          results: {
            staging: [{ type: 'command_output', content: 'CrashLoopBackOff' }],
          },
        },
      } as Step,
    ]);

    const result = runMockExpect(op, 'staging', '/tmp');
    assert.strictEqual(result.failed, 1);
    assert.strictEqual(result.results[0].status, 'fail');
    assert.strictEqual(result.results[0].detailed?.pass, false);
  });

  it('skips a step that has expect but no evidence for the environment', () => {
    const op = makeOperation([
      {
        name: 'NoEvidence',
        type: 'automatic',
        expect: { contains: 'ok' },
      } as Step,
    ]);

    const result = runMockExpect(op, 'staging', '/tmp');
    assert.strictEqual(result.skipped, 1);
    assert.strictEqual(result.results[0].status, 'skipped');
    assert.match(result.results[0].reason ?? '', /no command_output\/log/);
  });

  it('ignores steps without an expect', () => {
    const op = makeOperation([
      { name: 'Plain', type: 'manual', instruction: 'do it' } as Step,
    ]);
    const result = runMockExpect(op, 'staging', '/tmp');
    assert.strictEqual(result.results.length, 0);
  });

  it('resolves ${VAR} in expect against the environment variables', () => {
    const op = makeOperation(
      [
        {
          name: 'Replicas',
          type: 'automatic',
          expect: { contains: '${MIN}/${MIN}' },
          evidence: {
            results: {
              staging: [{ type: 'command_output', content: 'web 3/3 ready' }],
            },
          },
        } as Step,
      ],
      { MIN: 3 },
    );

    const result = runMockExpect(op, 'staging', '/tmp');
    assert.strictEqual(result.results[0].status, 'pass');
    // The resolved expect should show 3/3, not ${MIN}/${MIN}.
    assert.deepStrictEqual(result.results[0].expect, { contains: '3/3' });
  });

  it('reads evidence output from a file reference', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mock-run-'));
    try {
      writeFileSync(
        join(dir, 'out.log'),
        'deployment created\nAll pods Running\n',
      );
      const op = makeOperation([
        {
          name: 'FromFile',
          type: 'automatic',
          expect: { contains: 'All pods Running' },
          evidence: {
            results: {
              staging: [{ type: 'log', file: './out.log' }],
            },
          },
        } as Step,
      ]);

      const result = runMockExpect(op, 'staging', dir);
      assert.strictEqual(result.results[0].status, 'pass');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('evaluates sub-steps recursively', () => {
    const op = makeOperation([
      {
        name: 'Parent',
        type: 'manual',
        sub_steps: [
          {
            name: 'Child',
            type: 'automatic',
            expect: { contains: 'done' },
            evidence: {
              results: {
                staging: [{ type: 'command_output', content: 'done' }],
              },
            },
          },
        ],
      } as Step,
    ]);
    const result = runMockExpect(op, 'staging', '/tmp');
    assert.strictEqual(result.passed, 1);
    assert.strictEqual(result.results[0].stepName, 'Child');
  });
});

describe('runMockExpect: when-gate environment filtering', () => {
  function makeMultiEnvOperation(steps: Step[]): Operation {
    return {
      id: 'when-op',
      name: 'When Op',
      version: '1.0.0',
      description: 'when filter test',
      environments: [
        {
          name: 'dev',
          description: 'dev',
          variables: {},
          restrictions: [],
          approval_required: false,
          validation_required: false,
        },
        {
          name: 'stg',
          description: 'stg',
          variables: {},
          restrictions: [],
          approval_required: false,
          validation_required: false,
        },
      ],
      variables: { dev: {}, stg: {} },
      steps,
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
        execution_count: 0,
      },
    } as unknown as Operation
  }

  it('skips a when: [dev] step when the target environment is stg', () => {
    const op = makeMultiEnvOperation([
      {
        name: 'Dev Only',
        type: 'automatic',
        when: ['dev'],
        expect: { contains: 'ok' },
        evidence: {
          results: {
            stg: [{ type: 'command_output', content: 'ok' }],
          },
        },
      } as Step,
    ])
    const result = runMockExpect(op, 'stg', '/tmp')
    assert.strictEqual(result.results.length, 0, 'when: [dev] step must not appear in stg results')
    assert.strictEqual(result.skipped, 0)
  })

  it('includes a when: [dev, stg] step when the target environment is stg', () => {
    const op = makeMultiEnvOperation([
      {
        name: 'Dev And Stg',
        type: 'automatic',
        when: ['dev', 'stg'],
        expect: { contains: 'ready' },
        evidence: {
          results: {
            stg: [{ type: 'command_output', content: 'pod ready' }],
          },
        },
      } as Step,
    ])
    const result = runMockExpect(op, 'stg', '/tmp')
    assert.strictEqual(result.passed, 1)
    assert.strictEqual(result.results[0].stepName, 'Dev And Stg')
  })

  it('includes a step with no when in all environments', () => {
    const op = makeMultiEnvOperation([
      {
        name: 'Always',
        type: 'automatic',
        expect: { contains: 'running' },
        evidence: {
          results: {
            stg: [{ type: 'command_output', content: 'running' }],
          },
        },
      } as Step,
    ])
    const result = runMockExpect(op, 'stg', '/tmp')
    assert.strictEqual(result.passed, 1)
    assert.strictEqual(result.results[0].stepName, 'Always')
  })

  it('skips a when-gated sub-step that does not match the target environment', () => {
    const op = makeMultiEnvOperation([
      {
        name: 'Parent',
        type: 'manual',
        sub_steps: [
          {
            name: 'Dev Sub',
            type: 'automatic',
            when: ['dev'],
            expect: { contains: 'ok' },
            evidence: {
              results: {
                stg: [{ type: 'command_output', content: 'ok' }],
              },
            },
          } as Step,
        ],
      } as Step,
    ])
    const result = runMockExpect(op, 'stg', '/tmp')
    assert.strictEqual(result.results.length, 0, 'dev-only sub-step must not appear in stg results')
  })
});
