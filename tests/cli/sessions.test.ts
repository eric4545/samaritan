import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const CLI = 'node_modules/.bin/tsx';
const INDEX = 'src/cli/index.ts';

function runCli(
  args: string[],
  opts?: { input?: string; timeout?: number },
): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(CLI, [INDEX, ...args], {
    encoding: 'utf8',
    input: opts?.input,
    timeout: opts?.timeout ?? 15_000,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  };
}

describe('sessions command', () => {
  it('sessions --help exits 0 and shows usage', () => {
    const result = runCli(['sessions', '--help']);
    assert.strictEqual(result.status, 0, 'sessions --help must exit 0');
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('List saved run sessions'),
      'help must describe the command',
    );
    assert.ok(combined.includes('--all'), 'help must mention --all');
  });

  it('sessions exits 0 even with no resumable sessions', () => {
    const result = runCli(['sessions']);
    assert.strictEqual(result.status, 0, 'sessions must exit 0');
  });

  it('sessions --all lists a session created by run', () => {
    const fixture = resolve('tests/fixtures/operations/valid/minimal.yaml');
    const runResult = runCli([
      'run',
      fixture,
      '--env',
      'default',
      '--auto-approve',
    ]);
    const idMatch = (runResult.stdout + runResult.stderr).match(
      /📋 Session: ([0-9a-f-]{36})/,
    );
    assert.ok(idMatch, 'run must print the session id');
    const sessionId = idMatch[1];

    const result = runCli(['sessions', '--all']);
    assert.strictEqual(result.status, 0, 'sessions --all must exit 0');
    assert.ok(
      result.stdout.includes(sessionId),
      'sessions --all must list the session created by run',
    );
  });

  it('sessions shows a resume hint for resumable sessions', () => {
    const fixture = resolve(
      'tests/fixtures/operations/features/manual-step-actions.yaml',
    );
    // Abort at the first step — the session is persisted as paused/resumable
    const runResult = runCli(['run', fixture, '--env', 'default'], {
      input: 'q\n',
    });
    const idMatch = (runResult.stdout + runResult.stderr).match(
      /📋 Session: ([0-9a-f-]{36})/,
    );
    assert.ok(idMatch, 'run must print the session id');
    const sessionId = idMatch[1];

    const result = runCli(['sessions']);
    assert.ok(
      result.stdout.includes(`samaritan resume ${sessionId}`),
      'sessions must print a resume hint for the aborted (paused) session',
    );
  });
});
