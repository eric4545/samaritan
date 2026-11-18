import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { RULES } from '../../src/lib/lint/rules';

const CLI = resolve('node_modules/.bin/tsx');
const INDEX = resolve('src/cli/index.ts');

function runCli(
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(CLI, [INDEX, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  };
}

function operation(command: string, dir?: string): string {
  const root = dir ?? mkdtempSync(join(tmpdir(), 'samaritan-lint-cli-'));
  const file = join(root, 'op.yaml');
  writeFileSync(
    file,
    `name: lint-cli
version: 1.0.0
description: mock
environments:
  - name: staging
    description: Staging
steps:
  - name: Step
    type: automatic
    command: |
${command
  .split('\n')
  .map((l) => `      ${l}`)
  .join('\n')}
`,
  );
  return file;
}

const FIXTURE = 'tests/fixtures/operations/features/lint-command-rules.yaml';

describe('samaritan lint: exit-code contract', () => {
  it('exits 0 on a clean file', () => {
    const r = runCli(['lint', operation('echo ok')]);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /No problems in 1 file/);
  });

  it('exits 1 on an error-severity finding and names rule ids', () => {
    const r = runCli(['lint', FIXTURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    for (const id of [
      'shell/exit-verbs',
      'shell/errexit',
      'aws/no-pager',
      'tmux/kill-commands',
      'git/protected-push',
      'var/colon-unresolved',
      'analysis/unsupported',
    ]) {
      assert.ok(r.stdout.includes(id), `missing ${id} in:\n${r.stdout}`);
    }
    assert.match(r.stdout, /✖ \d+ problems \(\d+ errors?, \d+ warnings?\)/);
  });

  it('warnings alone exit 0, unless --max-warnings is exceeded', () => {
    const file = operation('git push origin HEAD:main');
    assert.strictEqual(runCli(['lint', file]).status, 0);
    assert.strictEqual(runCli(['lint', file, '--max-warnings', '1']).status, 0);
    const r = runCli(['lint', file, '--max-warnings', '0']);
    assert.strictEqual(r.status, 1);
    assert.match(r.stdout, /exceed --max-warnings 0/);
  });

  it('exits 2 when a file cannot be linted, after linting the others', () => {
    const r = runCli(['lint', 'no-such-file.yaml', FIXTURE]);
    assert.strictEqual(r.status, 2);
    assert.match(r.stdout, /fatal +file not found: no-such-file\.yaml/);
    assert.match(r.stdout, /shell\/exit-verbs/);
  });

  it('exits 2 on a broken lint config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'samaritan-lint-cli-'));
    writeFileSync(
      join(dir, 'samaritan.config.yaml'),
      'lint:\n  rules:\n    nope/x: error\n',
    );
    const r = runCli(['lint', operation('echo ok', dir)]);
    assert.strictEqual(r.status, 2);
    assert.match(r.stdout, /unknown rule 'nope\/x'/);
  });
});

describe('samaritan lint: config, format, rules', () => {
  it('applies the nearest samaritan.config.yaml', () => {
    const dir = mkdtempSync(join(tmpdir(), 'samaritan-lint-cli-'));
    writeFileSync(
      join(dir, 'samaritan.config.yaml'),
      `lint:
  rules:
    shell/exit-verbs: off
  banned:
    - pattern: 'git add -A'
      message: stage explicit paths
`,
    );
    const r = runCli(['lint', operation('exit 1\ngit add -Av', dir)]);
    assert.strictEqual(r.status, 1);
    assert.ok(!r.stdout.includes('shell/exit-verbs'));
    assert.match(r.stdout, /cmd\/banned .*stage explicit paths/);
  });

  it('uses the global --config only when given', () => {
    const dir = mkdtempSync(join(tmpdir(), 'samaritan-lint-cli-'));
    const config = join(dir, 'team.yaml');
    writeFileSync(config, 'lint:\n  protected_branches: [staging]\n');
    const file = operation('git push origin HEAD:staging');
    assert.strictEqual(
      runCli(['lint', file]).stdout.includes('git/protected-push'),
      false,
    );
    const r = runCli(['--config', config, 'lint', file]);
    assert.match(r.stdout, /git\/protected-push/);
  });

  it('--format json has a stable shape', () => {
    const r = runCli(['lint', FIXTURE, '--format', 'json']);
    const report = JSON.parse(r.stdout);
    assert.deepStrictEqual(Object.keys(report), [
      'files',
      'errorCount',
      'warningCount',
    ]);
    const [file] = report.files;
    assert.deepStrictEqual(Object.keys(file).sort(), [
      'errorCount',
      'file',
      'findings',
      'warningCount',
    ]);
    assert.deepStrictEqual(Object.keys(file.findings[0]), [
      'ruleId',
      'severity',
      'tier',
      'message',
    ]);
  });

  it('is deterministic: same findings from another cwd and host environment', () => {
    const file = resolve(FIXTURE);
    const a = runCli(['lint', file, '--format', 'json']);
    const b = runCli(['lint', file, '--format', 'json'], {
      cwd: tmpdir(),
      env: { CLUSTER: 'from-host', AWS_PAGER: '', HOME: tmpdir() },
    });
    assert.deepStrictEqual(
      JSON.parse(a.stdout).files[0].findings,
      JSON.parse(b.stdout).files[0].findings,
    );
  });

  it('--list-rules prints every registered rule', () => {
    const r = runCli(['lint', '--list-rules']);
    assert.strictEqual(r.status, 0);
    for (const rule of RULES)
      assert.ok(r.stdout.includes(`\`${rule.id}\``), rule.id);
  });
});

describe('validate: command rules are warnings only', () => {
  it('reports lint findings as warnings and keeps the exit code', () => {
    const r = runCli(['validate', FIXTURE]);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /lint \[shell\/exit-verbs\]/);
    assert.match(r.stdout, /Operation validation passed/);
  });

  it('honours rules turned off, and ignores a broken config with a warning', () => {
    const dir = mkdtempSync(join(tmpdir(), 'samaritan-lint-validate-'));
    const file = operation('exit 1', dir);
    writeFileSync(
      join(dir, 'samaritan.config.yaml'),
      'lint:\n  rules:\n    shell/exit-verbs: off\n',
    );
    assert.ok(!runCli(['validate', file]).stdout.includes('shell/exit-verbs'));
    writeFileSync(join(dir, 'samaritan.config.yaml'), 'lint:\n  bogus: 1\n');
    const r = runCli(['validate', file]);
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /lint config ignored/);
    assert.match(r.stdout, /lint \[shell\/exit-verbs\]/);
  });
});
