// End-to-end tests for sidecar mode against REAL tmux.
//
// Unlike the piped-stdin tests in tests/cli/run.test.ts (non-TTY → readline
// fallback), these run samaritan inside a genuine tmux pane, drive it with
// `tmux send-keys` (raw-mode action keys), and observe the rendered TUI +
// persisted run record. They cover workflows with little/no real-tmux
// coverage: [v] verify + auto-evidence, [p] send-to-pane, the spawn-own
// `sessions:` lifecycle, and abort → resume.
//
// Run with: npm run test:e2e   (needs a real tmux binary).

import assert from 'node:assert';
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ENTER_DEBOUNCE_MS } from '../../src/cli/commands/run.ts';
import { TmuxPaneCapture } from '../../src/lib/tmux-session.ts';
import { hasTmux, TmuxDriver, tmux } from './tmux-driver.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TSX = 'node_modules/.bin/tsx';
const CLI = 'src/cli/index.ts';
const FIXTURES = join(ROOT, 'tests/fixtures/operations/features');

const HAVE_TMUX = hasTmux();
// In the dedicated CI e2e job, tmux is installed and MUST be present — a silent
// skip there would let a broken sidecar path pass unnoticed. Fail hard instead.
if (process.env.SAMARITAN_E2E_REQUIRE_TMUX === '1' && !HAVE_TMUX) {
  throw new Error(
    'SAMARITAN_E2E_REQUIRE_TMUX=1 but no working tmux binary was found. ' +
      'Install tmux for the e2e job.',
  );
}
const skip = HAVE_TMUX ? false : 'tmux not available';

/** Copy a fixture into an isolated temp workdir (so run artifacts + sessions
 *  land in temp, not the repo tree). HOME is pointed here per-command. */
function workspace(fixture: string): {
  dir: string;
  op: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'sam-e2e-'));
  const op = join(dir, fixture);
  cpSync(join(FIXTURES, fixture), op);
  return {
    dir,
    op,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Build a pane command that runs samaritan from the repo root with an
 *  isolated HOME (for session persistence). */
function launch(home: string, args: string): string {
  return `cd ${ROOT} && HOME=${home} ${TSX} ${CLI} ${args}`;
}

/** Recursively find and read the single report.md under a workdir. */
function readReport(dir: string): string {
  const hit = findFile(dir, 'report.md');
  assert.ok(hit, `report.md not found under ${dir}`);
  return readFileSync(hit, 'utf8');
}

function findFile(dir: string, name: string): string | undefined {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = findFile(full, name);
      if (nested) return nested;
    } else if (entry.name === name) {
      return full;
    }
  }
  return undefined;
}

// The resume hint an abort prints (`samaritan resume <session-id>`).
const RESUME_HINT = /samaritan resume ([0-9a-f-]{36})/;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

