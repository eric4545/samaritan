import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

const CLI = join(process.cwd(), 'node_modules/.bin/tsx');
const INDEX = join(process.cwd(), 'src/cli/index.ts');

const STEP = (name: string, extra = '') =>
  `  - name: ${name}\n    type: manual\n    command: echo ${name.toLowerCase().replace(/\s+/g, '-')}\n${extra}`;

const op = (steps: string[]) =>
  `name: Resume Safety\nversion: 1.0.0\nenvironments:\n  - name: staging\nsteps:\n${steps.join('')}`;

function shQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** One answer per prompt, a second apart (readline drops batched lines). */
function runSequenced(
  args: string[],
  inputs: string[],
): { out: string; status: number | null } {
  const piped = inputs
    .map((line) => `printf ${shQuote(`${line}\\n`)}`)
    .join('; sleep 1; ');
  const cmd = `(sleep 2; ${piped}; sleep 1) | timeout 40 ${shQuote(CLI)} ${shQuote(INDEX)} ${args.map(shQuote).join(' ')}`;
  const result = spawnSync('bash', ['-c', `${cmd}; exit \${PIPESTATUS[1]}`], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  return {
    out: (result.stdout ?? '') + (result.stderr ?? ''),
    status: result.status,
  };
}

describe('resume: never resume blind', () => {
  const dirs: string[] = [];
  after(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  /** Write the operation, run it with `inputs`, return the session id. */
  function startRun(steps: string[], inputs: string[]) {
    const dir = mkdtempSync(join(tmpdir(), 'samaritan-resume-'));
    dirs.push(dir);
    const file = join(dir, 'op.yaml');
    writeFileSync(file, op(steps));
    const run = runSequenced(
      ['run', file, '--env', 'staging', '--mode', 'manual'],
      inputs,
    );
    const sessionId = run.out.match(/📋 Session: ([0-9a-f-]{36})/)?.[1];
    assert.ok(sessionId, `run must print its session id:\n${run.out}`);
    const runDir = join(dir, '.samaritan-runs', sessionId);
    return { dir, file, sessionId, runDir, run };
  }

  it('records the step list on session_start', () => {
    const { runDir } = startRun([STEP('Step A'), STEP('Step B')], ['q']);
    const first = JSON.parse(
      readFileSync(join(runDir, 'events.jsonl'), 'utf-8').split('\n')[0],
    );
    assert.deepEqual(first.steps, [
      { label: '1', name: 'Step A' },
      { label: '2', name: 'Step B' },
    ]);
  });

  it('refuses to resume when a step before the resume point was removed', () => {
    // A done, aborted on B; then A is deleted from the file. Resuming at the
    // saved index used to land on C and skip B, which never ran.
    const { file, sessionId } = startRun(
      [STEP('Step A'), STEP('Step B'), STEP('Step C')],
      ['', 'q'],
    );
    writeFileSync(file, op([STEP('Step B'), STEP('Step C')]));

    const resume = runSequenced(['resume', sessionId], ['q']);
    assert.notEqual(resume.status, 0);
    assert.match(resume.out, /The runbook changed since this run started/);
    assert.match(resume.out, /1\s+Step A {2}→ {2}Step B/);
    assert.match(resume.out, /2\s+Step B {2}→ {2}Step C/);
    assert.match(resume.out, /--from-step "Step B"/);
    assert.doesNotMatch(resume.out, /\[Step \d/);
  });

  it('refuses when a step was inserted before the resume point', () => {
    const { file, sessionId } = startRun(
      [STEP('Step A'), STEP('Step B'), STEP('Step C')],
      ['', 'q'],
    );
    writeFileSync(
      file,
      op([STEP('Step A'), STEP('Step A2'), STEP('Step B'), STEP('Step C')]),
    );
    const resume = runSequenced(['resume', sessionId], ['q']);
    assert.notEqual(resume.status, 0);
    assert.match(resume.out, /2\s+Step B {2}→ {2}Step A2/);
  });

  it('resumes when only steps after the resume point changed', () => {
    const { file, sessionId } = startRun(
      [STEP('Step A'), STEP('Step B'), STEP('Step C')],
      ['', 'q'],
    );
    writeFileSync(
      file,
      op([STEP('Step A'), STEP('Step B'), STEP('Step C v2'), STEP('Step D')]),
    );
    const resume = runSequenced(['resume', sessionId], ['q']);
    assert.match(resume.out, /Resuming at Step 2: Step B/);
    assert.doesNotMatch(resume.out, /runbook changed/);
  });

  it('a step skipped before the abort still gates `needs` after resume', () => {
    // Skip A, abort on B, resume, finish B: C needs A. Resume used to mark
    // every earlier step completed, so the gate never fired.
    const { sessionId } = startRun(
      [STEP('Step A'), STEP('Step B'), STEP('Step C', '    needs: [Step A]\n')],
      ['s', 'q'],
    );
    const resume = runSequenced(['resume', sessionId], ['', 'q']);
    assert.match(resume.out, /This step needs: Step A \(skipped\)/);
  });

  it('says what was done on the step the run stopped on, and records it', () => {
    const { sessionId, runDir } = startRun(
      [STEP('Step A'), STEP('Step B')],
      ['', 'q'],
    );
    const resume = runSequenced(['resume', sessionId], ['', '']);
    assert.match(
      resume.out,
      /Step B[\s\S]*↻ {2}This step was started before the run stopped/,
    );
    assert.match(resume.out, /Nothing was pasted or sent from samaritan/);
    const report = readFileSync(join(runDir, 'report.md'), 'utf-8');
    assert.match(
      report,
      /## Step 2: Step B[\s\S]*↻ Resumed after the run stopped on this step/,
    );
    // Step A finished before the abort: no recap for it.
    assert.doesNotMatch(report, /## Step 1: Step A[^#]*↻ Resumed/);
  });

  it('report merge refuses runs of two versions of the file', () => {
    const first = startRun([STEP('Step A'), STEP('Step B')], ['q']);
    writeFileSync(
      first.file,
      op([STEP('Step A0'), STEP('Step A'), STEP('Step B')]),
    );
    const second = runSequenced(
      ['run', first.file, '--env', 'staging', '--mode', 'manual'],
      ['q'],
    );
    const secondId = second.out.match(/📋 Session: ([0-9a-f-]{36})/)?.[1];
    assert.ok(secondId);
    const merge = spawnSync(
      CLI,
      [INDEX, 'report', 'merge', first.sessionId, secondId],
      { encoding: 'utf8', timeout: 30_000 },
    );
    assert.notEqual(merge.status, 0);
    assert.match(
      `${merge.stdout}${merge.stderr}`,
      /different versions of the runbook/,
    );
  });

  it('the resumed run keeps one session and report', () => {
    const { sessionId, runDir } = startRun(
      [STEP('Step A'), STEP('Step B')],
      ['s', 'q'],
    );
    runSequenced(['resume', sessionId], ['', '']);
    assert.deepEqual(readdirSync(join(runDir, '..')), [sessionId]);
    const report = readFileSync(join(runDir, 'report.md'), 'utf-8');
    assert.match(report, /\| 1 \| Step A \| ⏭ skipped \|/);
    assert.match(report, /\| 2 \| Step B \| ✅ completed \|/);
  });
});
