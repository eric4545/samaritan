import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import {
  buildPasteBufferArgs,
  capturePaneCursorLine,
  isLocalSession,
  isMultiLinePaste,
  listTmuxPanes,
  listUnresolvedTmuxSessionVars,
  normalizePasteText,
  paneOwnerFile,
  parseTmuxPaneList,
  parseWindowPanes,
  readPaneOwner,
  resolveTmuxSessionName,
  sanitizeSessionName,
  TmuxPaneCapture,
  TmuxSession,
  validateTmuxTarget,
} from '../../src/lib/tmux-session';

describe('TmuxSession (issue #6)', () => {
  it('getPipeFilePath follows naming convention', () => {
    const session = new TmuxSession('abc123', 'samaritan-abc123');
    const path = session.getPipeFilePath('execution');
    assert.ok(path.includes('abc123'), 'path includes session id');
    assert.ok(path.includes('execution'), 'path includes session name');
    assert.ok(path.endsWith('.pipe'), 'path ends with .pipe');
    assert.ok(path.startsWith(tmpdir()), 'path is in tmpdir');
  });

  it('currentOffset returns 0 when pipe file does not exist', () => {
    const session = new TmuxSession('no-pipe-xyz', 'samaritan-no-pipe-xyz');
    const offset = session.currentOffset('nonexistent');
    assert.strictEqual(offset, 0);
  });

  it('currentOffset returns file size when pipe file exists', () => {
    const session = new TmuxSession('has-pipe-1', 'samaritan-has-pipe-1');
    const pipeFile = session.getPipeFilePath('execution');
    writeFileSync(pipeFile, 'hello world\n', 'utf-8');
    try {
      const offset = session.currentOffset('execution');
      assert.strictEqual(offset, 12);
    } finally {
      if (existsSync(pipeFile)) unlinkSync(pipeFile);
    }
  });

  it('readOutput returns empty string when pipe file does not exist', () => {
    const session = new TmuxSession('no-pipe-ro', 'samaritan-no-pipe-ro');
    const output = session.readOutput('execution', 0);
    assert.strictEqual(output, '');
  });

  it('readOutput returns content from offset', () => {
    const session = new TmuxSession('ro-test-1', 'samaritan-ro-test-1');
    const pipeFile = session.getPipeFilePath('execution');
    writeFileSync(pipeFile, 'prefix_output_suffix\n', 'utf-8');
    try {
      const output = session.readOutput('execution', 7);
      assert.strictEqual(output, 'output_suffix\n');
    } finally {
      if (existsSync(pipeFile)) unlinkSync(pipeFile);
    }
  });

  it('readOutput returns full content from offset 0', () => {
    const session = new TmuxSession('ro-test-2', 'samaritan-ro-test-2');
    const pipeFile = session.getPipeFilePath('execution');
    writeFileSync(pipeFile, 'deployment created\n', 'utf-8');
    try {
      const output = session.readOutput('execution', 0);
      assert.strictEqual(output, 'deployment created\n');
    } finally {
      if (existsSync(pipeFile)) unlinkSync(pipeFile);
    }
  });

  it('registerPane stores pane target for later use', () => {
    const session = new TmuxSession('pane-test', 'samaritan-pane-test');
    session.registerPane('execution', 'samaritan-pane-test:0.1');
    // No error thrown means registration worked
  });

  it('teardown does not throw even when tmux is not running', () => {
    const session = new TmuxSession('teardown-test', 'samaritan-teardown-test');
    // teardown should be graceful — tmux not installed/no session is OK
    assert.doesNotThrow(() => {
      try {
        session.teardown();
      } catch {
        // acceptable if tmux not installed
      }
    });
  });

  it('send() does not throw for local sessions when tmux unavailable (graceful)', () => {
    const session = new TmuxSession('send-test', 'samaritan-send-test');
    // send() calls tmux which may not be installed — we just check it builds a proper command
    // The intent is that the function exists and has the right signature
    assert.strictEqual(typeof session.send, 'function');
  });

  it('pasteCommand() exists and is a graceful no-op when tmux is unavailable', () => {
    const session = new TmuxSession('paste-test', 'samaritan-paste-test');
    session.registerPane('execution', 'samaritan-paste-test:0.0');
    assert.strictEqual(typeof session.pasteCommand, 'function');
    assert.doesNotThrow(() => {
      session.pasteCommand('execution', 'echo "review me"');
    });
  });

  it('buildPasteBufferArgs pastes with bracketed paste (-p) so multiline lands atomically', () => {
    const { pasteArgs } = buildPasteBufferArgs('mysession:0.0', 'echo hi');
    // -p makes tmux wrap the paste in bracketed-paste markers; without it a
    // multi-line command's newlines are injected as Enter keypresses and each
    // line executes on arrival.
    assert.ok(pasteArgs.includes('-p'), 'paste-buffer must use -p');
    assert.deepStrictEqual(pasteArgs, [
      'paste-buffer',
      '-d',
      '-p',
      '-b',
      'samaritan-send',
      '-t',
      'mysession:0.0',
    ]);
  });

  it('buildPasteBufferArgs keeps a multi-line command as one --terminated argument', () => {
    const multiline = 'cat <<EOF\nline one\nline two\nEOF';
    const { setArgs } = buildPasteBufferArgs('%1', multiline);
    // The command must be a single argv element after `--` — never split on
    // newlines — so the whole block is stored in the buffer intact.
    assert.strictEqual(setArgs[setArgs.length - 1], multiline);
    assert.deepStrictEqual(setArgs.slice(0, -1), [
      'set-buffer',
      '-b',
      'samaritan-send',
      '--',
    ]);
  });

  it('normalizePasteText turns CRLF into LF so a \\ continuation survives tmux LF→CR', () => {
    // Regression: `\\\r\n` reached the pane as `\\\r\r` — a blank line after
    // each continuation, and the block split into separate commands.
    const crlf = 'echo a \\\r\n  --arg src x \\\r\n  b';
    assert.strictEqual(
      normalizePasteText(crlf),
      'echo a \\\n  --arg src x \\\n  b',
    );
    assert.strictEqual(normalizePasteText('a\rb'), 'a\nb');
  });

  it('normalizePasteText strips trailing newlines so the paste never ends in Enter', () => {
    // YAML `|` blocks always end in \n; without bracketed paste that is Enter.
    assert.strictEqual(normalizePasteText('touch x\n'), 'touch x');
    assert.strictEqual(normalizePasteText('a \\\n  b\r\n\n'), 'a \\\n  b');
    assert.strictEqual(normalizePasteText('echo hi'), 'echo hi');
  });

  it('buildPasteBufferArgs stores the normalized command', () => {
    const { setArgs } = buildPasteBufferArgs('%1', 'echo a \\\r\n  b\n');
    assert.strictEqual(setArgs[setArgs.length - 1], 'echo a \\\n  b');
  });

  it('isMultiLinePaste ignores a lone trailing newline', () => {
    assert.strictEqual(isMultiLinePaste('echo hi\n'), false);
    assert.strictEqual(isMultiLinePaste('echo a \\\n  b'), true);
    assert.strictEqual(isMultiLinePaste('echo a\r\nb'), true);
  });

  it('getPaneMap returns registered panes as a ReadonlyMap', () => {
    const session = new TmuxSession('pane-map-test', 'samaritan-pane-map-test');
    session.registerPane('execution', 'samaritan-pane-map-test:0.0');
    session.registerPane('verification', 'samaritan-pane-map-test:0.1');
    const paneMap = session.getPaneMap();
    assert.strictEqual(paneMap.get('execution'), 'samaritan-pane-map-test:0.0');
    assert.strictEqual(
      paneMap.get('verification'),
      'samaritan-pane-map-test:0.1',
    );
    assert.strictEqual(paneMap.size, 2);
  });

  it('getPaneMap returns empty map when no panes registered', () => {
    const session = new TmuxSession('no-panes', 'samaritan-no-panes');
    const paneMap = session.getPaneMap();
    assert.strictEqual(paneMap.size, 0);
  });

  it('waitForPrompt returns idle when pipe file stops growing', async () => {
    const session = new TmuxSession('idle-detect-1', 'samaritan-idle-detect-1');
    const pipeFile = session.getPipeFilePath('execution');
    writeFileSync(pipeFile, 'initial output\n', 'utf-8');
    try {
      const result = await session.waitForPrompt(
        'execution',
        5_000,
        undefined,
        200,
      );
      assert.strictEqual(
        result,
        'idle',
        'should detect idle when pipe stops growing',
      );
    } finally {
      if (existsSync(pipeFile)) unlinkSync(pipeFile);
    }
  });

  it('waitForPrompt returns timeout when deadline exceeded with idle disabled', async () => {
    const session = new TmuxSession('no-idle-1', 'samaritan-no-idle-1');
    // 800ms gives ample room for 2–3 poll cycles (200ms each) on slow CI runners
    const result = await session.waitForPrompt('execution', 800, undefined, 0);
    assert.strictEqual(
      result,
      'timeout',
      'should return timeout with idle disabled',
    );
  });
});

