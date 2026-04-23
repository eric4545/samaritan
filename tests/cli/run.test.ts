import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { getFixturePath } from '../fixtures/fixtures';

const CLI = 'node_modules/.bin/tsx';
const INDEX = 'src/cli/index.ts';

function runCli(args: string[], opts?: { input?: string }): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(CLI, [INDEX, ...args], {
    encoding: 'utf8',
    input: opts?.input,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  };
}

describe('run command: --env / --environment flag', () => {
  it('--env flag is accepted', () => {
    const fixture = getFixturePath('deploymentTest');
    const result = runCli(['run', fixture, '--env', 'staging', '--dry-run']);
    const combined = result.stdout + result.stderr;
    assert.ok(!combined.includes('not specified'), '--env should be accepted');
  });

  it('--environment flag is accepted as alias for --env', () => {
    const fixture = getFixturePath('deploymentTest');
    const result = runCli(['run', fixture, '--environment', 'staging', '--dry-run']);
    const combined = result.stdout + result.stderr;
    assert.ok(
      !combined.includes('not specified') && !combined.includes('unknown option'),
      '--environment should be accepted as an alias',
    );
  });

  it('missing env flag gives a clear error', () => {
    const fixture = getFixturePath('deploymentTest');
    const result = runCli(['run', fixture]);
    const combined = result.stdout + result.stderr;
    assert.notStrictEqual(result.status, 0);
    assert.ok(
      combined.includes('not specified') || combined.includes('required'),
      'Error must mention the missing required env option',
    );
  });
});

describe('run command: dry-run pause output', () => {
  // In --dry-run mode the operation uses the non-interactive executor path.
  // Automatic steps with autoMode=false return waiting, so the run pauses.

  it('does not print a resume hint when operation pauses', () => {
    const fixture = getFixturePath('deploymentTest');
    const result = runCli(['run', fixture, '--env', 'staging', '--dry-run']);

    const combined = result.stdout + result.stderr;
    assert.ok(
      !combined.includes('samaritan resume'),
      'Output must not suggest "samaritan resume" — session is not persisted across invocations',
    );
  });

  it('generate manual guidance includes the operation file path', () => {
    const fixture = getFixturePath('deploymentTest');
    const result = runCli(['run', fixture, '--env', 'staging', '--dry-run']);
    const combined = result.stdout + result.stderr;

    // The paused output should include the actual file path in the manual hint
    const hasFilePath =
      combined.includes('generate manual') && combined.includes(fixture);
    assert.ok(
      hasFilePath || !combined.includes('generate manual'),
      'If a generate manual hint is shown it must include the actual operation file path, not a placeholder',
    );
    assert.ok(
      !combined.includes('<operation.yaml>'),
      'Must not show placeholder <operation.yaml> — use actual path',
    );
  });
});

describe('run command: interactive mode (non-dry-run)', () => {
  it('starts interactive execution when not in dry-run mode', () => {
    const fixture = getFixturePath('deploymentTest');
    // Pipe a quit command so readline exits immediately without blocking
    const result = runCli(
      ['run', fixture, '--env', 'staging'],
      { input: 'q\n' },
    );
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('interactive') || combined.includes('Step') || combined.includes('Execute'),
      'Interactive mode should show step-by-step prompts',
    );
    assert.ok(
      !combined.includes('samaritan resume'),
      'Interactive mode must not print a resume hint',
    );
  });

  it('--auto-approve flag bypasses interactive prompts', () => {
    const fixture = getFixturePath('minimal');
    const result = runCli(['run', fixture, '--env', 'default', '--auto-approve']);
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('completed') || combined.includes('success') || result.status === 0,
      'Auto-approve should result in completed run, not interactive prompts',
    );
  });
});

describe('resume command: cross-process error message', () => {
  it('returns a clear error when session id is not found in a fresh process', () => {
    const result = runCli(['resume', 'nonexistent-session-id-abc123']);

    const combined = result.stdout + result.stderr;
    assert.notStrictEqual(result.status, 0, 'resume with unknown session must exit non-zero');
    assert.ok(
      combined.includes('Session not found') || combined.includes('not found'),
      'Error must mention the session was not found',
    );
    assert.ok(
      combined.includes('not persisted') || combined.includes('in-memory') || combined.includes('same process'),
      'Error must explain the in-memory limitation',
    );
  });
});
