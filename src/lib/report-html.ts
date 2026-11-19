import { readFileSync } from 'node:fs';

/**
 * Self-contained HTML for the evidence report (`report --format html`).
 *
 * The HTML is built from the report's own Markdown, so both formats keep the
 * same structure and headings. Only a small, known Markdown subset is read:
 * what `renderReport` writes (headings, paragraphs, nested bullets, GFM
 * tables, fenced code, `---`, and inline code / bold / italic / links /
 * images / `<url>` autolinks). Every piece of text is HTML-escaped, so a
 * note, a command or captured output can never inject markup or script.
 */

/** The raster formats a browser shows from a `data:` URI, by magic bytes. */
const IMAGE_SIGNATURES: Array<{ mime: string; test: (b: Buffer) => boolean }> =
  [
    {
      mime: 'image/png',
      test: (b) =>
        b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
    },
    {
      mime: 'image/jpeg',
      test: (b) => b.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')),
    },
    {
      mime: 'image/gif',
      test: (b) => /^GIF8[79]a/.test(b.subarray(0, 6).toString('latin1')),
    },
    {
      mime: 'image/webp',
      test: (b) =>
        b.subarray(0, 4).toString('latin1') === 'RIFF' &&
        b.subarray(8, 12).toString('latin1') === 'WEBP',
    },
  ];

/**
 * The file as a `data:image/…;base64,…` URI, or `undefined` when it cannot be
 * read or its bytes are not a PNG, JPEG, GIF or WebP image. The type comes
 * from the content, not the extension: a `.png` that is really text is not
 * embedded as an image.
 */
export function imageDataUri(path: string): string | undefined {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    return undefined;
  }
  const match = IMAGE_SIGNATURES.find((sig) => sig.test(bytes));
  return match
    ? `data:${match.mime};base64,${bytes.toString('base64')}`
    : undefined;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const EMBEDDED_IMAGE =
  /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;

/** Strip `<…>` around a link target and undo the escaping of `<`/`>` in it. */
function linkTarget(raw: string): string {
  const inner =
    raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw;
  return inner.replace(/%3C/gi, '<').replace(/%3E/gi, '>');
}

/**
 * A link target safe for `href`: web and mail URLs, in-page anchors and
 * relative paths. Anything with another scheme (`javascript:`, `data:`, …)
 * is refused, and the link renders as plain text.
 */
function safeHref(target: string): string | undefined {
  const scheme = target.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (!scheme) return target;
  return ['http', 'https', 'mailto'].includes(scheme) ? target : undefined;
}

/**
 * One regex for every inline form except code spans, tried left to right.
 * Groups: 1-2 image, 3-4 link, 5 autolink, 6 bold, 7 italic, 8 backslash
 * escape. Image alt and link text may contain escaped brackets (`\]`), which
 * the report writes for a description with `]`; an unescaped `[` ends them,
 * so a run of `[` cannot make every one of them rescan the rest of the line.
 */
const INLINE =
  /!\[((?:\\.|[^[\]\\])*)\]\((<[^>\n]*>|[^)\s]*)\)|\[((?:\\.|[^[\]\\])*)\]\((<[^>\n]*>|[^)\s]*)\)|<((?:https?|mailto):[^\s<>]+)>|\*\*(.+?)\*\*|(?<![\w\\])_([^_\n]+?)_(?!\w)|\\([\\`*_{}[\]()#+\-.!|<>])/g;

/** Stands in for a code span while the rest of the line is parsed. */
const SLOT_OPEN = '';
const SLOT_CLOSE = '';
const SLOT = /(\d+)/g;

interface CodeSpan {
  raw: string;
  html: string;
}

/**
 * Pull the code spans out of a line in one pass (CommonMark: a run of N
 * backticks opens a span that the next run of exactly N closes; a run with
 * no closer is literal text). Each span becomes a slot, so links and
 * emphasis around it still parse and nothing inside it does. Linear: the
 * next run of each length is looked up, never searched for.
 */
function extractCodeSpans(text: string): { text: string; spans: CodeSpan[] } {
  const runs: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < text.length; ) {
    if (text[i] !== '`') {
      i++;
      continue;
    }
    const start = i;
    while (i < text.length && text[i] === '`') i++;
    runs.push({ start, end: i });
  }
  const closer: number[] = new Array(runs.length).fill(-1);
  const nextOfLength = new Map<number, number>();
  for (let r = runs.length - 1; r >= 0; r--) {
    const len = runs[r].end - runs[r].start;
    closer[r] = nextOfLength.get(len) ?? -1;
    nextOfLength.set(len, r);
  }

  const spans: CodeSpan[] = [];
  let out = '';
  let pos = 0;
  for (let r = 0; r < runs.length; r++) {
    const close = closer[r];
    if (close < 0 || runs[r].start < pos) continue;
    const body = text.slice(runs[r].end, runs[close].start);
    const code = /^ .* $/s.test(body) && body.trim() ? body.slice(1, -1) : body;
    out += text.slice(pos, runs[r].start);
    out += `${SLOT_OPEN}${spans.length}${SLOT_CLOSE}`;
    spans.push({
      raw: text.slice(runs[r].start, runs[close].end),
      html: `<code>${escapeHtml(code)}</code>`,
    });
    pos = runs[close].end;
    r = close;
  }
  return { text: out + text.slice(pos), spans };
}