describe('sidecar e2e (real tmux)', () => {
  it(
    'golden path: attach → [v] verify PASS → auto-evidence → complete → report',
    { skip, timeout: 120_000 },
    async () => {
      const ws = workspace('e2e-sidecar.yaml');
      const d = TmuxDriver.create({ split: true });
      try {
        d.type(launch(ws.dir, `run ${ws.op} --env staging --attach ${d.work}`));

        // Step 1 prompt. Wait for the ${TOKEN}-RESOLVED command to render in the
        // box — not just the step header, which paints a beat earlier (waiting
        // on the header races the command box and can miss it). Reaching this
        // line at all proves ${TOKEN} resolved to E2E_DEPLOY_OK.
        await d.waitFor('Deploy App', { timeoutMs: 40_000 });
        await d.waitFor('echo "deploy E2E_DEPLOY_OK"', { timeoutMs: 15_000 });
        // The capture offset is baselined AFTER the command box renders; the
        // action bar prints after it. Output typed before the bar can land
        // before the baseline and [v] then sees nothing.
        await d.waitFor('v verify', { timeoutMs: 15_000 });

        // Operator runs the command in the work pane, then verify.
        d.type('echo "deploy E2E_DEPLOY_OK"', d.work);
        await d.waitFor('E2E_DEPLOY_OK', { pane: d.work, timeoutMs: 15_000 });
        d.key('v');
        const pass1 = await d.waitFor('✅ contains: E2E_DEPLOY_OK', {
          timeoutMs: 15_000,
        });
        assert.ok(pass1.includes('✅ PASS'), 'verify shows PASS header');
        // The evidence line prints just after the checklist — wait for it
        // rather than asserting on the checklist snapshot (avoids a race).
        await d.waitFor('Verified output captured as evidence', {
          timeoutMs: 10_000,
        });

        // Complete step 1 → advance to step 2.
        d.enter();
        // NOT 'Verify Health': step 1's 'Next : Verify Health' line already
        // shows it. Wait for step 2's own action bar (after its heading),
        // which prints after the step-2 capture baseline.
        await d.waitFor(/\[Step 2 · 2\/2\][\s\S]*\? more/, {
          timeoutMs: 15_000,
        });
        d.type('echo "health E2E_HEALTH_OK"', d.work);
        await d.waitFor('E2E_HEALTH_OK', { pane: d.work, timeoutMs: 15_000 });
        d.key('v');
        await d.waitFor('✅ contains: E2E_HEALTH_OK', { timeoutMs: 15_000 });
        d.enter();
        await d.waitFor('Operation completed successfully', {
          timeoutMs: 15_000,
        });

        const report = readReport(ws.dir);
        assert.ok(
          report.includes('Steps completed: 2/2'),
          'report records both steps complete',
        );
        assert.ok(
          report.includes('Auto-captured on passing verify'),
          'report embeds the auto-captured verify evidence',
        );
      } finally {
        d.kill();
        ws.cleanup();
      }
    },
  );

  it(
    '[p] send-to-pane pastes the command WITHOUT executing it (no trailing newline)',
    { skip, timeout: 90_000 },
    async () => {
      const ws = workspace('e2e-paste.yaml');
      const d = TmuxDriver.create({ split: true });
      try {
        d.type(launch(ws.dir, `run ${ws.op} --env staging --attach ${d.work}`));
        await d.waitFor('Paste check', { timeoutMs: 40_000 });

        d.key('p'); // paste the resolved command into the work pane (no Enter)
        // Wait for the pasted command to land rather than a fixed sleep. Because
        // [p] never sends Enter, the runtime-joined marker PASTE_EXECMARK cannot
        // appear unless the command executed — so once the paste is visible, its
        // absence proves the "no trailing newline" contract.
        const work = await d.waitFor("printf '%s_%s", {
          pane: d.work,
          timeoutMs: 15_000,
        });
        assert.ok(
          !work.includes('PASTE_EXECMARK'),
          `command must NOT have executed on [p] (no Enter); ` +
            `the runtime-joined marker appeared:\n${work.slice(-400)}`,
        );

        // Now the operator presses Enter in the work pane → it executes.
        d.enter(d.work);
        await d.waitFor('PASTE_EXECMARK', { pane: d.work, timeoutMs: 15_000 });
      } finally {
        d.kill();
        ws.cleanup();
      }
    },
  );

  it(
    'Enter after [v]: a burst `v⏎` only verifies, and a quick second ↵ is ignored (#116)',
    { skip, timeout: 120_000 },
    async () => {
      const ws = workspace('e2e-sidecar.yaml');
      const d = TmuxDriver.create({ split: true });
      try {
        const work = d.work as string;
        d.type(launch(ws.dir, `run ${ws.op} --env staging --attach ${work}`));
        await d.waitFor('echo "deploy E2E_DEPLOY_OK"', { timeoutMs: 40_000 });
        await d.waitFor('v verify', { timeoutMs: 15_000 });
        d.type('echo "deploy E2E_DEPLOY_OK"', work);
        await d.waitFor('E2E_DEPLOY_OK', { pane: work, timeoutMs: 15_000 });

        // `v` and Enter in ONE send-keys → one input chunk ("v\r"). The Enter
        // used to vanish here (fast) or complete the step (slow): now the
        // type-ahead is discarded, deterministically.
        tmux(['send-keys', '-t', d.main, 'v', 'Enter']);
        await d.waitFor('✅ contains: E2E_DEPLOY_OK', { timeoutMs: 15_000 });
        await d.waitFor('The step is not done yet', { timeoutMs: 10_000 });
        await sleep(800);
        assert.ok(
          !d.capture().includes('Step marked complete'),
          'a burst v⏎ must not complete the step',
        );

        // ↵ completes step 1; a second ↵ 100 ms later must NOT complete step 2.
        d.enter();
        await sleep(100);
        d.enter();
        await d.waitFor('Enter ignored: pressed twice', { timeoutMs: 15_000 });
        await sleep(500);
        assert.strictEqual(
          d.capture().split('Step marked complete').length - 1,
          1,
          'only step 1 was completed',
        );

        // A deliberate ↵ on step 2 still works.
        d.type('echo "health E2E_HEALTH_OK"', work);
        await d.waitFor('E2E_HEALTH_OK', { pane: work, timeoutMs: 15_000 });
        d.key('v');
        await d.waitFor('✅ contains: E2E_HEALTH_OK', { timeoutMs: 15_000 });
        d.enter();
        await d.waitFor('Operation completed successfully', {
          timeoutMs: 15_000,
        });
        assert.ok(readReport(ws.dir).includes('Steps completed: 2/2'));
      } finally {
        d.kill();
        ws.cleanup();
      }
    },
  );

  it(
    'un-run [p] paste: ↵ asks first, and the next [p] is refused instead of appending (#115)',
    { skip, timeout: 120_000 },
    async () => {
      const ws = workspace('e2e-paste-guard.yaml');
      const d = TmuxDriver.create({ split: true });
      try {
        d.type(launch(ws.dir, `run ${ws.op} --env staging --attach ${d.work}`));
        await d.waitFor('p paste', { timeoutMs: 40_000 });

        // Step 1: paste, do NOT run it, press ↵ here.
        d.key('p');
        await d.waitFor('echo PG_ONE', { pane: d.work, timeoutMs: 15_000 });
        await d.waitFor('Pasted into', { timeoutMs: 10_000 });
        d.enter();
        await d.waitFor('Mark done anyway?', { timeoutMs: 15_000 });
        d.key('n'); // go back: still on step 1
        await sleep(500);
        assert.ok(
          !d.capture().includes('Paste guard two\n'),
          'n keeps the operator on step 1',
        );
        d.enter();
        // The SECOND prompt: `y` sent to the bar instead would be [y] run it.
        await d.waitFor(/Mark done anyway\?[\s\S]*Mark done anyway\?/, {
          timeoutMs: 15_000,
        });
        d.key('y');

        // Step 2 opens with a warning about step 1's un-run paste.
        await d.waitFor('MANUAL: Paste guard two', { timeoutMs: 15_000 });
        await d.waitFor('still has the paste from "Paste guard one"', {
          timeoutMs: 15_000,
        });

        // [p] is refused, and the pane line is left untouched.
        d.key('p');
        await d.waitFor('Nothing pasted.', { timeoutMs: 15_000 });
        await sleep(500);
        const work = d.capture(d.work);
        assert.ok(
          !work.includes('PG_ONEecho PG_TWO'),
          `[p] must not append to the un-run paste:\n${work.slice(-300)}`,
        );

        // Clear the line in the work pane → [p] pastes; run it → ↵ asks nothing.
        tmux(['send-keys', '-t', d.work as string, 'C-u']);
        await sleep(300);
        d.key('p');
        await d.waitFor('echo PG_TWO', { pane: d.work, timeoutMs: 15_000 });
        d.enter(d.work);
        await d.waitFor('\nPG_TWO', { pane: d.work, timeoutMs: 15_000 });
        d.enter();
        await d.waitFor('Operation completed successfully', {
          timeoutMs: 15_000,
        });

        const report = readReport(ws.dir);
        assert.ok(
          report.includes(
            'Marked done while the pasted command was not run: echo PG_ONE',
          ),
          'report records the override on step 1',
        );
        assert.strictEqual(
          report.split('Marked done while the pasted command').length - 1,
          1,
          'step 2 (run before ↵) carries no override note',
        );
      } finally {
        d.kill();
        ws.cleanup();
      }
    },
  );

  it(
    'spawn-own sessions: bootstrap spawns a tmux session, verifies, and tears it down',
    { skip, timeout: 120_000 },
    async () => {
      const ws = workspace('e2e-sessions-local.yaml');
      const d = TmuxDriver.create();
      try {
        d.type(launch(ws.dir, `run ${ws.op} --env staging`));
        await d.waitFor('Bootstrapping tmux sessions', { timeoutMs: 40_000 });
        await d.waitFor('Echo tag', { timeoutMs: 20_000 });
        // Wait for the ${TAG}-RESOLVED command in the box, not just the step
        // header (which paints first) — reaching here proves ${TAG} resolved.
        await d.waitFor('built v1 E2E_BUILD_OK', { timeoutMs: 15_000 });

        // A spawned samaritan-* session must now exist on the tmux server.
        const during = TmuxDriver.listSessions();
        const spawned = during.find((s) => s.startsWith('samaritan-'));
        assert.ok(
          spawned,
          `bootstrap must spawn a samaritan-* session; saw: ${during.join(', ')}`,
        );

        // Paste the command into the spawned pane; wait until it lands there
        // (no fixed sleep). [p] pastes WITHOUT a trailing newline, so it is not
        // executed yet — the string that appears here is the echoed command.
        d.key('p');
        await d.waitFor('built v1 E2E_BUILD_OK', {
          pane: spawned,
          timeoutMs: 15_000,
        });
        // Run it: press Enter in the spawned pane, then wait for the command's
        // OUTPUT line on its own (not the echoed `echo "..."`). Verify asserts
        // against the command output — the echoed command is stripped — so the
        // command must actually execute before [v].
        d.enter(spawned);
        await d.waitFor(/^built v1 E2E_BUILD_OK$/m, {
          pane: spawned,
          timeoutMs: 15_000,
        });
        d.key('v');
        await d.waitFor('✅ contains: E2E_BUILD_OK', { timeoutMs: 15_000 });
        d.enter();
        await d.waitFor('Operation completed successfully', {
          timeoutMs: 15_000,
        });

        // Teardown must kill the spawned session (poll briefly for exit).
        let gone = false;
        for (let i = 0; i < 20; i++) {
          if (
            !TmuxDriver.listSessions().some((s) => s.startsWith('samaritan-'))
          ) {
            gone = true;
            break;
          }
          await sleep(300);
        }
        assert.ok(gone, 'teardown must kill the spawned samaritan-* session');
      } finally {
        d.kill();
        ws.cleanup();
      }
    },
  );

  it(
    'abort → resume: a paused session resumes at the same step under real tmux',
    { skip, timeout: 120_000 },
    async () => {
      const ws = workspace('e2e-sidecar.yaml');
      const d = TmuxDriver.create();
      try {
        d.type(launch(ws.dir, `run ${ws.op} --env staging`));
        await d.waitFor('Deploy App', { timeoutMs: 40_000 });

        // Abort at step 1 → paused + resume hint.
        d.type('abort');
        // Wait for the resume HINT itself, not "Run aborted" (printed one line
        // earlier): tmux can capture the screen between the two writes.
        const aborted = await d.waitFor(RESUME_HINT, { timeoutMs: 15_000 });
        const m = aborted.match(RESUME_HINT);
        assert.ok(
          m,
          `abort must print a resume hint with a session id; got:\n${aborted.slice(-400)}`,
        );
        const sessionId = m[1];

        // Resume → must re-enter the loop at step 1 (not re-run step 0 as done).
        d.type(launch(ws.dir, `resume ${sessionId}`));
        await d.waitFor('Resuming session', { timeoutMs: 20_000 });
        const resumed = await d.waitFor('Resuming at step: 1', {
          timeoutMs: 15_000,
        });
        assert.ok(
          resumed.includes('paused'),
          'resume reports the prior status was paused',
        );
        await d.waitFor('Deploy App', { timeoutMs: 15_000 });

        // Clean up: abort the resumed run.
        d.type('abort');
        await d.waitFor('Run aborted', { timeoutMs: 15_000 });
      } finally {
        d.kill();
        ws.cleanup();
      }
    },
  );

  it(
    'abort → resume re-attaches the --attach pane (by stable pane id) so [v] still verifies',
    { skip, timeout: 150_000 },
    async () => {
      const ws = workspace('e2e-sidecar.yaml');
      const d = TmuxDriver.create({ split: true });
      const paneId = (target: string): string =>
        tmux([
          'display-message',
          '-p',
          '-t',
          target,
          '#{pane_id}',
        ]).stdout.trim();
      try {
        const work = d.work as string;
        // The session saves the STABLE pane id, never the positional target.
        const workId = paneId(work);
        const main = paneId(d.main);
        d.type(launch(ws.dir, `run ${ws.op} --env staging --attach ${work}`));
        await d.waitFor('echo "deploy E2E_DEPLOY_OK"', { timeoutMs: 40_000 });
        d.type('abort');
        const aborted = await d.waitFor(RESUME_HINT, { timeoutMs: 15_000 });
        const id = aborted.match(RESUME_HINT)?.[1];
        assert.ok(id, 'abort prints the resume hint');

        // No --attach on resume: the saved pane is re-attached automatically.
        d.type(launch(ws.dir, `resume ${id}`));
        await d.waitFor(`Re-attached capture to tmux pane: ${workId}`, {
          timeoutMs: 30_000,
        });
        await d.waitFor(/Resuming operation execution[\s\S]*\? more/, {
          timeoutMs: 15_000,
        });
        d.type('echo "deploy E2E_DEPLOY_OK"', work);
        await d.waitFor(/^deploy E2E_DEPLOY_OK$/m, {
          pane: work,
          timeoutMs: 15_000,
        });
        d.key('v');
        const verified = await d.waitFor('✅ contains: E2E_DEPLOY_OK', {
          timeoutMs: 15_000,
        });
        assert.ok(!verified.includes('Verify requires an attached capture'));
        d.type('abort');
        await d.waitFor(/(Run aborted[\s\S]*){2}/, { timeoutMs: 15_000 });

        // Close the work pane: tmux renumbers the window, so the old positional
        // target (`:0.0`) now names samaritan's OWN pane. The saved id does not
        // — resume must warn that the pane is gone, never attach to itself.
        tmux(['kill-pane', '-t', workId]);
        d.type(launch(ws.dir, `resume ${id}`), main);
        await d.waitFor(`Saved tmux pane "${workId}" no longer exists`, {
          pane: main,
          timeoutMs: 30_000,
        });
        d.type('abort', main);
        await d.waitFor(/(Run aborted[\s\S]*){3}/, {
          pane: main,
          timeoutMs: 15_000,
        });
      } finally {
        d.kill();
        ws.cleanup();
      }
    },
  );

  it(
    'resume of an --attach run on an operation with sessions: re-attaches the pane, never spawns',
    { skip, timeout: 150_000 },
    async () => {
      const ws = workspace('e2e-sessions-local.yaml');
      const d = TmuxDriver.create({ split: true });
      const spawned = (): string[] =>
        TmuxDriver.listSessions().filter((s) => s.startsWith('samaritan-'));
      try {
        const work = d.work as string;
        d.type(launch(ws.dir, `run ${ws.op} --env staging --attach ${work}`));
        // --attach wins over sessions: — told once, nothing spawned.
        await d.waitFor(
          'sessions: (work) are not spawned with an attached pane',
          {
            timeoutMs: 40_000,
          },
        );
        await d.waitFor('echo "built v1 E2E_BUILD_OK"', { timeoutMs: 15_000 });
        assert.deepStrictEqual(spawned(), [], 'run --attach spawns nothing');
        d.type('abort');
        const aborted = await d.waitFor(RESUME_HINT, { timeoutMs: 15_000 });
        const id = aborted.match(RESUME_HINT)?.[1];
        assert.ok(id, 'abort prints the resume hint');

        d.type(launch(ws.dir, `resume ${id}`));
        const resumed = await d.waitFor(
          /Re-attached capture to tmux pane: %\d+/,
          {
            timeoutMs: 30_000,
          },
        );
        assert.ok(
          !resumed.includes('Bootstrapping tmux sessions'),
          'resume must not spawn sessions: for an attached run',
        );
        assert.deepStrictEqual(spawned(), [], 'resume spawns nothing');
        await d.waitFor(/Resuming operation execution[\s\S]*\? more/, {
          timeoutMs: 15_000,
        });
        d.type('echo "built v1 E2E_BUILD_OK"', work);
        await d.waitFor(/^built v1 E2E_BUILD_OK$/m, {
          pane: work,
          timeoutMs: 15_000,
        });
        d.key('v');
        await d.waitFor('✅ contains: E2E_BUILD_OK', { timeoutMs: 15_000 });
        d.type('abort');
        await d.waitFor(/(Run aborted[\s\S]*){2}/, { timeoutMs: 15_000 });
      } finally {
        for (const s of spawned()) tmux(['kill-session', '-t', s]);
        d.kill();
        ws.cleanup();
      }
    },
  );

  it(
    'two runs on one pane: the run whose pipe was taken re-attaches and still verifies',
    { skip, timeout: 150_000 },
    async () => {
      const ws = workspace('e2e-sidecar.yaml');
      const d = TmuxDriver.create({ split: true });
      // A third pane for the second samaritan run (B), below run A.
      tmux(['split-window', '-t', d.main, '-v']);
      const paneB = `${d.session}:0.2`;
      try {
        const work = d.work as string;
        d.type(launch(ws.dir, `run ${ws.op} --env staging --attach ${work}`));
        await d.waitFor('echo "deploy E2E_DEPLOY_OK"', { timeoutMs: 40_000 });

        // Run B attaches to the SAME pane — tmux replaces A's pipe-pane.
        d.type(
          launch(ws.dir, `run ${ws.op} --env staging --attach ${work}`),
          paneB,
        );
        await d.waitFor('This pane was captured by samaritan session', {
          pane: paneB,
          timeoutMs: 40_000,
        });

        d.type('echo "deploy E2E_DEPLOY_OK"', work);
        await d.waitFor(/^deploy E2E_DEPLOY_OK$/m, {
          pane: work,
          timeoutMs: 15_000,
        });

        // A verifies: detects the takeover, re-attaches, reads scrollback.
        d.key('v');
        const verified = await d.waitFor('✅ contains: E2E_DEPLOY_OK', {
          timeoutMs: 15_000,
        });
        assert.match(verified, /was taken over by samaritan session/);
        assert.match(verified, /Pipe capture was interrupted this step/);

        // A now owns the pipe; B's exit must NOT close it.
        d.type('abort', paneB);
        await d.waitFor('Run aborted', { pane: paneB, timeoutMs: 15_000 });
        const pipe = tmux([
          'display-message',
          '-p',
          '-t',
          work,
          '#{pane_pipe}',
        ]);
        assert.strictEqual(pipe.stdout.trim(), '1', "B left A's pipe open");

        d.type('abort');
        await d.waitFor('Run aborted', { timeoutMs: 15_000 });
      } finally {
        d.kill();
        ws.cleanup();
      }
    },
  );

  it(
    '--attach rollback: [g] after the last step pastes each RESOLVED command into the pane and records what the operator ran',
    { skip, timeout: 150_000 },
    async () => {
      const ws = workspace('e2e-rollback.yaml');
      const d = TmuxDriver.create({ split: true });
      try {
        const work = d.work as string;
        d.type(launch(ws.dir, `run ${ws.op} --env staging --attach ${work}`));
        await d.waitFor('echo "deploy E2E_RB_MARK"', { timeoutMs: 40_000 });

        // Complete the step (global rollback aggregates COMPLETED steps'
        // rollbacks), then trigger [g] from the all-steps-done screen.
        d.enter();
        await d.waitFor('All steps done.', { timeoutMs: 15_000 });

        // Global rollback: preview → single-key y (no Enter) → entry 1/2.
        d.key('g');
        await d.waitFor('Run global rollback and abort the operation?');
        d.key('y');
        await d.waitFor('Rollback 1/2: Restore traffic', { timeoutMs: 15_000 });

        // [p] pastes the ${MARK}-resolved command WITHOUT running it.
        d.key('p');
        await d.waitFor('echo "GLOBAL_RESTORE E2E_RB_MARK"', {
          pane: work,
          timeoutMs: 15_000,
        });
        assert.ok(
          !/^GLOBAL_RESTORE E2E_RB_MARK$/m.test(d.capture(work)),
          'paste must not execute the rollback command',
        );
        d.enter(work);
        await d.waitFor(/^GLOBAL_RESTORE E2E_RB_MARK$/m, {
          pane: work,
          timeoutMs: 15_000,
        });
        d.enter(); // ↵ done — I ran it

        // Entry 2/2 (aggregated step rollback): paste, run, [v] its expect.
        await d.waitFor('Rollback 2/2', { timeoutMs: 15_000 });
        d.key('p');
        await d.waitFor('echo "UNDO_DEPLOY E2E_RB_MARK"', {
          pane: work,
          timeoutMs: 15_000,
        });
        d.enter(work);
        await d.waitFor(/^UNDO_DEPLOY E2E_RB_MARK$/m, {
          pane: work,
          timeoutMs: 15_000,
        });
        d.key('v');
        await d.waitFor('✅ contains: UNDO_DEPLOY', { timeoutMs: 15_000 });
        d.enter();
        await d.waitFor('Rollback complete — 2/2 step(s) run by the operator', {
          timeoutMs: 15_000,
        });
        await d.waitFor('Run aborted', { timeoutMs: 15_000 });

        const report = readReport(ws.dir);
        assert.ok(
          report.includes(
            '- ✅ run by operator: Restore traffic — `echo "GLOBAL_RESTORE E2E_RB_MARK"` (pasted into pane)',
          ),
          report,
        );
        assert.ok(report.includes('(pasted into pane, verify ✅)'), report);
        assert.ok(
          report.includes(
            '**Status**: ✅ completed — 2/2 step(s) confirmed run',
          ),
          report,
        );
        const events = readFileSync(
          findFile(ws.dir, 'events.jsonl') as string,
          'utf8',
        );
        assert.ok(
          !events.includes('${MARK}'),
          'audit log holds resolved commands',
        );
        assert.ok(
          !events.includes('"command_sent"'),
          'nothing claimed as sent',
        );
      } finally {
        d.kill();
        ws.cleanup();
      }
    },
  );

  it(
    'completion screen: after the last step, [r] still rolls a step back',
    { skip, timeout: 120_000 },
    async () => {
      const ws = workspace('e2e-rollback.yaml');
      const d = TmuxDriver.create({ split: true });
      try {
        const work = d.work as string;
        d.type(launch(ws.dir, `run ${ws.op} --env staging --attach ${work}`));
        await d.waitFor('echo "deploy E2E_RB_MARK"', { timeoutMs: 40_000 });
        d.enter(); // complete the only step

        await d.waitFor('All steps done.', { timeoutMs: 15_000 });
        d.key('r');
        await d.waitFor('Roll back which step?');
        d.type('1');
        await d.waitFor('Rollback 1/1: Undo deploy', { timeoutMs: 15_000 });
        d.key('s'); // skip it → rollback NOT complete
        await d.waitFor(
          'Rollback NOT complete — 0/1 step(s) confirmed run, 1 skipped',
          {
            timeoutMs: 15_000,
          },
        );
        await d.waitFor(/All steps done\.[\s\S]*All steps done\./, {
          timeoutMs: 15_000,
        });
        d.enter(); // finish
        await d.waitFor('Operation completed successfully', {
          timeoutMs: 15_000,
        });
        assert.ok(
          readReport(ws.dir).includes('**Status**: ❌ NOT executed'),
          'a skipped rollback is never reported as success',
        );
      } finally {
        d.kill();
        ws.cleanup();
      }
    },
  );

  it(
    '[p] then [y]: samaritan presses Enter, waits for the command, auto-verifies, report credits [y]',
    { skip, timeout: 120_000 },
    async () => {
      const ws = workspace('e2e-paste.yaml');
      const d = TmuxDriver.create({ split: true });
      try {
        const work = d.work as string;
        d.type(launch(ws.dir, `run ${ws.op} --env staging --attach ${work}`));
        await d.waitFor('Paste check', { timeoutMs: 40_000 });
        // With a pane attached the header points at [p], and the compact bar
        // shows the flow keys + `?` (copy/note/… live under it).
        await d.waitFor(`Command — [p] pastes it into tmux pane ${work}:`);
        await d.waitFor(/↵ done .*p paste .*v verify .*\? more/);

        d.key('p');
        await d.waitFor('[y] to run it', { timeoutMs: 15_000 });
        await d.waitFor(/y run it .*↵ done/);
        assert.ok(
          !d.capture(work).includes('PASTE_EXECMARK'),
          'nothing runs on [p] alone',
        );
        d.key('y');
        await d.waitFor('Enter sent to', { timeoutMs: 15_000 });
        await d.waitFor('PASTE_EXECMARK', { pane: work, timeoutMs: 15_000 });
        // No [v]: verify runs by itself once the command is back at the prompt.
        const main = await d.waitFor(
          /Finished\.[\s\S]*✅ contains: PASTE_EXECMARK[\s\S]*Verify passed/,
          { timeoutMs: 15_000 },
        );
        assert.ok(!main.includes('❌'), 'no premature FAIL before it finished');
        d.enter();
        await d.waitFor('Operation completed successfully', {
          timeoutMs: 15_000,
        });
        assert.ok(
          readReport(ws.dir).includes('⏎ Enter sent from samaritan `[y]`'),
          'the report credits samaritan for pressing Enter',
        );
      } finally {
        d.kill();
        ws.cleanup();
      }
    },
  );

  it(
    'rollback [p] then [y]: Enter sent for the rollback entry, auto-verified, credited in the report',
    { skip, timeout: 120_000 },
    async () => {
      const ws = workspace('e2e-rollback.yaml');
      const d = TmuxDriver.create({ split: true });
      try {
        const work = d.work as string;
        d.type(launch(ws.dir, `run ${ws.op} --env staging --attach ${work}`));
        await d.waitFor('echo "deploy E2E_RB_MARK"', { timeoutMs: 40_000 });
        d.enter(); // complete the only step
        await d.waitFor('All steps done.', { timeoutMs: 15_000 });
        d.key('r');
        await d.waitFor('Roll back which step?');
        d.type('1');
        await d.waitFor('Rollback 1/1: Undo deploy', { timeoutMs: 15_000 });
        d.key('p');
        await d.waitFor('[y] to run it', { timeoutMs: 15_000 });
        d.key('y');
        await d.waitFor(/^UNDO_DEPLOY E2E_RB_MARK$/m, {
          pane: work,
          timeoutMs: 15_000,
        });
        // Auto-verify of the rollback entry's expect — no [v] needed.
        await d.waitFor('✅ contains: UNDO_DEPLOY', { timeoutMs: 15_000 });
        d.enter(); // ↵ done
        await d.waitFor('Rollback complete — 1/1', { timeoutMs: 15_000 });
        await d.waitFor(/All steps done\.[\s\S]*All steps done\./, {
          timeoutMs: 15_000,
        });
        // Two bare Enters closer than ENTER_DEBOUNCE_MS are a double press
        // (#116): the second is ignored. A person reads the new screen first.
        await sleep(ENTER_DEBOUNCE_MS + 100);
        d.enter();
        await d.waitFor('Operation completed successfully', {
          timeoutMs: 15_000,
        });
        assert.ok(
          readReport(ws.dir).includes(
            '(pasted into pane, Enter sent from samaritan `[y]`, verify ✅)',
          ),
          readReport(ws.dir),
        );
      } finally {
        d.kill();
        ws.cleanup();
      }
    },
  );

  it(
    '[y] on a slow command: any key stops waiting, [v] later still verifies',
    { skip, timeout: 120_000 },
    async () => {
      const ws = workspace('e2e-slow-run.yaml');
      const d = TmuxDriver.create({ split: true });
      try {
        const work = d.work as string;
        d.type(launch(ws.dir, `run ${ws.op} --env staging --attach ${work}`));
        await d.waitFor('Slow rollout', { timeoutMs: 40_000 });
        d.key('p');
        await d.waitFor('[y] to run it', { timeoutMs: 15_000 });
        d.key('y');
        await d.waitFor('Running… verify follows', { timeoutMs: 15_000 });
        d.key('z'); // any key: hand the bar back while it still runs
        await d.waitFor('Stopped waiting', { timeoutMs: 15_000 });
        assert.ok(!d.capture().includes('❌'), 'no verify while it runs');
        await d.waitFor(/^SLOW_DONE$/m, { pane: work, timeoutMs: 20_000 });
        d.key('v');
        await d.waitFor('✅ contains: SLOW_DONE', { timeoutMs: 15_000 });
        assert.ok(
          !/> z/.test(d.capture()),
          'the stop key must not leak into the next prompt',
        );
      } finally {
        d.kill();
        ws.cleanup();
      }
    },
  );

  it(
    '[y] refuses unless the pane is exactly as the paste left it (copy-mode, typed input, synchronize-panes)',
    { skip, timeout: 150_000 },
    async () => {
      const ws = workspace('e2e-paste.yaml');
      const d = TmuxDriver.create({ split: true });
      const runs = (): number =>
        (d.capture(work).match(/^PASTE_EXECMARK$/gm) ?? []).length;
      const work = d.work as string;
      const refusals = (): number =>
        (d.capture().match(/Enter NOT sent/g) ?? []).length;
      const window = work.replace(/\.\d+$/, '');
      try {
        d.type(launch(ws.dir, `run ${ws.op} --env staging --attach ${work}`));
        await d.waitFor('Paste check', { timeoutMs: 40_000 });

        // 1. Copy-mode would swallow Enter: refused, stays armed, and works
        //    once the pane leaves copy-mode.
        d.key('p');
        await d.waitFor('[y] to run it', { timeoutMs: 15_000 });
        tmux(['copy-mode', '-t', work]);
        d.key('y');
        await d.waitFor('Enter NOT sent: the pane is in copy/view mode');
        assert.strictEqual(runs(), 0, 'refused [y] must not run anything');
        tmux(['send-keys', '-t', work, '-X', 'cancel']);
        d.key('y');
        await d.waitFor('Verify passed', { timeoutMs: 15_000 });
        assert.strictEqual(runs(), 1);

        // 2. The operator typed in the pane after the paste: refused.
        d.key('p');
        await d.waitFor(/\[y\] to run it[\s\S]*\[y\] to run it/, {
          timeoutMs: 15_000,
        });
        d.key(' #edited', work);
        await d.waitFor('#edited', { pane: work });
        d.key('y');
        await d.waitFor(
          'Enter NOT sent: the pane printed output since the paste',
        );
        assert.strictEqual(runs(), 1, 'an edited command is never run');

        // 3. synchronize-panes would send Enter to every pane: refused.
        tmux(['send-keys', '-t', work, 'C-c']);
        await sleep(300);
        d.key('p');
        await d.waitFor(/(\[y\] to run it[\s\S]*){3}/, { timeoutMs: 15_000 });
        tmux(['set-window-option', '-t', window, 'synchronize-panes', 'on']);
        const before = refusals();
        d.key('y');
        await d.waitFor(/synchronize-panes is on/, { timeoutMs: 15_000 });
        assert.strictEqual(refusals(), before + 1);
        tmux(['set-window-option', '-t', window, 'synchronize-panes', 'off']);
        assert.strictEqual(runs(), 1, 'nothing ran while synchronized');
      } finally {
        d.kill();
        ws.cleanup();
      }
    },
  );

  it(
    '[p] multi-line paste: pastes straight away on every step, no confirm prompt',
    { skip, timeout: 120_000 },
    async () => {
      const ws = workspace('e2e-multiline-paste.yaml');
      const d = TmuxDriver.create({ split: true });
      try {
        const work = d.work as string;
        d.type(launch(ws.dir, `run ${ws.op} --env staging --attach ${work}`));
        await d.waitFor('MULTILINE_ONE', { timeoutMs: 40_000 });

        for (const [mark, out] of [
          ['MULTILINE_ONE', /^FIRST MULTILINE_ONE$/m],
          ['MULTILINE_TWO', /^SECOND MULTILINE_TWO$/m],
        ] as const) {
          d.key('p');
          // The block lands in the work pane with no question asked first.
          await d.waitFor(mark, { pane: work, timeoutMs: 15_000 });
          assert.ok(!out.test(d.capture(work)), 'paste must not execute');
          d.enter(work);
          await d.waitFor(out, { pane: work });
          d.enter(); // complete the step
        }
        await d.waitFor('Operation completed successfully', {
          timeoutMs: 15_000,
        });
        const main = d.capture();
        assert.ok(!main.includes('Paste it?'), main);
        assert.ok(!main.includes('Multi-line command'), main);
      } finally {
        d.kill();
        ws.cleanup();
      }
    },
  );

  it(
    '[p] paste keeps a CRLF backslash-continuation block intact (no blank line, one command)',
    { skip, timeout: 60_000 },
    async () => {
      // Regression: tmux paste-buffer rewrites LF→CR, so a `\\\r\n` line end
      // arrived as `\\\r\r` — readline drew a blank line after each `\\` and the
      // continuation broke into separate commands (`b: command not found`).
      const d = TmuxDriver.create({ width: 120, height: 20 });
      try {
        d.type("exec env -i TERM=screen PS1='$ ' bash --norc --noprofile");
        await d.waitFor(/^\$ $/m);
        new TmuxPaneCapture('e2e-paste', d.main).pasteCommand(
          '',
          'echo a \\\r\n  --arg src x \\\r\n  b\r\n',
        );
        const pasted = await d.waitFor(/ {2}b$/m);
        assert.match(
          pasted,
          /echo a \\\n {2}--arg src x \\\n {2}b/,
          'pasted block must keep its line breaks with no blank line inserted',
        );
        // Nothing ran yet — the operator presses Enter.
        assert.ok(!/^a --arg src x b$/m.test(pasted), 'paste must not execute');
        d.enter();
        const ran = await d.waitFor(/^a --arg src x b$/m);
        assert.ok(!ran.includes('command not found'), 'continuation intact');
      } finally {
        d.kill();
      }
    },
  );
});
