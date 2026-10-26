/**
 * Escaping for text placed inside a Markdown (GFM / markdown-it) table cell.
 *
 * A table row is split into cells BEFORE inline parsing, and the splitter
 * treats every `\|` as an escaped pipe: it removes exactly the one backslash
 * in front of the pipe, however many backslashes precede it. What is left is
 * then parsed as ordinary inline Markdown (or kept verbatim in a code span).
 */

/**
 * Escape the pipes in code that will sit inside a code span in a table cell.
 *
 * Backslashes are deliberately NOT escaped: a code span shows backslashes
 * verbatim, and the splitter strips only the backslash added here, so
 * `grep 'a\|b'` renders as `grep 'a\|b'`. Doubling backslashes (the usual
 * remedy) would render it as `grep 'a\\|b'`.
 */
export function escapeTableCodePipes(code: string): string {
  return code.replace(/\|/g, '\\|');
}

/**
 * Render `code` as an inline code span safe to place in a table cell.
 *
 * Backslash escapes do not work inside a code span, so a backtick in the code
 * cannot be written as `` \` ``. Instead the span is fenced with a backtick
 * run longer than any run inside the code (CommonMark), padded with a space
 * when the code starts or ends with a backtick.
 */
export function tableCodeSpan(code: string): string {
  const runs: string[] = code.match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(longest + 1);
  const pad = code.startsWith('`') || code.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${escapeTableCodePipes(code)}${pad}${fence}`;
}

/**
 * Escape plain (inline Markdown) text for a table cell.
 *
 * Every pipe is escaped for the splitter, and any backslashes directly in
 * front of a pipe are doubled first so they survive inline parsing: `a\|b`
 * renders as `a\|b`, not `a|b`. Other backslashes are left alone so authors'
 * own Markdown escapes (e.g. `\*`) keep working.
 */
export function escapeTableText(text: string): string {
  return text.replace(/(\\*)\|/g, (_match, slashes: string) => {
    return `${slashes}${slashes}\\|`;
  });
}
