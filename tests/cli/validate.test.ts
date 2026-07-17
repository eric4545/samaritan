import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('validate variable warnings', () => {
  it('does not warn about shell parameter-expansion guards like ${X:?}', () => {
    const dir = mkdtempSync(join(tmpdir(), 'samaritan-shell-guard-'));
    const file = join(dir, 'op.yaml');
    writeFileSync(
      file,
      `name: Shell Guard Test
version: 1.0.0
environments:
  - name: staging
    variables:
      SERVICE: web
steps:
  - name: Restart
    type: manual
    command: |
      POD=$(kubectl get pods -l app=\${SERVICE} -o name | head -1)
      kubectl delete "\${POD:?no pod found}"
`,
    );
    const result = runCli(['validate', file]);
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.ok(
      !result.stdout.includes('POD'),
      `must not warn about \${POD:?}, got: ${result.stdout}`,
    );
  });
});

describe('validate regex-lint', () => {
  function writeOp(expectYaml: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'samaritan-regex-lint-'));
    const file = join(dir, 'op.yaml');
    writeFileSync(
      file,
      `name: Regex Lint Test
version: 1.0.0
environments:
  - name: default
steps:
  - name: Check
    type: manual
    command: echo hi
    expect:
${expectYaml}
`,
    );
    return file;
  }

  it('fails validation on an invalid regex pattern', () => {
    const file = writeOp('      matches: "[unterminated"');
    const result = runCli(['validate', file]);
    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /regex-lint:.*invalid regex/);
  });

  it('warns (but passes) on a ReDoS-prone pattern', () => {
    const file = writeOp('      any_line_matches: "(a+)+$"');
    const result = runCli(['validate', file]);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /regex-lint:.*catastrophic/);
  });

  it('promotes a ReDoS-prone pattern to an error under --strict', () => {
    const file = writeOp('      any_line_matches: "(a+)+$"');
    const result = runCli(['validate', file, '--strict']);
    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /regex-lint:.*catastrophic/);
  });
});

describe('validate built-in variable shadowing', () => {
  function writeOp(body: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'samaritan-builtin-'));
    const file = join(dir, 'op.yaml');
    writeFileSync(file, body);
    return file;
  }

  it('warns when a user variable shadows a built-in run-time variable', () => {
    const file = writeOp(`name: Shadow Test
version: 1.0.0
common_variables:
  CURRENT_DATE: not-a-date
environments:
  - name: staging
    description: Staging
    variables: {}
steps:
  - name: Step
    type: manual
    command: echo hi
`);
    const result = runCli(['validate', file]);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /CURRENT_DATE.*shadows a built-in/);
  });

  it('does not warn "not defined" for built-ins used but not declared', () => {
    const file = writeOp(`name: Builtin Use
version: 1.0.0
environments:
  - name: staging
    description: Staging
    variables: {}
steps:
  - name: Step
    type: manual
    command: echo \${CURRENT_DATE}
`);
    const result = runCli(['validate', file]);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(
      !result.stdout.includes(
        "Variable 'CURRENT_DATE' used in steps but not defined",
      ),
      'built-in use must not trigger an undefined-variable warning',
    );
  });
});
