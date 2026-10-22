import assert from 'node:assert';
import { homedir } from 'node:os';
import { describe, it } from 'node:test';
import { renderReport } from '../../src/lib/report-generator';
import { foldEvents, type SessionEvent } from '../../src/lib/session-log';

const ESC = '';

function ev(partial: Partial<SessionEvent> & { type: string }): SessionEvent {
  return {
    ts: '2026-07-06T00:00:00.000Z',
    session_id: 's1',
    ...partial,
  } as SessionEvent;
}

function render(events: SessionEvent[], runDir?: string): string {
  return renderReport(events, foldEvents(events), runDir);
}

describe('renderReport — terminal-noise cleaning', () => {
  it('strips ANSI/OSC escape sequences from auto-captured verify evidence', () => {
    const noisy = `${ESC}[7mPERSONAL_TO="a@b.com"${ESC}[27m${ESC}[K\nMAIL_BODY_ROWS=2`;
    const md = render([
      ev({ type: 'session_start', op: 'op.yaml' }),
      ev({ type: 'step_start', step: 0, name: 'Send mail' }),
      ev({
        type: 'evidence_captured',
        step: 0,
        evidence_type: 'command_output',
        content: noisy,
        description: 'Auto-captured on passing verify',
      }),
      ev({ type: 'step_complete', step: 0 }),
      ev({ type: 'session_end', status: 'completed' }),
    ]);
    assert.ok(!md.includes(ESC), 'no raw escape bytes remain');
    assert.ok(!md.includes('[27m'), 'no SGR toggles remain');
    assert.ok(md.includes('PERSONAL_TO="a@b.com"'), 'readable text preserved');
    assert.ok(md.includes('MAIL_BODY_ROWS=2'));
  });

  it('cleans escape sequences in command output blocks', () => {
    const md = render([
      ev({ type: 'session_start', op: 'op.yaml' }),
      ev({ type: 'step_start', step: 0, name: 'Run' }),
      ev({ type: 'command_sent', session: 'execution', command: 'echo hi' }),
      ev({
        type: 'pane_captured',
        session: 'execution',
        output: `${ESC}[32mhi${ESC}[0m`,
      }),
      ev({ type: 'step_complete', step: 0 }),
      ev({ type: 'session_end', status: 'completed' }),
    ]);
    assert.ok(md.includes('hi'));
    assert.ok(!md.includes(ESC), 'no escape codes in output block');
  });
});

