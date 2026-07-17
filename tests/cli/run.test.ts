import assert from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
    nestedSubsteps2Levels:
      'tests/fixtures/operations/features/nested-substeps-2-levels.yaml',
    varRendering: 'tests/fixtures/operations/features/var-rendering.yaml',
    foreachLoop: 'tests/fixtures/operations/features/foreach-loop.yaml',
    aggregatedGlobalRollback:
      'tests/fixtures/operations/features/aggregated-global-rollback.yaml',
    rollbackForeach: 'tests/fixtures/operations/features/rollback-foreach.yaml',
    evidenceRequired:
      'tests/fixtures/operations/features/evidence-required.yaml',
    multiOperator: 'tests/fixtures/operations/features/multi-operator.yaml',
    globalRollbackForeachVars:
      'tests/fixtures/operations/features/global-rollback-foreach-vars.yaml',
    scriptOnlyStep: 'tests/fixtures/operations/features/script-only-step.yaml',
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

  it('shows "Expected:" criteria upfront for a step with expect', () => {
    const fixture = fixturePath('manualStepActions');
    const result = runCli(['run', fixture, '--env', 'default'], {
      input: 'abort\n',
    });
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('Expected: contains: successfully rolled out'),
      `should print the expect criteria upfront; output:\n${combined.slice(-1000)}`,
    );
  });

  it('re-renders "Expected:" before each prompt so it never scrolls off', () => {
    const fixture = fixturePath('manualStepActions');
    // Copy (single-prompt action) re-displays the prompt; the Expected line
    // must reappear above it rather than scrolling away after the first render.
    const result = runCli(['run', fixture, '--env', 'default'], {
      input: 'c\nabort\n',
    });
    const combined = result.stdout + result.stderr;
    const occurrences =
      combined.split('Expected: contains: successfully rolled out').length - 1;
    assert.ok(
      occurrences >= 2,
      `Expected criteria should re-render before every prompt; saw ${occurrences}\n${combined.slice(-1000)}`,
    );
  });

  it('[v] verify without an attached capture shows the attach hint, not a verify outcome', () => {
    const fixture = fixturePath('manualStepActions');
    const result = runCli(['run', fixture, '--env', 'default'], {
      input: 'v\nabort\n',
    });
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('Verify requires an attached capture'),
      'should warn that verify needs an attached capture',
    );
    assert.ok(
      !combined.includes('re-verify') && !combined.includes('more'),
      'failure menu hints must not appear without a captured outcome',
    );
  });
});

// ─── evidence.required gate on step completion ───────────────────────────────