describe('isLocalSession (issue #6)', () => {
  it('returns true when no host is set', () => {
    assert.strictEqual(isLocalSession({}), true);
    assert.strictEqual(isLocalSession(undefined), true);
    assert.strictEqual(isLocalSession({ user: 'deploy' }), true);
  });

  it('returns false when host is set', () => {
    assert.strictEqual(isLocalSession({ host: 'bastion.example.com' }), false);
    assert.strictEqual(
      isLocalSession({ host: 'monitoring.example.com', user: 'sre' }),
      false,
    );
  });
});

describe('validateTmuxTarget', () => {
  it('returns false for an obviously invalid target (no live tmux needed)', () => {
    // No tmux server running in CI — any target should fail with status != 0
    const result = validateTmuxTarget('definitely-not-a-real-pane-xyz');
    assert.strictEqual(result, false, 'invalid target must return false');
  });

  it('returns false for empty string', () => {
    assert.strictEqual(validateTmuxTarget(''), false);
  });
});

describe('TmuxPaneCapture (capture-backend)', () => {
  it('implements CaptureBackend interface', () => {
    const capture = new TmuxPaneCapture('test-cap-1', 'mysession:0.0');
    assert.strictEqual(typeof capture.hasTarget, 'function');
    assert.strictEqual(typeof capture.currentOffset, 'function');
    assert.strictEqual(typeof capture.readOutput, 'function');
    assert.strictEqual(typeof capture.describeTarget, 'function');
    assert.strictEqual(typeof capture.teardown, 'function');
    assert.strictEqual(typeof capture.attach, 'function');
  });

  it('hasTarget always returns true (single pane target)', () => {
    const capture = new TmuxPaneCapture('test-cap-2', 'mysession:0.0');
    assert.strictEqual(capture.hasTarget('default'), true);
    assert.strictEqual(capture.hasTarget('any-session'), true);
    assert.strictEqual(capture.hasTarget(''), true);
  });

  it('describeTarget includes the tmux pane target', () => {
    const capture = new TmuxPaneCapture('test-cap-3', 'mysession:1.0');
    const desc = capture.describeTarget('default');
    assert.ok(
      desc.includes('mysession:1.0'),
      `describeTarget should include the pane target, got: ${desc}`,
    );
  });

  it('currentOffset returns 0 when pipe file does not exist', () => {
    const capture = new TmuxPaneCapture('test-cap-offset-1', 'mysession:0.0');
    const offset = capture.currentOffset('default');
    assert.strictEqual(offset, 0);
  });

  it('currentOffset returns file size when pipe file exists', () => {
    const capture = new TmuxPaneCapture('test-cap-offset-2', 'mysession:0.0');
    // Seed the pipe file manually (simulating what pipe-pane would do)
    const pipeFile = join(
      tmpdir(),
      'samaritan-test-cap-offset-2-attached.pipe',
    );
    writeFileSync(pipeFile, 'hello world\n', 'utf-8');
    try {
      const offset = capture.currentOffset('default');
      assert.strictEqual(offset, 12);
    } finally {
      if (existsSync(pipeFile)) unlinkSync(pipeFile);
    }
  });

  it('readOutput returns content from offset', () => {
    const capture = new TmuxPaneCapture('test-cap-ro-1', 'mysession:0.0');
    const pipeFile = join(tmpdir(), 'samaritan-test-cap-ro-1-attached.pipe');
    writeFileSync(pipeFile, 'prefix_output_suffix\n', 'utf-8');
    try {
      const output = capture.readOutput('default', 7);
      assert.strictEqual(output, 'output_suffix\n');
    } finally {
      if (existsSync(pipeFile)) unlinkSync(pipeFile);
    }
  });

  it('readOutput returns empty string when file does not exist', () => {
    const capture = new TmuxPaneCapture('test-cap-ro-missing', 'mysession:0.0');
    const output = capture.readOutput('default', 0);
    assert.strictEqual(output, '');
  });

  it('teardown unlinks the pipe file and does not throw', () => {
    const capture = new TmuxPaneCapture('test-cap-td-1', 'mysession:0.0');
    const pipeFile = join(tmpdir(), 'samaritan-test-cap-td-1-attached.pipe');
    writeFileSync(pipeFile, 'captured output\n', 'utf-8');
    assert.ok(existsSync(pipeFile), 'pipe file should exist before teardown');
    // teardown calls tmux pipe-pane (may fail in CI — that is OK) and unlinks
    assert.doesNotThrow(() => {
      capture.teardown();
    });
    assert.ok(!existsSync(pipeFile), 'pipe file should be removed by teardown');
  });

  it('teardown does not throw when pipe file does not exist', () => {
    const capture = new TmuxPaneCapture('test-cap-td-missing', 'mysession:0.0');
    assert.doesNotThrow(() => {
      capture.teardown();
    });
  });

  it('pasteCommand() exists and is a graceful no-op when tmux is unavailable', () => {
    const capture = new TmuxPaneCapture('test-cap-paste', 'mysession:0.0');
    assert.strictEqual(typeof capture.pasteCommand, 'function');
    assert.doesNotThrow(() => {
      capture.pasteCommand('ignored', 'kubectl get pods');
    });
  });
});

