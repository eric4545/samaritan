import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { lintFile } from '../../src/cli/commands/lint';
import { OperationValidator } from '../../src/cli/commands/validate';
import { RULES, type Rule } from '../../src/lib/lint/rules';

const TSX = resolve('node_modules/.bin/tsx');
const INDEX = resolve('src/cli/index.ts');

function runCli(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const r = spawnSync(TSX, [INDEX, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    env,
  });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status };
}

function write(name: string, text: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'samaritan-lint-err-')), name);
  writeFileSync(file, text);
  return file;
}

const OP = (command: string) => `name: lint-errors
version: 1.0.0
description: mock
environments:
  - name: staging
    description: Staging
steps:
  - name: Step
    type: manual
    command: ${command}
`;

describe('samaritan lint: a file that cannot be linted exits 2', () => {
  it('invalid YAML', () => {
    const r = runCli(['lint', write('op.yaml', 'name: [unclosed\n')]);
    assert.strictEqual(r.status, 2);
    assert.match(r.stdout, /fatal +cannot parse/);
  });

  it('an operation the schema rejects', () => {
    const r = runCli(['lint', write('op.yaml', 'name: x\nsteps: nope\n')]);
    assert.strictEqual(r.status, 2);
    assert.match(r.stdout, /fatal +cannot parse/);
  });

  it('a --config file that does not exist', () => {
    const r = runCli([
      '--config',
      '/nonexistent/team.yaml',
      'lint',
      write('op.yaml', OP('echo ok')),
    ]);
    assert.strictEqual(r.status, 2);
    assert.match(r.stdout, /config file not found/);
  });

  it('fatal beats errors: one file with errors, one fatal → 2', () => {
    const r = runCli(['lint', write('a.yaml', OP('exit 1')), 'missing.yaml']);
    assert.strictEqual(r.status, 2);
    assert.match(r.stdout, /shell\/exit-verbs/);
  });
});

describe('samaritan lint: bad usage exits 2 with a message', () => {
  const file = write('op.yaml', OP('echo ok'));
  for (const [args, message] of [
    [['lint'], /give at least one operation file/],
    [['lint', file, '--format', 'xml'], /unknown --format 'xml'/],
    [
      ['lint', file, '--max-warnings', '-1'],
      /--max-warnings needs a whole number/,
    ],
    [
      ['lint', file, '--max-warnings', 'many'],
      /--max-warnings needs a whole number/,
    ],
  ] as [string[], RegExp][]) {
    it(args.slice(1).join(' ') || '(no files)', () => {
      const r = runCli(args);
      assert.strictEqual(r.status, 2);
      assert.match(r.stderr, message);
    });
  }
});

describe('samaritan lint: shell/shellcheck on, shellcheck missing', () => {
  it('prints a notice, does not change the exit code', () => {
    const bin = mkdtempSync(join(tmpdir(), 'samaritan-nobin-'));
    symlinkSync(process.execPath, join(bin, 'node'));
    const dir = mkdtempSync(join(tmpdir(), 'samaritan-lint-err-'));
    writeFileSync(
      join(dir, 'samaritan.config.yaml'),
      'lint:\n  rules:\n    shell/shellcheck: warning\n',
    );
    const file = join(dir, 'op.yaml');
    writeFileSync(file, OP('echo ok'));
    const env = { ...process.env, PATH: bin };
    const text = runCli(['lint', file], env);
    assert.strictEqual(text.status, 0, text.stdout + text.stderr);
    assert.match(
      text.stdout,
      /notice +shell\/shellcheck is on but shellcheck is not on PATH/,
    );
    const json = JSON.parse(
      runCli(['lint', file, '--format', 'json'], env).stdout,
    );
    assert.deepStrictEqual(json.files[0].notices, [
      'shell/shellcheck is on but shellcheck is not on PATH; it was skipped',
    ]);
  });
});

describe('a rule that crashes', () => {
  const crash: Rule = {
    kind: 'operation',
    id: 'test/crash',
    tier: 1,
    defaultSeverity: 'warning',
    inValidate: 'warning',
    description: 'throws, for this test only',
    check() {
      throw new Error('boom');
    },
  };
  const withCrash = async <T>(run: () => Promise<T>): Promise<T> => {
    (RULES as Rule[]).push(crash);
    try {
      return await run();
    } finally {
      (RULES as Rule[]).splice(RULES.indexOf(crash), 1);
    }
  };

  it('lint: the file is fatal (exit 2) and names the rule', async () => {
    const result = await withCrash(() => lintFile('examples/deployment.yaml'));
    assert.strictEqual(result.fatal, 'rule test/crash failed: boom');
    assert.deepStrictEqual(result.findings, []);
  });

  it('validate: stays valid and says lint was skipped (never an error)', async () => {
    const log = console.log;
    console.log = () => {};
    try {
      const result = await withCrash(() =>
        new OperationValidator().validateFile('examples/deployment.yaml', {}),
      );
      assert.strictEqual(result.valid, true, result.errors.join('\n'));
      assert.ok(
        result.warnings.includes('lint skipped: rule test/crash failed: boom'),
      );
    } finally {
      console.log = log;
    }
  });
});

describe('samaritan lint: output read through a pipe is complete', () => {
  // A run with many findings printed more than a pipe buffer (64 KiB);
  // process.exit() right after console.log() dropped the rest, so
  // `lint --format json | jq` got invalid JSON.
  const many = `name: many-findings
version: 1.0.0
description: mock
environments:
  - name: staging
    description: Staging
steps:
${Array.from(
  { length: 2000 },
  (_, k) => `  - name: Step ${k}\n    type: manual\n    command: exit 1\n`,
).join('')}`;
  const file = write('many.yaml', many);

  it('--format json is whole, parses and keeps the exit code', () => {
    const r = runCli(['lint', file, '--format', 'json']);
    assert.ok(r.stdout.length > 65_536, `only ${r.stdout.length} bytes`);
    const report = JSON.parse(r.stdout);
    assert.strictEqual(report.files[0].findings.length, 2000);
    assert.strictEqual(r.status, 1);
  });

  it('text output ends with its summary line', () => {
    const r = runCli(['lint', file]);
    assert.ok(r.stdout.length > 65_536, `only ${r.stdout.length} bytes`);
    assert.match(r.stdout, /✖ 2000 problems \(2000 errors, 0 warnings\)\n$/);
    assert.strictEqual(r.status, 1);
  });
});