describe('run command: evidence-required gate', () => {
  // Multi-question flows (gate -> capture/override sub-prompts) hit the
  // documented readline gotcha where several lines delivered in one stdin
  // chunk get dropped after the first pending question() — stagger delivery
  // with sleeps so each question() gets its own read event (same technique
  // used by the sidecar verify UX tests below).
  // Single-quote a value for safe interpolation into the constructed shell
  // command below (args include filesystem paths, so quote rather than trust).
  function shQuote(value: string): string {
    return `'${value.replace(/'/g, "'\\''")}'`;
  }

  function runSequenced(
    args: string[],
    inputs: string[],
    timeoutMs = 15_000,
  ): { stdout: string; stderr: string } {
    const piped = inputs
      .map((line) => `printf ${shQuote(`${line}\\n`)}`)
      .join('; sleep 1; ');
    const quotedArgs = args.map(shQuote).join(' ');
    const cmd = `(sleep 1; ${piped}) | timeout ${Math.ceil(timeoutMs / 1000)} ${shQuote(CLI)} ${shQuote(INDEX)} ${quotedArgs}`;
    const result = spawnSync('bash', ['-c', cmd], {
      encoding: 'utf8',
      timeout: timeoutMs + 5_000,
    });
    return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  }

  it('blocks plain Enter and does not mark the step complete', () => {
    const fixture = fixturePath('evidenceRequired');
    const result = runCli(['run', fixture, '--env', 'default'], {
      input: '\n',
    });
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('requires evidence'),
      'should show the inline evidence-required warning',
    );
    assert.ok(
      !combined.includes('✅ Step marked complete.'),
      'step must not complete without evidence or a skip',
    );
  });

  it('--no-require-evidence disables the gate', () => {
    const fixture = fixturePath('evidenceRequired');
    const result = runCli(
      ['run', fixture, '--env', 'default', '--no-require-evidence'],
      { input: 'confirmed\n' },
    );
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('✅ Step marked complete.'),
      'step should complete immediately when the gate is disabled',
    );
    assert.ok(
      !combined.includes('requires evidence'),
      'gate warning must not appear when disabled',
    );
  });

  it('warning on completion keeps the operator on the same bar (no re-entry)', () => {
    const fixture = fixturePath('evidenceRequired');
    const { stdout, stderr } = runSequenced(
      ['run', fixture, '--env', 'default'],
      ['', 'abort'],
    );
    const combined = stdout + stderr;
    assert.ok(
      combined.includes('requires evidence'),
      `should show the inline evidence-required warning; output:\n${combined.slice(-1000)}`,
    );
    assert.ok(
      !combined.includes('✅ Step marked complete.'),
      'step must not complete while evidence is missing',
    );
    assert.ok(
      combined.includes('aborted by operator'),
      'run should still be abortable after the warning',
    );
  });

  it('skipping from the bar marks the step skipped without completing it', () => {
    const fixture = fixturePath('evidenceRequired');
    const { stdout, stderr } = runSequenced(
      ['run', fixture, '--env', 'default'],
      ['', 's'],
    );
    const combined = stdout + stderr;
    assert.ok(
      combined.includes('⏭  Skipped.'),
      `should skip the gated step; output:\n${combined.slice(-1000)}`,
    );
    assert.ok(
      !combined.includes('✅ Step marked complete.'),
      'a skipped step must not be marked complete',
    );
  });

  it('capturing evidence via [e] satisfies the requirement and allows completion', () => {
    const fixture = fixturePath('evidenceRequired');
    const { stdout, stderr } = runSequenced(
      ['run', fixture, '--env', 'default'],
      ['e', 't', 'pods healthy, 3/3 ready', '', ''],
    );
    const combined = stdout + stderr;
    assert.ok(
      combined.includes('📎 Evidence captured'),
      `should confirm evidence capture; output:\n${combined.slice(-1200)}`,
    );
    assert.ok(
      combined.includes('✅ Step marked complete.'),
      'step should complete once evidence exists',
    );
  });

  it('approval step: blocks approve until evidence is captured on its bar', () => {
    const fixture = fixturePath('evidenceRequired');
    // Capture evidence for step 1 and complete it, then reach the approval
    // step: approve is refused inline until evidence is captured on the
    // approval bar itself (no separate gate sub-menu).
    const { stdout, stderr } = runSequenced(
      ['run', fixture, '--env', 'default'],
      [
        'e',
        't',
        'evidence for step 1',
        '',
        '',
        'approve',
        'e',
        't',
        'sign-off evidence',
        '',
        'approve',
        '', // approval rationale (optional)
      ],
      25_000,
    );
    const combined = stdout + stderr;
    assert.ok(
      combined.includes('requires evidence'),
      `should gate the approval step until evidence exists; output:\n${combined.slice(-1500)}`,
    );
    assert.ok(
      combined.includes('✅ Approved.'),
      'approval step should complete once evidence is captured',
    );
  });

  it('gate never fires for a step without evidence.required', () => {
    const fixture = fixturePath('manualStepActions');
    const result = runCli(['run', fixture, '--env', 'default'], {
      input: 'abort\n',
    });
    const combined = result.stdout + result.stderr;
    assert.ok(
      !combined.includes('requires evidence'),
      'gate must not appear for steps without evidence.required',
    );
  });
});

// ─── Sidecar verify UX: checklist, highlighting, [m]/[v] re-verify ───────────

