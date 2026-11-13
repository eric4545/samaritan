/**
 * Key-by-key buffer for a prompt that accepts a multi-line paste.
 *
 * A line-based prompt (`readline.question`) ends at the FIRST newline, so a
 * pasted block of output was cut to its first line and the rest was read by
 * whatever prompt came next: the description, then the step's action bar,
 * where a pasted line that was a single letter fired that action key.
 *
 * With bracketed paste on (`ESC[?2004h`) the terminal wraps a paste in
 * `paste-start` / `paste-end` keys, and every newline in between is content.
 * A terminal without bracketed paste delivers the paste as one burst of keys;
 * the caller covers that by waiting a moment after an Enter (`'enter'`
 * result) and calling `newline()` when more keys follow.
 */

export interface KeyLike {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  sequence?: string;
}

export type FeedResult =
  /** Keep reading. `echo` is what to show for this key. */
  | { action: 'more'; echo: string }
  /** Enter outside a paste: submit, unless more keys follow at once. */
  | { action: 'enter' }
  | { action: 'submit' }
  | { action: 'cancel' }
  | { action: 'interrupt' };

export class MultilineBuffer {
  private chars: string[] = [];
  private inPaste = false;

  constructor(private readonly continuation = '\n      ') {}

  get text(): string {
    return this.chars.join('');
  }

  get pasting(): boolean {
    return this.inPaste;
  }

  /** Turn the Enter last reported as `'enter'` into a line break. */
  newline(): string {
    this.chars.push('\n');
    return this.continuation;
  }

  feed(ch: string | undefined, key: KeyLike | undefined): FeedResult {
    const name = key?.name;
    if (name === 'paste-start') {
      this.inPaste = true;
      return { action: 'more', echo: '' };
    }
    if (name === 'paste-end') {
      this.inPaste = false;
      return { action: 'more', echo: '' };
    }
    if (key?.ctrl && name === 'c') return { action: 'interrupt' };
    if (name === 'return' || name === 'enter') {
      if (this.inPaste) return { action: 'more', echo: this.newline() };
      return { action: 'enter' };
    }
    if (this.inPaste) {
      if (name === 'tab') return this.append('\t');
      return ch && isPrintable(ch)
        ? this.append(ch)
        : { action: 'more', echo: '' };
    }
    if (key?.ctrl && name === 'd') return { action: 'submit' };
    if (name === 'escape') return { action: 'cancel' };
    if (name === 'backspace') return { action: 'more', echo: this.erase() };
    if (key?.ctrl || key?.meta) return { action: 'more', echo: '' };
    if (name === 'tab') return this.append('\t');
    if (!ch || !isPrintable(ch)) return { action: 'more', echo: '' };
    return this.append(ch);
  }

  private append(ch: string): FeedResult {
    this.chars.push(ch);
    return { action: 'more', echo: ch === '\t' ? '  ' : ch };
  }

  /** Backspace edits the current line only; it never joins two lines. */
  private erase(): string {
    const last = this.chars[this.chars.length - 1];
    if (last === undefined || last === '\n') return '';
    this.chars.pop();
    return last === '\t' ? '\b\b  \b\b' : '\b \b';
  }
}

function isPrintable(ch: string): boolean {
  // Everything but control characters (C0, DEL, C1); keeps non-ASCII text.
  return !/\p{Cc}/u.test(ch);
}
