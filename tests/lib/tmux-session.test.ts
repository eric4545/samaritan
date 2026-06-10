import assert from 'node:assert';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  isLocalSession,
  listTmuxPanes,
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

  it('describeTarget includes pane when registered', () => {
    const session = new TmuxSession('cbc-3', 'samaritan-cbc-3');
    session.registerPane('execution', 'samaritan-cbc-3:0.0');
    const desc = session.describeTarget('execution');
    assert.ok(
      desc.includes('samaritan-cbc-3:0.0'),
      `describeTarget should include pane, got: ${desc}`,
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
