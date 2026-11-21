import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  interruptedStepRecap,
  mayHaveRun,
  recapLines,
  recapNote,
  recordedStatusOf,
  recordedStepList,
  runbookMismatches,
} from '../../src/lib/resume-state';
import type { SessionEvent } from '../../src/lib/session-log';

let clock = 0;
const ev = (
  type: string,
  fields: Record<string, unknown> = {},
): SessionEvent => {
  clock += 1;
  return {
    ts: `2026-01-01T00:00:${String(clock).padStart(2, '0')}Z`,
    type,
    session_id: 'sess',
    ...fields,
  };
};

const STEPS = [
  { label: '1', name: 'Step A' },
  { label: '2', name: 'Step B' },
  { label: '3', name: 'Step C' },
];

/** A run that skipped A, completed B and was aborted on C. */
function abortedRun(): SessionEvent[] {
  return [
    ev('session_start', { total_steps: 3, steps: STEPS }),
    ev('step_start', { step: 0, label: '1', name: 'Step A' }),
    ev('step_skip', { step: 0, label: '1', name: 'Step A' }),
    ev('step_start', { step: 1, label: '2', name: 'Step B' }),
    ev('step_complete', { step: 1 }),
    ev('step_start', { step: 2, label: '3', name: 'Step C' }),
    ev('session_end', { status: 'cancelled' }),
  ];
}

describe('resume-state: recordedStatusOf', () => {
  it('returns the status each earlier step ended with', () => {
    const status = recordedStatusOf(abortedRun());
    assert.strictEqual(status(0), 'skipped');
    assert.strictEqual(status(1), 'completed');
    assert.strictEqual(status(2), 'pending');
    assert.strictEqual(status(7), undefined);
  });
});

describe('resume-state: recordedStepList', () => {
  it('reads the step list of the latest session_start that has one', () => {
    const events = [
      ev('session_start', { steps: [{ label: '1', name: 'Old' }] }),
      ev('session_start', { steps: STEPS }),
      ev('session_start', {}),
    ];
    assert.deepStrictEqual(recordedStepList(events), STEPS);
  });

  it('is undefined for a log written before step lists were recorded', () => {
    assert.strictEqual(
      recordedStepList([ev('session_start', { total_steps: 3 })]),
      undefined,
    );
  });
});

describe('resume-state: runbookMismatches', () => {
  it('finds nothing when the step list is unchanged', () => {
    assert.deepStrictEqual(runbookMismatches(abortedRun(), STEPS, 2), []);
  });

  it('ignores edits to steps the run has not reached', () => {
    const now = [...STEPS, { label: '4', name: 'Step D (added)' }];
    assert.deepStrictEqual(runbookMismatches(abortedRun(), now, 2), []);
  });

  it('flags a removed step that shifts the steps the run already did', () => {
    // A step removed before the resume point: the recorded indices now
    // point at different steps (a real run then skipped a step silently).
    const now = [
      { label: '1', name: 'Step B' },
      { label: '2', name: 'Step C' },
    ];
    const found = runbookMismatches(abortedRun(), now, 2);
    assert.deepStrictEqual(
      found.map((m) => [m.index, m.recorded, m.now]),
      [
        [0, 'Step A', 'Step B'],
        [1, 'Step B', 'Step C'],
        [2, 'Step C', undefined],
      ],
    );
  });

  it('flags an inserted step before the resume point', () => {
    const now = [
      { label: '1', name: 'Step A' },
      { label: '2', name: 'Step A2 (inserted)' },
      { label: '3', name: 'Step B' },
      { label: '4', name: 'Step C' },
    ];
    const found = runbookMismatches(abortedRun(), now, 2);
    assert.deepStrictEqual(
      found.map((m) => m.index),
      [1, 2],
    );
  });

  it('checks the resume step from the recorded list when it never started', () => {
    // Aborted right after completing B: no step_start for C yet.
    const events = abortedRun().slice(0, 5);
    const now = [
      { label: '1', name: 'Step A' },
      { label: '2', name: 'Step B' },
      { label: '3', name: 'Step X' },
    ];
    assert.deepStrictEqual(
      runbookMismatches(events, now, 2).map((m) => [m.index, m.recorded]),
      [[2, 'Step C']],
    );
  });

  it('older logs (no recorded list) are still checked by their step names', () => {
    const events = abortedRun().map((e) =>
      e.type === 'session_start' ? { ...e, steps: undefined } : e,
    );
    const now = [{ label: '1', name: 'Step B' }, STEPS[2]];
    // A, B and C all have records; none is where it was.
    assert.strictEqual(runbookMismatches(events, now, 1).length, 3);
  });
});

