import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
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

// A tiny but real PNG header: enough for the report to recognise an image.
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001',
  'hex',
);
const PNG_URI = `data:image/png;base64,${PNG.toString('base64')}`;

function shQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * One answer per second: several lines in one stdin chunk are dropped by
 * readline (`.claude/rules/testing.md`). HOME is the test's temp directory,
 * so sessions never land in the real one.
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

function runCli(
  args: string[],
  home?: string,
): { out: string; status: number | null } {
  const result = spawnSync(CLI, [INDEX, ...args], {
    encoding: 'utf8',
    timeout: 20_000,
    input: '',
    env: home ? { ...process.env, HOME: home } : process.env,
  });
  return {
    out: (result.stdout ?? '') + (result.stderr ?? ''),
    status: result.status,
  };
}

const sessionIdOf = (out: string): string => {
  const id = out.match(/📋 Session: ([0-9a-f-]{36})/)?.[1];
  assert.ok(id, `run output must include the session id:\n${out}`);
  return id;
};

describe('HTML evidence report (CLI)', () => {
  const tmpDirs: string[] = [];
  const workspace = (): { dir: string; op: string; shot: string } => {
    const dir = mkdtempSync(join(tmpdir(), 'samaritan-report-html-cli-'));
    tmpDirs.push(dir);
    const op = join(dir, 'evidence-kinds.yaml');
    cpSync(getFixturePath('evidenceKinds'), op);
    const shot = join(dir, 'dash board.png');
    writeFileSync(shot, PNG);
    return { dir, op, shot };
  };
  after(() => {
    for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
  });

  /** Step 1 with a screenshot attached, then quit at step 2. */
  const runWithScreenshot = (
    dir: string,
    op: string,
    shot: string,
    extraArgs: string[] = [],
  ) =>
    runSequenced(
      dir,
      ['run', op, '--env', 'staging', ...extraArgs],
      ['e', shQuote(shot), 'Dashboard after deploy', '', 'q'],
    );

  describe('report <jsonl> --format html', () => {
    /** A log whose evidence covers every kind the report renders. */
    const writeLog = (dir: string): string => {
      const runDir = join(dir, '.samaritan-runs', 'abc123');
      mkdirSync(join(runDir, 'evidence'), { recursive: true });
      writeFileSync(join(runDir, 'evidence', 'shot.png'), PNG);
      writeFileSync(join(runDir, 'evidence', 'app.log'), 'started\n');
      const events = [
        { type: 'session_start', op: join(dir, 'op.yaml'), total_steps: 1 },
        { type: 'step_start', step: 0, name: 'Deploy web-server', label: '1' },
        {
          type: 'evidence_captured',
          step: 0,
          evidence_type: 'screenshot',
          description: 'Dashboard',
          path: join(runDir, 'evidence', 'shot.png'),
          filename: 'shot.png',
        },
        // Logs written with a path relative to the run directory.
        {
          type: 'evidence_captured',
          step: 0,
          evidence_type: 'photo',
          description: 'Rack photo',
          path: 'evidence/shot.png',
          filename: 'shot.png',
        },
        {
          type: 'evidence_captured',
          step: 0,
          evidence_type: 'screenshot',
          description: 'Deleted later',
          path: join(runDir, 'evidence', 'gone.png'),
          filename: 'gone.png',
        },
        {
          type: 'evidence_captured',
          step: 0,
          evidence_type: 'log',
          description: 'App log',
          path: join(runDir, 'evidence', 'app.log'),
          filename: 'app.log',
        },
        { type: 'step_complete', step: 0 },
        { type: 'session_end', status: 'completed' },
      ];
      const jsonl = join(runDir, 'events.jsonl');
      writeFileSync(
        jsonl,
        `${events
          .map((e) =>
            JSON.stringify({
              ts: '2026-01-01T00:00:00Z',
              session_id: 'abc123',
              ...e,
            }),
          )
          .join('\n')}\n`,
      );
      return jsonl;
    };

    it('writes one file with the images embedded and other files linked', () => {
      const { dir } = workspace();
      const jsonl = writeLog(dir);
      const out = join(dir, 'shared', 'report.html');
      mkdirSync(join(dir, 'shared'));

      const result = runCli(['report', jsonl, '--format', 'html', '-o', out]);
      assert.equal(result.status, 0, result.out);
      assert.match(result.out, /Evidence report written to/);

      const html = readFileSync(out, 'utf-8');
      assert.ok(html.startsWith('<!DOCTYPE html>'), html);
      assert.ok(html.includes('<h2>Step 1: Deploy web-server</h2>'), html);
      assert.ok(html.includes(`<img src="${PNG_URI}" alt="Dashboard">`), html);
      assert.ok(html.includes(`<img src="${PNG_URI}" alt="Rack photo">`), html);
      // No image is loaded from disk: the file renders after being moved.
      assert.ok(!/<img src="(?!data:)/.test(html), html);
      // Non-image evidence stays a link, relative to where the report is.
      assert.ok(
        html.includes(
          '<a href="../.samaritan-runs/abc123/evidence/app.log">app.log</a>',
        ),
        html,
      );
      // An image file that is gone is named, not shown as a broken image.
      assert.match(
        html,
        /<a href="[^"]*gone\.png">gone\.png<\/a> <em>\(not embedded: file missing or not an image\)<\/em>/,
      );
    });

    it('stays Markdown with linked images by default', () => {
      const { dir } = workspace();
      const jsonl = writeLog(dir);
      const md = runCli(['report', jsonl]).out;
      assert.ok(md.includes('![Dashboard](evidence/shot.png)'), md);
      assert.ok(!md.includes('data:image'), md);
      assert.ok(!md.includes('not embedded'), md);
    });

    it('refuses an unknown format', () => {
      const { dir } = workspace();
      const result = runCli(['report', writeLog(dir), '--format', 'pdf']);
      assert.notEqual(result.status, 0);
      assert.match(result.out, /Allowed choices are markdown, html/);
    });
  });

  describe('run --report <dir> --report-format html', () => {
    it('writes the --report copy as HTML; report.md stays Markdown', () => {
      const { dir, op, shot } = workspace();
      const reports = join(dir, 'reports');
      const run = runWithScreenshot(dir, op, shot, [
        '--report',
        reports,
        '--report-format',
        'html',
      ]);
      const id = sessionIdOf(run.out);
      const runDir = join(dir, '.samaritan-runs', id);

      // The image the run stored, embedded byte for byte.
      const [stored] = readdirSync(join(runDir, 'evidence'));
      const html = readFileSync(
        join(reports, `samaritan-${id}-report.html`),
        'utf-8',
      );
      assert.ok(
        html.includes(`<img src="${PNG_URI}" alt="Dashboard after deploy">`),
        html,
      );
      assert.ok(html.includes('<h2>Step 1: Announce the deploy'), html);
      assert.ok(!existsSync(join(reports, `samaritan-${id}-report.md`)));

      const md = readFileSync(join(runDir, 'report.md'), 'utf-8');
      assert.ok(
        md.includes(`![Dashboard after deploy](evidence/${stored})`),
        md,
      );
    });

    it('--report-format without --report is an error', () => {
      const { op } = workspace();
      const result = runCli([
        'run',
        op,
        '--env',
        'staging',
        '--report-format',
        'html',
      ]);
      assert.equal(result.status, 1, result.out);
      assert.match(result.out, /add --report <dir>/);
    });
  });

  describe('report merge', () => {
    it('honours -o and --format html', () => {
      const { dir, op, shot } = workspace();
      const first = sessionIdOf(runWithScreenshot(dir, op, shot).out);
      const second = sessionIdOf(
        runSequenced(dir, ['run', op, '--env', 'staging'], ['q']).out,
      );

      // `-o` used to be taken by the parent `report` command: merge printed
      // to stdout and wrote no file.
      const mdOut = join(dir, 'merged.md');
      const md = runCli(['report', 'merge', first, second, '-o', mdOut], dir);
      assert.equal(md.status, 0, md.out);
      assert.match(md.out, /Merged report written to/);
      assert.ok(!md.out.includes('# Evidence Report'), md.out);
      assert.match(
        readFileSync(mdOut, 'utf-8'),
        /!\[Dashboard after deploy\]\(\.samaritan-runs\//,
      );

      const htmlOut = join(dir, 'merged.html');
      const html = runCli(
        [
          'report',
          'merge',
          first,
          second,
          '--format',
          'html',
          '--output',
          htmlOut,
        ],
        dir,
      );
      assert.equal(html.status, 0, html.out);
      const page = readFileSync(htmlOut, 'utf-8');
      assert.ok(page.startsWith('<!DOCTYPE html>'), page);
      assert.ok(
        page.includes(`<img src="${PNG_URI}" alt="Dashboard after deploy">`),
        page,
      );
    });
  });
});
