import assert from 'node:assert';
import { describe, it } from 'node:test';
import { type KeyLike, MultilineBuffer } from '../../src/lib/multiline-input';

type Key = [string | undefined, KeyLike];
const ch = (c: string): Key => [c, { name: c }];
const ENTER: Key = ['\r', { name: 'return' }];
const PASTE_START: Key = [undefined, { name: 'paste-start' }];
const PASTE_END: Key = [undefined, { name: 'paste-end' }];

/** Feed keys; returns the action of the last one. */
function feed(buffer: MultilineBuffer, keys: Key[]): string {
  let last = 'more';
  for (const [c, key] of keys) last = buffer.feed(c, key).action;
  return last;
}
const typed = (text: string): Key[] => [...text].map(ch);

describe('MultilineBuffer', () => {
  it('typed text then Enter asks to submit', () => {
    const b = new MultilineBuffer();
    assert.strictEqual(feed(b, [...typed('pods ok'), ENTER]), 'enter');
    assert.strictEqual(b.text, 'pods ok');
  });

  it('a bracketed paste keeps every line: Enter inside it is content', () => {
    // The failure seen in a real run: line 1 became the evidence, line 2 the
    // description and a one-letter line 3 fired an action key.
    const b = new MultilineBuffer();
    const last = feed(b, [
      PASTE_START,
      ...typed('web-server: 3/3 ready'),
      ENTER,
      ...typed('y'),
      ENTER,
      ENTER,
      ...typed('last line'),
      PASTE_END,
    ]);
    assert.strictEqual(last, 'more', 'the paste alone never submits');
    assert.strictEqual(b.text, 'web-server: 3/3 ready\ny\n\nlast line');
    assert.strictEqual(feed(b, [ENTER]), 'enter');
  });

  it('without bracketed paste the caller turns a mid-burst Enter into a line break', () => {
    const b = new MultilineBuffer();
    assert.strictEqual(feed(b, [...typed('alpha'), ENTER]), 'enter');
    b.newline(); // more keys followed the Enter at once
    feed(b, typed('s'));
    assert.strictEqual(b.text, 'alpha\ns');
  });

  it('Esc cancels, Ctrl+C interrupts, Ctrl+D submits', () => {
    const b = new MultilineBuffer();
    assert.strictEqual(b.feed(undefined, { name: 'escape' }).action, 'cancel');
    assert.strictEqual(
      b.feed('\x03', { name: 'c', ctrl: true }).action,
      'interrupt',
    );
    assert.strictEqual(
      b.feed('\x04', { name: 'd', ctrl: true }).action,
      'submit',
    );
  });

  it('Ctrl+V asks for the clipboard image only on an empty prompt', () => {
    const ctrlV: KeyLike = { name: 'v', ctrl: true };
    const empty = new MultilineBuffer();
    assert.strictEqual(empty.feed('\x16', ctrlV).action, 'clipboard');
    const typing = new MultilineBuffer();
    feed(typing, typed('pods'));
    assert.strictEqual(typing.feed('\x16', ctrlV).action, 'more');
    assert.strictEqual(typing.text, 'pods');
  });

  it('an escape inside a paste is content noise, not a cancel', () => {
    const b = new MultilineBuffer();
    feed(b, [PASTE_START, ...typed('a')]);
    assert.strictEqual(b.feed(undefined, { name: 'escape' }).action, 'more');
    assert.strictEqual(b.pasting, true);
  });

  it('backspace edits the current line and stops at a line break', () => {
    const b = new MultilineBuffer();
    feed(b, [PASTE_START, ...typed('ab'), ENTER, ...typed('c'), PASTE_END]);
    const back: KeyLike = { name: 'backspace' };
    assert.deepStrictEqual(b.feed(undefined, back), {
      action: 'more',
      echo: '\b \b',
    });
    assert.deepStrictEqual(b.feed(undefined, back), {
      action: 'more',
      echo: '',
    });
    assert.strictEqual(b.text, 'ab\n');
  });

  it('keeps non-ASCII text and tabs, drops control characters', () => {
    const b = new MultilineBuffer();
    feed(b, [ch('é'), ['\t', { name: 'tab' }], ch('日'), ['\x07', {}]]);
    assert.strictEqual(b.text, 'é\t日');
  });
});
