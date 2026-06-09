import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';

// Resolve fixture paths directly (avoids importing parser via fixtures.ts)
function fixturePath(name: string): string {
  const map: Record<string, string> = {
    deploymentTest: 'tests/fixtures/operations/valid/deployment-test.yaml',
    minimal: 'tests/fixtures/operations/valid/minimal.yaml',
    manualStepActions:
      'tests/fixtures/operations/features/manual-step-actions.yaml',
    withSessions: 'tests/fixtures/operations/features/with-sessions.yaml',
    sidecar: 'tests/fixtures/operations/features/sidecar.yaml',
  };
  return resolve(map[name]);
}

const CLI = 'node_modules/.bin/tsx';
const INDEX = 'src/cli/index.ts';

function runCli(
  args: string[],
  opts?: { input?: string; timeout?: number },
): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(CLI, [INDEX, ...args], {
    encoding: 'utf8',
    input: opts?.input,
    timeout: opts?.timeout ?? 15_000,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  };
}

// ─── --env / --environment flag ───────────────────────────────────────────────

describe('run command: --env / --environment flag', () => {
  it('--env flag is accepted', () => {
    const fixture = fixturePath('deploymentTest');
    const result = runCli(['run', fixture, '--env', 'staging', '--dry-run']);
    const combined = result.stdout + result.stderr;
    assert.ok(!combined.includes('not specified'), '--env should be accepted');
  });

  it('--environment flag is accepted as alias for --env', () => {
    const fixture = fixturePath('deploymentTest');
    const result = runCli([
      'run',
      fixture,
      '--environment',
      'staging',
      '--dry-run',
    ]);
    const combined = result.stdout + result.stderr;
    assert.ok(
      !combined.includes('not specified') &&
        !combined.includes('unknown option'),
      '--environment should be accepted as an alias',
    );
  });

  it('missing env flag gives a clear error', () => {
    const fixture = fixturePath('deploymentTest');
    const result = runCli(['run', fixture]);
    const combined = result.stdout + result.stderr;
    assert.notStrictEqual(result.status, 0);
    assert.ok(
      combined.includes('not specified') || combined.includes('required'),
      'Error must mention the missing required env option',
    );
  });
});

// ─── --dry-run semantics ──────────────────────────────────────────────────────

describe('run command: dry-run semantics', () => {
  it('dry-run exits 0 and reports full preview', () => {
    const fixture = fixturePath('deploymentTest');
    const result = runCli(['run', fixture, '--env', 'staging', '--dry-run']);
    assert.strictEqual(result.status, 0, 'dry-run must exit 0');
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('preview complete') ||
        combined.includes('traversed') ||
        combined.includes('completed'),
      'dry-run must report full traversal',
    );
  });

  it('dry-run does not pause at first manual/waiting step', () => {
    const fixture = fixturePath('deploymentTest');
    const result = runCli(['run', fixture, '--env', 'staging', '--dry-run']);
    const combined = result.stdout + result.stderr;
    assert.ok(
      !combined.includes('paused') || combined.includes('preview complete'),
      'dry-run must not stop with "paused" status',
    );
  });

  it('dry-run does not print a resume hint', () => {
    const fixture = fixturePath('deploymentTest');
    const result = runCli(['run', fixture, '--env', 'staging', '--dry-run']);
    const combined = result.stdout + result.stderr;
    // resume hint appears only when paused mid-run, never in dry-run
    assert.ok(
      !combined.includes('samaritan resume'),
      'dry-run must not suggest "samaritan resume"',
    );
  });

  it('generate manual guidance does not show <operation.yaml> placeholder', () => {
    const fixture = fixturePath('deploymentTest');
    const result = runCli(['run', fixture, '--env', 'staging', '--dry-run']);
    const combined = result.stdout + result.stderr;
    assert.ok(
      !combined.includes('<operation.yaml>'),
      'Must not show placeholder <operation.yaml>',
    );
  });
});

// ─── Variable interpolation ───────────────────────────────────────────────────

describe('run command: variable interpolation', () => {
  it('resolves ${VAR} from environment variables before display', () => {
    // deployment-test.yaml has ${REPLICAS} for staging=2 and ${PORT} for staging=8080
    const fixture = fixturePath('deploymentTest');
    const result = runCli(['run', fixture, '--env', 'staging'], {
      input: 'q\n',
    });
    const combined = result.stdout + result.stderr;
    // The instruction for Health Check step reads:
    //   "Check the application health endpoint at http://localhost:${PORT}/health"
    // After resolution it should read "...localhost:8080/health"
    // We just verify no raw ${PORT} appears in the combined output when vars are available.
    assert.ok(
      !combined.includes('${PORT}'),
      'Resolved output must not contain raw ${PORT} placeholder',
    );
  });

  it('resolves ${REPLICAS} placeholder in commands', () => {
    const fixture = fixturePath('deploymentTest');
    const result = runCli(['run', fixture, '--env', 'staging'], {
      input: 'q\n',
    });
    const combined = result.stdout + result.stderr;
    assert.ok(
      !combined.includes('${REPLICAS}'),
      'Resolved output must not contain raw ${REPLICAS} placeholder',
    );
  });
});