/** Undo Markdown backslash escapes (alt text is an attribute, not inline). */
function unescapeText(text: string): string {
  return text.replace(/\\([\\`*_{}[\]()#+\-.!|<>])/g, '$1');
}

export function renderInline(text: string): string {
  // Private-use characters in the input would read as slots: replace them.
  const clean = text.replace(/[]/g, '�');
  const { text: slotted, spans } = extractCodeSpans(clean);
  // Inside an attribute (alt, href) a span is its source text, not markup.
  const raw = (s: string): string =>
    s.replace(SLOT, (_, n) => spans[Number(n)]?.raw ?? '');
  return renderSpans(slotted, raw).replace(
    SLOT,
    (_, n) => spans[Number(n)]?.html ?? '',
  );
}

function renderSpans(text: string, raw: (s: string) => string): string {
  let html = '';
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    html += escapeHtml(text.slice(last, m.index));
    last = m.index + m[0].length;
    const [, alt, imgSrc, label, href, autolink, bold, italic, esc] = m;
    if (imgSrc !== undefined) {
      html += renderImage(
        unescapeText(raw(alt ?? '')),
        linkTarget(raw(imgSrc)),
      );
    } else if (href !== undefined) {
      const target = safeHref(linkTarget(raw(href)));
      const inner = renderSpans(label ?? '', raw);
      html += target ? `<a href="${escapeHtml(target)}">${inner}</a>` : inner;
    } else if (autolink !== undefined) {
      const url = raw(autolink);
      html += `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
    } else if (bold !== undefined) {
      html += `<strong>${renderSpans(bold, raw)}</strong>`;
    } else if (italic !== undefined) {
      html += `<em>${renderSpans(italic, raw)}</em>`;
    } else if (esc !== undefined) {
      html += escapeHtml(esc);
    }
  }
  return html + escapeHtml(text.slice(last));
}

/**
 * An embedded (`data:`) image shows inline. Any other image target could not
 * be embedded, so it renders as a link rather than as a broken image.
 */
function renderImage(alt: string, src: string): string {
  if (EMBEDDED_IMAGE.test(src)) {
    return `<img src="${src}" alt="${escapeHtml(alt)}">`;
  }
  const target = safeHref(src);
  const label = escapeHtml(alt || src);
  return target ? `<a href="${escapeHtml(target)}">${label}</a>` : label;
}

const FENCE_OPEN = /^( *)(`{3,})(.*)$/;
const TABLE_DIVIDER = /^\|(?:\s*:?-+:?\s*\|)+\s*$/;
const LIST_ITEM = /^( *)- (.*)$/;

/** Split a GFM table row on unescaped `|`; `\|` becomes a literal pipe. */
function tableCells(row: string): string[] {
  const inner = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

/** Leading spaces of a line; a blank line counts as indented without limit. */
function indentOf(line: string): number {
  return line.trim() === ''
    ? Number.POSITIVE_INFINITY
    : line.length - line.trimStart().length;
}

/**
 * Render a run of Markdown lines as HTML blocks. List items re-enter this
 * function with their content dedented, so nested bullets and fenced code
 * under a bullet render in place.
 */
export function renderBlocks(lines: string[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }

    const fence = line.match(FENCE_OPEN);
    if (fence) {
      const [, indent, ticks, info] = fence;
      const close = new RegExp(`^ *\`{${ticks.length},}\\s*$`);
      const body: string[] = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) {
        const l = lines[i];
        body.push(
          l.startsWith(indent) ? l.slice(indent.length) : l.trimStart(),
        );
        i++;
      }
      i++; // closing fence
      const lang = info.trim().match(/^[\w-]+/)?.[0];
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      out.push(`<pre><code${cls}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6}) (.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^-{3,}\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    if (line.startsWith('|') && TABLE_DIVIDER.test(lines[i + 1] ?? '')) {
      const head = tableCells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        rows.push(tableCells(lines[i]));
        i++;
      }
      out.push(
        '<table>',
        `<thead><tr>${head.map((c) => `<th>${renderInline(c)}</th>`).join('')}</tr></thead>`,
        '<tbody>',
        ...rows.map(
          (r) =>
            `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`,
        ),
        '</tbody>',
        '</table>',
      );
      continue;
    }

    const item = line.match(LIST_ITEM);
    if (item) {
      const indent = item[1].length;
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(LIST_ITEM);
        if (!m || m[1].length !== indent) break;
        const content = [m[2]];
        i++;
        // Continuation: blank lines followed by deeper-indented content, or
        // deeper-indented lines (sub-bullets, fenced code, wrapped notes).
        while (i < lines.length) {
          let j = i;
          while (j < lines.length && lines[j].trim() === '') j++;
          if (j >= lines.length || indentOf(lines[j]) <= indent) break;
          for (; i <= j; i++) content.push(lines[i].slice(indent + 2));
        }
        items.push(`<li>${renderItem(content)}</li>`);
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // Paragraph: consecutive plain lines, one per visual line.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !startsBlock(lines, i)
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${para.map(renderInline).join('<br>\n')}</p>`);
  }
  return out.join('\n');
}

