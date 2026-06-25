import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  formatRegexFinding,
  isCatastrophicRegex,
  lintOperationRegex,
} from '../../src/lib/regex-lint';
import type { Operation, Step } from '../../src/models/operation';

/** Build a minimal Operation around a set of steps for lint testing. */
function opWith(steps: Step[]): Operation {
  return {
    name: 'Test',
    version: '1.0.0',
    description: 'test',
    environments: [],
    variables: {},
    steps,
  } as unknown as Operation;
}

function step(expect: Step['expect'], name = 'Step'): Step {
  return { name, type: 'manual', expect } as unknown as Step;
}

describe('isCatastrophicRegex', () => {
  it('flags nested unbounded quantifiers', () => {
    assert.strictEqual(isCatastrophicRegex('(a+)+'), true);
    assert.strictEqual(isCatastrophicRegex('(a*)*'), true);
    assert.strictEqual(isCatastrophicRegex('(.*)+$'), true);
    assert.strictEqual(isCatastrophicRegex('(a+)*'), true);
  });

  it('does not flag ordinary patterns', () => {
    assert.strictEqual(isCatastrophicRegex('^pod/web-[0-9]+$'), false);
    assert.strictEqual(isCatastrophicRegex('ERROR|FATAL'), false);
    assert.strictEqual(isCatastrophicRegex('Running'), false);
  });
});

describe('lintOperationRegex', () => {
  it('returns no findings for valid patterns', () => {
    const findings = lintOperationRegex(
      opWith([
        step({ matches: '^pod/web-[0-9]+' }),
        step({ any_line_matches: 'ERROR|FATAL' }),
        step({ no_line_matches: 'panic' }),
      ]),
    );
    assert.strictEqual(findings.length, 0);
  });

  it('reports invalid regex syntax as an error', () => {
    const findings = lintOperationRegex(opWith([step({ matches: '[bad' })]));
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].level, 'error');
    assert.strictEqual(findings[0].field, 'matches');
    assert.ok(findings[0].message.includes('invalid regex'));
  });

  it('reports catastrophic regex as a warning', () => {
    const findings = lintOperationRegex(
      opWith([step({ any_line_matches: '(a+)+$' })]),
    );
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].level, 'warning');
    assert.ok(findings[0].message.includes('catastrophic'));
  });

  it('lints array-form expect checks', () => {
    const findings = lintOperationRegex(
      opWith([
        step([{ contains: 'ok' }, { matches: '[bad' }] as Step['expect']),
      ]),
    );
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].field, 'matches');
  });

  it('skips string-shorthand expect (literal contains, not regex)', () => {
    const findings = lintOperationRegex(
      opWith([step('[bad' as Step['expect'])]),
    );
    assert.strictEqual(findings.length, 0);
  });

  it('lints sub_steps recursively', () => {
    const parent = step(undefined, 'Parent');
    (parent as Step).sub_steps = [step({ matches: '[bad' }, 'Child')];
    const findings = lintOperationRegex(opWith([parent]));
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].stepName, 'Child');
  });

  it('lints rollback steps', () => {
    const s = step(undefined, 'Deploy');
    (s as Step).rollback = [
      {
        command: 'undo',
        expect: { matches: '[bad' },
      } as Step['rollback'][number],
    ];
    const findings = lintOperationRegex(opWith([s]));
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].field, 'matches');
  });

  it('lints retry.while as a regex guard', () => {
    const findings = lintOperationRegex(
      opWith([
        step({
          contains: 'ok',
          retry: { interval: '5s', max: 3, while: '[bad' },
        }),
      ]),
    );
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].field, 'retry.while');
    assert.strictEqual(findings[0].level, 'error');
  });

  it('does not flag a plain substring retry.while (valid regex)', () => {
    const findings = lintOperationRegex(
      opWith([
        step({
          contains: 'ok',
          retry: { interval: '5s', max: 3, while: 'connection refused' },
        }),
      ]),
    );
    assert.strictEqual(findings.length, 0);
  });
});

describe('formatRegexFinding', () => {
  it('renders a human-readable line', () => {
    const line = formatRegexFinding({
      stepName: 'Check rollout',
      field: 'matches',
      pattern: '[bad',
      level: 'error',
      message: 'invalid regex: [bad',
    });
    assert.strictEqual(
      line,
      'step "Check rollout" (matches): invalid regex: [bad',
    );
  });
});