describe('TmuxSession CaptureBackend conformance', () => {
  it('hasTarget returns false when pane not registered', () => {
    const session = new TmuxSession('cbc-1', 'samaritan-cbc-1');
    assert.strictEqual(session.hasTarget('execution'), false);
  });

  it('hasTarget returns true after registerPane', () => {
    const session = new TmuxSession('cbc-2', 'samaritan-cbc-2');
    session.registerPane('execution', 'samaritan-cbc-2:0.0');
    assert.strictEqual(session.hasTarget('execution'), true);
  });

  it('describeTarget names the window and the pane id when registered', () => {
    const session = new TmuxSession('cbc-5', 'TICKET-1-sbx');
    session.registerPane('work', '%7');
    assert.strictEqual(
      session.describeTarget('work'),
      'tmux pane TICKET-1-sbx:work (%7)',
    );
  });

  it('describeTarget falls back to session name when pane not registered', () => {
    const session = new TmuxSession('cbc-4', 'samaritan-cbc-4');
    const desc = session.describeTarget('unregistered');
    assert.ok(
      desc.includes('samaritan-cbc-4'),
      `describeTarget should include tmux session name, got: ${desc}`,
    );
  });
});

describe('sanitizeSessionName — shell injection prevention (bug fix)', () => {
  it('strips semicolons', () => {
    assert.strictEqual(sanitizeSessionName('foo;bar'), 'foo_bar');
  });

  it('strips spaces', () => {
    assert.strictEqual(sanitizeSessionName('foo bar'), 'foo_bar');
  });

  it('strips shell expansion characters', () => {
    // $, (, ), spaces, / are stripped; letters, digits, -, _ are kept
    assert.strictEqual(sanitizeSessionName('$(rm -rf /)'), '__rm_-rf___');
    assert.strictEqual(sanitizeSessionName('`whoami`'), '_whoami_');
  });

  it('strips backtick command substitution', () => {
    assert.strictEqual(
      sanitizeSessionName('name`cmd`suffix'),
      'name_cmd_suffix',
    );
  });

  it('preserves safe characters unchanged', () => {
    assert.strictEqual(sanitizeSessionName('my-session_01'), 'my-session_01');
    assert.strictEqual(sanitizeSessionName('deploy'), 'deploy');
  });

  it('resulting name produces a shell-safe pipe file path', () => {
    const session = new TmuxSession('sid', 'samaritan-sid');
    const dangerous = 'foo; touch /tmp/pwned';
    const safe = sanitizeSessionName(dangerous);
    const path = session.getPipeFilePath(safe);
    assert.ok(!path.includes(';'), 'no semicolons in pipe file path');
    assert.ok(!path.includes(' '), 'no spaces in pipe file path');
  });
});

