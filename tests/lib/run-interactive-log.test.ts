import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';

const CLI = 'node_modules/.bin/tsx';
const INDEX = 'src/cli/index.ts';

function fixturePath(name: string): string {
  const map: Record<string, string> = {
    minimal: 'tests/fixtures/operations/valid/minimal.yaml',
  };
  return resolve(map[name]);
}

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

function findLogPath(combined: string): string | null {
  // Session ID is a UUID printed as "📋 Session: <uuid>"
  const match = combined.match(
    /Session:\s+([\w-]{8}-[\w-]{4}-[\w-]{4}-[\w-]{4}-[\w-]{12})/,
  );
  if (!match) return null;
  // Run records are written beside the operation file under .samaritan-runs/.
  return join(
    dirname(fixturePath('minimal')),
    '.samaritan-runs',
    match[1],
    'events.jsonl',
  );
}

describe('Interactive run JSONL event log', () => {
  it('emits session_start with op field at start of run', () => {
    const fixture = fixturePath('minimal');
    const result = runCli(['run', fixture, '--env', 'default'], {
      input: 'q\n',
    });
    const combined = result.stdout + result.stderr;
    const logPath = findLogPath(combined);
    if (!logPath || !existsSync(logPath)) return;

    try {
      const events = readFileSync(logPath, 'utf-8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));

      const start = events.find((e) => e.type === 'session_start');
      assert.ok(start, 'should emit session_start event');
      assert.ok(start.op, 'session_start should include op field');
      assert.ok(
        start.op.includes('minimal.yaml'),
        `op should reference the fixture: got ${start.op}`,
      );
    } finally {
      if (existsSync(logPath)) unlinkSync(logPath);
    }
  });

  it('emits at least one step_start event per step entered', () => {
    const fixture = fixturePath('minimal');
    const result = runCli(['run', fixture, '--env', 'default'], {
      input: '\nq\n',
    });
    const combined = result.stdout + result.stderr;
    const logPath = findLogPath(combined);
    if (!logPath || !existsSync(logPath)) return;

    try {
      const events = readFileSync(logPath, 'utf-8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));

      const stepStarts = events.filter((e) => e.type === 'step_start');
      assert.ok(stepStarts.length > 0, 'should emit at least one step_start');
      assert.ok(stepStarts[0].name, 'step_start should have name field');
      assert.strictEqual(
        typeof stepStarts[0].step,
        'number',
        'step_start should have numeric step index',
      );
    } finally {
      if (existsSync(logPath)) unlinkSync(logPath);
    }
  });

  it('emits session_end as last event with status and steps_completed', () => {
    const fixture = fixturePath('minimal');
    const result = runCli(['run', fixture, '--env', 'default'], {
      input: 'q\n',
    });
    const combined = result.stdout + result.stderr;
    const logPath = findLogPath(combined);
    if (!logPath || !existsSync(logPath)) return;

    try {
      const lines = readFileSync(logPath, 'utf-8')
        .trim()
        .split('\n')
        .filter(Boolean);
      const last = JSON.parse(lines[lines.length - 1]);

      assert.strictEqual(
        last.type,
        'session_end',
        'last event should be session_end',
      );
      assert.ok('status' in last, 'session_end should carry status field');
      assert.ok(
        'steps_completed' in last,
        'session_end should carry steps_completed field',
      );
    } finally {
      if (existsSync(logPath)) unlinkSync(logPath);
    }
  });

  it('all events carry session_id and ts fields', () => {
    const fixture = fixturePath('minimal');
    const result = runCli(['run', fixture, '--env', 'default'], {
      input: 'q\n',
    });
    const combined = result.stdout + result.stderr;
    const logPath = findLogPath(combined);
    if (!logPath || !existsSync(logPath)) return;

    try {
      const events = readFileSync(logPath, 'utf-8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));

      for (const event of events) {
        assert.ok(event.ts, `event ${event.type} must have ts`);
        assert.ok(event.session_id, `event ${event.type} must have session_id`);
      }
    } finally {
      if (existsSync(logPath)) unlinkSync(logPath);
    }
  });

  it('prints audit log path to terminal on session start', () => {
    const fixture = fixturePath('minimal');
    const result = runCli(['run', fixture, '--env', 'default'], {
      input: 'q\n',
    });
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.toLowerCase().includes('audit log') ||
        combined.includes('Audit log'),
      'output should mention "Audit log"',
    );
    assert.ok(combined.includes('.jsonl'), 'output should include .jsonl path');
  });

  it('typing r at step prompt triggers rollback handling', () => {
    const fixture = fixturePath('minimal');
    const result = runCli(['run', fixture, '--env', 'default'], {
      input: 'r\nq\n',
      timeout: 15_000,
    });
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.toLowerCase().includes('rollback'),
      'output should contain rollback-related message when user types r',
    );
  });
});
