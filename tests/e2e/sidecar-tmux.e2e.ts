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
import { hasTmux, TmuxDriver } from './tmux-driver.ts';

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

        // Step 1 prompt: the ${TOKEN} in the command must render resolved.
        const step1 = await d.waitFor('Deploy App', { timeoutMs: 40_000 });
        assert.ok(
          step1.includes('echo "deploy E2E_DEPLOY_OK"'),
          'displayed command resolves ${TOKEN}',
        );

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
        await d.waitFor('Verify Health', { timeoutMs: 15_000 });
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

        d.key('p'); // paste the resolved command into the work pane
        // Give tmux paste-buffer a moment to land.
        await sleep(1500);
        const work = d.capture(d.work);
        assert.ok(
          work.includes("printf '%s_%s"),
          `command text should be pasted into the work pane; got:\n${work.slice(-400)}`,
        );
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
    'spawn-own sessions: bootstrap spawns a tmux session, verifies, and tears it down',
    { skip, timeout: 120_000 },
    async () => {
      const ws = workspace('e2e-sessions-local.yaml');
      const d = TmuxDriver.create();
      try {
        d.type(launch(ws.dir, `run ${ws.op} --env staging`));
        await d.waitFor('Bootstrapping tmux sessions', { timeoutMs: 40_000 });
        const prompt = await d.waitFor('Echo tag', { timeoutMs: 20_000 });
        assert.ok(
          prompt.includes('built v1 E2E_BUILD_OK'),
          'displayed command resolves ${TAG}',
        );

        // A spawned samaritan-* session must now exist on the tmux server.
        const during = TmuxDriver.listSessions();
        assert.ok(
          during.some((s) => s.startsWith('samaritan-')),
          `bootstrap must spawn a samaritan-* session; saw: ${during.join(', ')}`,
        );

        // Send the command to the spawned pane, verify, complete.
        d.key('p');
        await sleep(1000);
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
        const aborted = await d.waitFor('Run aborted', { timeoutMs: 15_000 });
        const m = aborted.match(/samaritan resume ([0-9a-f-]{36})/);
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
});
