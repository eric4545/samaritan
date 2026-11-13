import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { getFixturePath } from '../fixtures/fixtures';

const CLI = join(process.cwd(), 'node_modules/.bin/tsx');
const INDEX = join(process.cwd(), 'src/cli/index.ts');

function shQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Drive the run with one answer per second: several lines in one stdin chunk
 * are dropped by readline (see `.claude/rules/testing.md`). HOME is a temp
 * directory so the session never lands in the real one.
 */
function runSequenced(
  home: string,
  args: string[],
  inputs: string[],
): { out: string; status: number | null } {
  const piped = inputs
    .map((line) => `printf ${shQuote(`${line}\\n`)}`)
    .join('; sleep 1; ');
  const seconds = inputs.length + 12;
  const cmd = `(sleep 1; ${piped}) | timeout ${seconds} ${shQuote(CLI)} ${shQuote(INDEX)} ${args.map(shQuote).join(' ')}`;
  const result = spawnSync('bash', ['-c', cmd], {
    encoding: 'utf8',
    timeout: (seconds + 5) * 1000,
    env: { ...process.env, HOME: home },
  });
  return {
    out: (result.stdout ?? '') + (result.stderr ?? ''),
    status: result.status,
  };
}

function runCli(args: string[]): { out: string; status: number | null } {
  const result = spawnSync(CLI, [INDEX, ...args], {
    encoding: 'utf8',
    timeout: 20_000,
  });
  return {
    out: (result.stdout ?? '') + (result.stderr ?? ''),
    status: result.status,
  };
}

describe('evidence (CLI)', () => {
  const tmpDirs: string[] = [];
  const workspace = (): { dir: string; op: string } => {
    const dir = mkdtempSync(join(tmpdir(), 'samaritan-evidence-cli-'));
    tmpDirs.push(dir);
    const op = join(dir, 'evidence-kinds.yaml');
    cpSync(getFixturePath('evidenceKinds'), op);
    return { dir, op };
  };
  after(() => {
    for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
  });

  describe('run', () => {
    // Operator feedback on a sidecar run: a URL had to be recorded as
    // "command output", and an attached screenshot did not open from the
    // report. Walks the run artifacts: events.jsonl, report.md, the copied
    // file, the session and `sessions`.
    it('[e] records a URL as a link and a file beside the report', () => {
      const { dir, op } = workspace();
      const shot = join(dir, 'dash board.png');
      writeFileSync(shot, Buffer.from('89504e470d0a1a0a', 'hex'));

      const run = runSequenced(
        dir,
        ['run', op, '--env', 'staging'],
        [
          'e',
          'https://ci.example.com/job/web-server-deploy/42/console',
          'CI build',
          'e',
          shQuote(shot),
          'Dashboard after deploy',
          '', // done
          'q',
        ],
      );
      assert.match(run.out, /Evidence : required — screenshot/);
      assert.match(run.out, /this step asks for: screenshot/);
      assert.match(
        run.out,
        /📎 Evidence recorded: link https:\/\/ci\.example\.com/,
      );
      assert.match(run.out, /asks for screenshot; recorded: link/);
      assert.match(run.out, /📎 Evidence recorded: screenshot dash board\.png/);
      assert.match(run.out, /✅ Step marked complete\./);

      const sessionId = run.out.match(/📋 Session: ([0-9a-f-]{36})/)?.[1];
      assert.ok(sessionId, run.out);
      const runDir = join(dir, '.samaritan-runs', sessionId);

      // events.jsonl: the report is built from these alone.
      const captured = readFileSync(join(runDir, 'events.jsonl'), 'utf-8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((e) => e.type === 'evidence_captured');
      assert.deepEqual(
        captured.map((e) => e.evidence_type),
        ['link', 'screenshot'],
      );
      assert.equal(
        captured[0].content,
        'https://ci.example.com/job/web-server-deploy/42/console',
      );

      // The file is copied into the run directory, under a link-safe name.
      const [stored] = readdirSync(join(runDir, 'evidence'));
      assert.match(stored, /^[0-9a-f]{8}-dash-board\.png$/);
      assert.equal(captured[1].path, join(runDir, 'evidence', stored));

      const report = readFileSync(join(runDir, 'report.md'), 'utf-8');
      assert.ok(report.includes('**Evidence**: link — CI build'), report);
      assert.ok(
        report.includes(
          '<https://ci.example.com/job/web-server-deploy/42/console>',
        ),
        report,
      );
      assert.ok(
        report.includes(`![Dashboard after deploy](evidence/${stored})`),
        report,
      );
      assert.ok(existsSync(join(runDir, 'evidence', stored)));

      // The session keeps both items, so resume still knows the gate is met.
      const session = JSON.parse(
        readFileSync(
          join(dir, '.samaritan', 'sessions', `${sessionId}.json`),
          'utf-8',
        ),
      );
      assert.deepEqual(
        session.evidence.map((e: { type: string }) => e.type),
        ['link', 'screenshot'],
      );
    });

    it('[e] with nothing entered records nothing and the gate still holds', () => {
      const { dir, op } = workspace();
      const run = runSequenced(
        dir,
        ['run', op, '--env', 'staging'],
        ['e', '', '', 'q'],
      );
      assert.match(run.out, /Nothing entered — no evidence recorded/);
      assert.match(run.out, /requires evidence \(screenshot\)/);
      assert.ok(!run.out.includes('✅ Step marked complete.'), run.out);
    });

    it('[e] with a path that does not exist says so instead of recording text', () => {
      const { dir, op } = workspace();
      const run = runSequenced(
        dir,
        ['run', op, '--env', 'staging'],
        ['e', '/nope/missing.png', 'q'],
      );
      assert.match(run.out, /File not found: \/nope\/missing\.png/);
      assert.ok(!run.out.includes('Evidence recorded'), run.out);
    });
  });

  describe('validate', () => {
    it('rejects misspelled evidence keys', () => {
      const result = runCli(['validate', getFixturePath('evidenceTypo')]);
      assert.notEqual(result.status, 0);
      assert.match(
        result.out,
        /evidence: must NOT have additional properties: 'require'/,
      );
      assert.match(
        result.out,
        /evidence: must NOT have additional properties: 'type'/,
      );
    });

    it('accepts link and text results', () => {
      const result = runCli(['validate', getFixturePath('evidenceKinds')]);
      assert.equal(result.status, 0, result.out);
      assert.ok(!result.out.includes('evidence.results'), result.out);
    });

    it('warns about results for an unknown environment and missing files', () => {
      const { dir } = workspace();
      const op = join(dir, 'results.yaml');
      writeFileSync(
        op,
        [
          'name: Results lint',
          'version: 1.0.0',
          'description: evidence.results that render as nothing',
          'environments:',
          '  - name: staging',
          '    description: Staging environment',
          'steps:',
          '  - name: Check dashboard',
          '    type: manual',
          '    instruction: Check the web-server dashboard.',
          '    evidence:',
          '      results:',
          '        prod:',
          '          - type: log',
          '            content: ok',
          '        staging:',
          '          - type: screenshot',
          '            file: ./evidence/missing.png',
          '',
        ].join('\n'),
      );
      const result = runCli(['validate', op]);
      assert.equal(result.status, 0, result.out);
      assert.match(result.out, /evidence\.results\.prod is never rendered/);
      assert.match(result.out, /file not found: \.\/evidence\/missing\.png/);
    });
  });
});
