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
import { TmuxPaneCapture } from '../../src/lib/tmux-session.ts';
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

        // Step 1 prompt. Wait for the ${TOKEN}-RESOLVED command to render in the
        // box — not just the step header, which paints a beat earlier (waiting
        // on the header races the command box and can miss it). Reaching this
        // line at all proves ${TOKEN} resolved to E2E_DEPLOY_OK.
        await d.waitFor('Deploy App', { timeoutMs: 40_000 });
        await d.waitFor('echo "deploy E2E_DEPLOY_OK"', { timeoutMs: 15_000 });

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

  it(
    'approval: d denies in a real TTY (r used to fire rollback while typing "reject")',
    { skip, timeout: 90_000 },
    async () => {
      const ws = workspace('approval-keys.yaml');
      const d = TmuxDriver.create();
      try {
        d.type(launch(ws.dir, `run ${ws.op} --env default --no-tmux`));
        await d.waitFor('Approve the production change', { timeoutMs: 40_000 });
        d.key('d');
        await d.waitFor('Rationale (optional)', { timeoutMs: 15_000 });
        d.type('window closed');
        const after = await d.waitFor('Rejected — step skipped', {
          timeoutMs: 15_000,
        });
        assert.ok(
          !after.includes('Rollback'),
          'deny must not start a rollback',
        );
        await d.waitFor('Confirm the change window is open', {
          timeoutMs: 15_000,
        });
        d.key('q');
        await d.waitFor('Run aborted', { timeoutMs: 15_000 });
      } finally {
        d.kill();
        ws.cleanup();
      }
    },
  );

  it(
    '↵ = verify & next: PASS advances + auto-evidence; FAIL stays until override',
    { skip, timeout: 120_000 },
    async () => {
      const ws = workspace('e2e-sidecar.yaml');
      const d = TmuxDriver.create({ split: true });
      try {
        d.type(launch(ws.dir, `run ${ws.op} --env staging --attach ${d.work}`));
        await d.waitFor('echo "deploy E2E_DEPLOY_OK"', { timeoutMs: 40_000 });
        await d.waitFor('verify & next', { timeoutMs: 15_000 });

        // Run the command, then ONE Enter: verify passes and the step advances.
        d.type('echo "deploy E2E_DEPLOY_OK"', d.work);
        await d.waitFor(/^deploy E2E_DEPLOY_OK$/m, { pane: d.work });
        d.enter();
        await d.waitFor('Verified output captured as evidence', {
          timeoutMs: 15_000,
        });
        await d.waitFor('Verify Health', { timeoutMs: 15_000 });

        // Step 2: Enter without running the command → FAIL, stays on the step.
        d.enter();
        await d.waitFor('Assertion failed', { timeoutMs: 15_000 });
        d.enter(); // ↵ = stay
        const stayed = await d.waitFor('Staying on this step', {
          timeoutMs: 15_000,
        });
        assert.ok(
          !stayed.includes('Operation completed'),
          'a failed check must not advance',
        );

        // Override with a reason completes it.
        d.enter();
        await d.waitFor('Assertion failed', { timeoutMs: 15_000 });
        d.key('o');
        await d.waitFor('Reason for override', { timeoutMs: 15_000 });
        d.type('health endpoint checked manually');
        await d.waitFor('Operation completed successfully', {
          timeoutMs: 15_000,
        });
      } finally {
        d.kill();
        ws.cleanup();
      }
    },
  );

  it(
    'auto work pane: created beside samaritan, reused on the next run and on resume',
    { skip, timeout: 150_000 },
    async () => {
      const ws = workspace('e2e-sidecar.yaml');
      const d = TmuxDriver.create();
      try {
        d.type(launch(ws.dir, `run ${ws.op} --env staging`));
        const first = await d.waitFor(/Work pane (%\d+) \(created\)/, {
          timeoutMs: 40_000,
        });
        const paneId = first.match(/Work pane (%\d+) \(created\)/)?.[1];
        assert.ok(paneId, 'work pane id printed');
        assert.ok(
          first.includes(`tmux select-pane -t ${paneId}`),
          'prints how to reach it',
        );
        await d.waitFor('p paste', { timeoutMs: 15_000 });
        d.key('q');
        const aborted = await d.waitFor('Run aborted', { timeoutMs: 15_000 });
        const sessionId = aborted.match(
          /samaritan resume ([0-9a-f-]{36})/,
        )?.[1];
        assert.ok(sessionId, 'resume hint');

        // Resume reattaches to the SAME pane.
        d.type(launch(ws.dir, `resume ${sessionId}`));
        await d.waitFor(`Work pane ${paneId} (reused)`, { timeoutMs: 40_000 });
        d.key('q');
        await d.waitFor(/Run aborted[\s\S]*Run aborted/, { timeoutMs: 15_000 });

        // A fresh run of the same operation reuses it too.
        d.type('clear');
        d.type(launch(ws.dir, `run ${ws.op} --env staging`));
        await d.waitFor(`Work pane ${paneId} (reused)`, { timeoutMs: 40_000 });
        d.key('q');
        await d.waitFor('Run aborted', { timeoutMs: 15_000 });
      } finally {
        d.kill();
        ws.cleanup();
      }
    },
  );

  it(
    '[e] evidence: ↵ stores cleaned pane output; t + URL stores a clickable link',
    { skip, timeout: 120_000 },
    async () => {
      const ws = workspace('e2e-sidecar.yaml');
      const d = TmuxDriver.create({ split: true });
      try {
        d.type(launch(ws.dir, `run ${ws.op} --env staging --attach ${d.work}`));
        await d.waitFor('echo "deploy E2E_DEPLOY_OK"', { timeoutMs: 40_000 });
        // Colored output: the stored evidence must not keep the escape codes.
        d.type("printf '\\033[31mred E2E_COLOR\\033[0m\\n'", d.work);
        await d.waitFor('red E2E_COLOR', { pane: d.work });

        d.key('e');
        await d.waitFor('i clipboard image', { timeoutMs: 15_000 });
        d.enter(); // ↵ pane output
        await d.waitFor('Description [↵ = "pane output"]', {
          timeoutMs: 15_000,
        });
        d.enter();
        await d.waitFor('Evidence captured (command_output', {
          timeoutMs: 15_000,
        });

        d.key('e');
        await d.waitFor('i clipboard image', { timeoutMs: 15_000 });
        d.key('t');
        await d.waitFor('Text or URL', { timeoutMs: 15_000 });
        d.type('https://bot:tok3n@jenkins.example.com/job/deploy/42/');
        await d.waitFor('Credentials removed from the URL', {
          timeoutMs: 15_000,
        });
        d.enter(); // accept default label
        await d.waitFor('Evidence captured (link', { timeoutMs: 15_000 });

        d.key('q');
        await d.waitFor('Run aborted', { timeoutMs: 15_000 });

        const events = readFileSync(
          findFile(ws.dir, 'events.jsonl') ?? '',
          'utf8',
        )
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l))
          .filter((e) => e.type === 'evidence_captured');
        const pane = events.find((e) => e.evidence_type === 'command_output');
        assert.ok(
          pane?.content.includes('red E2E_COLOR'),
          JSON.stringify(pane),
        );
        assert.ok(!pane.content.includes('\x1b'), 'no ANSI escapes stored');
        const link = events.find((e) => e.evidence_type === 'link');
        assert.strictEqual(
          link?.content,
          'https://jenkins.example.com/job/deploy/42/',
        );
        assert.strictEqual(
          link?.description,
          'jenkins.example.com/job/deploy/42',
        );

        const report = readReport(ws.dir);
        assert.ok(
          report.includes(
            '[jenkins.example.com/job/deploy/42](https://jenkins.example.com/job/deploy/42/)',
          ),
          'report renders the link',
        );
        assert.ok(!report.includes('tok3n'), 'token never reaches the report');
      } finally {
        d.kill();
        ws.cleanup();
      }
    },
  );

  it(
    'approval: typing the legacy word "reject" denies instead of firing rollback',
    { skip, timeout: 90_000 },
    async () => {
      const ws = workspace('approval-keys.yaml');
      const d = TmuxDriver.create();
      try {
        d.type(launch(ws.dir, `run ${ws.op} --env default --no-tmux`));
        await d.waitFor('Approve the production change', { timeoutMs: 40_000 });
        d.type('reject');
        const after = await d.waitFor('Rationale (optional)', {
          timeoutMs: 15_000,
        });
        assert.ok(!after.includes('Rollback'), 'no rollback on the r');
        d.enter();
        await d.waitFor('Rejected — step skipped', { timeoutMs: 15_000 });
        d.key('q');
        await d.waitFor('Run aborted', { timeoutMs: 15_000 });
      } finally {
        d.kill();
        ws.cleanup();
      }
    },
  );
});
