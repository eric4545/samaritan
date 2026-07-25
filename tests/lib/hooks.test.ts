import assert from 'node:assert';
import { describe, it } from 'node:test';
import { applyHooks } from '../../src/lib/hooks';
import type { OperationHook, Step } from '../../src/models/operation';

function step(name: string, extra: Partial<Step> = {}): Step {
  return { name, type: 'manual', phase: 'flight', ...extra } as Step;
}

function names(steps: Step[]): string[] {
  return steps.map((s) => s.name);
}

describe('applyHooks: no hooks', () => {
  it('returns the step list untouched', () => {
    const steps = [step('a'), step('b')];
    const result = applyHooks(steps, undefined);
    assert.deepStrictEqual(names(result.steps), ['a', 'b']);
    assert.deepStrictEqual(result.onFailure, []);
    assert.deepStrictEqual(result.issues, []);
  });

  it('treats an empty hook array as no hooks', () => {
    const steps = [step('a')];
    assert.deepStrictEqual(names(applyHooks(steps, []).steps), ['a']);
  });
});

describe('applyHooks: step-id anchors', () => {
  const steps = [
    step('build', { id: 'build' }),
    step('deploy', { id: 'deploy' }),
    step('verify', { id: 'verify' }),
  ];

  it('injects before the anchored step', () => {
    const hooks: OperationHook[] = [
      { before: 'deploy', steps: [step('drain')] },
    ];
    assert.deepStrictEqual(names(applyHooks(steps, hooks).steps), [
      'build',
      'drain',
      'deploy',
      'verify',
    ]);
  });

  it('injects after the anchored step', () => {
    const hooks: OperationHook[] = [
      { after: 'deploy', steps: [step('warm cache')] },
    ];
    assert.deepStrictEqual(names(applyHooks(steps, hooks).steps), [
      'build',
      'deploy',
      'warm cache',
      'verify',
    ]);
  });

  it('applies several hooks on one anchor in declaration order', () => {
    // Multiple hooks on the same anchor apply in the order they were declared.
    const hooks: OperationHook[] = [
      { before: 'deploy', steps: [step('first')] },
      { before: 'deploy', steps: [step('second')] },
    ];
    assert.deepStrictEqual(names(applyHooks(steps, hooks).steps), [
      'build',
      'first',
      'second',
      'deploy',
      'verify',
    ]);
  });

  it('resolves every anchor against the ORIGINAL list, not injected output', () => {
    // `after: build` and `before: deploy` both land between them, and neither
    // hook may attach to the other's injected step.
    const hooks: OperationHook[] = [
      { after: 'build', steps: [step('x')] },
      { before: 'deploy', steps: [step('y')] },
    ];
    assert.deepStrictEqual(names(applyHooks(steps, hooks).steps), [
      'build',
      'x',
      'y',
      'deploy',
      'verify',
    ]);
  });

  it('injects a multi-step hook as a contiguous block', () => {
    const hooks: OperationHook[] = [
      { before: 'deploy', steps: [step('p'), step('q')] },
    ];
    assert.deepStrictEqual(names(applyHooks(steps, hooks).steps), [
      'build',
      'p',
      'q',
      'deploy',
      'verify',
    ]);
  });

  it('stamps injected steps with their hook provenance', () => {
    const hooks: OperationHook[] = [
      { before: 'deploy', steps: [step('drain')] },
    ];
    const injected = applyHooks(steps, hooks).steps.find(
      (s) => s.name === 'drain',
    );
    assert.deepStrictEqual(injected?.hookSource, {
      anchor: 'deploy',
      position: 'before',
    });
  });

  it('leaves authored steps unstamped', () => {
    const hooks: OperationHook[] = [
      { before: 'deploy', steps: [step('drain')] },
    ];
    const authored = applyHooks(steps, hooks).steps.find(
      (s) => s.name === 'deploy',
    );
    assert.strictEqual(authored?.hookSource, undefined);
  });
});

