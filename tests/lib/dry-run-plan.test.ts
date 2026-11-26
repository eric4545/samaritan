import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  buildDryRunPlan,
  dryRunCoverageLines,
} from '../../src/lib/dry-run-plan';
import type { Step } from '../../src/models/operation';

const step = (name: string, more: Partial<Step> = {}): Step =>
  ({ name, type: 'automatic', ...more }) as Step;

describe('buildDryRunPlan', () => {
  it('prints each command with the run and step variables resolved', () => {
    const plan = buildDryRunPlan(
      [
        {
          label: '1',
          step: step('Scale', {
            command: 'kubectl scale deploy/${APP} --replicas=${N} -n ${NS}',
            variables: { N: 3 },
          }),
        },
      ],
      { APP: 'web-server', NS: 'staging' },
    );
    assert.deepStrictEqual(plan.lines, [
      '  Step 1  Scale  [automatic]',
      '      [dry-run] Would execute: kubectl scale deploy/web-server --replicas=3 -n staging',
    ]);
    assert.deepStrictEqual(plan.unresolved, []);
    assert.strictEqual(plan.steps, 1);
  });

  it('names a variable nothing defines, once', () => {
    const plan = buildDryRunPlan(
      [
        { label: '1', step: step('A', { command: 'echo ${MISSING}' }) },
        { label: '2', step: step('B', { command: 'echo ${MISSING}' }) },
      ],
      {},
    );
    assert.ok(plan.lines.includes('      ⚠️  unresolved: ${MISSING}'));
    assert.deepStrictEqual(plan.unresolved, ['MISSING']);
  });

  it('resolves built-in variables like the run loop', () => {
    const plan = buildDryRunPlan(
      [{ label: '1', step: step('Env', { command: 'echo ${CURRENT_DATE}' }) }],
      {},
      new Date('2026-01-01T00:00:00Z'),
    );
    assert.deepStrictEqual(plan.unresolved, []);
  });

  it('shows the session and leaves out steps for other environments', () => {
    const plan = buildDryRunPlan(
      [
        {
          label: '1.1',
          step: step('Check', { command: 'uptime', session: 'ops' }),
        },
        {
          label: '2',
          step: step('Prod only', { command: 'echo prod' }),
          filteredByEnv: true,
        },
      ],
      {},
    );
    assert.strictEqual(
      plan.lines[0],
      '  Step 1.1  Check  [automatic] · session ops',
    );
    assert.ok(!plan.lines.join('\n').includes('Prod only'));
    assert.strictEqual(plan.steps, 1);
  });

  it('says what a step without a command waits for; a bare section says nothing', () => {
    const plan = buildDryRunPlan(
      [
        {
          label: '1',
          step: step('Section', { type: 'manual', sub_steps: [step('x')] }),
        },
        { label: '2', step: step('Sign-off', { type: 'approval' }) },
        {
          label: '3',
          step: step('Look', {
            type: 'manual',
            instruction: 'Check the dashboard',
          }),
        },
        { label: '4', step: step('Script', { script: 'scripts/deploy.sh' }) },
      ],
      {},
    );
    assert.deepStrictEqual(plan.lines, [
      '  Step 1  Section  [manual]',
      '  Step 2  Sign-off  [approval]',
      '      [dry-run] Would wait for approval',
      '  Step 3  Look  [manual]',
      '      [dry-run] Would wait for the operator to mark it done',
      '  Step 4  Script  [automatic]',
      '      [dry-run] Would execute: bash scripts/deploy.sh',
    ]);
  });

  it('indents the continuation lines of a multi-line command', () => {
    const plan = buildDryRunPlan(
      [
        {
          label: '1',
          step: step('Multi', { command: 'echo a \\\n  && echo b\n' }),
        },
      ],
      {},
    );
    assert.deepStrictEqual(plan.lines.slice(1), [
      '      [dry-run] Would execute: echo a \\',
      '          && echo b',
    ]);
  });
});

describe('dryRunCoverageLines', () => {
  it('states what was checked and what was not', () => {
    const text = dryRunCoverageLines({
      environment: 'staging',
      steps: 4,
      errors: 0,
      warnings: 2,
      unresolved: 1,
    }).join('\n');
    assert.match(text, /all 4 step\(s\) traversed/);
    assert.match(text, /samaritan validate --env staging/);
    assert.match(text, /0 error\(s\), 2 warning\(s\)/);
    assert.match(text, /1 variable\(s\) left unresolved/);
    assert.match(text, /Not checked: that any command succeeds/);
  });

  it('says "no findings" when validate found none', () => {
    const text = dryRunCoverageLines({
      environment: 'staging',
      steps: 1,
      errors: 0,
      warnings: 0,
      unresolved: 0,
    }).join('\n');
    assert.match(text, /no findings/);
    assert.ok(!text.includes('unresolved'));
  });
});
