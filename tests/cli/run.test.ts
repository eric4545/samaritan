import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { getFixturePath } from '../fixtures/fixtures';

const CLI = 'node_modules/.bin/tsx';
const INDEX = 'src/cli/index.ts';

function runCli(args: string[]): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(CLI, [INDEX, ...args], { encoding: 'utf8' });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  };
}

describe('run command: pause output accuracy', () => {
  it('does not print a resume hint when operation pauses on a manual step', () => {
    // deployment-test has manual steps; staging env has no approval required
    const fixture = getFixturePath('deploymentTest');
    const result = runCli(['run', fixture, '--env', 'staging']);

    const combined = result.stdout + result.stderr;
    assert.ok(
      !combined.includes('samaritan resume'),
      'Output must not suggest "samaritan resume" — session is not persisted across invocations',
    );
  });

  it('prints paused status instead of completed when manual step is encountered', () => {
    const fixture = getFixturePath('deploymentTest');
    const result = runCli(['run', fixture, '--env', 'staging']);

    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('paused') || combined.includes('Paused') || combined.includes('waiting'),
      'Output must indicate operation paused, not completed',
    );
    assert.ok(
      !combined.includes('Operation completed successfully'),
      'Output must not claim the operation completed successfully',
    );
  });

  it('prints honest note about session persistence when paused', () => {
    const fixture = getFixturePath('deploymentTest');
    const result = runCli(['run', fixture, '--env', 'staging']);

    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('not persisted') || combined.includes('not yet') || combined.includes('not available'),
      'Output must explain that session state is not persisted or interactive mode is not available',
    );
  });

  it('warns about interactive mode limitations before execution starts', () => {
    const fixture = getFixturePath('deploymentTest');
    const result = runCli(['run', fixture, '--env', 'staging']);

    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('not yet available') || combined.includes('Interactive execution'),
      'Should warn about interactive execution limitation upfront',
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
