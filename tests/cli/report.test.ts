import assert from 'node:assert';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { generateReport } from '../../src/lib/report-generator';

function makeJsonl(events: object[]): string {
  return `${events
    .map((e) =>
      JSON.stringify({
        ts: new Date().toISOString(),
        session_id: 'f3a9b2',
        ...e,
      }),
    )
    .join('\n')}\n`;
}

const sampleJsonl = makeJsonl([
  {
    type: 'session_start',
    op: 'deployment.yaml',
    tmux_session: 'samaritan-f3a9b2',
  },
  {
    type: 'step_start',
    step: 0,
    name: 'Pre-flight checks',
    pic: 'ops@example.com',
  },
  { type: 'command_sent', session: 'execution', command: 'kubectl get nodes' },
  {
    type: 'pane_captured',
    session: 'execution',
    output: 'node/prod-1  Ready  4d\nnode/prod-2  Ready  4d',
  },
  {
    type: 'user_input',
    action: 'verify_ok',
    step: 0,
    actor: 'ops@example.com',
  },
  { type: 'step_complete', step: 0 },
  {
    type: 'step_start',
    step: 1,
    name: 'Deploy App',
    pic: 'ops@example.com',
    reviewer: 'sre@example.com',
  },
  {
    type: 'command_sent',
    session: 'execution',
    command: 'kubectl apply -f deployment.yaml',
  },
  {
    type: 'pane_captured',
    session: 'execution',
    output: 'deployment.apps/web created',
  },
  { type: 'step_complete', step: 1 },
  { type: 'session_end', status: 'completed', steps_completed: 2 },
]);

describe('generateReport (issue #10)', () => {
  it('generates valid Markdown from JSONL', () => {
    const jsonlPath = join(tmpdir(), 'test-report-gen.jsonl');
    writeFileSync(jsonlPath, sampleJsonl, 'utf-8');
    try {
      const md = generateReport(jsonlPath);
      assert.ok(typeof md === 'string', 'should return string');
      assert.ok(md.includes('#'), 'should have heading');
    } finally {
      if (existsSync(jsonlPath)) unlinkSync(jsonlPath);
    }
  });

  it('includes session ID and status in report', () => {
    const jsonlPath = join(tmpdir(), 'test-report-session.jsonl');
    writeFileSync(jsonlPath, sampleJsonl, 'utf-8');
    try {
      const md = generateReport(jsonlPath);
      assert.ok(md.includes('f3a9b2'), 'should include session id');
      assert.ok(
        md.includes('completed') || md.includes('Completed'),
        'should include status',
      );
    } finally {
      if (existsSync(jsonlPath)) unlinkSync(jsonlPath);
    }
  });

  it('each step section has heading with step name', () => {
    const jsonlPath = join(tmpdir(), 'test-report-steps.jsonl');
    writeFileSync(jsonlPath, sampleJsonl, 'utf-8');
    try {
      const md = generateReport(jsonlPath);
      assert.ok(md.includes('Pre-flight checks'), 'should include step 1 name');
      assert.ok(md.includes('Deploy App'), 'should include step 2 name');
    } finally {
      if (existsSync(jsonlPath)) unlinkSync(jsonlPath);
    }
  });

  it('command output rendered as code block', () => {
    const jsonlPath = join(tmpdir(), 'test-report-code.jsonl');
    writeFileSync(jsonlPath, sampleJsonl, 'utf-8');
    try {
      const md = generateReport(jsonlPath);
      assert.ok(md.includes('```'), 'should have code block');
      assert.ok(md.includes('kubectl'), 'should include command');
    } finally {
      if (existsSync(jsonlPath)) unlinkSync(jsonlPath);
    }
  });

  it('includes rollback section (even if empty)', () => {
    const jsonlPath = join(tmpdir(), 'test-report-rollback.jsonl');
    writeFileSync(jsonlPath, sampleJsonl, 'utf-8');
    try {
      const md = generateReport(jsonlPath);
      assert.ok(
        md.includes('Rollback') || md.includes('rollback'),
        'should have rollback section',
      );
    } finally {
      if (existsSync(jsonlPath)) unlinkSync(jsonlPath);
    }
  });

  it('summary shows step counts and operation file', () => {
    const jsonlPath = join(tmpdir(), 'test-report-summary.jsonl');
    writeFileSync(jsonlPath, sampleJsonl, 'utf-8');
    try {
      const md = generateReport(jsonlPath);
      assert.ok(md.includes('deployment.yaml'), 'should mention op file');
      assert.ok(md.includes('2'), 'should show step count');
    } finally {
      if (existsSync(jsonlPath)) unlinkSync(jsonlPath);
    }
  });

  it('includes rollback events in dedicated section', () => {
    const withRollback = makeJsonl([
      {
        type: 'session_start',
        op: 'deploy.yaml',
        tmux_session: 'samaritan-rb1',
      },
      { type: 'step_start', step: 0, name: 'Deploy' },
      { type: 'rollback_start', step: 0, triggered_by: 'user_input' },
      {
        type: 'command_sent',
        session: 'execution',
        command: 'kubectl rollout undo',
        context: 'rollback',
      },
      { type: 'rollback_complete', step: 0, status: 'success' },
      { type: 'session_end', status: 'rolled_back', steps_completed: 0 },
    ]);
    const jsonlPath = join(tmpdir(), 'test-report-rb.jsonl');
    writeFileSync(jsonlPath, withRollback, 'utf-8');
    try {
      const md = generateReport(jsonlPath);
      assert.ok(
        md.includes('kubectl rollout undo') || md.includes('Rollback'),
        'should show rollback event',
      );
    } finally {
      if (existsSync(jsonlPath)) unlinkSync(jsonlPath);
    }
  });
});