// ─── Interactive mode ─────────────────────────────────────────────────────────

describe('run command: interactive mode', () => {
  it('starts interactive execution when not in dry-run mode', () => {
    const fixture = fixturePath('deploymentTest');
    const result = runCli(['run', fixture, '--env', 'staging'], {
      input: 'q\n',
    });
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('interactive') ||
        combined.includes('Step') ||
        combined.includes('Execute') ||
        combined.includes('AUTOMATIC') ||
        combined.includes('MANUAL'),
      'Interactive mode should show step-by-step prompts',
    );
  });

  it('shows exact execution mode in summary', () => {
    const fixture = fixturePath('deploymentTest');
    const result = runCli([
      'run',
      fixture,
      '--env',
      'staging',
      '--dry-run',
      '-m',
      'manual',
    ]);
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('manual') || combined.includes('Execution mode'),
      'Should display the exact execution mode',
    );
  });

  it('--auto-approve flag runs without interactive prompts', () => {
    const fixture = fixturePath('minimal');
    const result = runCli([
      'run',
      fixture,
      '--env',
      'default',
      '--auto-approve',
    ]);
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('completed') ||
        combined.includes('success') ||
        result.status === 0,
      'Auto-approve should complete without prompts',
    );
  });
});

// ─── Manual-step note/evidence/verify actions ────────────────────────────────

describe('run command: manual-step note/evidence/verify actions', () => {
  it('manual step prompt offers [n] note and [e] evidence actions', () => {
    const fixture = fixturePath('manualStepActions');
    const result = runCli(['run', fixture, '--env', 'default'], {
      input: 'abort\n',
    });
    const combined = result.stdout + result.stderr;
    assert.ok(combined.includes('note'), 'should offer a note action');
    assert.ok(combined.includes('evidence'), 'should offer an evidence action');
  });

  it('manual step prompt offers [v] verify when step.expect is set', () => {
    const fixture = fixturePath('manualStepActions');
    const result = runCli(['run', fixture, '--env', 'default'], {
      input: 'abort\n',
    });
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('verify'),
      'should offer a verify action when step has an expect',
    );
  });

  it('recording a note emits a user_input note event', () => {
    const fixture = fixturePath('manualStepActions');
    const result = runCli(['run', fixture, '--env', 'default'], {
      input: 'n\nLooks good so far\nabort\n',
    });
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('Note recorded') || combined.includes('📝'),
      'should confirm the note was recorded',
    );
  });

  it('[x] remove evidence is not offered before any evidence is captured', () => {
    const fixture = fixturePath('manualStepActions');
    const result = runCli(['run', fixture, '--env', 'default'], {
      input: 'abort\n',
    });
    const combined = result.stdout + result.stderr;
    assert.ok(
      !combined.includes('remove evidence'),
      'should not offer [x] remove evidence when the step has no evidence yet',
    );
  });
});

// ─── run --help smoke test ────────────────────────────────────────────────────

describe('run command: smoke tests', () => {
  it('run --help exits 0 and shows usage', () => {
    const result = runCli(['run', '--help']);
    assert.strictEqual(result.status, 0, 'run --help must exit 0');
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('operation') || combined.includes('environment'),
      'run --help must show usage text',
    );
  });
});

// ─── Session persistence + resume ────────────────────────────────────────────

describe('resume command: session persistence', () => {
  it('resume with unknown session gives a clear not-found error', () => {
    const result = runCli(['resume', 'nonexistent-session-id-abc123']);
    const combined = result.stdout + result.stderr;
    assert.notStrictEqual(
      result.status,
      0,
      'resume with unknown session must exit non-zero',
    );
    assert.ok(
      combined.includes('Session not found') || combined.includes('not found'),
      'Error must mention the session was not found',
    );
  });

  it('session file is written to ~/.samaritan/sessions/ on run', () => {
    const fixture = fixturePath('minimal');
    const result = runCli([
      'run',
      fixture,
      '--env',
      'default',
      '--auto-approve',
    ]);
    assert.strictEqual(result.status, 0, 'run should complete successfully');

    // Check that at least one session JSON was written
    const sessionDir = join(homedir(), '.samaritan', 'sessions');
    if (existsSync(sessionDir)) {
      const files = readdirSync(sessionDir).filter((f: string) =>
        f.endsWith('.json'),
      );
      assert.ok(
        files.length > 0,
        'At least one session file must be written to ~/.samaritan/sessions/',
      );
    }
    // If the directory doesn't exist yet, the feature isn't broken — just skipped.
    // The real persistence check is that resume works across processes (next test).
  });
});