describe('renderReport — steps-completed count', () => {
  it('aborted run counts only completed steps against the true total', () => {
    const md = render([
      ev({ type: 'session_start', op: 'op.yaml', total_steps: 5 }),
      ev({ type: 'step_start', step: 0, name: 'A' }),
      ev({ type: 'step_complete', step: 0 }),
      ev({ type: 'step_start', step: 1, name: 'B' }),
      ev({ type: 'step_complete', step: 1 }),
      ev({ type: 'step_start', step: 2, name: 'C (aborted)' }),
      ev({ type: 'session_end', status: 'cancelled' }),
    ]);
    assert.ok(md.includes('Steps completed: 2/5'), `expected 2/5, got:\n${md}`);
  });

  it('falls back to reached-step count when total_steps is absent', () => {
    const md = render([
      ev({ type: 'session_start', op: 'op.yaml' }),
      ev({ type: 'step_start', step: 0, name: 'A' }),
      ev({ type: 'step_complete', step: 0 }),
      ev({ type: 'step_start', step: 1, name: 'B' }),
      ev({ type: 'step_complete', step: 1 }),
      ev({ type: 'session_end', status: 'completed' }),
    ]);
    assert.ok(md.includes('Steps completed: 2/2'), `expected 2/2, got:\n${md}`);
  });

  it('flags the stop point of an aborted run (summary line + step marker)', () => {
    const md = render([
      ev({ type: 'session_start', op: 'op.yaml', total_steps: 5 }),
      ev({ type: 'step_start', step: 0, name: 'A' }),
      ev({ type: 'step_complete', step: 0 }),
      ev({ type: 'step_start', step: 1, name: 'B' }),
      ev({ type: 'step_complete', step: 1 }),
      // Step 3 was reached (step_start) but never completed — the abort point.
      ev({ type: 'step_start', step: 2, name: 'C in progress' }),
      ev({ type: 'session_end', status: 'cancelled' }),
    ]);
    // Count stays honest…
    assert.ok(md.includes('Steps completed: 2/5'), `expected 2/5, got:\n${md}`);
    // …and the report says WHERE it stopped, both in the summary…
    assert.ok(
      md.includes('- Aborted at step 3: C in progress'),
      `expected an "Aborted at step 3" summary line, got:\n${md}`,
    );
    // …and on the in-progress step's heading.
    assert.ok(
      md.includes('## Step 3: C in progress 🛑 (aborted here — in progress)'),
      `expected the in-progress step heading to be flagged, got:\n${md}`,
    );
    // The status header is no longer a bare "unknown" (❓) icon.
    assert.ok(
      md.includes('Status: 🛑 cancelled'),
      `expected a cancelled status icon, got:\n${md}`,
    );
    // Genuinely completed steps are NOT flagged as the abort point.
    assert.ok(
      !md.includes('## Step 1: A 🛑'),
      'completed steps must not carry the abort marker',
    );
  });

  it('does not flag any stop point for a cleanly completed run', () => {
    const md = render([
      ev({ type: 'session_start', op: 'op.yaml', total_steps: 2 }),
      ev({ type: 'step_start', step: 0, name: 'A' }),
      ev({ type: 'step_complete', step: 0 }),
      ev({ type: 'step_start', step: 1, name: 'B' }),
      ev({ type: 'step_complete', step: 1 }),
      ev({ type: 'session_end', status: 'completed' }),
    ]);
    assert.ok(!md.includes('Aborted at step'), 'no abort line on clean run');
    assert.ok(!md.includes('🛑'), 'no abort marker on clean run');
  });

  it('does not count a failed step as completed', () => {
    const md = render([
      ev({ type: 'session_start', op: 'op.yaml', total_steps: 3 }),
      ev({ type: 'step_start', step: 0, name: 'A' }),
      ev({ type: 'step_complete', step: 0 }),
      ev({ type: 'step_start', step: 1, name: 'B' }),
      ev({ type: 'step_failed', step: 1, reason: 'boom' }),
      ev({ type: 'session_end', status: 'aborted' }),
    ]);
    assert.ok(md.includes('Steps completed: 1/3'), `expected 1/3, got:\n${md}`);
  });

  it('shows completed status when all steps finish before a cancelled session_end', () => {
    // Scenario: user pressed Ctrl+C AFTER the last step completed but before
    // the session-end confirmation. All work is done, so the report should
    // not confusingly show "🛑 cancelled" alongside "Steps completed: 3/3".
    const md = render([
      ev({ type: 'session_start', op: 'op.yaml', total_steps: 3 }),
      ev({ type: 'step_start', step: 0, name: 'A' }),
      ev({ type: 'step_complete', step: 0 }),
      ev({ type: 'step_start', step: 1, name: 'B' }),
      ev({ type: 'step_complete', step: 1 }),
      ev({ type: 'step_start', step: 2, name: 'C' }),
      ev({ type: 'step_complete', step: 2 }),
      ev({ type: 'session_end', status: 'cancelled' }),
    ]);
    assert.ok(md.includes('Steps completed: 3/3'), `expected 3/3, got:\n${md}`);
    assert.ok(
      md.includes('Status: ✅ completed'),
      `expected completed status icon, got:\n${md}`,
    );
    assert.ok(
      !md.includes('Aborted at step'),
      'no abort line when all steps finished',
    );
    assert.ok(
      !md.includes('🛑'),
      'no abort icon when all steps finished before cancel',
    );
  });

  it('still shows cancelled status when only some steps completed before cancel', () => {
    // Only 2 of 5 steps done — genuinely cancelled mid-run.
    const md = render([
      ev({ type: 'session_start', op: 'op.yaml', total_steps: 5 }),
      ev({ type: 'step_start', step: 0, name: 'A' }),
      ev({ type: 'step_complete', step: 0 }),
      ev({ type: 'step_start', step: 1, name: 'B' }),
      ev({ type: 'step_complete', step: 1 }),
      ev({ type: 'step_start', step: 2, name: 'C in progress' }),
      ev({ type: 'session_end', status: 'cancelled' }),
    ]);
    assert.ok(md.includes('Steps completed: 2/5'), `expected 2/5, got:\n${md}`);
    assert.ok(
      md.includes('Status: 🛑 cancelled'),
      `expected cancelled status, got:\n${md}`,
    );
  });

  it('stays cancelled when total_steps is absent even if stepsCompleted === steps.length', () => {
    // Regression: without session_start.total_steps, the code fell back to
    // steps.length as totalSteps. If every recorded step completed, then
    // stepsCompleted === steps.length === totalSteps, which falsely triggered the
    // "all done, promote to completed" path — even for a 40-step operation whose
    // log only recorded 3 completed steps before cancellation.
    const md = render([
      // No total_steps declared — partial log with 3 completed steps.
      ev({ type: 'session_start', op: 'op.yaml' }),
      ev({ type: 'step_start', step: 0, name: 'A' }),
      ev({ type: 'step_complete', step: 0 }),
      ev({ type: 'step_start', step: 1, name: 'B' }),
      ev({ type: 'step_complete', step: 1 }),
      ev({ type: 'step_start', step: 2, name: 'C' }),
      ev({ type: 'step_complete', step: 2 }),
      ev({ type: 'session_end', status: 'cancelled' }),
    ]);
    assert.ok(md.includes('Steps completed: 3/3'), `expected 3/3, got:\n${md}`);
    assert.ok(
      md.includes('Status: 🛑 cancelled'),
      `must stay cancelled when no declared total — got:\n${md}`,
    );
    assert.ok(
      !md.includes('Status: ✅ completed'),
      `must not be falsely promoted to completed — got:\n${md}`,
    );
  });
});