/** A bullet's content: one plain line stays inline, the rest are blocks. */
function renderItem(content: string[]): string {
  const [first, ...rest] = content;
  const tail = rest.some((l) => l.trim() !== '')
    ? `\n${renderBlocks(rest)}`
    : '';
  return renderInline(first) + tail;
}

function startsBlock(lines: string[], i: number): boolean {
  const line = lines[i];
  return (
    FENCE_OPEN.test(line) ||
    /^#{1,6} /.test(line) ||
    /^-{3,}\s*$/.test(line) ||
    LIST_ITEM.test(line) ||
    (line.startsWith('|') && TABLE_DIVIDER.test(lines[i + 1] ?? ''))
  );
}

/** Minimal readable styling, light and dark, no external resources. */
const REPORT_CSS = `
:root { color-scheme: light dark; --fg: #1f2328; --bg: #ffffff; --muted: #59636e; --border: #d1d9e0; --code-bg: #f6f8fa; --link: #0969da; }
@media (prefers-color-scheme: dark) { :root { --fg: #e6edf3; --bg: #0d1117; --muted: #9198a1; --border: #3d444d; --code-bg: #151b23; --link: #4493f8; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
main { max-width: 980px; margin: 0 auto; padding: 24px 16px 48px; }
h1, h2, h3 { line-height: 1.25; margin: 1.5em 0 0.6em; }
h1 { font-size: 1.7em; margin-top: 0; padding-bottom: 0.3em; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
h2 { font-size: 1.35em; padding-bottom: 0.25em; border-bottom: 1px solid var(--border); }
h3 { font-size: 1.1em; }
a { color: var(--link); }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.88em; }
code { background: var(--code-bg); padding: 0.1em 0.35em; border-radius: 4px; overflow-wrap: anywhere; }
pre { background: var(--code-bg); border: 1px solid var(--border); border-radius: 6px; padding: 12px; overflow-x: auto; }
pre code { background: none; padding: 0; overflow-wrap: normal; }
table { border-collapse: collapse; display: block; overflow-x: auto; margin: 1em 0; }
th, td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; vertical-align: top; }
th { background: var(--code-bg); }
ul { padding-left: 1.5em; }
hr { border: 0; border-top: 1px solid var(--border); margin: 2em 0; }
img { display: block; max-width: 100%; height: auto; margin: 0.5em 0; border: 1px solid var(--border); border-radius: 6px; }
@media print { pre, img, tr { break-inside: avoid; } }
`.trim();

/**
 * Wrap the report's Markdown as one self-contained HTML document. The title
 * is the report's own `# ` heading. Deterministic: the same Markdown always
 * gives the same bytes.
 */
export function reportMarkdownToHtml(markdown: string): string {
  const lines = markdown.split('\n');
  const title =
    lines
      .find((l) => l.startsWith('# '))
      ?.slice(2)
      .trim() ?? 'Evidence Report';
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="generator" content="samaritan">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>\n${REPORT_CSS}\n</style>`,
    '</head>',
    '<body>',
    '<main>',
    renderBlocks(lines),
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