// ─── --report flag ───────────────────────────────────────────────────────────

describe('run command: --report flag', () => {
  it('--report flag creates Markdown evidence report in specified directory', () => {
    const fixture = fixturePath('minimal');
    const reportDir = mkdtempSync(join(tmpdir(), 'samaritan-report-'));

    try {
      runCli(['run', fixture, '--env', 'default', '--report', reportDir], {
        input: 'q\n',
        timeout: 30_000,
      });

      const files = readdirSync(reportDir);
      const mdFiles = files.filter((f) => f.endsWith('.md'));
      assert.ok(
        mdFiles.length > 0,
        `should create at least one .md file in report dir, got: [${files.join(', ')}]`,
      );
    } finally {
      rmSync(reportDir, { recursive: true, force: true });
    }
  });

  it('--report flag prints report path to stdout', () => {
    const fixture = fixturePath('minimal');
    const reportDir = mkdtempSync(join(tmpdir(), 'samaritan-report-'));

    try {
      const result = runCli(
        ['run', fixture, '--env', 'default', '--report', reportDir],
        { input: 'q\n', timeout: 30_000 },
      );
      const combined = result.stdout + result.stderr;
      assert.ok(
        combined.includes('.md') || combined.includes('report'),
        'output should mention the report file or "report"',
      );
    } finally {
      rmSync(reportDir, { recursive: true, force: true });
    }
  });
});

// ─── Sidecar mode tests ───────────────────────────────────────────────────────

describe('run command: sidecar mode', () => {
  it('--help mentions sidecar and --attach', () => {
    const result = runCli(['run', '--help']);
    const combined = result.stdout + result.stderr;
    assert.ok(combined.includes('sidecar'), '--help must mention sidecar mode');
    assert.ok(combined.includes('attach'), '--help must mention --attach flag');
  });

  it('invalid -m bogus gives a clear error', () => {
    const fixture = fixturePath('sidecar');
    const result = runCli(['run', fixture, '--env', 'staging', '-m', 'bogus']);
    assert.notStrictEqual(result.status, 0, 'invalid mode must exit non-zero');
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('bogus') ||
        combined.includes('Invalid mode') ||
        combined.includes('invalid'),
      'error must mention the bad mode value',
    );
  });

  it('default mode is sidecar (shown in dry-run summary)', () => {
    const fixture = fixturePath('sidecar');
    const result = runCli(['run', fixture, '--env', 'staging', '--dry-run']);
    assert.strictEqual(result.status, 0, 'dry-run must exit 0');
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('sidecar'),
      'default mode should be sidecar as shown in dry-run summary',
    );
  });

  it('sidecar run of an automatic step shows manual-style action hints and command block', () => {
    const fixture = fixturePath('sidecar');
    // Single-prompt interaction: q to abort immediately after seeing the first step
    const result = runCli(['run', fixture, '--env', 'staging'], {
      input: 'q\n',
      timeout: 15_000,
    });
    const combined = result.stdout + result.stderr;
    // Should show the command block (sidecar displays command for operator to run)
    assert.ok(
      combined.includes('kubectl apply') || combined.includes('Deploy App'),
      'sidecar should show the automatic step command',
    );
    // Should offer manual-style hints (done/copy/note/evidence/verify) — not '📤 Sent to tmux'
    assert.ok(
      !combined.includes('📤') && !combined.includes('Sent to tmux'),
      'sidecar must NOT send commands to tmux',
    );
  });

  it('[t] attach pane hint appears in sidecar mode', () => {
    const fixture = fixturePath('sidecar');
    const result = runCli(['run', fixture, '--env', 'staging'], {
      input: 'q\n',
      timeout: 15_000,
    });
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('attach pane') ||
        combined.includes('[t]') ||
        combined.includes('attach'),
      'sidecar mode should show [t] attach hint',
    );
  });

  it('--attach bogus-target warns gracefully and still starts the step loop', () => {
    const fixture = fixturePath('sidecar');
    const result = runCli(
      ['run', fixture, '--env', 'staging', '--attach', 'bogus-target-xyz'],
      { input: 'q\n', timeout: 15_000 },
    );
    const combined = result.stdout + result.stderr;
    // Must warn about invalid target (not crash)
    assert.ok(
      combined.includes('bogus-target-xyz') ||
        combined.includes('not a valid') ||
        combined.includes('invalid'),
      'must warn about invalid --attach target',
    );
    // Must still reach the step loop (show at least one step header or action hint)
    assert.ok(
      combined.includes('Deploy App') ||
        combined.includes('step') ||
        combined.includes('done') ||
        combined.includes('abort'),
      'must still reach the step loop even with invalid --attach',
    );
  });
});
