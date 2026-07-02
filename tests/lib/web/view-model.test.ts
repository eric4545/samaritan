import assert from 'node:assert';
import { describe, it } from 'node:test';
import { buildOperationView } from '../../../src/lib/web/view-model';
import type { Operation } from '../../../src/models/operation';

function makeOperation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: 'demo-op',
    name: 'Demo Operation',
    version: '1.0.0',
    description: 'A demo operation for view-model tests',
    environments: [
      {
        name: 'staging',
        description: 'Staging',
        variables: { NAMESPACE: 'staging', REPLICAS: 2 },
        restrictions: [],
        approval_required: false,
        validation_required: false,
      },
      {
        name: 'production',
        description: 'Production',
        variables: { NAMESPACE: 'production', REPLICAS: 5 },
        restrictions: [],
        approval_required: true,
        validation_required: false,
      },
    ],
    variables: {
      staging: { NAMESPACE: 'staging', REPLICAS: 2 },
      production: { NAMESPACE: 'production', REPLICAS: 5 },
    },
    steps: [],
    metadata: { created_at: new Date(), updated_at: new Date() },
    ...overrides,
  };
}

describe('buildOperationView', () => {
  it('resolves ${VAR} in command differently per environment', () => {
    const operation = makeOperation({
      steps: [
        {
          name: 'Deploy',
          type: 'automatic',
          command: 'kubectl apply -n ${NAMESPACE} --replicas=${REPLICAS}',
        },
      ],
    });

    const view = buildOperationView(operation);

    assert.strictEqual(view.environments.length, 2);
    assert.strictEqual(view.steps.length, 1);
    const step = view.steps[0];
    assert.strictEqual(step.label, '1');
    assert.strictEqual(
      step.perEnv.staging.command,
      'kubectl apply -n staging --replicas=2',
    );
    assert.strictEqual(
      step.perEnv.production.command,
      'kubectl apply -n production --replicas=5',
    );
    // Sanity: the two envs really did resolve differently, not just coincidentally equal.
    assert.notStrictEqual(
      step.perEnv.staging.command,
      step.perEnv.production.command,
    );
  });

  it('flattens sub_steps recursively with dotted labels', () => {
    const operation = makeOperation({
      steps: [
        {
          name: 'Parent step',
          type: 'automatic',
          sub_steps: [
            {
              name: 'Child one',
              type: 'automatic',
              command: 'echo child-one',
            },
            {
              name: 'Child with grandchild',
              type: 'automatic',
              sub_steps: [
                {
                  name: 'Grandchild',
                  type: 'automatic',
                  command: 'echo grandchild',
                },
              ],
            },
          ],
        },
        {
          name: 'Second top-level step',
          type: 'automatic',
          command: 'echo second',
        },
      ],
    });

    const view = buildOperationView(operation);

    const labels = view.steps.map((s) => s.label);
    assert.deepStrictEqual(labels, ['1', '1.1', '1.2', '1.2.1', '2']);

    // Sequential 0-based index over the flattened list, independent of label.
    assert.deepStrictEqual(
      view.steps.map((s) => s.index),
      [0, 1, 2, 3, 4],
    );

    const grandchild = view.steps.find((s) => s.label === '1.2.1');
    assert.ok(grandchild);
    assert.strictEqual(grandchild?.perEnv.staging.command, 'echo grandchild');
  });

  it('omits a step from perEnv for environments excluded by `when`', () => {
    const operation = makeOperation({
      steps: [
        {
          name: 'Production-only step',
          type: 'automatic',
          command: 'echo prod-only',
          when: ['production'],
        },
      ],
    });

    const view = buildOperationView(operation);
    const step = view.steps[0];

    assert.strictEqual(step.perEnv.production.command, 'echo prod-only');
    assert.strictEqual(step.perEnv.staging, undefined);
  });

  it('falls back to a single "default" environment when none are defined', () => {
    const operation = makeOperation({
      environments: [],
      steps: [{ name: 'Only step', type: 'manual', instruction: 'Do it' }],
    });

    const view = buildOperationView(operation);
    assert.deepStrictEqual(view.environments, ['default']);
    assert.strictEqual(view.steps[0].perEnv.default.instruction, 'Do it');
  });

  it('resolves expect into a human-readable description', () => {
    const operation = makeOperation({
      steps: [
        {
          name: 'Verify',
          type: 'manual',
          command: 'curl ${NAMESPACE}',
          expect: { contains: 'ok in ${NAMESPACE}' },
        },
      ],
    });

    const view = buildOperationView(operation);
    const step = view.steps[0];
    assert.strictEqual(step.perEnv.staging.expect, 'contains: ok in staging');
    assert.strictEqual(
      step.perEnv.production.expect,
      'contains: ok in production',
    );
  });

  it('scopes evidence.results to the environment it belongs to', () => {
    const operation = makeOperation({
      steps: [
        {
          name: 'Deploy with evidence',
          type: 'automatic',
          command: 'echo deploy',
          evidence: {
            required: true,
            types: ['command_output'],
            results: {
              staging: [{ type: 'command_output', content: 'staging output' }],
              production: [
                { type: 'command_output', content: 'production output' },
              ],
            },
          },
        },
      ],
    });

    const view = buildOperationView(operation);
    const step = view.steps[0];
    assert.strictEqual(step.perEnv.staging.evidence?.required, true);
    assert.deepStrictEqual(step.perEnv.staging.evidence?.results, [
      { type: 'command_output', content: 'staging output' },
    ]);
    assert.deepStrictEqual(step.perEnv.production.evidence?.results, [
      { type: 'command_output', content: 'production output' },
    ]);
  });

  it('includes operation metadata', () => {
    const operation = makeOperation({ steps: [] });
    const view = buildOperationView(operation);
    assert.strictEqual(view.meta.id, 'demo-op');
    assert.strictEqual(view.meta.name, 'Demo Operation');
    assert.strictEqual(view.meta.version, '1.0.0');
    assert.strictEqual(
      view.meta.description,
      'A demo operation for view-model tests',
    );
  });
});
