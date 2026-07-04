import assert from 'node:assert';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { postmortemFromRun } from '../../src/lib/postmortem-from-run';
import { generatePostmortemMarkdown } from '../../src/manuals/postmortem-generator';
import { validatePostmortemSchema } from '../../src/operations/postmortem-parser';

const EVENTS = [
  {
    ts: '2026-07-01T14:32:00.000Z',
    type: 'session_start',
    op: 'deployment.yaml',
  },
  {
    ts: '2026-07-01T14:33:00.000Z',
    type: 'step_start',
    step: 0,
    name: 'Pre-flight checks',
    pic: 'ops@example.com',
  },
  { ts: '2026-07-01T14:35:00.000Z', type: 'step_complete', step: 0 },
  {
    ts: '2026-07-01T14:36:00.000Z',
    type: 'step_start',
    step: 1,
    name: 'Deploy App',
    pic: 'alice@example.com',
    reviewer: 'bob@example.com',
  },
  {
    ts: '2026-07-01T14:40:00.000Z',
    type: 'step_failed',
    step: 1,
    name: 'Deploy App',
    reason: 'pod CrashLoopBackOff',
  },
  {
    ts: '2026-07-01T14:41:00.000Z',
    type: 'rollback_start',
    step: 1,
    triggered_by: 'user_input',
  },
  {
    ts: '2026-07-01T14:45:00.000Z',
    type: 'rollback_complete',
    step: 1,
    status: 'success',
  },
  {
    ts: '2026-07-01T14:46:00.000Z',
    type: 'session_end',
    status: 'rolled_back',
  },
];

describe('postmortemFromRun', () => {
  let dir: string;
  let jsonlPath: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'samaritan-fromrun-'));
    jsonlPath = join(dir, 'events.jsonl');
    writeFileSync(
      jsonlPath,
      `${EVENTS.map((e) => JSON.stringify({ session_id: 'abc123', ...e })).join('\n')}\n`,
      'utf-8',
    );
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('seeds a schema-valid postmortem from a run log', () => {
    const pm = postmortemFromRun(jsonlPath);
    assert.equal(
      validatePostmortemSchema(pm).length,
      0,
      'seeded doc is schema-valid',
    );
  });

  it('sets the incident window from first/last event timestamps', () => {
    const pm = postmortemFromRun(jsonlPath);
    assert.equal(pm.occurred_at, '2026-07-01T14:32:00.000Z');
    assert.equal(pm.resolved_at, '2026-07-01T14:46:00.000Z');
  });

  it('collects participants from step PIC/reviewer', () => {
    const pm = postmortemFromRun(jsonlPath);
    assert.deepEqual(pm.authors, [
      'ops@example.com',
      'alice@example.com',
      'bob@example.com',
    ]);
  });

  it('builds a timeline including the failure and rollback', () => {
    const pm = postmortemFromRun(jsonlPath);
    const events = pm.timeline?.map((t) => t.event) ?? [];
    assert.ok(events.some((e) => e.includes('Started: Deploy App')));
    assert.ok(events.some((e) => e.includes('Failed: Deploy App')));
    assert.ok(events.some((e) => e.includes('Rollback complete')));
    assert.ok(events.some((e) => e.includes('Run ended: rolled_back')));
    // failure entry classified as a cause
    const fail = pm.timeline?.find((t) => t.event.includes('Failed'));
    assert.equal(fail?.kind, 'cause');
  });

  it('back-references the operation and run log', () => {
    const pm = postmortemFromRun(jsonlPath);
    assert.equal(pm.operation, 'deployment.yaml');
    assert.equal(pm.run, jsonlPath);
  });

  it('leaves narrative fields as TODO placeholders', () => {
    const pm = postmortemFromRun(jsonlPath);
    assert.ok(pm.summary.startsWith('TODO'));
    assert.ok(pm.root_cause?.summary.includes('Deploy App'));
  });

  it('the seeded doc re-renders to Markdown', () => {
    const pm = postmortemFromRun(jsonlPath);
    const md = generatePostmortemMarkdown(pm);
    assert.ok(md.includes('# Incident: deployment'));
    assert.ok(md.includes('## Timeline'));
  });

  it('throws a helpful error for an unknown session/path', () => {
    assert.throws(
      () => postmortemFromRun('nonexistent-session-id'),
      /No events log or saved session/,
    );
  });

  it('throws when the run log has no events', () => {
    const empty = join(dir, 'empty.jsonl');
    writeFileSync(empty, '', 'utf-8');
    assert.throws(() => postmortemFromRun(empty), /No events found/);
    assert.ok(existsSync(empty));
  });
});