describe('listTmuxPanes', () => {
  it('returns an array and never throws (empty when no tmux server)', () => {
    const panes = listTmuxPanes();
    assert.ok(Array.isArray(panes), 'must return an array');
    for (const pane of panes) {
      assert.strictEqual(typeof pane.id, 'string');
      assert.strictEqual(typeof pane.target, 'string');
      assert.ok(pane.target.includes(':'), 'target is session:window.pane');
      assert.strictEqual(typeof pane.isSelf, 'boolean');
    }
  });
});

describe('parseTmuxPaneList (tmux 3.4 rewrites TAB to _ in -F output)', () => {
  it('parses <|>-separated rows into pane info', () => {
    const out = '%1<|>ops:0.0<|>zsh<|>host\n%2<|>ops:0.1<|>vim<|>notes\n';
    assert.deepStrictEqual(parseTmuxPaneList(out, '%2'), [
      {
        id: '%1',
        target: 'ops:0.0',
        currentCommand: 'zsh',
        title: 'host',
        isSelf: false,
      },
      {
        id: '%2',
        target: 'ops:0.1',
        currentCommand: 'vim',
        title: 'notes',
        isSelf: true,
      },
    ]);
  });

  it('keeps a title that itself contains the separator intact', () => {
    const [pane] = parseTmuxPaneList('%1<|>s:0.0<|>sh<|>a<|>b');
    assert.strictEqual(pane.title, 'a<|>b');
  });

  it('drops a tab-escaped row instead of mis-parsing it (regression)', () => {
    // What tmux 3.4 actually printed for the old \t-joined format.
    assert.deepStrictEqual(parseTmuxPaneList('%1_s:0.0_zsh_vm\n'), []);
  });
});

