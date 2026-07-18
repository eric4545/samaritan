import assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

/**
 * Write JSONL into a freshly-created private temp directory (0700, random
 * name) and return the file path. Using mkdtempSync avoids the predictable
 * shared-tmp filename that CodeQL's js/insecure-temporary-file flags.
 */
function writeTempJsonl(content: string): string {
  const jsonlPath = join(
    mkdtempSync(join(tmpdir(), 'samaritan-report-')),
    'events.jsonl',
  );
  writeFileSync(jsonlPath, content, 'utf-8');
  return jsonlPath;
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
    const jsonlPath = writeTempJsonl(sampleJsonl);
    try {
      const md = generateReport(jsonlPath);
      assert.ok(typeof md === 'string', 'should return string');
      assert.ok(md.includes('#'), 'should have heading');
    } finally {
      rmSync(dirname(jsonlPath), { recursive: true, force: true });
    }
  });

  it('includes session ID and status in report', () => {
    const jsonlPath = writeTempJsonl(sampleJsonl);
    try {
      const md = generateReport(jsonlPath);
      assert.ok(md.includes('f3a9b2'), 'should include session id');
      assert.ok(
        md.includes('completed') || md.includes('Completed'),
        'should include status',
      );
    } finally {
      rmSync(dirname(jsonlPath), { recursive: true, force: true });
    }
  });

  it('each step section has heading with step name', () => {
    const jsonlPath = writeTempJsonl(sampleJsonl);
    try {
      const md = generateReport(jsonlPath);
      assert.ok(md.includes('Pre-flight checks'), 'should include step 1 name');
      assert.ok(md.includes('Deploy App'), 'should include step 2 name');
    } finally {
      rmSync(dirname(jsonlPath), { recursive: true, force: true });
    }
  });

  it('command output rendered as code block', () => {
    const jsonlPath = writeTempJsonl(sampleJsonl);
    try {
      const md = generateReport(jsonlPath);
      assert.ok(md.includes('```'), 'should have code block');
      assert.ok(md.includes('kubectl'), 'should include command');
    } finally {
      rmSync(dirname(jsonlPath), { recursive: true, force: true });
    }
  });

  it('includes rollback section (even if empty)', () => {
    const jsonlPath = writeTempJsonl(sampleJsonl);
    try {
      const md = generateReport(jsonlPath);
      assert.ok(
        md.includes('Rollback') || md.includes('rollback'),
        'should have rollback section',
      );
    } finally {
      rmSync(dirname(jsonlPath), { recursive: true, force: true });
    }
  });

  it('summary shows step counts and operation file', () => {
    const jsonlPath = writeTempJsonl(sampleJsonl);
    try {
      const md = generateReport(jsonlPath);
      assert.ok(md.includes('deployment.yaml'), 'should mention op file');
      assert.ok(md.includes('2'), 'should show step count');
    } finally {
      rmSync(dirname(jsonlPath), { recursive: true, force: true });
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
    const jsonlPath = writeTempJsonl(withEvidence);
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
      rmSync(dirname(jsonlPath), { recursive: true, force: true });
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
    const jsonlPath = writeTempJsonl(withEvidence);
    try {
      const md = generateReport(jsonlPath);
      assert.ok(
        md.includes(
          '![Evidence](/home/user/.samaritan/sessions/abc123/evidence/uuid-dashboard.png)',
        ),
        'should embed the screenshot as an image',
      );
    } finally {
      rmSync(dirname(jsonlPath), { recursive: true, force: true });
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
    const jsonlPath = writeTempJsonl(withEvidence);
    try {
      const md = generateReport(jsonlPath);
      assert.ok(
        md.includes(
          '[View file](/home/user/.samaritan/sessions/abc123/evidence/uuid-deploy.log)',
        ),
        'should render file evidence as a link',
      );
    } finally {
      rmSync(dirname(jsonlPath), { recursive: true, force: true });
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
    const jsonlPath = writeTempJsonl(withRemoval);
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
      rmSync(dirname(jsonlPath), { recursive: true, force: true });
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
    const jsonlPath = writeTempJsonl(withNotes);
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
      rmSync(dirname(jsonlPath), { recursive: true, force: true });
    }
  });

  it('command_displayed renders as "Command (run by operator)" in sidecar mode', () => {
    const withDisplayed = makeJsonl([
      {
        type: 'session_start',
        op: 'sidecar.yaml',
        tmux_session: undefined,
      },
      {
        type: 'step_start',
        step: 0,
        name: 'Deploy App',
      },
      {
        type: 'command_displayed',
        step: 0,
        session: 'default',
        command: 'kubectl apply -f deployment.yaml',
      },
      { type: 'step_complete', step: 0 },
      { type: 'session_end', status: 'completed', steps_completed: 1 },
    ]);
    const jsonlPath = writeTempJsonl(withDisplayed);
    try {
      const md = generateReport(jsonlPath);
      assert.ok(
        md.includes('**Command (run by operator)**'),
        'should use "Command (run by operator)" label for command_displayed events',
      );
      assert.ok(
        md.includes('kubectl apply -f deployment.yaml'),
        'should include the command',
      );
      assert.ok(
        !md.includes('**Command sent**'),
        'must not use "Command sent" label for command_displayed events',
      );
    } finally {
      rmSync(dirname(jsonlPath), { recursive: true, force: true });
    }
  });

  it('command_sent still renders as "Command sent"', () => {
    const jsonlPath = writeTempJsonl(sampleJsonl);
    try {
      const md = generateReport(jsonlPath);
      assert.ok(
        md.includes('**Command sent**'),
        'regular command_sent events should still use "Command sent" label',
      );
    } finally {
      rmSync(dirname(jsonlPath), { recursive: true, force: true });
    }
  });

  it('renders per-check verification results with expected/actual', () => {
    const withVerify = makeJsonl([
      { type: 'session_start', op: 'deploy.yaml' },
      { type: 'step_start', step: 0, name: 'Verify rollout' },
      {
        type: 'assert_result',
        step: 0,
        pass: true,
        actual: '3',
        expected: '>= 3',
        assertion_type: 'count',
      },
      {
        type: 'assert_result',
        step: 0,
        pass: false,
        actual: 'CrashLoopBackOff',
        expected: 'Running',
        assertion_type: 'contains',
      },
      { type: 'step_complete', step: 0 },
      { type: 'session_end', status: 'completed', steps_completed: 1 },
    ]);
    const jsonlPath = writeTempJsonl(withVerify);
    try {
      const md = generateReport(jsonlPath);
      assert.ok(
        md.includes('**Verification**'),
        'should have verification block',
      );
      assert.ok(
        md.includes('❌ FAIL'),
        'overall should fail when any check fails',
      );
      assert.ok(md.includes('expected: `>= 3`'), 'should show expected');
      assert.ok(
        md.includes('actual: `CrashLoopBackOff`'),
        'should show actual for failing check',
      );
    } finally {
      rmSync(dirname(jsonlPath), { recursive: true, force: true });
    }
  });

  it('renders multi-line verify output as a fenced code block, not inline backticks', () => {
    const multiline =
      'pod/web-0   0/1   CrashLoopBackOff   3   40s\npod/web-1   1/1   Running            0   2m';
    const withVerify = makeJsonl([
      { type: 'session_start', op: 'deploy.yaml' },
      { type: 'step_start', step: 0, name: 'Verify rollout' },
      {
        type: 'assert_result',
        step: 0,
        pass: false,
        actual: multiline,
        expected: 'contains "Running"',
        assertion_type: 'contains',
      },
      { type: 'step_complete', step: 0 },
      { type: 'session_end', status: 'completed', steps_completed: 1 },
    ]);
    const jsonlPath = writeTempJsonl(withVerify);
    try {
      const md = generateReport(jsonlPath);
      // The capture must be inside a fenced block under the check bullet…
      assert.ok(
        md.includes('  ```\n  pod/web-0   0/1   CrashLoopBackOff'),
        'multi-line actual should be fenced, not inline',
      );
      // …and NOT wrapped in a single inline-backtick pair spanning newlines.
      assert.ok(
        !md.includes('actual: `pod/web-0'),
        'multi-line actual must not use inline backticks',
      );
    } finally {
      rmSync(dirname(jsonlPath), { recursive: true, force: true });
    }
  });

  it('redacts operator-local paths in verify actual/expected', () => {
    const withVerify = makeJsonl([
      { type: 'session_start', op: '/home/alice/ops/deploy.yaml' },
      { type: 'step_start', step: 0, name: 'Verify config' },
      {
        type: 'assert_result',
        step: 0,
        pass: false,
        // Path lives under the operation dir, so it should be stripped.
        actual: 'reading /home/alice/ops/config/app.yaml\nstatus: bad',
        expected: 'contains "ok"',
        assertion_type: 'contains',
      },
      { type: 'step_complete', step: 0 },
      { type: 'session_end', status: 'completed', steps_completed: 1 },
    ]);
    const jsonlPath = writeTempJsonl(withVerify);
    try {
      const md = generateReport(jsonlPath);
      assert.ok(
        !md.includes('/home/alice/ops/config/app.yaml'),
        'operation-dir path should be redacted from actual',
      );
      assert.ok(
        md.includes('config/app.yaml'),
        'redacted path should keep its relative tail',
      );
    } finally {
      rmSync(dirname(jsonlPath), { recursive: true, force: true });
    }
  });

  it('renders per-step duration when timing is present', () => {
    const withTiming = makeJsonl([
      { type: 'session_start', op: 'deploy.yaml' },
      {
        type: 'step_start',
        step: 0,
        name: 'Slow step',
        ts: '2026-07-15T10:00:00.000Z',
      },
      {
        type: 'step_complete',
        step: 0,
        ts: '2026-07-15T10:01:05.000Z',
      },
      { type: 'session_end', status: 'completed', steps_completed: 1 },
    ]);
    const jsonlPath = writeTempJsonl(withTiming);
    try {
      const md = generateReport(jsonlPath);
      assert.ok(
        md.includes('**Duration**: 1m 5s'),
        'should show the per-step duration',
      );
    } finally {
      rmSync(dirname(jsonlPath), { recursive: true, force: true });
    }
  });

  it('labels command output with a bold **Output** heading', () => {
    const jsonlPath = writeTempJsonl(sampleJsonl);
    try {
      const md = generateReport(jsonlPath);
      assert.ok(
        md.includes('**Output**'),
        'command output should use a bold Output label',
      );
    } finally {
      rmSync(dirname(jsonlPath), { recursive: true, force: true });
    }
  });

  it('renders an Approval Trail with approver, decision and rationale', () => {
    const withApproval = makeJsonl([
      { type: 'session_start', op: 'deploy.yaml' },
      { type: 'step_start', step: 0, name: 'Production gate' },
      {
        type: 'user_input',
        action: 'approved',
        step: 0,
        actor: 'lead@example.com',
        rationale: 'CHG-42 signed off',
      },
      { type: 'step_complete', step: 0 },
      { type: 'session_end', status: 'completed', steps_completed: 1 },
    ]);
    const jsonlPath = writeTempJsonl(withApproval);
    try {
      const md = generateReport(jsonlPath);
      assert.ok(
        md.includes('## Approval Trail'),
        'should have approval trail section',
      );
      assert.ok(md.includes('lead@example.com'), 'should name the approver');
      assert.ok(md.includes('✅ approved'), 'should show the decision');
      assert.ok(
        md.includes('CHG-42 signed off'),
        'should include the rationale',
      );
    } finally {
      rmSync(dirname(jsonlPath), { recursive: true, force: true });
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
    const jsonlPath = writeTempJsonl(withRollback);
    try {
      const md = generateReport(jsonlPath);
      assert.ok(
        md.includes('kubectl rollout undo') || md.includes('Rollback'),
        'should show rollback event',
      );
    } finally {
      rmSync(dirname(jsonlPath), { recursive: true, force: true });
    }
  });
});
