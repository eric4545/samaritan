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

  it('renders text/command_output evidence as a code block', () => {
    const withEvidence = makeJsonl([
      {
        type: 'session_start',
        op: 'deploy.yaml',
        tmux_session: 'samaritan-ev1',
      },
      { type: 'step_start', step: 0, name: 'Check pods' },
      {
        type: 'evidence_captured',
        step: 0,
        evidence_id: 'ev-1',
        evidence_type: 'command_output',
        automatic: true,
        description: 'Pod status output',
        content: 'pod/web-0   1/1   Running',
      },
      { type: 'step_complete', step: 0 },
      { type: 'session_end', status: 'completed', steps_completed: 1 },
    ]);
    const jsonlPath = join(tmpdir(), 'test-report-evidence-text.jsonl');
    writeFileSync(jsonlPath, withEvidence, 'utf-8');
    try {
      const md = generateReport(jsonlPath);
      assert.ok(
        md.includes('**Evidence**: command_output — Pod status output'),
        'should label the evidence with description',
      );
      assert.ok(
        md.includes('pod/web-0   1/1   Running'),
        'should include content',
      );
      assert.ok(md.includes('```'), 'content rendered as code block');
    } finally {
      if (existsSync(jsonlPath)) unlinkSync(jsonlPath);
    }
  });

  it('renders screenshot evidence as an embedded image', () => {
    const withEvidence = makeJsonl([
      {
        type: 'session_start',
        op: 'deploy.yaml',
        tmux_session: 'samaritan-ev2',
      },
      { type: 'step_start', step: 0, name: 'Capture dashboard' },
      {
        type: 'evidence_captured',
        step: 0,
        evidence_id: 'ev-2',
        evidence_type: 'screenshot',
        automatic: false,
        description: 'Dashboard screenshot',
        filename: 'dashboard.png',
        path: '/home/user/.samaritan/sessions/abc123/evidence/uuid-dashboard.png',
      },
      { type: 'step_complete', step: 0 },
      { type: 'session_end', status: 'completed', steps_completed: 1 },
    ]);
    const jsonlPath = join(tmpdir(), 'test-report-evidence-screenshot.jsonl');
    writeFileSync(jsonlPath, withEvidence, 'utf-8');
    try {
      const md = generateReport(jsonlPath);
      assert.ok(
        md.includes(
          '![Evidence](/home/user/.samaritan/sessions/abc123/evidence/uuid-dashboard.png)',
        ),
        'should embed the screenshot as an image',
      );
    } finally {
      if (existsSync(jsonlPath)) unlinkSync(jsonlPath);
    }
  });

  it('renders file/video evidence as a download-style link', () => {
    const withEvidence = makeJsonl([
      {
        type: 'session_start',
        op: 'deploy.yaml',
        tmux_session: 'samaritan-ev3',
      },
      { type: 'step_start', step: 0, name: 'Attach log file' },
      {
        type: 'evidence_captured',
        step: 0,
        evidence_id: 'ev-3',
        evidence_type: 'file',
        automatic: false,
        description: 'Deployment log',
        filename: 'deploy.log',
        path: '/home/user/.samaritan/sessions/abc123/evidence/uuid-deploy.log',
      },
      { type: 'step_complete', step: 0 },
      { type: 'session_end', status: 'completed', steps_completed: 1 },
    ]);
    const jsonlPath = join(tmpdir(), 'test-report-evidence-file.jsonl');
    writeFileSync(jsonlPath, withEvidence, 'utf-8');
    try {
      const md = generateReport(jsonlPath);
      assert.ok(
        md.includes(
          '[View file](/home/user/.samaritan/sessions/abc123/evidence/uuid-deploy.log)',
        ),
        'should render file evidence as a link',
      );
    } finally {
      if (existsSync(jsonlPath)) unlinkSync(jsonlPath);
    }
  });

  it('omits evidence that was later removed by the operator', () => {
    const withRemoval = makeJsonl([
      {
        type: 'session_start',
        op: 'deploy.yaml',
        tmux_session: 'samaritan-ev4',
      },
      { type: 'step_start', step: 0, name: 'Check pods' },
      {
        type: 'evidence_captured',
        step: 0,
        evidence_id: 'ev-keep',
        evidence_type: 'command_output',
        automatic: true,
        description: 'Kept output',
        content: 'pod/web-0   1/1   Running',
      },
      {
        type: 'evidence_captured',
        step: 0,
        evidence_id: 'ev-remove',
        evidence_type: 'command_output',
        automatic: false,
        description: 'Mistaken capture',
        content: 'oops wrong pane',
      },
      {
        type: 'evidence_removed',
        step: 0,
        evidence_id: 'ev-remove',
        evidence_type: 'command_output',
        description: 'Mistaken capture',
      },
      { type: 'step_complete', step: 0 },
      { type: 'session_end', status: 'completed', steps_completed: 1 },
    ]);
    const jsonlPath = join(tmpdir(), 'test-report-evidence-removed.jsonl');
    writeFileSync(jsonlPath, withRemoval, 'utf-8');
    try {
      const md = generateReport(jsonlPath);
      assert.ok(
        md.includes('**Evidence**: command_output — Kept output'),
        'should keep the evidence that was not removed',
      );
      assert.ok(
        !md.includes('Mistaken capture'),
        'should omit the removed evidence entirely',
      );
      assert.ok(
        !md.includes('oops wrong pane'),
        'should omit the removed evidence content',
      );
    } finally {
      if (existsSync(jsonlPath)) unlinkSync(jsonlPath);
    }
  });

  it('renders operator notes as a bullet list under the step', () => {
    const withNotes = makeJsonl([
      {
        type: 'session_start',
        op: 'deploy.yaml',
        tmux_session: 'samaritan-note1',
      },
      { type: 'step_start', step: 0, name: 'Manual restart' },
      {
        type: 'user_input',
        action: 'note',
        step: 0,
        actor: 'ops@example.com',
        notes: 'Restarted pod manually due to stuck rollout',
      },
      {
        type: 'user_input',
        action: 'note',
        step: 0,
        actor: 'ops@example.com',
        notes: 'Confirmed with on-call before proceeding',
      },
      { type: 'step_complete', step: 0 },
      { type: 'session_end', status: 'completed', steps_completed: 1 },
    ]);
    const jsonlPath = join(tmpdir(), 'test-report-notes.jsonl');
    writeFileSync(jsonlPath, withNotes, 'utf-8');
    try {
      const md = generateReport(jsonlPath);
      assert.ok(md.includes('**Notes**'), 'should have a Notes heading');
      assert.ok(
        md.includes('- Restarted pod manually due to stuck rollout'),
        'should list first note as a bullet',
      );
      assert.ok(
        md.includes('- Confirmed with on-call before proceeding'),
        'should list second note as a bullet',
      );
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