describe('applyHooks: phase anchors', () => {
  const steps = [
    step('check a', { phase: 'preflight' }),
    step('check b', { phase: 'preflight' }),
    step('apply', { phase: 'flight' }),
    step('confirm', { phase: 'postflight' }),
  ];

  it('before <phase> attaches to the FIRST step of that phase', () => {
    const hooks: OperationHook[] = [
      { before: 'preflight', steps: [step('announce')] },
    ];
    assert.deepStrictEqual(
      names(applyHooks(steps, hooks).steps)[0],
      'announce',
    );
  });

  it('after <phase> attaches to the LAST step of that phase', () => {
    // The whole point: `after: preflight` must land at the end of preflight,
    // not in the middle of it.
    const hooks: OperationHook[] = [
      { after: 'preflight', steps: [step('gate')] },
    ];
    assert.deepStrictEqual(names(applyHooks(steps, hooks).steps), [
      'check a',
      'check b',
      'gate',
      'apply',
      'confirm',
    ]);
  });

  it('treats a step with no explicit phase as flight', () => {
    const unphased = [{ name: 'x', type: 'manual' } as Step];
    const hooks: OperationHook[] = [
      { before: 'flight', steps: [step('before-flight')] },
    ];
    assert.deepStrictEqual(names(applyHooks(unphased, hooks).steps), [
      'before-flight',
      'x',
    ]);
  });

  it('reports a phase anchor that no step occupies', () => {
    const onlyFlight = [step('apply', { phase: 'flight' })];
    const hooks: OperationHook[] = [
      { before: 'postflight', steps: [step('late')] },
    ];
    const result = applyHooks(onlyFlight, hooks);
    assert.strictEqual(result.issues.length, 1);
    assert.match(result.issues[0].message, /anchor 'postflight'/);
    // The unplaceable step is dropped rather than guessed at a position.
    assert.deepStrictEqual(names(result.steps), ['apply']);
  });
});

describe('applyHooks: unknown anchors', () => {
  it('reports an anchor matching no step id or phase', () => {
    const result = applyHooks(
      [step('a', { id: 'a' })],
      [{ before: 'nope', steps: [step('orphan')] }],
    );
    assert.strictEqual(result.issues.length, 1);
    assert.strictEqual(result.issues[0].anchor, 'nope');
    assert.strictEqual(result.issues[0].hookIndex, 0);
    assert.deepStrictEqual(names(result.steps), ['a']);
  });

  it('never throws — the caller decides severity', () => {
    assert.doesNotThrow(() =>
      applyHooks([], [{ after: 'ghost', steps: [step('x')] }]),
    );
  });

  it('still applies the hooks that DO resolve', () => {
    const result = applyHooks(
      [step('a', { id: 'a' })],
      [
        { before: 'nope', steps: [step('orphan')] },
        { after: 'a', steps: [step('good')] },
      ],
    );
    assert.strictEqual(result.issues.length, 1);
    assert.deepStrictEqual(names(result.steps), ['a', 'good']);
  });
});

describe('applyHooks: on_failure', () => {
  it('collects on_failure steps instead of injecting them', () => {
    const steps = [step('a', { id: 'a' })];
    const result = applyHooks(steps, [
      { on_failure: true, steps: [step('page on-call')] },
    ]);
    assert.deepStrictEqual(names(result.steps), ['a'], 'flow is untouched');
    assert.deepStrictEqual(names(result.onFailure), ['page on-call']);
  });

  it('concatenates several on_failure hooks in declaration order', () => {
    const result = applyHooks(
      [step('a', { id: 'a' })],
      [
        { on_failure: true, steps: [step('notify')] },
        { on_failure: true, steps: [step('collect logs')] },
      ],
    );
    assert.deepStrictEqual(names(result.onFailure), ['notify', 'collect logs']);
  });

  it('needs no anchor, so it never produces an issue', () => {
    const result = applyHooks(
      [],
      [{ on_failure: true, steps: [step('notify')] }],
    );
    assert.deepStrictEqual(result.issues, []);
    assert.deepStrictEqual(names(result.onFailure), ['notify']);
  });

  it('coexists with before/after hooks', () => {
    const result = applyHooks(
      [step('deploy', { id: 'deploy' })],
      [
        { before: 'deploy', steps: [step('drain')] },
        { on_failure: true, steps: [step('page')] },
      ],
    );
    assert.deepStrictEqual(names(result.steps), ['drain', 'deploy']);
    assert.deepStrictEqual(names(result.onFailure), ['page']);
  });
});
