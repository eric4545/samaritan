import assert from 'node:assert';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  buildStepRecords,
  foldEvents,
  readEvents,
  type SessionEvent,
} from '../../src/lib/session-log';

function ev(partial: Partial<SessionEvent> & { type: string }): SessionEvent {
  return {
    ts: new Date().toISOString(),
    session_id: 's1',
    ...partial,
  } as SessionEvent;
}

describe('foldEvents', () => {
  it('captures command input and attaches pane output', () => {
    const { steps } = foldEvents([
      ev({ type: 'step_start', step: 0, name: 'Deploy', pic: 'ops@x.com' }),
      ev({
        type: 'command_sent',
        session: 'execution',
        command: 'kubectl apply',
      }),
      ev({ type: 'pane_captured', session: 'execution', output: 'created' }),
      ev({ type: 'step_complete', step: 0 }),
    ]);
    assert.strictEqual(steps.length, 1);
    const step = steps[0];
    assert.strictEqual(step.status, 'completed');
    assert.strictEqual(step.pic, 'ops@x.com');
    assert.strictEqual(step.commands.length, 1);
    assert.strictEqual(step.commands[0].command, 'kubectl apply');
    assert.strictEqual(step.commands[0].output, 'created');
  });

  it('marks a jumped-over step skipped even without a step_start', () => {
    const { steps } = foldEvents([
      // step 0 is jumped over: only a step_skip event, no step_start
      ev({ type: 'step_skip', step: 0, name: 'Deploy' }),
      ev({ type: 'step_start', step: 1, name: 'Verify' }),
      ev({ type: 'step_complete', step: 1 }),
    ]);
    assert.strictEqual(steps.length, 2);
    assert.strictEqual(steps[0].name, 'Deploy');
    assert.strictEqual(steps[0].status, 'skipped');
    assert.strictEqual(steps[1].status, 'completed');
  });

  it('marks an already-started step skipped (mid-run jump)', () => {
    const { steps } = foldEvents([
      ev({ type: 'step_start', step: 0, name: 'Deploy' }),
      ev({ type: 'step_skip', step: 0, name: 'Deploy' }),
    ]);
    assert.strictEqual(steps[0].status, 'skipped');
  });

  it('evaluates all verification checks (no short-circuit) with actual/expected', () => {
    const { steps } = foldEvents([
      ev({ type: 'step_start', step: 0, name: 'Verify' }),
      ev({
        type: 'assert_result',
        step: 0,
        pass: true,
        actual: '3',
        expected: '>= 3',
        assertion_type: 'count',
      }),
      ev({
        type: 'assert_result',
        step: 0,
        pass: false,
        actual: 'CrashLoop',
        expected: 'Running',
        assertion_type: 'contains',
      }),
      ev({ type: 'step_complete', step: 0 }),
    ]);
    const v = steps[0].verification;
    assert.ok(v);
    assert.strictEqual(v.pass, false);
    assert.strictEqual(v.checks.length, 2);
    assert.strictEqual(v.checks[0].expected, '>= 3');
    assert.strictEqual(v.checks[1].actual, 'CrashLoop');
    assert.strictEqual(v.checks[1].type, 'contains');
  });

  it('records an approval decision with approver and rationale', () => {
    const { steps } = foldEvents([
      ev({ type: 'step_start', step: 0, name: 'Gate' }),
      ev({
        type: 'user_input',
        action: 'approved',
        step: 0,
        actor: 'lead@x.com',
        rationale: 'Change ticket CHG-42 signed off',
      }),
      ev({ type: 'step_complete', step: 0 }),
    ]);
    const a = steps[0].approval;
    assert.ok(a);
    assert.strictEqual(a.approved, true);
    assert.strictEqual(a.approver, 'lead@x.com');
    assert.strictEqual(a.rationale, 'Change ticket CHG-42 signed off');
  });

  it('records a rejection as approved:false', () => {
    const { steps } = foldEvents([
      ev({ type: 'step_start', step: 0, name: 'Gate' }),
      ev({
        type: 'user_input',
        action: 'rejected',
        step: 0,
        actor: 'lead@x.com',
      }),
    ]);
    assert.strictEqual(steps[0].approval?.approved, false);
  });

  it('omits evidence that was later removed', () => {
    const { steps } = foldEvents([
      ev({ type: 'step_start', step: 0, name: 'Evidence' }),
      ev({
        type: 'evidence_captured',
        step: 0,
        evidence_id: 'keep',
        evidence_type: 'command_output',
        content: 'ok',
      }),
      ev({
        type: 'evidence_captured',
        step: 0,
        evidence_id: 'drop',
        evidence_type: 'command_output',
        content: 'oops',
      }),
      ev({ type: 'evidence_removed', step: 0, evidence_id: 'drop' }),
      ev({ type: 'step_complete', step: 0 }),
    ]);
    const ids = steps[0].evidence.map((e) => e.id);
    assert.deepStrictEqual(ids, ['keep']);
  });

  it('builds a rollback record with command, output and status', () => {
    const { rollbacks } = foldEvents([
      ev({ type: 'step_start', step: 0, name: 'Deploy' }),
      ev({ type: 'rollback_start', step: 0, triggered_by: 'assertion_failed' }),
      ev({
        type: 'command_sent',
        session: 'execution',
        command: 'kubectl rollout undo',
        context: 'rollback',
      }),
      ev({
        type: 'pane_captured',
        session: 'execution',
        output: 'rolled back',
        context: 'rollback',
      }),
      ev({ type: 'rollback_complete', step: 0, status: 'success' }),
    ]);
    assert.strictEqual(rollbacks.length, 1);
    assert.strictEqual(rollbacks[0].triggeredBy, 'assertion_failed');
    assert.strictEqual(
      rollbacks[0].commands[0].command,
      'kubectl rollout undo',
    );
    assert.strictEqual(rollbacks[0].commands[0].output, 'rolled back');
    assert.strictEqual(rollbacks[0].status, 'success');
  });

  it('dedupes a re-run step (resume) by index instead of duplicating', () => {
    const { steps } = foldEvents([
      ev({ type: 'step_start', step: 0, name: 'Deploy' }),
      ev({ type: 'session_end', status: 'paused' }),
      // resume re-enters the same step index
      ev({ type: 'step_start', step: 0, name: 'Deploy' }),
      ev({ type: 'command_sent', session: 'execution', command: 'retry' }),
      ev({ type: 'step_complete', step: 0 }),
    ]);
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].status, 'completed');
  });

  it('buildStepRecords returns just the steps array', () => {
    const records = buildStepRecords([
      ev({ type: 'step_start', step: 0, name: 'A' }),
      ev({ type: 'step_complete', step: 0 }),
    ]);
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].name, 'A');
  });
});

describe('readEvents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'samaritan-readevents-'));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('skips a malformed trailing line (mid-append) without throwing', () => {
    const path = join(dir, 'events.jsonl');
    const valid = JSON.stringify({
      ts: 't',
      session_id: 's',
      type: 'step_start',
    });
    writeFileSync(path, `${valid}\n{"type":"step_comp`, 'utf-8');
    const events = readEvents(path);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'step_start');
  });

  it('returns [] for a missing file', () => {
    const path = join(dir, 'does-not-exist.jsonl');
    assert.strictEqual(existsSync(path), false);
    assert.deepStrictEqual(readEvents(path), []);
  });
});