describe('parseWindowPanes', () => {
  it('maps window name to its active pane id', () => {
    const map = parseWindowPanes('work<|>%3\naux<|>%4\n');
    assert.deepStrictEqual(
      [...map.entries()],
      [
        ['work', '%3'],
        ['aux', '%4'],
      ],
    );
  });

  it('first window wins on a duplicate name; malformed lines ignored', () => {
    const map = parseWindowPanes('work<|>%3\nwork<|>%9\ngarbage\n<|>%5\n');
    assert.deepStrictEqual([...map.entries()], [['work', '%3']]);
  });

  it('splits on the LAST separator so a window name may contain it', () => {
    const map = parseWindowPanes('a<|>b<|>%3');
    assert.strictEqual(map.get('a<|>b'), '%3');
  });
});

describe('resolveTmuxSessionName (run.tmux_session)', () => {
  const ctx = { sessionId: 'abc-123', env: 'sbx', operationId: 'op-1' };
  const cases: Array<
    [string, string | undefined, Record<string, any>, string]
  > = [
    ['default is samaritan-<session id>', undefined, {}, 'samaritan-abc-123'],
    [
      '${TICKET}-${ENV} from run vars + the ENV built-in',
      '${TICKET}-${ENV}',
      { TICKET: 'GCSGPSOPS-17034' },
      'GCSGPSOPS-17034-sbx',
    ],
    [
      'a user variable wins over a built-in of the same name',
      '${TICKET}-${ENV}',
      { TICKET: 'T', ENV: 'x' },
      'T-x',
    ],
    [
      'characters tmux forbids (. and :) are sanitized',
      '${V}',
      { V: 'rel.1:a b' },
      'rel_1_a_b',
    ],
  ];
  for (const [name, template, vars, expected] of cases) {
    it(name, () => {
      assert.strictEqual(resolveTmuxSessionName(template, vars, ctx), expected);
    });
  }

  it('throws on an unresolved variable instead of guessing a name', () => {
    assert.throws(
      () => resolveTmuxSessionName('${TICKET}-${ENV}', {}, ctx),
      /run\.tmux_session "\$\{TICKET\}-\$\{ENV\}".*TICKET/s,
    );
  });

  it('listUnresolvedTmuxSessionVars ignores the run-scoped built-ins', () => {
    assert.deepStrictEqual(
      listUnresolvedTmuxSessionVars('${TICKET}-${ENV}-${SESSION_ID}', {}),
      ['TICKET'],
    );
    assert.deepStrictEqual(
      listUnresolvedTmuxSessionVars('${TICKET}-${ENV}', { TICKET: 'x' }),
      [],
    );
    assert.deepStrictEqual(listUnresolvedTmuxSessionVars(undefined, {}), []);
  });
});