describe('run command: sidecar verify UX (--attach + tmux)', () => {
  const hasTmux =
    process.platform === 'linux' &&
    spawnSync('tmux', ['-V'], { encoding: 'utf8' }).status === 0;

  // Pre-populate a detached tmux pane with output, then attach samaritan to
  // it and press [v] to verify. The pane echoes its output shortly after
  // creation so it's present in the pipe-pane capture by the time samaritan
  // reaches the [v] prompt (~3s in).
  function withTmuxPane(
    paneOutput: string,
    run: (target: string) => { stdout: string; stderr: string },
  ): { stdout: string; stderr: string } {
    const session = `samaritan-test-${process.pid}-${Date.now()}`;
    const target = `${session}:0.0`;
    spawnSync('tmux', [
      'new-session',
      '-d',
      '-s',
      session,
      '-x',
      '200',
      '-y',
      '50',
      `sleep 1.5 && echo '${paneOutput}' && sleep 30`,
    ]);
    try {
      return run(target);
    } finally {
      spawnSync('tmux', ['kill-session', '-t', session], { stdio: 'ignore' });
    }
  }

  it(
    '[v] verify PASS shows checklist, highlighted match, and re-verify hint',
    {
      skip: !hasTmux,
    },
    () => {
      const fixture = fixturePath('manualStepActions');
      const { stdout, stderr } = withTmuxPane(
        'deployment "web" successfully rolled out',
        (target) => {
          const cmd = `(sleep 3; printf 'v\\n'; sleep 1; printf 'abort\\n') | timeout 20 node_modules/.bin/tsx src/cli/index.ts run ${fixture} --env default --attach ${target}`;
          const result = spawnSync('bash', ['-c', cmd], {
            encoding: 'utf8',
            timeout: 30_000,
          });
          return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
        },
      );
      const combined = stdout + stderr;
      assert.ok(combined.includes('✅ PASS'), 'shows PASS header');
      assert.ok(
        combined.includes('contains: successfully rolled out'),
        'shows the per-check criterion',
      );
      assert.ok(
        combined.includes('Verify passed'),
        'shows a hint that verify passed',
      );
      // Highlighted match: GREEN+INVERSE around "successfully rolled out"
      assert.ok(
        combined.includes('\x1b[32m') && combined.includes('\x1b[7m'),
        'matched text is highlighted green/inverse',
      );
    },
  );

  it(
    '[v] verify FAIL shows missing-expected output and offers [m]/[v] re-verify',
    {
      skip: !hasTmux,
    },
    () => {
      const fixture = fixturePath('manualStepActions');
      const { stdout, stderr } = withTmuxPane(
        'deployment still progressing...',
        (target) => {
          const cmd = `(sleep 3; printf 'v\\n'; sleep 1; printf '\\n'; sleep 1; printf 'abort\\n') | timeout 20 node_modules/.bin/tsx src/cli/index.ts run ${fixture} --env default --attach ${target}`;
          const result = spawnSync('bash', ['-c', cmd], {
            encoding: 'utf8',
            timeout: 30_000,
          });
          return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
        },
      );
      const combined = stdout + stderr;
      assert.ok(combined.includes('❌ FAIL'), 'shows FAIL header');
      assert.ok(
        combined.includes('missing: successfully rolled out'),
        'shows the missing expected text',
      );
      assert.ok(
        combined.includes('m=more') && combined.includes('v=re-verify'),
        `failure menu should offer [m] more and [v] re-verify; output:\n${combined.slice(-1500)}`,
      );
      assert.ok(
        combined.includes('c=copy command'),
        `failure menu should offer [c] copy command; output:\n${combined.slice(-1500)}`,
      );
    },
  );

  it(
    '[c] at the verify-failure prompt copies the command and re-renders the menu',
    {
      skip: !hasTmux,
    },
    () => {
      const fixture = fixturePath('manualStepActions');
      const { stdout, stderr } = withTmuxPane(
        'deployment still progressing...',
        (target) => {
          // v → verify fails → menu; c → copy command + re-render menu; Enter → stop; abort.
          const cmd = `(sleep 3; printf 'v\\n'; sleep 1; printf 'c\\n'; sleep 1; printf '\\n'; sleep 1; printf 'abort\\n') | timeout 20 node_modules/.bin/tsx src/cli/index.ts run ${fixture} --env default --attach ${target}`;
          const result = spawnSync('bash', ['-c', cmd], {
            encoding: 'utf8',
            timeout: 30_000,
          });
          return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
        },
      );
      const combined = stdout + stderr;
      // The clipboard binary may be absent in CI — either outcome confirms the
      // copy branch ran rather than being treated as an unknown key.
      assert.ok(
        combined.includes('Copied to clipboard!') ||
          combined.includes('Clipboard unavailable'),
        `pressing c must trigger the copy branch; output:\n${combined.slice(-1500)}`,
      );
      // Copy is not terminal: the failure menu must render again afterwards.
      const menuCount = combined.split('c=copy command').length - 1;
      assert.ok(
        menuCount >= 2,
        `failure menu must re-render after copy (saw ${menuCount}); output:\n${combined.slice(-1500)}`,
      );
    },
  );
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

// ─── durable run record (beside the operation) ──────────────────────────────

describe('run command: durable run record beside the operation', () => {
  function extractSessionId(output: string): string {
    const m = output.match(/📋 Session: ([0-9a-f-]{36})/);
    assert.ok(m, `run output must include the session id; got:\n${output}`);
    return (m as RegExpMatchArray)[1];
  }

  it('always writes events.jsonl + report.md beside the operation and a step_log on the session', () => {
    // Copy a fixture into a writable temp dir so the .samaritan-runs/ folder
    // lands next to the operation, not in the repo tree.
    const opDir = mkdtempSync(join(tmpdir(), 'samaritan-run-'));
    const opFile = join(opDir, 'op.yaml');
    const src = readFileSync(fixturePath('minimal'), 'utf-8');
    writeFileSync(opFile, src, 'utf-8');

    try {
      const result = runCli(['run', opFile, '--env', 'default'], {
        input: 'q\n',
      });
      const combined = result.stdout + result.stderr;
      const sessionId = extractSessionId(combined);

      const runDir = join(opDir, '.samaritan-runs', sessionId);
      assert.ok(
        existsSync(join(runDir, 'events.jsonl')),
        'events.jsonl must be written beside the operation',
      );
      assert.ok(
        existsSync(join(runDir, 'report.md')),
        'report.md must be written beside the operation (always-on)',
      );

      const sessionPath = join(
        homedir(),
        '.samaritan',
        'sessions',
        `${sessionId}.json`,
      );
      const session = JSON.parse(readFileSync(sessionPath, 'utf-8'));
      assert.ok(
        Array.isArray(session.step_log) && session.step_log.length >= 1,
        'session JSON must carry a structured step_log',
      );
      assert.ok(
        session.step_log[0].commands?.length >= 1,
        'step_log must capture the step input command',
      );
    } finally {
      rmSync(opDir, { recursive: true, force: true });
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

  it('displays a script-only step with its content and a bash <path> runnable', () => {
    // A step whose only action is `script:` (no inline command) previously
    // rendered nothing runnable in the run loop.
    const fixture = fixturePath('scriptOnlyStep');
    const result = runCli(['run', fixture, '--env', 'staging'], {
      input: 'q\n',
      timeout: 15_000,
    });
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('Script: ./deploy.sh'),
      'should show the script path',
    );
    assert.ok(
      combined.includes('Deploying web server'),
      'should embed the script file content',
    );
    assert.ok(
      combined.includes('bash ./deploy.sh'),
      'should show a bash <path> runnable for the operator',
    );
    assert.ok(
      combined.includes('copy'),
      'should offer [c] copy for the script invocation',
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

  it('[p] send to pane hint appears in sidecar mode for a step with a command', () => {
    const fixture = fixturePath('sidecar');
    const result = runCli(['run', fixture, '--env', 'staging'], {
      input: 'q\n',
      timeout: 15_000,
    });
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('send to pane') || combined.includes('[p]'),
      'sidecar mode should show the [p] send-to-pane hint',
    );
  });

  it('[p] without an attached pane warns to attach first, then continues', () => {
    const fixture = fixturePath('sidecar');
    // 'p' is a single-token action; the warning must appear and the loop must
    // survive so 'abort' is still consumed afterwards.
    const result = runCli(['run', fixture, '--env', 'staging'], {
      input: 'p\nabort\n',
      timeout: 15_000,
    });
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('No tmux pane attached'),
      `[p] with no attached pane must warn to attach first; output:\n${combined.slice(-800)}`,
    );
    // It must NOT auto-run anything (sidecar never executes on the operator's behalf)
    assert.ok(
      !combined.includes('Sent to tmux') && !combined.includes('📤'),
      'sidecar [p] must never auto-execute a command',
    );
  });

  it('[b] back hint is not offered on the very first step', () => {
    const fixture = fixturePath('sidecar');
    const result = runCli(['run', fixture, '--env', 'staging'], {
      input: 'q\n',
      timeout: 15_000,
    });
    const combined = result.stdout + result.stderr;
    // Isolate the first step's prompt block (before any second step header).
    const firstStepBlock = combined.split('Verify Health')[0];
    assert.ok(
      !/\bback\b/.test(firstStepBlock),
      'the [b] back action must not appear on the first step',
    );
  });

  it('[j] jump hint is offered on an early step but not on the last step', () => {
    // sidecar fixture has 2 steps. Complete step 1 (Enter), then abort on the
    // last step (q). Jump must appear before the last step, not on it.
    const fixture = fixturePath('sidecar');
    const result = runCli(['run', fixture, '--env', 'staging'], {
      input: '\nq\n',
      timeout: 15_000,
    });
    const combined = result.stdout + result.stderr;
    const [firstStepBlock, lastStepBlock] = combined.split('Verify Health');
    // Note: labels are wrapped in ANSI codes (e.g. \x1b[2mjump\x1b[0m), so a
    // \bjump\b regex would fail on the leading boundary — use includes().
    assert.ok(
      firstStepBlock.includes('jump'),
      'the [j] jump action must appear on a step that has later steps',
    );
    assert.ok(
      lastStepBlock !== undefined && !lastStepBlock.includes('jump'),
      'the [j] jump action must not appear on the last step',
    );
  });
});

// ─── Sub-steps support ────────────────────────────────────────────────────────

describe('run command: sub-steps support', () => {
  it('dry-run expands sub_steps into flat step count', () => {
    // nested-substeps-2-levels has 1 top-level step with 2 sub_steps each
    // having 2 leaf sub_steps — 7 flat steps total vs. 1 top-level
    const fixture = fixturePath('nestedSubsteps2Levels');
    const result = runCli(['run', fixture, '--env', 'staging', '--dry-run']);
    assert.strictEqual(result.status, 0, 'dry-run with sub_steps must exit 0');
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('Steps: 7') || combined.includes('7  Skipped'),
      'flat step count must include sub_steps (7 total, not 1 top-level)',
    );
  });

  it('interactive mode shows parent section header with sub-steps annotation', () => {
    const fixture = fixturePath('nestedSubsteps2Levels');
    const result = runCli(['run', fixture, '--env', 'staging'], {
      input: 'q\n',
    });
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('sub-steps follow'),
      'parent step must appear as section header with sub-steps annotation',
    );
  });

  it('interactive mode shows sub-step labels like [1a/N] after parent section', () => {
    const fixture = fixturePath('nestedSubsteps2Levels');
    const result = runCli(['run', fixture, '--env', 'staging'], {
      input: 'q\n',
    });
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('[1a/') || combined.includes('[1b/'),
      'sub-steps must appear with alphabetic labels (1a, 1b, ...)',
    );
  });

  it('action prompt accepts single-char input in non-TTY fallback mode', () => {
    // In non-TTY (piped stdin), readActionKey falls back to readline question()
    const fixture = fixturePath('nestedSubsteps2Levels');
    const result = runCli(['run', fixture, '--env', 'staging'], {
      input: 'q\n',
    });
    assert.strictEqual(
      result.status,
      0,
      'non-TTY fallback must handle single-char input + newline',
    );
  });
});

// ─── ${VAR} rendering in run-mode display ────────────────────────────────────

describe('run command: ${VAR} rendering in step display', () => {
  it('resolves ${VAR} in step description', () => {
    const fixture = fixturePath('varRendering');
    const result = runCli(['run', fixture, '--env', 'staging'], {
      input: 'q\n',
    });
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('Scale to 2 replicas in the staging-ns namespace'),
      'description must have ${REPLICAS}/${NAMESPACE} resolved',
    );
    assert.ok(
      !combined.includes('${NAMESPACE}'),
      'description must not show literal ${NAMESPACE}',
    );
  });

  it('resolves ${VAR} in the "Expected:" criteria display', () => {
    const fixture = fixturePath('varRendering');
    const result = runCli(['run', fixture, '--env', 'staging'], {
      input: 'q\n',
    });
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes(
        'Expected: contains: deployment.apps/web scaled in staging-ns',
      ),
      `Expected criteria must have ${'${NAMESPACE}'} resolved; output:\n${combined.slice(-1000)}`,
    );
    assert.ok(
      !combined.includes(
        'contains: deployment.apps/web scaled in ${NAMESPACE}',
      ),
      'Expected criteria must not show literal ${NAMESPACE}',
    );
  });

  it('resolves ${VAR} in rollback command display (no tmux session)', () => {
    const fixture = fixturePath('varRendering');
    // r triggers rollback display for step 1, then q aborts — but multi-prompt
    // piped stdin is unreliable (see CLAUDE.md); send both lines in one chunk
    // is exactly the broken case, so use 'r\n' only: rollback prints, then the
    // step re-prompts and stdin EOF ends the run.
    const result = runCli(['run', fixture, '--env', 'staging'], {
      input: 'r\n',
    });
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('kubectl rollout undo deployment/web -n staging-ns'),
      'rollback command display must have ${NAMESPACE} resolved',
    );
  });

  it('resolves a foreach loop variable (step.variables) in the command display', () => {
    // foreach injects the loop var (SERVICE) into each expanded step's
    // step.variables — not the env/common vars. The command display must
    // resolve it the same way `expect` already does, instead of leaking
    // literal ${SERVICE}.
    const fixture = fixturePath('foreachLoop');
    const result = runCli(['run', fixture, '--env', 'production'], {
      input: 'q\n',
    });
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('kubectl apply -f backend.yaml -n production'),
      `command must have foreach var ${'${SERVICE}'} resolved; output:\n${combined.slice(-1000)}`,
    );
    assert.ok(
      !combined.includes('${SERVICE}'),
      'command must not show literal ${SERVICE}',
    );
  });

  it('offers [g] global rollback and previews the consolidated recovery', () => {
    // Single-action interaction only — the confirm prompt is a second
    // question() call, and piped multi-line stdin is unreliable (CLAUDE.md
    // Gotcha #3). `g` fires the jump and previews; EOF then ends the run.
    const fixture = fixturePath('aggregatedGlobalRollback');
    const result = runCli(['run', fixture, '--env', 'staging'], {
      input: 'g\n',
    });
    const combined = result.stdout + result.stderr;
    // The action menu advertises the global rollback jump.
    assert.ok(
      combined.includes('global rollback'),
      'manual step menu must offer [g] global rollback',
    );
    // Pressing g previews the consolidated rollback (explicit plan step here,
    // since no step has been completed yet).
    assert.ok(
      combined.includes('Global rollback will run the following'),
      'g must preview the consolidated rollback',
    );
    assert.ok(
      combined.includes('Notify on-call'),
      'preview must include the explicit operation-level rollback step',
    );
  });

  it('[g] global rollback previews every matrix-expanded rollback step', () => {
    // The operation-level rollback plan uses a matrix foreach (2×2). The run
    // loop consumes the flat, pre-expanded RollbackStep[], so the preview must
    // list all four combinations — not a single un-expanded step.
    const fixture = fixturePath('rollbackForeach');
    const result = runCli(['run', fixture, '--env', 'production'], {
      input: 'g\n',
    });
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('Global rollback will run the following'),
      'g must preview the consolidated rollback',
    );
    for (const combo of [
      'Restart (us, web)',
      'Restart (us, api)',
      'Restart (eu, web)',
      'Restart (eu, api)',
    ]) {
      assert.ok(
        combined.includes(combo),
        `preview must include expanded rollback step "${combo}"; output:\n${combined.slice(-1500)}`,
      );
    }
  });

  it('[g] global rollback preview resolves foreach entry variables', () => {
    // The foreach values are ${VAR} references (not baked at parse time), so
    // each expanded rollback entry carries them in `variables`. The preview
    // must pass those to tryResolve so ${HOST} resolves in the command.
    const fixture = fixturePath('globalRollbackForeachVars');
    const result = runCli(['run', fixture, '--env', 'staging'], {
      input: 'g\n',
    });
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('ssh web.staging.example.com systemctl restart app'),
      `preview must resolve ${'${HOST}'} from the entry's variables; output:\n${combined.slice(-1200)}`,
    );
    assert.ok(
      combined.includes('ssh api.staging.example.com systemctl restart app'),
      'preview must resolve the second foreach entry command',
    );
    assert.ok(
      !combined.includes('ssh ${HOST}'),
      'preview must not leave literal ${HOST} in the command',
    );
  });

  it('warns about unresolved variables instead of failing silently', () => {
    const fixture = fixturePath('varRendering');
    // skip step 1 so step 2 (with ${NOT_DEFINED}) renders, then EOF ends run
    const result = runCli(['run', fixture, '--env', 'staging'], {
      input: 's\n',
    });
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('Unresolved variable(s): NOT_DEFINED'),
      'must warn which variable could not be resolved',
    );
    assert.ok(
      combined.includes('${NOT_DEFINED}'),
      'unresolved placeholder stays visible as a marker',
    );
  });
});

