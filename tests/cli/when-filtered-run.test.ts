import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { stepColumn } from '../../src/cli/commands/sessions';

const CLI = join(process.cwd(), 'node_modules/.bin/tsx');
const INDEX = join(process.cwd(), 'src/cli/index.ts');

const OP = `name: When filter
version: 1.0.0
environments:
  - name: staging
  - name: production
steps:
  - name: Step A
    command: echo a
  - name: Prod only
    when: production
    command: echo p
  - name: Step C
    command: echo c
`;

function shQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** One answer per prompt, seconds apart (readline drops batched lines). */
function runSequenced(args: string[], inputs: string[], home: string): string {
  const piped = inputs
    .map((line) => `printf ${shQuote(`${line}\\n`)}`)
    .join('; sleep 2; ');
  const cmd = `(sleep 2; ${piped}; sleep 2) | HOME=${shQuote(home)} timeout 60 ${shQuote(CLI)} ${shQuote(INDEX)} ${args.map(shQuote).join(' ')}`;
  const result = spawnSync('bash', ['-c', cmd], {
    encoding: 'utf8',
    timeout: 90_000,
  });
  return (result.stdout ?? '') + (result.stderr ?? '');
}

describe('a step `when:` leaves out is not part of the run', () => {
  const dirs: string[] = [];
  after(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), 'samaritan-when-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'op.yaml'), OP);
    return { dir, file: join(dir, 'op.yaml'), home: join(dir, 'home') };
  };
  const sessionIdOf = (out: string) =>
    out.match(/📋 Session: ([0-9a-f-]{36})/)?.[1] as string;
  const sessions = (home: string) =>
    spawnSync(CLI, [INDEX, 'sessions', '--all'], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home },
    }).stdout;

  it('a finished staging run is 2/2 completed, not 2/3', () => {
    // A real run of a file with a production-only step: every staging step
    // done, yet the report read "2/3" and an abort after the last step stayed
    // "cancelled".
    const { dir, file, home } = setup();
    const out = runSequenced(
      ['run', file, '--env', 'staging', '--mode', 'manual'],
      ['', ''],
      home,
    );
    assert.match(out, /Steps: 2 \(1 only for other environments\)/);
    const id = sessionIdOf(out);
    const runDir = join(dir, '.samaritan-runs', id);
    const start = JSON.parse(
      readFileSync(join(runDir, 'events.jsonl'), 'utf8').split('\n')[0],
    );
    assert.equal(start.total_steps, 2);
    assert.equal(start.steps.length, 3, 'the step list keeps every index');
    const report = readFileSync(join(runDir, 'report.md'), 'utf8');
    assert.match(report, /Status: ✅ completed/);
    assert.match(report, /- Steps completed: 2\/2/);
    assert.doesNotMatch(report, /Prod only/);
    assert.match(
      sessions(home),
      /Status: completed {2}Step: all done {2}Progress: 100%/,
    );
  });

  it('progress and the resumed report count only this environment', () => {
    const { dir, file, home } = setup();
    const out = runSequenced(
      ['run', file, '--env', 'staging', '--mode', 'manual'],
      ['', 'q'],
      home,
    );
    const id = sessionIdOf(out);
    assert.match(sessions(home), /Status: paused {2}Step: 3 {2}Progress: 50%/);
    runSequenced(['resume', id], [''], home);
    const report = readFileSync(
      join(dir, '.samaritan-runs', id, 'report.md'),
      'utf8',
    );
    assert.match(report, /- Steps completed: 2\/2/);
    assert.match(report, /Status: ✅ completed/);
  });

  it('sessions: a completed run is "all done", not one step past the end', () => {
    assert.equal(
      stepColumn({ status: 'completed', current_step_index: 2 }),
      'all done',
    );
    assert.equal(
      stepColumn({
        status: 'paused',
        current_step_index: 1,
        current_step_label: '1.2',
      }),
      '1.2',
    );
    assert.equal(stepColumn({ status: 'paused', current_step_index: 1 }), '2');
  });
});
