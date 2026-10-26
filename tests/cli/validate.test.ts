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

describe('validate expect-lint ($VAR in expect)', () => {
  function writeOp(body: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'samaritan-expect-lint-'));
    const file = join(dir, 'op.yaml');
    writeFileSync(
      file,
      `name: Expect Lint Test
version: 1.0.0
environments:
  - name: default
${body}
steps:
  - name: Who
    type: manual
    command: echo $USER
    expect:
      contains: $USER
`,
    );
    return file;
  }

  it('warns that a bare $VAR in expect is compared literally', () => {
    const result = runCli(['validate', writeOp('')]);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /expect-lint: step "Who" \(expect\.contains\): "\$USER" is compared literally/,
    );
  });

  it('stays quiet when $VAR names an operation variable (resolved at verify)', () => {
    const result = runCli([
      'validate',
      writeOp('common_variables:\n  USER: deployer'),
    ]);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /expect-lint:/);
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

describe('validate step dependencies (needs)', () => {
  it('errors on a dependency cycle', () => {
    const result = runCli([
      'validate',
      'tests/fixtures/operations/invalid/needs-cycle.yaml',
    ]);
    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /dependency cycle/);
  });

  it('errors on a forward reference (needing a later step)', () => {
    const result = runCli([
      'validate',
      'tests/fixtures/operations/invalid/needs-forward-ref.yaml',
    ]);
    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /depends on a later step/);
  });

  it('warns (but passes) on an unknown dependency by default', () => {
    const dir = mkdtempSync(join(tmpdir(), 'samaritan-needs-'));
    const file = join(dir, 'op.yaml');
    writeFileSync(
      file,
      `name: Unknown Dep
version: 1.0.0
environments:
  - name: staging
    description: Staging
steps:
  - name: A
    type: manual
    needs: [ghost]
    command: echo a
`,
    );
    const result = runCli(['validate', file]);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /dependency 'ghost' not found/);
  });

  it('promotes an unknown dependency to an error under --strict', () => {
    const dir = mkdtempSync(join(tmpdir(), 'samaritan-needs-strict-'));
    const file = join(dir, 'op.yaml');
    writeFileSync(
      file,
      `name: Unknown Dep Strict
version: 1.0.0
environments:
  - name: staging
    description: Staging
steps:
  - name: A
    type: manual
    needs: [ghost]
    command: echo a
`,
    );
    const result = runCli(['validate', file, '--strict']);
    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /dependency 'ghost' not found/);
  });

  it('accepts a valid backward chain including a foreach dependency', () => {
    const result = runCli([
      'validate',
      'tests/fixtures/operations/features/step-needs.yaml',
    ]);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /validation passed/);
  });
});

describe('validate run.tmux_session / run.default_session', () => {
  const write = (body: string): string => {
    const dir = mkdtempSync(join(tmpdir(), 'samaritan-tmux-name-'));
    const file = join(dir, 'op.yaml');
    writeFileSync(file, body);
    return file;
  };
  const op = (run: string, sessions = 'sessions:\n  work: {}\n'): string =>
    `name: Tmux Name
version: 1.0.0
description: d
common_variables:
  TICKET: T-1
${sessions}run:
${run}
environments:
  - name: sbx
    description: sandbox
steps:
  - name: Echo
    type: manual
    command: echo hi
`;

  it('accepts a resolvable ${TICKET}-${ENV} name and a declared default', () => {
    const result = runCli([
      'validate',
      write(op('  tmux_session: ${TICKET}-${ENV}\n  default_session: work')),
    ]);
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.ok(!result.stdout.includes('tmux_session'), result.stdout);
  });

  it('errors when default_session is not a declared session', () => {
    const result = runCli(['validate', write(op('  default_session: wrok'))]);
    assert.notStrictEqual(result.status, 0);
    assert.match(
      result.stdout,
      /run\.default_session "wrok" is not declared in sessions: \(declared: work\)/,
    );
  });

  it('warns (not errors) when tmux_session uses an undefined variable', () => {
    const result = runCli([
      'validate',
      write(op('  tmux_session: ${NOPE}-${ENV}')),
    ]);
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(
      result.stdout,
      /uses \$\{NOPE\} not defined for environment 'sbx'/,
    );
  });

  it('warns that tmux_session has no effect without sessions:', () => {
    const result = runCli([
      'validate',
      write(op('  tmux_session: ${TICKET}', '')),
    ]);
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(
      result.stdout,
      /run\.tmux_session has no effect without sessions:/,
    );
  });

  it('schema rejects an empty tmux_session', () => {
    const result = runCli(['validate', write(op("  tmux_session: ''"))]);
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stdout, /tmux_session/);
  });
});