describe('renderReport — operator-local path redaction', () => {
  it('strips run-dir and op-dir prefixes and collapses home to ~', () => {
    const home = homedir();
    const runDir = '/tmp/operation/runs/JOB-1';
    const md = render(
      [
        ev({ type: 'session_start', op: '/tmp/operation/repo/op.yaml' }),
        ev({ type: 'step_start', step: 0, name: 'Render' }),
        ev({
          type: 'command_displayed',
          session: 'execution',
          command: 'cat /tmp/operation/repo/config/x.j2',
        }),
        ev({
          type: 'pane_captured',
          session: 'execution',
          output: `wrote ${runDir}/email.html`,
        }),
        ev({
          type: 'evidence_captured',
          step: 0,
          evidence_type: 'command_output',
          content: `HOME_FILE=${home}/notes.txt`,
        }),
        ev({ type: 'step_complete', step: 0 }),
        ev({ type: 'session_end', status: 'completed' }),
      ],
      runDir,
    );
    assert.ok(!md.includes(runDir), 'run dir prefix removed');
    assert.ok(md.includes('wrote email.html'), 'output relativized');
    assert.ok(
      md.includes('cat config/x.j2'),
      'op-dir prefix stripped from command',
    );
    assert.ok(!md.includes(`${home}/notes.txt`), 'home path not leaked raw');
    assert.ok(md.includes('~/notes.txt'), 'home collapsed to ~');
  });
});

describe('renderReport — plain UTF-8 (no control bytes)', () => {
  it('drops NUL / SI / charset escapes from verify output, notes and commands', () => {
    const noisy = `ok\u0000 ${ESC}(B\u000fdone`;
    const md = render([
      ev({ type: 'session_start', op: 'op.yaml' }),
      ev({ type: 'step_start', step: 0, name: 'Noisy\u0000' }),
      ev({
        type: 'command_displayed',
        session: 'default',
        command: 'printf x\u0007',
      }),
      ev({
        type: 'assert_result',
        step: 0,
        pass: false,
        actual: noisy,
        expected: 'nothing-here',
        assertion_type: 'contains',
      }),
      ev({
        type: 'user_input',
        action: 'note',
        step: 0,
        notes: `see ${ESC}[31mred\u0000`,
      }),
      ev({ type: 'step_complete', step: 0 }),
      ev({ type: 'session_end', status: 'completed' }),
    ]);
    const control = [...md].filter((ch) => {
      const c = ch.charCodeAt(0);
      return (c < 0x20 && ch !== '\n' && ch !== '\t') || c === 0x7f;
    });
    assert.deepStrictEqual(control, [], 'report holds no control bytes');
    assert.ok(md.includes('ok done'), 'readable text preserved');
  });
});