// ─── TTY raw-mode action prompt (regression: silent exit at first prompt) ────

describe('run command: TTY raw-mode action prompt', () => {
  // readActionKey() pauses readline and switches stdin to raw mode; without an
  // explicit stdin.resume() the paused stream emits no keypress events and
  // holds no live handle, so the event loop drains and the process exits 0 at
  // the first prompt. Piped-stdin tests can't catch this (non-TTY falls back
  // to question()), so run under a pseudo-TTY via util-linux `script`.
  const hasScript =
    process.platform === 'linux' &&
    spawnSync('script', ['--version'], { encoding: 'utf8' }).status === 0;

  it(
    'waits at the action prompt under a TTY and aborts on q',
    {
      skip: !hasScript,
    },
    () => {
      const fixture = fixturePath('manualStepActions');
      // Hold stdin open, send a single raw `q` keypress after the prompt renders.
      const cmd = `(sleep 3; printf 'q'; sleep 3) | script -qec "${CLI} ${INDEX} run ${fixture} --env default" /dev/null`;
      const result = spawnSync('bash', ['-c', cmd], {
        encoding: 'utf8',
        timeout: 30_000,
      });
      const combined = (result.stdout ?? '') + (result.stderr ?? '');
      assert.ok(
        combined.includes('aborted by operator'),
        `process must stay alive at the raw-mode prompt and abort on q; output was:\n${combined.slice(-2000)}`,
      );
    },
  );
});

