import assert from 'node:assert';
import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { deletePersistedSession } from '../../src/lib/session-persistence';
import { startServer } from '../../src/lib/web/server';
import { parseOperation } from '../../src/operations/parser';

const FIXTURE = resolve(
  'tests/fixtures/operations/features/evidence-with-results.yaml',
);

// Sessions created by these tests are real files under ~/.samaritan/sessions/
// (same as `run`'s session persistence) — track and clean them up so the
// test suite doesn't leave test fixtures behind on disk.
const createdSessionIds: string[] = [];

afterEach(() => {
  while (createdSessionIds.length > 0) {
    const id = createdSessionIds.pop();
    if (!id) continue;
    deletePersistedSession(id);
    const sessionDir = join(homedir(), '.samaritan', 'sessions', id);
    if (existsSync(sessionDir)) {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  }
});

async function withServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const operation = await parseOperation(FIXTURE);
  const handle = await startServer(operation, FIXTURE, { port: 0 });
  try {
    return await fn(handle.url);
  } finally {
    await handle.close();
  }
}

describe('samaritan serve HTTP server', () => {
  it('GET /api/operation returns the view model with envs and steps', async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/operation`);
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.meta.name, 'Evidence with Results Test');
      assert.deepStrictEqual(body.environments, ['staging', 'production']);
      assert.ok(Array.isArray(body.steps));
      assert.ok(body.steps.length >= 3);
      assert.strictEqual(body.steps[0].label, '1');
    });
  });

  it('GET / returns 200 HTML containing the operation name', async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/`);
      assert.strictEqual(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', /text\/html/);
      const html = await res.text();
      assert.ok(html.includes('Evidence with Results Test'));
      assert.ok(html.includes('EXPERIMENTAL'));
    });
  });

  it('never executes step commands: no matching child_process import', async () => {
    // Static guard mirroring the runtime contract: the server module (and its
    // view-model/app-html collaborators) must not import child_process.
    const fs = await import('node:fs');
    for (const file of [
      'src/lib/web/server.ts',
      'src/lib/web/view-model.ts',
      'src/lib/web/app-html.ts',
    ]) {
      const source = fs.readFileSync(resolve(file), 'utf-8');
      assert.ok(
        !/child_process/.test(source),
        `${file} must not reference child_process`,
      );
    }
  });

  it('full run lifecycle: create run, update step, attach evidence, verify via history', async () => {
    await withServer(async (baseUrl) => {
      const createRes = await fetch(`${baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          environment: 'staging',
          operator: 'test-operator',
        }),
      });
      assert.strictEqual(createRes.status, 201);
      const session = await createRes.json();
      assert.ok(session.id);
      createdSessionIds.push(session.id);
      assert.strictEqual(session.environment, 'staging');
      assert.strictEqual(session.mode, 'sidecar');

      // The new session shows up in history immediately.
      const historyRes = await fetch(`${baseUrl}/api/history`);
      assert.strictEqual(historyRes.status, 200);
      const history = await historyRes.json();
      assert.ok(history.some((s: any) => s.id === session.id));

      // Update step 0's status + a note.
      const stepRes = await fetch(`${baseUrl}/api/runs/${session.id}/steps/0`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed', note: 'looks good' }),
      });
      assert.strictEqual(stepRes.status, 200);
      const afterStep = await stepRes.json();
      assert.strictEqual(afterStep.step_log[0].status, 'completed');
      assert.deepStrictEqual(afterStep.step_log[0].notes, ['looks good']);
      assert.ok(afterStep.completion_percentage > 0);

      // Attach base64 file evidence to step 1.
      const dataBase64 = Buffer.from('hello evidence').toString('base64');
      const evidenceRes = await fetch(
        `${baseUrl}/api/runs/${session.id}/steps/1/evidence`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'file',
            description: 'test upload',
            filename: 'note.txt',
            dataBase64,
          }),
        },
      );
      assert.strictEqual(evidenceRes.status, 201);
      const afterEvidence = await evidenceRes.json();
      const evidenceItem = afterEvidence.evidence.find(
        (e: any) => e.step_id === '1',
      );
      assert.ok(
        evidenceItem,
        'evidence item should be recorded on the session',
      );
      assert.strictEqual(evidenceItem.metadata.size, 14);
      assert.ok(
        existsSync(evidenceItem.content),
        'evidence file should be written to disk',
      );

      const stepRecord = afterEvidence.step_log.find((r: any) => r.index === 1);
      assert.ok(stepRecord, 'step_log entry for step 1 should exist');
      assert.strictEqual(stepRecord.evidence[0].filename, 'note.txt');

      // GET /api/history/:id reflects everything above.
      const detailRes = await fetch(`${baseUrl}/api/history/${session.id}`);
      assert.strictEqual(detailRes.status, 200);
      const detail = await detailRes.json();
      assert.strictEqual(detail.session.id, session.id);
      assert.strictEqual(detail.step_log[0].status, 'completed');
    });
  });

  it('rejects an unknown environment with 400', async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment: 'does-not-exist' }),
      });
      assert.strictEqual(res.status, 400);
    });
  });

  it('returns 404 for an unknown session id in history', async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/history/does-not-exist`);
      assert.strictEqual(res.status, 404);
    });
  });

  it('rejects an out-of-range step index with 400', async () => {
    await withServer(async (baseUrl) => {
      const createRes = await fetch(`${baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment: 'staging' }),
      });
      const session = await createRes.json();
      createdSessionIds.push(session.id);

      const res = await fetch(`${baseUrl}/api/runs/${session.id}/steps/9999`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });
      assert.strictEqual(res.status, 400);
    });
  });
});
