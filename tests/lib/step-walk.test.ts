import assert from 'node:assert';
import { describe, it } from 'node:test';
import { stepDisplayName, walkOperationSteps } from '../../src/lib/step-walk';
import type { Operation } from '../../src/models/operation';

describe('walkOperationSteps', () => {
  it('visits steps, sub-steps, step rollbacks and the operation rollback', () => {
    const operation = {
      steps: [
        {
          name: 'Deploy',
          sub_steps: [
            {
              name: 'Deploy part',
              rollback: [{ name: 'Undo part', command: 'echo undo-part' }],
            },
          ],
          rollback: [
            {
              name: 'Undo deploy',
              sub_steps: [{ name: 'Undo nested', command: 'echo nested' }],
            },
          ],
        },
        { name: 'Check' },
      ],
      rollback: { steps: [{ name: 'Global undo' }, { command: 'echo x' }] },
    } as unknown as Operation;

    const names = [...walkOperationSteps(operation)].map(stepDisplayName);
    assert.deepStrictEqual(names, [
      'Deploy',
      'Deploy part',
      'Undo part',
      'Undo deploy',
      'Undo nested',
      'Check',
      'Global undo',
      '(rollback)',
    ]);
  });

  it('handles an operation without rollback', () => {
    const operation = { steps: [{ name: 'Only' }] } as unknown as Operation;
    assert.deepStrictEqual(
      [...walkOperationSteps(operation)].map((s) => s.name),
      ['Only'],
    );
  });
});