describe('resume-state: interruptedStepRecap', () => {
  it('reports the paste, the Enter, the verify and the output before the abort', () => {
    const events = [
      ...abortedRun().slice(0, 6),
      ev('user_input', { action: 'send_to_pane', step: 2, command: 'echo c' }),
      ev('user_input', { action: 'enter_sent', step: 2, command: 'echo c' }),
      ev('pane_captured', { step: 2, output: 'c' }),
      ev('assert_result', { step: 2, pass: false, output: 'c', checks: [] }),
      ev('session_end', { status: 'cancelled' }),
    ];
    const recap = interruptedStepRecap(events, 2);
    assert.ok(recap);
    assert.strictEqual(recap.name, 'Step C');
    assert.strictEqual(recap.label, '3');
    assert.ok(recap.pastedAt);
    assert.ok(recap.enterSentAt);
    assert.strictEqual(recap.verify?.pass, false);
    assert.strictEqual(recap.output, 'c');
    assert.strictEqual(recap.command, 'echo c');
  });

  it('ignores rollback events (they carry a context)', () => {
    const events = [
      ...abortedRun().slice(0, 6),
      ev('user_input', {
        action: 'enter_sent',
        step: 2,
        context: 'rollback',
        command: 'undo',
      }),
    ];
    const recap = interruptedStepRecap(events, 2);
    assert.ok(recap);
    assert.strictEqual(recap.enterSentAt, undefined);
  });

  it('is undefined when the step finished or never started', () => {
    assert.strictEqual(interruptedStepRecap(abortedRun(), 1), undefined);
    assert.strictEqual(
      interruptedStepRecap(abortedRun().slice(0, 5), 2),
      undefined,
    );
  });

  it('keeps an Enter sent in an earlier interrupted attempt', () => {
    // Aborted twice on the same step: the first attempt sent the command,
    // the second sent nothing. The command may still have run.
    const events = [
      ...abortedRun().slice(0, 6),
      ev('user_input', { action: 'enter_sent', step: 2, command: 'echo c' }),
      ev('session_end', { status: 'cancelled' }),
      ev('session_start', { steps: STEPS }),
      ev('step_start', { step: 2, label: '3', name: 'Step C' }),
      ev('session_end', { status: 'cancelled' }),
    ];
    assert.ok(interruptedStepRecap(events, 2)?.enterSentAt);
  });

  it('forgets attempts from before the step last finished', () => {
    // Completed once, then [b] back to it and aborted with nothing sent.
    const events = [
      ...abortedRun().slice(0, 6),
      ev('user_input', { action: 'enter_sent', step: 2, command: 'echo c' }),
      ev('step_complete', { step: 2 }),
      ev('step_start', { step: 2, label: '3', name: 'Step C' }),
      ev('session_end', { status: 'cancelled' }),
    ];
    const recap = interruptedStepRecap(events, 2);
    assert.ok(recap);
    assert.strictEqual(recap.enterSentAt, undefined);
  });
});

describe('resume-state: recap text', () => {
  const base = {
    index: 2,
    name: 'Step C',
    startedAt: '2026-01-01T00:00:01Z',
  };

  it('warns that a sent command may already have run', () => {
    const recap = {
      ...base,
      pastedAt: '2026-01-01T00:00:02Z',
      enterSentAt: '2026-01-01T00:00:03Z',
      verify: { pass: false, at: '2026-01-01T00:00:04Z' },
    };
    assert.ok(mayHaveRun(recap));
    const text = recapLines(recap).join('\n');
    assert.match(text, /started before the run stopped \(00:00:01\)/);
    assert.match(text, /pasted into the pane at 00:00:02/);
    assert.match(text, /Enter sent from samaritan at 00:00:03/);
    assert.match(text, /verify FAIL at 00:00:04/);
    assert.match(text, /may already have run/);
    assert.strictEqual(
      recapNote(recap),
      '↻ Resumed after the run stopped on this step. Before it: pasted, Enter sent from samaritan, verify FAIL.',
    );
  });

  it('says a paste was not run from samaritan', () => {
    const recap = { ...base, pastedAt: '2026-01-01T00:00:02Z' };
    assert.ok(!mayHaveRun(recap));
    assert.match(recapLines(recap).join('\n'), /not run from samaritan/);
  });

  it('says nothing was sent when the step only started', () => {
    assert.match(recapLines(base).join('\n'), /Nothing was pasted or sent/);
    assert.match(recapNote(base), /Nothing was pasted or sent/);
  });
});