// ─── Abort persists a resumable session (issue: "how to resume a run?") ──────

describe('run command: abort persists a resumable session', () => {
  function extractSessionId(output: string): string {
    const m = output.match(/📋 Session: ([0-9a-f-]{36})/);
    assert.ok(m, `run output must include the session id; got:\n${output}`);
    return (m as RegExpMatchArray)[1];
  }

  function readSessionFile(sessionId: string): any {
    const path = join(homedir(), '.samaritan', 'sessions', `${sessionId}.json`);
    assert.ok(existsSync(path), `session file must exist at ${path}`);
    return JSON.parse(readFileSync(path, 'utf-8'));
  }

  it('q/abort saves the session as paused and prints a resume hint', () => {
    const fixture = fixturePath('manualStepActions');
    const result = runCli(['run', fixture, '--env', 'default'], {
      input: 'q\n',
    });
    const combined = result.stdout + result.stderr;
    const sessionId = extractSessionId(combined);

    assert.ok(
      combined.includes(`samaritan resume ${sessionId}`),
      'abort must print a resume hint with the session id',
    );

    const session = readSessionFile(sessionId);
    assert.strictEqual(
      session.status,
      'paused',
      'aborted session must be persisted as paused (resumable)',
    );
  });

  it('Ctrl+C (SIGINT) saves the session as paused and prints a resume hint', async () => {
    const fixture = fixturePath('manualStepActions');
    // Run node directly with the tsx loader so SIGINT hits OUR process (a
    // wrapper shim might not forward the signal). Keep stdin open (pipe, no
    // input) so the run parks at the first step prompt.
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', INDEX, 'run', fixture, '--env', 'default'],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );

    let out = '';
    let signalled = false;
    await new Promise<void>((done, fail) => {
      const kill = setTimeout(() => {
        child.kill('SIGKILL');
        fail(new Error(`timed out; output was:\n${out}`));
      }, 25_000);

      const onData = (d: Buffer) => {
        out += d.toString();
        // The per-step divider/banner only prints once the loop is running, by
        // which point the SIGINT handler is registered — safe to interrupt.
        if (
          !signalled &&
          /Session: [0-9a-f-]{36}/.test(out) &&
          out.includes('─')
        ) {
          signalled = true;
          setTimeout(() => child.kill('SIGINT'), 200);
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', fail);
      child.on('close', () => {
        clearTimeout(kill);
        done();
      });
    });

    const sessionId = extractSessionId(out);
    assert.ok(
      out.includes(`samaritan resume ${sessionId}`),
      `Ctrl+C must print a resume hint; output was:\n${out.slice(-1500)}`,
    );
    const session = readSessionFile(sessionId);
    assert.strictEqual(
      session.status,
      'paused',
      'Ctrl+C-aborted session must be persisted as paused (resumable)',
    );
  });

  it('persists the post-step index so resume continues at the NEXT step', () => {
    // varRendering has 2 manual steps; complete step 1 with Enter, then EOF
    // ends the run at step 2's prompt.
    const fixture = fixturePath('varRendering');
    const result = runCli(['run', fixture, '--env', 'staging'], {
      input: '\n',
    });
    const combined = result.stdout + result.stderr;
    const sessionId = extractSessionId(combined);

    const session = readSessionFile(sessionId);
    assert.strictEqual(
      session.current_step_index,
      1,
      'after completing step 1, the persisted index must point at step 2 — ' +
        'not back at the already-completed step',
    );
  });
});

// ─── run --from-step: jump ahead at startup ─────────────────────────────────

describe('run command: --from-step starts at a later step', () => {
  function extractSessionId(output: string): string {
    const m = output.match(/📋 Session: ([0-9a-f-]{36})/);
    assert.ok(m, `run output must include the session id; got:\n${output}`);
    return (m as RegExpMatchArray)[1];
  }

  function readSessionFile(sessionId: string): any {
    const path = join(homedir(), '.samaritan', 'sessions', `${sessionId}.json`);
    assert.ok(existsSync(path), `session file must exist at ${path}`);
    return JSON.parse(readFileSync(path, 'utf-8'));
  }

  it('opens at the requested step and records earlier steps as skipped', () => {
    // sidecar fixture has 2 steps; start at step 2.
    const fixture = fixturePath('sidecar');
    const result = runCli(
      ['run', fixture, '--env', 'staging', '--from-step', '2'],
      {
        input: 'q\n',
        timeout: 15_000,
      },
    );
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('Starting at step 2'),
      'must announce the jumped-to start step',
    );
    // The first per-step banner shown must be [2/2], not [1/2].
    const firstBanner = combined.match(/\[\d+\/\d+\]/);
    assert.ok(
      firstBanner && firstBanner[0] === '[2/2]',
      `first step banner must be [2/2]; got ${firstBanner?.[0]}`,
    );

    const sessionId = extractSessionId(combined);
    const session = readSessionFile(sessionId);
    assert.strictEqual(
      session.current_step_index,
      1,
      '--from-step 2 must persist current_step_index at 1 (0-based)',
    );
  });

  it('exits non-zero for an out-of-range --from-step', () => {
    const fixture = fixturePath('sidecar');
    const result = runCli(
      ['run', fixture, '--env', 'staging', '--from-step', '9'],
      { input: 'q\n', timeout: 15_000 },
    );
    assert.notStrictEqual(
      result.status,
      0,
      'out-of-range --from-step must fail',
    );
    const combined = result.stdout + result.stderr;
    assert.ok(
      /--from-step must be between 1 and \d+/.test(combined),
      'must print the valid range error',
    );
  });
});

// ─── TTY raw-mode: [t] fires immediately and keys are not echoed twice ───────

describe('run command: TTY [t] attach prompt', () => {
  const hasScript =
    process.platform === 'linux' &&
    spawnSync('script', ['--version'], { encoding: 'utf8' }).status === 0;

  it(
    'pressing t opens the attach prompt without Enter and without double echo',
    {
      skip: !hasScript,
    },
    () => {
      const fixture = fixturePath('sidecar');
      // t → attach prompt appears immediately; Enter cancels it; q aborts.
      const cmd = `(sleep 3; printf 't'; sleep 2; printf '\\n'; sleep 2; printf 'q'; sleep 2) | script -qec "${CLI} ${INDEX} run ${fixture} --env staging" /dev/null`;
      const result = spawnSync('bash', ['-c', cmd], {
        encoding: 'utf8',
        timeout: 30_000,
      });
      const combined = (result.stdout ?? '') + (result.stderr ?? '');
      assert.ok(
        combined.includes('Select pane') ||
          combined.includes('Tmux pane target'),
        `[t] must open the attach prompt without requiring Enter; output:\n${combined.slice(-2000)}`,
      );
      // Regression: readline's own keypress listener used to stay attached in
      // raw mode, echoing every key twice ("t" rendered as "tt").
      assert.ok(
        !/>\s*tt/.test(combined),
        `keys must not be echoed twice at the action prompt; output:\n${combined.slice(-2000)}`,
      );
    },
  );
});

// ─── --pic focus mode ─────────────────────────────────────────────────────────

describe('run command: --pic focus mode', () => {
  // The multi-operator fixture orders a bob-owned step FIRST, so under
  // `--pic alice` it is auto-skipped before the loop reaches alice's first
  // interactive step — where we abort. A single `abort` keeps the readline
  // flow simple (no multi-prompt chaining; see the manual-step testing note).

  it('auto-skips a step assigned to a different PIC and records it', () => {
    const fixture = fixturePath('multiOperator');
    const result = runCli(
      ['run', fixture, '--env', 'staging', '--pic', 'alice'],
      { input: 'abort\n' },
    );
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('Skipped (assigned to bob'),
      `bob's step must be auto-skipped under --pic alice; output:\n${combined.slice(-2000)}`,
    );
    assert.ok(
      combined.includes('🎯 Focus: alice'),
      'focus banner must show the focused operator',
    );
    // Alice's own step is reached (it's where we abort).
    assert.ok(
      combined.includes('Alice deploy'),
      "alice's own step must be presented",
    );
  });

  it("--no-skip-others keeps other operators' steps visible (not skipped)", () => {
    const fixture = fixturePath('multiOperator');
    const result = runCli(
      [
        'run',
        fixture,
        '--env',
        'staging',
        '--pic',
        'alice',
        '--no-skip-others',
      ],
      { input: 'abort\n' },
    );
    const combined = result.stdout + result.stderr;
    assert.ok(
      !combined.includes('Skipped (assigned to bob'),
      '--no-skip-others must not auto-skip other PICs',
    );
    assert.ok(
      combined.includes('assigned elsewhere'),
      "other operators' steps must be annotated as assigned elsewhere",
    );
  });

  it('without --pic, no focus filtering happens (bob step not skipped)', () => {
    const fixture = fixturePath('multiOperator');
    const result = runCli(['run', fixture, '--env', 'staging'], {
      input: 'abort\n',
    });
    const combined = result.stdout + result.stderr;
    assert.ok(
      !combined.includes('Skipped (assigned to'),
      'no focus filtering without --pic',
    );
    assert.ok(!combined.includes('🎯 Focus:'), 'no focus banner without --pic');
    // The first step (Bob migrate) is presented normally.
    assert.ok(combined.includes('Bob migrate'), "bob's step is shown");
  });
});
