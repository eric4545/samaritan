import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

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

const FAILING_OP = `name: Mock Fail
version: 1.0.0
description: expect does not match captured evidence
author: test
environments:
  - name: staging
    description: staging
    variables: {}
    restrictions: []
    approval_required: false
    validation_required: false
steps:
  - name: Bad Check
    type: automatic
    command: echo hi
    expect:
      contains: Succeeded
    evidence:
      results:
        staging:
          - type: command_output
            content: |
              CrashLoopBackOff
`;

describe('run --mock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mock-cli-'));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('passes and exits 0 for the bundled example', () => {
    const result = runCli([
      'run',
      'examples/mock-run-expect.yaml',
      '--env',
      'staging',
      '--mock',
    ]);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /Mock run summary: 2 passed, 0 failed/);
  });

  it('exits non-zero when an expect does not match its evidence', () => {
    const opPath = join(dir, 'failing.yaml');
    writeFileSync(opPath, FAILING_OP);
    const result = runCli(['run', opPath, '--env', 'staging', '--mock']);
    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /1 failed/);
  });

  it('requires an environment', () => {
    const result = runCli(['run', 'examples/mock-run-expect.yaml', '--mock']);
    assert.notStrictEqual(result.status, 0);
  });
});
