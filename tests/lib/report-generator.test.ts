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