describe('renderReport — verification final state + overrides', () => {
  const attempt = (pass: boolean, extra: Record<string, unknown> = {}) =>
    ev({
      type: 'assert_result',
      step: 0,
      pass,
      actual: pass ? 'a\nb' : '3',
      expected: pass ? '(all checks passed)' : '2',
      assertion_type: pass ? 'all' : 'line_count',
      output: 'a\nb',
      checks: [
        { pass, type: 'line_count', expected: '2', actual: pass ? '2' : '3' },
        { pass: true, type: 'contains', expected: 'a' },
      ],
      ...extra,
    });

  it('renders ⚠️ OVERRIDDEN with who/when/reason instead of one ❌ per attempt', () => {
    const md = render([
      ev({ type: 'session_start', op: 'op.yaml', total_steps: 1 }),
      ev({ type: 'step_start', step: 0, name: 'Two lines' }),
      attempt(false),
      attempt(false),
      ev({
        ts: '2026-07-06T00:05:00.000Z',
        type: 'user_input',
        action: 'override',
        step: 0,
        actor: 'alice',
        reason: 'prompt line counted',
      }),
      ev({ type: 'step_complete', step: 0 }),
      ev({ type: 'session_end', status: 'completed' }),
    ]);
    assert.ok(
      md.includes(
        '**Verification**: ⚠️ OVERRIDDEN (2 attempts, 2 failed — last shown)',
      ),
      md,
    );
    assert.ok(
      md.includes(
        '- ⚠️ Overridden by alice at Mon, 06 Jul 2026 00:05:00 UTC — reason: prompt line counted',
      ),
      md,
    );
    assert.ok(!md.includes('❌ FAIL'), 'no bare FAIL for an overridden step');
    assert.strictEqual(
      md.split('❌ (line_count)').length - 1,
      1,
      'only the last attempt is listed',
    );
    assert.ok(md.includes('## Step 1: Two lines ⚠️ (verification overridden)'));
    assert.ok(md.includes('- Verification overridden: Step 1'));
  });

  it('shows the final PASS after earlier failed attempts', () => {
    const md = render([
      ev({ type: 'session_start', op: 'op.yaml' }),
      ev({ type: 'step_start', step: 0, name: 'Settles' }),
      attempt(false),
      attempt(true),
      ev({ type: 'step_complete', step: 0 }),
      ev({ type: 'session_end', status: 'completed' }),
    ]);
    assert.ok(
      md.includes(
        '**Verification**: ✅ PASS (2 attempts, 1 failed — last shown)',
      ),
      md,
    );
    assert.ok(
      !md.includes('❌'),
      'the earlier failure is summarized, not listed',
    );
    assert.ok(md.includes('- output:'), 'checked output rendered once');
  });
});

describe('renderReport — rollback events are honest', () => {
  const base = [
    ev({ type: 'session_start', op: 'op.yaml' }),
    ev({ type: 'step_start', step: 1, name: 'Deploy' }),
  ];

  it('lists what the operator confirmed and a partial status', () => {
    const md = render([
      ...base,
      ev({
        type: 'rollback_start',
        step: 1,
        triggered_by: 'alice',
        context: 'global',
      }),
      ev({
        type: 'command_displayed',
        session: 'tmux pane w:0.0',
        command: 'echo GLOBAL_RB dev',
        context: 'global',
      }),
      ev({ type: 'user_input', action: 'send_to_pane', context: 'global' }),
      ev({
        type: 'rollback_step',
        step: 1,
        context: 'global',
        index: 0,
        outcome: 'executed',
      }),
      ev({
        type: 'command_displayed',
        session: 'tmux pane w:0.0',
        command: 'echo ROLLBACK dev',
        context: 'global',
        name: '↩ Rollback for "Build"',
      }),
      ev({
        type: 'rollback_step',
        step: 1,
        context: 'global',
        index: 1,
        outcome: 'skipped',
      }),
      ev({
        type: 'rollback_complete',
        step: 1,
        status: 'partial',
        context: 'global',
        executed: 1,
        skipped: 1,
        total: 2,
      }),
      ev({ type: 'session_end', status: 'cancelled' }),
    ]);
    assert.ok(md.includes('### Global rollback (triggered at Step 2)'), md);
    assert.ok(
      md.includes(
        '- ✅ run by operator: `echo GLOBAL_RB dev` (pasted into pane)',
      ),
      md,
    );
    assert.ok(
      md.includes('- ⏭ skipped: ↩ Rollback for "Build" — `echo ROLLBACK dev`'),
      md,
    );
    assert.ok(
      md.includes(
        '**Status**: ⚠️ partial — 1/2 step(s) confirmed run, 1 skipped',
      ),
      md,
    );
    assert.ok(!md.includes('Command sent'), 'rollback is not a step command');
  });

  it('marks an unconfirmed rollback as NOT executed', () => {
    const md = render([
      ...base,
      ev({
        type: 'rollback_start',
        step: 1,
        triggered_by: 'alice',
        context: 'rollback',
      }),
      ev({
        type: 'command_displayed',
        session: 'default',
        command: 'echo undo',
        context: 'rollback',
      }),
      ev({
        type: 'rollback_complete',
        step: 1,
        status: 'not_executed',
        context: 'rollback',
        executed: 0,
        skipped: 0,
        total: 1,
      }),
    ]);
    assert.ok(md.includes('- ⚠️ not run: `echo undo`'), md);
    assert.ok(
      md.includes('**Status**: ❌ NOT executed — 0/1 step(s) confirmed run'),
      md,
    );
    assert.ok(!md.includes('success'), md);
  });
});
