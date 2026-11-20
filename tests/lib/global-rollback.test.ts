import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  buildEffectiveRollback,
  buildGlobalRollback,
} from '../../src/lib/global-rollback';
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

  it("keeps a step's own rollback entries in authored order (steps reversed, entries not)", () => {
    // Field report: restore-then-verify came out verify-then-restore because
    // the whole flat entry list was reversed, not just the step order.
    const multi: Step[] = [
      step('Backup', [{ name: 'Discard backup', command: 'rm backup.sql' }]),
      step('Deploy', [
        { name: 'Restore previous version', command: './restore.sh' },
        { name: 'Verify restore', command: './check.sh' },
      ]),
    ];
    const result = buildGlobalRollback([], multi, { aggregate: true });
    assert.deepEqual(
      result.map((r) => r.command),
      ['./restore.sh', './check.sh', 'rm backup.sql'],
    );
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

describe('buildEffectiveRollback dependency ordering', () => {
  function withNeeds(
    name: string,
    id: string,
    rollbackCmd: string,
    needs?: string[],
  ): Step {
    return {
      name,
      id,
      type: 'manual',
      needs,
      rollback: [{ command: rollbackCmd }],
    } as Step;
  }

  it('keeps document order for a valid backward-dependency chain', () => {
    const plan = { steps: [], aggregate_step_rollbacks: true };
    const steps = [
      withNeeds('Build', 'build', 'undo-build'),
      withNeeds('Deploy', 'deploy', 'undo-deploy', ['build']),
    ];
    const result = buildEffectiveRollback(plan, steps);
    // aggregated in REVERSE step order: Deploy's rollback first, then Build's.
    assert.deepStrictEqual(
      result.map((r) => r.command),
      ['undo-deploy', 'undo-build'],
    );
  });

  it('is cycle-safe (does not throw) when steps form a cycle', () => {
    const plan = { steps: [], aggregate_step_rollbacks: true };
    const steps = [
      withNeeds('A', 'a', 'undo-a', ['b']),
      withNeeds('B', 'b', 'undo-b', ['a']),
    ];
    assert.doesNotThrow(() => buildEffectiveRollback(plan, steps));
  });
});

// A folded step rollback undoes work done in the step's window: without its
// own `target:` it takes the step's, so [g] checks the pane like [r] does.
describe('buildGlobalRollback — target inheritance', () => {
  it('folded entries take the step target unless they set their own', () => {
    const withTarget = (s: Step, target: string): Step => ({ ...s, target });
    const result = buildGlobalRollback(
      [],
      [
        withTarget(
          step('Deploy', [
            { name: 'Undo', command: 'kubectl rollout undo' },
            { name: 'Elsewhere', command: 'echo x', target: 'db' },
          ]),
          'production',
        ),
        step('Plain', [{ name: 'Undo plain', command: 'echo y' }]),
      ],
      { aggregate: true },
    );
    const byName = new Map(result.map((r) => [r.name, r.target]));
    assert.equal(byName.get('↩ Rollback for "Deploy": Undo'), 'production');
    assert.equal(byName.get('↩ Rollback for "Deploy": Elsewhere'), 'db');
    assert.equal(byName.get('↩ Rollback for "Plain": Undo plain'), undefined);
    // No `target` key is added where neither the entry nor the step has one.
    const plain = result.find((r) => r.name?.includes('Plain'));
    assert.ok(plain && !('target' in plain));
  });
});
