import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { isShellcheckAvailable } from '../../src/lib/shell-lint';

const CLI = 'node_modules/.bin/tsx';
const INDEX = 'src/cli/index.ts';

function runCli(args: string[]): {
  stdout: string;
  stderr: string;
  status: number | null;
} {
  const result = spawnSync(CLI, [INDEX, ...args], {
    encoding: 'utf8',
    timeout: 20_000,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  };
}

describe('validate --lint', () => {
  it('validates a clean example and reports lint status', () => {
    const result = runCli(['validate', 'examples/deployment.yaml', '--lint']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /Operation validation passed/);

    if (isShellcheckAvailable()) {
      // When shellcheck IS available, the example should lint cleanly (no
      // shell-lint warnings) and the skip notice must NOT appear.
      assert.ok(!result.stdout.includes('shell-lint skipped'));
    } else {
      // Otherwise the graceful skip notice is printed and validation still passes.
      assert.match(result.stdout, /shell-lint skipped: shellcheck not found/);
    }
  });

  it('does not run shell-lint without the --lint flag', () => {
    const result = runCli(['validate', 'examples/deployment.yaml']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(!result.stdout.includes('shell-lint'));
  });
});
