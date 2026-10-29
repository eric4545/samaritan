import assert from 'node:assert';
import { describe, it } from 'node:test';
import type { CaptureBackend } from '../../src/lib/capture-backend';
import {
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
