import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { getFixturePath } from '../fixtures/fixtures';

const CLI = 'node_modules/.bin/tsx';
const INDEX = 'src/cli/index.ts';
const fixture = getFixturePath('deploymentWithGroups');

function runCli(
  args: string[],
  input?: string,
): { stdout: string; stderr: string; status: number | null; out: string } {
  const result = spawnSync(CLI, [INDEX, ...args], {
    encoding: 'utf8',
    input,
    timeout: 20_000,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return { stdout, stderr, status: result.status, out: stdout + stderr };
}

describe('operation groups (CLI)', () => {
  const tmpDirs: string[] = [];
  const makeDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'samaritan-groups-cli-'));
    tmpDirs.push(dir);
    return dir;
  };
  after(() => {
    for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
  });

  describe('generate manual', () => {
    it('refuses an operation with groups when no group is chosen', () => {
      const result = runCli(['generate', 'manual', fixture]);
      assert.notEqual(result.status, 0);
      assert.match(
        result.out,
        /defines groups \(web-server, api-gateway\)\. Choose one with --group <name>/,
      );
    });

    it('--group renders only that group (multi-env table format)', () => {
      const output = join(makeDir(), 'manual.md');
      const result = runCli([
        'generate',
        'manual',
        fixture,
        '--group',
        'web-server',
        '-o',
        output,
      ]);
      assert.equal(result.status, 0, result.out);
      const manual = readFileSync(output, 'utf-8');
      assert.match(manual, /Service Deployment \(web-server\)/);
      assert.match(manual, /Purge the CDN/);
      assert.ok(!manual.includes('Probe the cache'));
      assert.ok(!manual.includes('Flush the cache after rollback'));
      // Both environments are still in the one manual.
      assert.match(manual, /staging/);
      assert.match(manual, /production/);
    });

    it('--group with --env renders the single-env format with group variables resolved', () => {
      const output = join(makeDir(), 'manual.md');
      const result = runCli([
        'generate',
        'manual',
        fixture,
        '--group',
        'api-gateway',
        '--env',
        'staging',
        '--resolve-vars',
        '-o',
        output,
      ]);
      assert.equal(result.status, 0, result.out);
      const manual = readFileSync(output, 'utf-8');
      assert.match(manual, /# Service Deployment \(api-gateway\)/);
      assert.match(
        manual,
        /kubectl apply -f api-gateway\.yaml -n staging --replicas=2/,
      );
      assert.match(manual, /redis-cli -h cache\.example\.com ping/);
      assert.match(manual, /Flush the cache after rollback/);
      assert.ok(!manual.includes('Purge the CDN'));
    });

    for (const format of ['confluence', 'adf'] as const) {
      it(`--group filters the ${format} format too`, () => {
        const output = join(makeDir(), `manual.${format}`);
        const result = runCli([
          'generate',
          'manual',
          fixture,
          '--group',
          'api-gateway',
          '--format',
          format,
          '-o',
          output,
        ]);
        assert.equal(result.status, 0, result.out);
        const manual = readFileSync(output, 'utf-8');
        assert.match(manual, /Service Deployment \(api-gateway\)/);
        assert.match(manual, /Probe the cache/);
        assert.ok(!manual.includes('Purge the CDN'));
      });
    }

    it('--all-groups writes one directory per group', () => {
      const outDir = makeDir();
      const result = runCli([
        'generate',
        'manual',
        fixture,
        '--all-groups',
        '--output-dir',
        outDir,
      ]);
      assert.equal(result.status, 0, result.out);
      assert.match(result.stdout, /Generated manuals for 2 group\(s\)/);

      const web = join(outDir, 'web-server', 'deployment-with-groups.md');
      const api = join(outDir, 'api-gateway', 'deployment-with-groups.md');
      assert.ok(existsSync(web), 'web-server manual should exist');
      assert.ok(existsSync(api), 'api-gateway manual should exist');
      assert.ok(!readFileSync(web, 'utf-8').includes('Probe the cache'));
      assert.match(readFileSync(api, 'utf-8'), /Probe the cache/);
    });

    it('--all-groups with --all-envs writes one manual per environment in each group directory', () => {
      const outDir = makeDir();
      const result = runCli([
        'generate',
        'manual',
        fixture,
        '--all-groups',
        '--all-envs',
        '--prefix',
        'release',
        '--output-dir',
        outDir,
      ]);
      assert.equal(result.status, 0, result.out);
      for (const group of ['web-server', 'api-gateway']) {
        assert.deepEqual(readdirSync(join(outDir, group)).sort(), [
          'release_production.md',
          'release_staging.md',
        ]);
      }
    });

    it('--all-groups rejects --group, --output and an operation without groups', () => {
      const both = runCli([
        'generate',
        'manual',
        fixture,
        '--all-groups',
        '--group',
        'web-server',
      ]);
      assert.notEqual(both.status, 0);
      assert.match(both.out, /either --group <name> or --all-groups/);

      const withOutput = runCli([
        'generate',
        'manual',
        fixture,
        '--all-groups',
        '-o',
        join(makeDir(), 'manual.md'),
      ]);
      assert.notEqual(withOutput.status, 0);
      assert.match(withOutput.out, /use --output-dir instead of --output/);

      const noGroups = runCli([
        'generate',
        'manual',
        getFixturePath('deployment'),
        '--all-groups',
      ]);
      assert.notEqual(noGroups.status, 0);
      assert.match(noGroups.out, /No groups defined/);
    });
  });

  describe('validate', () => {
    it('checks every group and does not flag group variables as undefined', () => {
      const result = runCli(['validate', fixture]);
      assert.equal(result.status, 0, result.out);
      assert.match(
        result.stdout,
        /Checked 2 group\(s\): web-server, api-gateway/,
      );
      assert.ok(
        !result.stdout.includes("Variable 'APP' used in steps but not defined"),
        result.stdout,
      );
    });

    it('reports a problem that only one group has, prefixed with the group', () => {
      const file = join(makeDir(), 'operation.yaml');
      writeFileSync(
        file,
        `name: Service Deployment
version: 1.0.0
description: Two groups, one dependency missing from a group
groups:
  - name: web-server
  - name: api-gateway
steps:
  - name: Warm the cache
    type: manual
    groups: [api-gateway]
    command: echo warm
  - name: Deploy
    type: manual
    needs: [Warm the cache]
    command: echo deploy
`,
      );
      const result = runCli(['validate', file]);
      // A dangling `needs` is a warning, so validation still passes.
      assert.equal(result.status, 0, result.out);
      assert.match(result.stdout, /\[group web-server\] .*Warm the cache/);
      assert.ok(!result.stdout.includes('[group api-gateway]'), result.stdout);

      const oneGroup = runCli(['validate', file, '--group', 'api-gateway']);
      assert.equal(oneGroup.status, 0, oneGroup.out);
    });
  });

  describe('diff', () => {
    it('compares environments within one group', () => {
      const result = runCli([
        'diff',
        fixture,
        'staging',
        'production',
        '--group',
        'web-server',
      ]);
      assert.equal(result.status, 0, result.out);
      assert.match(result.stdout, /Service Deployment \(web-server\)/);
      assert.match(result.stdout, /web-server\.yaml -n staging --replicas=4/);
      assert.ok(!result.stdout.includes('Probe the cache'));
    });

    it('requires a group', () => {
      const result = runCli(['diff', fixture, 'staging', 'production']);
      assert.notEqual(result.status, 0);
      assert.match(result.out, /Choose one with --group <name>/);
    });
  });

  describe('run / resume', () => {
    it('run requires a group', () => {
      const result = runCli(['run', fixture, '--env', 'staging', '--dry-run']);
      assert.notEqual(result.status, 0);
      assert.match(result.out, /Choose one with --group <name>/);
    });

    it('run --group walks only that group and resume keeps the group', () => {
      const run = runCli(
        ['run', fixture, '--env', 'staging', '--group', 'api-gateway'],
        'q\n',
      );
      assert.match(run.out, /Group: api-gateway/);
      assert.match(run.out, /Steps: 4/);
      const sessionId = run.out.match(/📋 Session: ([0-9a-f-]{36})/)?.[1];
      assert.ok(
        sessionId,
        `run output must include the session id:\n${run.out}`,
      );

      const sessionFile = join(
        homedir(),
        '.samaritan',
        'sessions',
        `${sessionId}.json`,
      );
      assert.equal(
        JSON.parse(readFileSync(sessionFile, 'utf-8')).group,
        'api-gateway',
      );

      // The run artifacts say which group they are: one file is several
      // runbooks, so the file path alone does not identify a report.
      const runDir = join(dirname(fixture), '.samaritan-runs', sessionId);
      const report = readFileSync(join(runDir, 'report.md'), 'utf-8');
      assert.match(report, /- Operation: .+ \(api-gateway\)/);
      assert.match(report, /- Environment: staging/);
      assert.match(report, /- Group: api-gateway/);
      const sessionStart = JSON.parse(
        readFileSync(join(runDir, 'events.jsonl'), 'utf-8').split('\n')[0],
      );
      assert.equal(sessionStart.group, 'api-gateway');
      assert.equal(sessionStart.environment, 'staging');

      const sessions = runCli(['sessions']);
      assert.match(
        sessions.out,
        new RegExp(`${sessionId}\\n.*Group: api-gateway`),
      );

      const resume = runCli(['resume', sessionId], 'q\n');
      assert.match(resume.out, /Group: api-gateway/);
      assert.ok(
        !resume.out.includes('Choose one with --group'),
        `resume must re-apply the session's group:\n${resume.out}`,
      );
    });

    it('report merge refuses sessions of two different groups', () => {
      const ids = ['web-server', 'api-gateway'].map((group) => {
        const run = runCli(
          ['run', fixture, '--env', 'staging', '--group', group],
          'q\n',
        );
        const id = run.out.match(/📋 Session: ([0-9a-f-]{36})/)?.[1];
        assert.ok(id, `run output must include the session id:\n${run.out}`);
        return id;
      });
      const merge = runCli(['report', 'merge', ...ids]);
      assert.notEqual(merge.status, 0);
      assert.match(merge.out, /Cannot merge sessions from different groups/);
    });
  });
});
