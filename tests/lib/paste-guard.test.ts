import assert from 'node:assert';
import { describe, it } from 'node:test';
import type { CaptureBackend } from '../../src/lib/capture-backend';
import type { PaneState } from '../../src/lib/pane-enter-guard';
import {
  checkClearSafe,
  type PendingPaste,
  pastePreview,
  pasteStillOnInputLine,
  unrunPaste,
} from '../../src/lib/paste-guard';

// #115: [p] never presses Enter, so an un-run paste stays on the pane's input
// line. These decide "still un-run" from the pane's cursor line alone.

describe('pasteStillOnInputLine', () => {
  it('true while the prompt line still ends with the pasted command', () => {
    assert.ok(pasteStillOnInputLine('bash-5.2# echo hello-b', 'echo hello-b'));
    assert.ok(pasteStillOnInputLine('$ echo hello-b   ', 'echo hello-b\n'));
  });

  it('false once it ran (cursor on a fresh prompt or on output)', () => {
    assert.ok(!pasteStillOnInputLine('bash-5.2# ', 'echo hello-b'));
    assert.ok(!pasteStillOnInputLine('hello-b', 'echo hello-b'));
    assert.ok(!pasteStillOnInputLine('', 'echo hello-b'));
  });

  it('false when the cursor line cannot be read', () => {
    assert.ok(!pasteStillOnInputLine(undefined, 'echo hello-b'));
  });

  it('checks the LAST line of a multi-line paste (CRLF normalized)', () => {
    const cmd = 'kubectl apply \\\r\n  -f deploy.yaml\r\n';
    assert.ok(pasteStillOnInputLine('  -f deploy.yaml', cmd));
    assert.ok(!pasteStillOnInputLine('$ ', cmd));
  });

  it('a long command wrapped across rows matches by its tail', () => {
    const cmd = `echo ${'x'.repeat(80)} done-marker-tail`;
    assert.ok(pasteStillOnInputLine('xxxxxxxxxx done-marker-tail', cmd));
    // A short line that merely ends the command is not trusted.
    assert.ok(!pasteStillOnInputLine('tail', cmd));
  });
});

function fakeBackend(cursor: string | undefined, attached = true) {
  return {
    hasTarget: () => attached,
    promptLine: () => cursor,
  } as unknown as CaptureBackend;
}

describe('unrunPaste', () => {
  const paste = (cursor: string | undefined, attached = true) => ({
    backend: fakeBackend(cursor, attached),
    sessionName: 'default',
    command: 'echo PG_ONE',
    step: 0,
  });

  it('returns the paste while it is still on the input line', () => {
    const p = paste('$ echo PG_ONE');
    assert.strictEqual(unrunPaste(p), p);
  });

  it('undefined once run, with no paste, or with the pane detached', () => {
    assert.strictEqual(unrunPaste(paste('$ ')), undefined);
    assert.strictEqual(unrunPaste(undefined), undefined);
    assert.strictEqual(unrunPaste(paste('$ echo PG_ONE', false)), undefined);
  });
});

describe('pastePreview', () => {
  it('flattens newlines and truncates', () => {
    assert.strictEqual(pastePreview('a \\\n  b'), 'a \\ ⏎ b');
    assert.strictEqual(pastePreview('x'.repeat(100), 10), `${'x'.repeat(9)}…`);
  });
});

// [u] — Ctrl+U for an un-run paste. Only harmless at the shell prompt the
// paste landed on: every other pane state refuses.
describe('checkClearSafe', () => {
  const state = (over: Partial<PaneState> = {}): PaneState => ({
    paneId: '%3',
    dead: false,
    inMode: false,
    synchronized: false,
    inputOff: false,
    currentCommand: 'bash',
    cursorX: 20,
    cursorY: 4,
    historySize: 0,
    cursorLine: '$ echo PG_ONE',
    ...over,
  });
  const paste: PendingPaste = {
    backend: fakeBackend('$ echo PG_ONE'),
    sessionName: 'default',
    command: 'echo PG_ONE',
    step: 0,
    paneId: '%3',
    shell: 'bash',
  };

  it('allows Ctrl+U while the paste is at the cursor in the same shell', () => {
    assert.strictEqual(checkClearSafe(paste, state()), undefined);
  });

  it('allows a multi-line paste (the cursor holds its last line)', () => {
    const multi = { ...paste, command: 'echo A \\\n  && echo B' };
    assert.strictEqual(
      checkClearSafe(multi, state({ cursorLine: '  && echo B' })),
      undefined,
    );
  });

  it('refuses when the pane is gone, another pane, or dead', () => {
    assert.match(checkClearSafe(paste, undefined) ?? '', /gone/);
    assert.match(
      checkClearSafe(paste, state({ paneId: '%9' })) ?? '',
      /now %9.*pasted into %3/,
    );
    assert.match(checkClearSafe(paste, state({ dead: true })) ?? '', /dead/);
  });

  it('refuses in copy-mode, with synchronize-panes, or input off', () => {
    assert.match(
      checkClearSafe(paste, state({ inMode: true })) ?? '',
      /copy\/view mode/,
    );
    assert.match(
      checkClearSafe(paste, state({ synchronized: true })) ?? '',
      /every pane in the window/,
    );
    assert.match(
      checkClearSafe(paste, state({ inputOff: true })) ?? '',
      /input disabled/,
    );
  });

  it('refuses when another program is in front (an editor, a pager)', () => {
    assert.match(
      checkClearSafe(paste, state({ currentCommand: 'vim' })) ?? '',
      /now runs vim, not bash/,
    );
  });

  it('refuses once the paste is no longer at the cursor', () => {
    assert.match(
      checkClearSafe(paste, state({ cursorLine: '$ ' })) ?? '',
      /no longer at the cursor/,
    );
  });

  it('without a recorded pane id or shell, still checks the cursor line', () => {
    const bare = { ...paste, paneId: undefined, shell: undefined };
    assert.strictEqual(
      checkClearSafe(bare, state({ paneId: '%7', currentCommand: 'zsh' })),
      undefined,
    );
  });
});
