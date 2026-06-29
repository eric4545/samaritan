import assert from 'node:assert';
import { describe, it } from 'node:test';
import { buildGlobalRollback } from '../../src/lib/global-rollback';
import type { RollbackStep, Step } from '../../src/models/operation';

function step(
  name: string,
  rollback?: RollbackStep[],
  sub_steps?: Step[],
): Step {
  return { name, type: 'manual', rollback, sub_steps } as Step;
}

const globalSteps: RollbackStep[] = [
  { name: 'Notify on-call', instruction: 'Page the SRE' },
];

const steps: Step[] = [
  step('Backup', [{ name: 'Discard backup', command: 'rm backup.sql' }]),
  step('Deploy', [{ name: 'Undo deploy', command: 'kubectl rollout undo' }]),
];

describe('buildGlobalRollback', () => {
  it('returns only the explicit plan steps when aggregate is off', () => {
    const result = buildGlobalRollback(globalSteps, steps, {
      aggregate: false,
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'Notify on-call');
  });

  it('returns only the explicit plan steps when aggregate is omitted', () => {
    const result = buildGlobalRollback(globalSteps, steps);
    assert.equal(result.length, 1);
  });

  it('appends per-step rollbacks in reverse step order after the plan', () => {
    const result = buildGlobalRollback(globalSteps, steps, { aggregate: true });
    // Explicit plan first, then last step's rollback, then first step's.
    assert.deepEqual(
      result.map((r) => r.name),
      [
        'Notify on-call',
        '↩ Rollback for "Deploy": Undo deploy',
        '↩ Rollback for "Backup": Discard backup',
      ],
    );
    // Commands are preserved on the cloned entries.
    assert.equal(result[1].command, 'kubectl rollout undo');
    assert.equal(result[2].command, 'rm backup.sql');
  });

  it('does not mutate the source step rollbacks (non-destructive clone)', () => {
    buildGlobalRollback(globalSteps, steps, { aggregate: true });
    assert.equal(steps[1].rollback?.[0].name, 'Undo deploy');
  });

  it('uses a bare provenance label when the rollback step has no name', () => {
    const noName: Step[] = [step('Migrate', [{ command: 'flyway undo' }])];
    const result = buildGlobalRollback([], noName, { aggregate: true });
    assert.equal(result[0].name, '↩ Rollback for "Migrate"');
    assert.equal(result[0].command, 'flyway undo');
  });

  it('includes rollbacks from sub-steps', () => {
    const withSub: Step[] = [
      step('Parent', undefined, [step('Child', [{ command: 'undo child' }])]),
    ];
    const result = buildGlobalRollback([], withSub, { aggregate: true });
    assert.equal(result.length, 1);
    assert.equal(result[0].name, '↩ Rollback for "Child"');
  });

  it('skips steps with empty/contentless rollback', () => {
    const empty: Step[] = [
      step('NoRollback'),
      step('Real', [{ command: 'x' }]),
    ];
    const result = buildGlobalRollback([], empty, { aggregate: true });
    assert.equal(result.length, 1);
    assert.equal(result[0].command, 'x');
  });

  it('keeps the appended entry sub_steps intact for recursive rendering', () => {
    const nested: Step[] = [
      step('Deploy', [
        {
          name: 'Roll back',
          sub_steps: [{ command: 'step one' }, { command: 'step two' }],
        },
      ]),
    ];
    const result = buildGlobalRollback([], nested, { aggregate: true });
    assert.equal(result[0].name, '↩ Rollback for "Deploy": Roll back');
    assert.equal(result[0].sub_steps?.length, 2);
  });
});