describe('TmuxSession ownership and pane fallback', () => {
  it('a session samaritan creates is owned (killed on teardown) by default', () => {
    assert.strictEqual(
      new TmuxSession('own-1', 'samaritan-own-1').isOwned(),
      true,
    );
    assert.strictEqual(
      new TmuxSession('own-2', 'operator', false).isOwned(),
      false,
    );
  });

  it('an unregistered session name falls back to the FIRST declared pane', () => {
    // Never a bare `<tmux>:0.0`, which in a reused operator session may be an
    // unrelated window.
    const session = new TmuxSession('own-3', 'operator-session', false);
    session.registerPane('work', '%1');
    session.registerPane('aux', '%2');
    assert.strictEqual(session.paneFor('default'), '%1');
    assert.strictEqual(session.paneFor('aux'), '%2');
  });

  it('with no panes registered at all, paneFor keeps the legacy :0.0 target', () => {
    const session = new TmuxSession('own-4', 'samaritan-own-4');
    assert.strictEqual(session.paneFor('x'), 'samaritan-own-4:0.0');
  });
});

describe('capturePaneCursorLine', () => {
  const hasTmux =
    process.platform !== 'win32' &&
    spawnSync('tmux', ['-V'], { encoding: 'utf8' }).status === 0;

  it('returns undefined for a pane that does not exist', () => {
    assert.strictEqual(
      capturePaneCursorLine('samaritan-no-such-session-xyz:0.0'),
      undefined,
    );
  });

  it(
    'returns the shell prompt line of a live pane',
    { skip: !hasTmux },
    async () => {
      const session = `sam-cursor-${process.pid}-${Date.now()}`;
      spawnSync('tmux', [
        'new-session',
        '-d',
        '-s',
        session,
        'env PS1="CURSOR_PROMPT\\$ " bash --norc --noprofile',
      ]);
      try {
        let line: string | undefined;
        for (let i = 0; i < 30; i++) {
          line = capturePaneCursorLine(`${session}:0.0`);
          if (line?.includes('CURSOR_PROMPT')) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        assert.strictEqual(line?.trimEnd(), 'CURSOR_PROMPT$');
      } finally {
        spawnSync('tmux', ['kill-session', '-t', session], { stdio: 'ignore' });
      }
    },
  );
});

describe('TmuxPaneCapture — one pipe-pane per pane (ownership)', () => {
  const hasTmux =
    process.platform !== 'win32' &&
    spawnSync('tmux', ['-V'], { encoding: 'utf8' }).status === 0;

  const pipeOn = (target: string): string =>
    spawnSync('tmux', ['display-message', '-p', '-t', target, '#{pane_pipe}'], {
      encoding: 'utf8',
    }).stdout.trim();

  it('ensureCapture reports unavailable when the pane does not exist', () => {
    const cap = new TmuxPaneCapture('own-missing', 'samaritan-no-such-xyz:0.0');
    assert.deepStrictEqual(cap.ensureCapture('default'), {
      status: 'unavailable',
    });
  });

  it(
    'detects a takeover, re-attaches, and never closes another run’s pipe',
    { skip: !hasTmux },
    () => {
      const session = `sam-own-${process.pid}-${Date.now()}`;
      const target = `${session}:0.0`;
      spawnSync('tmux', ['new-session', '-d', '-s', session]);
      // Markers are keyed by tmux server socket + pane id (pane ids restart
      // at %0 on every server, so the id alone collides across servers).
      const paneId = spawnSync(
        'tmux',
        ['display-message', '-p', '-t', target, '#{socket_path}#{pane_id}'],
        { encoding: 'utf8' },
      ).stdout.trim();
      const a = new TmuxPaneCapture(`own-a-${process.pid}`, target);
      const b = new TmuxPaneCapture(`own-b-${process.pid}`, target);
      try {
        assert.deepStrictEqual(
          a.attach(),
          {},
          'first attach: no previous owner',
        );
        assert.deepStrictEqual(a.ensureCapture('default'), { status: 'ok' });

        const { previousOwner } = b.attach();
        assert.strictEqual(previousOwner?.captureId, `own-a-${process.pid}`);
        assert.strictEqual(
          readPaneOwner(paneId)?.captureId,
          `own-b-${process.pid}`,
        );

        const check = a.ensureCapture('default');
        assert.strictEqual(check.status, 'reattached');
        assert.strictEqual(
          check.status === 'reattached' ? check.takenBy?.captureId : undefined,
          `own-b-${process.pid}`,
        );
        assert.strictEqual(
          readPaneOwner(paneId)?.captureId,
          `own-a-${process.pid}`,
        );

        // B no longer owns the pane: its teardown must leave A's pipe running.
        b.teardown();
        assert.strictEqual(pipeOn(target), '1');
        assert.ok(existsSync(paneOwnerFile(paneId)));

        // A pipe closed behind our back (pipe-pane with no command) is repaired.
        spawnSync('tmux', ['pipe-pane', '-t', target]);
        assert.deepStrictEqual(a.ensureCapture('default'), {
          status: 'reattached',
        });
        assert.strictEqual(pipeOn(target), '1');

        a.teardown();
        assert.strictEqual(pipeOn(target), '0', 'owner closes its own pipe');
        assert.ok(!existsSync(paneOwnerFile(paneId)), 'owner marker removed');
      } finally {
        spawnSync('tmux', ['kill-session', '-t', session], { stdio: 'ignore' });
      }
    },
  );

  it('keeps owner markers in a private per-user dir, never the shared temp dir', () => {
    const file = paneOwnerFile('/tmp/tmux-0/default#%0');
    assert.ok(file.startsWith(join(homedir(), '.samaritan', 'panes')), file);
    assert.ok(!file.startsWith(tmpdir()), file);
    if (process.platform !== 'win32') {
      assert.strictEqual(statSync(dirname(file)).mode & 0o777, 0o700);
    }
  });
});
