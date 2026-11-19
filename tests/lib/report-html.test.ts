import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { generateReport } from '../../src/lib/report-generator';
import {
  imageDataUri,
  renderBlocks,
  renderInline,
  reportMarkdownToHtml,
} from '../../src/lib/report-html';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const JPEG = Buffer.from('ffd8ffe000104a464946', 'hex');
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1');
const WEBP = Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8 ', 'latin1');

describe('imageDataUri', () => {
  const dir = mkdtempSync(join(tmpdir(), 'samaritan-report-html-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const file = (name: string, bytes: Buffer): string => {
    const path = join(dir, name);
    writeFileSync(path, bytes);
    return path;
  };

  it('embeds PNG, JPEG, GIF and WebP by their bytes', () => {
    for (const [name, bytes, mime] of [
      ['a.png', PNG, 'image/png'],
      ['b.jpg', JPEG, 'image/jpeg'],
      ['c.gif', GIF, 'image/gif'],
      ['d.webp', WEBP, 'image/webp'],
    ] as const) {
      assert.equal(
        imageDataUri(file(name, bytes)),
        `data:${mime};base64,${bytes.toString('base64')}`,
      );
    }
  });

  it('takes the type from the content, not the extension', () => {
    assert.match(
      imageDataUri(file('shot.dat', PNG)) ?? '',
      /^data:image\/png;/,
    );
    assert.equal(
      imageDataUri(file('fake.png', Buffer.from('not an image'))),
      undefined,
    );
  });

  it('returns undefined for a file that does not exist', () => {
    assert.equal(imageDataUri(join(dir, 'missing.png')), undefined);
  });
});

describe('renderInline', () => {
  it('escapes HTML in text and in code spans', () => {
    assert.equal(
      renderInline('<script>x</script> `a<b && c`'),
      '&lt;script&gt;x&lt;/script&gt; <code>a&lt;b &amp;&amp; c</code>',
    );
  });

  it('renders bold, italic, links and autolinks', () => {
    assert.equal(
      renderInline(
        '**Step 1: deploy** _(none)_ [app.log](evidence/app.log) <https://example.com/a?b=1&c=2>',
      ),
      '<strong>Step 1: deploy</strong> <em>(none)</em> <a href="evidence/app.log">app.log</a> <a href="https://example.com/a?b=1&amp;c=2">https://example.com/a?b=1&amp;c=2</a>',
    );
  });

  it('leaves underscores inside a word alone', () => {
    assert.equal(renderInline('web_server_deploy'), 'web_server_deploy');
  });

  it('opens a link target wrapped in <…> (spaces in the file name)', () => {
    assert.equal(
      renderInline('[my file](<evidence/my file.log>)'),
      '<a href="evidence/my file.log">my file</a>',
    );
  });

  it('refuses a javascript: or data: link, keeping its text', () => {
    assert.equal(renderInline('[click](javascript:void0)'), 'click');
    assert.equal(renderInline('[click](JavaScript:void0)'), 'click');
    assert.equal(renderInline('[x](data:text/html,hi)'), 'x');
  });

  it('shows an embedded image, and only a data:image URI as an image', () => {
    assert.equal(
      renderInline('![Dash "board"](data:image/png;base64,iVBORw0K)'),
      '<img src="data:image/png;base64,iVBORw0K" alt="Dash &quot;board&quot;">',
    );
    // Not embedded (a relative path): a link, never a broken <img>.
    assert.equal(
      renderInline('![Dashboard](evidence/shot.png)'),
      '<a href="evidence/shot.png">Dashboard</a>',
    );
    assert.equal(renderInline('![x](data:image/svg+xml;base64,PHN2Zz4=)'), 'x');
  });

  it('undoes backslash escapes', () => {
    assert.equal(renderInline('a \\| b \\*c\\*'), 'a | b *c*');
  });

  it('reads escaped brackets in image alt and link text', () => {
    assert.equal(
      renderInline(
        '![Grafana \\[prod\\] panel\\]](data:image/png;base64,iVBORw0K)',
      ),
      '<img src="data:image/png;base64,iVBORw0K" alt="Grafana [prod] panel]">',
    );
    assert.equal(
      renderInline('[app\\]x.log](evidence/app.log)'),
      '<a href="evidence/app.log">app]x.log</a>',
    );
  });
});

describe('code spans', () => {
  it('bind before bold and links, like CommonMark', () => {
    assert.equal(
      renderInline('**Step 1: run `kubectl get pods`**'),
      '<strong>Step 1: run <code>kubectl get pods</code></strong>',
    );
    assert.equal(
      renderInline('`[x](y)` and `**a**`'),
      '<code>[x](y)</code> and <code>**a**</code>',
    );
  });

  it('pair runs of the same length; an unmatched run is literal', () => {
    assert.equal(renderInline('``a ` b``'), '<code>a ` b</code>');
    assert.equal(renderInline('`` only open'), '`` only open');
    assert.equal(renderInline('`a`` b`'), '<code>a`` b</code>');
  });

  it('keep their source text inside an attribute', () => {
    assert.equal(
      renderInline('![run `ls`](data:image/png;base64,iVBORw0K)'),
      '<img src="data:image/png;base64,iVBORw0K" alt="run `ls`">',
    );
  });

  it('are not confused by private-use characters in the input', () => {
    assert.equal(renderInline('a0 `b`'), 'a�0� <code>b</code>');
  });
});

describe('linear time on hostile input', () => {
  // CodeQL js/polynomial-redos: these shapes rescanned the rest of the line
  // from every position (seconds at 100k characters, before).
  const n = 100_000;
  for (const [name, input] of [
    ['a run of backticks', '`'.repeat(n)],
    ['a run of [', '['.repeat(n)],
    ['a run of ![', '!['.repeat(n / 2)],
    [
      'many unclosed runs',
      Array.from({ length: 400 }, (_, k) => `${'`'.repeat(k + 1)}a`).join(' '),
    ],
  ] as const) {
    it(name, () => {
      const start = performance.now();
      renderInline(input);
      assert.ok(performance.now() - start < 1500, `${name} took too long`);
    });
  }

  it('a description of spaces', () => {
    const start = performance.now();
    const md = generateReport(writeLogWithDescription(`${' '.repeat(n)}x`));
    assert.ok(performance.now() - start < 1500, 'took too long');
    assert.ok(md.includes('![x](shot.png)'), md.slice(-300));
  });
});

const logDirs: string[] = [];
after(() => {
  for (const dir of logDirs) rmSync(dir, { recursive: true, force: true });
});
function writeLogWithDescription(description: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'samaritan-report-desc-'));
  logDirs.push(dir);
  writeFileSync(join(dir, 'shot.png'), PNG);
  const jsonl = join(dir, 'events.jsonl');
  const events = [
    { type: 'session_start', op: join(dir, 'op.yaml'), total_steps: 1 },
    { type: 'step_start', step: 0, name: 'Deploy web-server', label: '1' },
    {
      type: 'evidence_captured',
      step: 0,
      evidence_type: 'screenshot',
      description,
      path: join(dir, 'shot.png'),
      filename: 'shot.png',
    },
  ];
  writeFileSync(
    jsonl,
    `${events.map((e) => JSON.stringify({ ts: '2026-01-01T00:00:00Z', session_id: 'abc123', ...e })).join('\n')}\n`,
  );
  return jsonl;
}

describe('evidence description with brackets', () => {
  // An operator typed "]" in a screenshot description: the image ended early
  // and rendered as text, with the whole base64 of the screenshot visible.
  const dir = mkdtempSync(join(tmpdir(), 'samaritan-report-brackets-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const shot = join(dir, 'shot.png');
  writeFileSync(shot, PNG);
  const jsonl = join(dir, 'events.jsonl');
  writeFileSync(
    jsonl,
    `${[
      { type: 'session_start', op: join(dir, 'op.yaml'), total_steps: 1 },
      { type: 'step_start', step: 0, name: 'Deploy web-server', label: '1' },
      {
        type: 'evidence_captured',
        step: 0,
        evidence_type: 'screenshot',
        description: 'Grafana [prod] panel]\nsecond line',
        path: shot,
        filename: 'shot.png',
      },
      { type: 'session_end', status: 'completed' },
    ]
      .map((e) =>
        JSON.stringify({
          ts: '2026-01-01T00:00:00Z',
          session_id: 'abc123',
          ...e,
        }),
      )
      .join('\n')}\n`,
  );

  it('Markdown escapes the brackets so the image stays an image', () => {
    const md = generateReport(jsonl);
    assert.ok(
      md.includes('![Grafana \\[prod\\] panel\\] second line](shot.png)'),
      md,
    );
  });

  it('HTML embeds the image with the description as alt text', () => {
    const html = generateReport(jsonl, { format: 'html' });
    const uri = `data:image/png;base64,${PNG.toString('base64')}`;
    assert.ok(
      html.includes(
        `<img src="${uri}" alt="Grafana [prod] panel] second line">`,
      ),
      html,
    );
    // The base64 appears once: in the src, never as visible text.
    assert.equal(html.split(PNG.toString('base64')).length, 2, html);
  });
});

describe('renderBlocks', () => {
  it('renders a GFM table, with \\| as a literal pipe', () => {
    const html = renderBlocks([
      '| # | Step |',
      '|---|---|',
      '| 1 | grep a\\|b |',
    ]);
    assert.ok(html.includes('<th>#</th><th>Step</th>'), html);
    assert.ok(html.includes('<td>1</td><td>grep a|b</td>'), html);
  });

  it('keeps a fenced block under a bullet inside that bullet', () => {
    const html = renderBlocks([
      '**Verification**: ❌ FAIL',
      '- ❌ (line_count) — expected: `2`',
      '  actual:',
      '',
      '  ```',
      '  line one',
      '  <b>two</b>',
      '  ```',
      '- ✅ (contains)',
    ]);
    assert.equal(
      html,
      [
        '<p><strong>Verification</strong>: ❌ FAIL</p>',
        '<ul><li>❌ (line_count) — expected: <code>2</code>\n<p>actual:</p>\n<pre><code>line one\n&lt;b&gt;two&lt;/b&gt;</code></pre></li><li>✅ (contains)</li></ul>',
      ].join('\n'),
    );
  });

  it('closes a fence only on a run at least as long as the opener', () => {
    const html = renderBlocks(['````', '```', 'inner', '```', '````']);
    assert.equal(html, '<pre><code>```\ninner\n```</code></pre>');
  });

  it('keeps a multi-line note in its bullet', () => {
    const html = renderBlocks(['**Notes**', '- first line', '  second line']);
    assert.ok(html.includes('<li>first line\n<p>second line</p></li>'), html);
  });

  it('renders nested bullets', () => {
    const html = renderBlocks(['- outer', '  - inner']);
    assert.equal(html, '<ul><li>outer\n<ul><li>inner</li></ul></li></ul>');
  });
});

describe('reportMarkdownToHtml', () => {
  it('is one standalone document titled by the report heading', () => {
    const html = reportMarkdownToHtml('# Evidence Report: <op>.yaml\nbody');
    assert.ok(html.startsWith('<!DOCTYPE html>'), html);
    assert.ok(html.includes('<title>Evidence Report: &lt;op&gt;.yaml</title>'));
    assert.ok(html.includes('<meta charset="utf-8">'));
    // Nothing fetched from elsewhere: no external script, stylesheet or font.
    assert.ok(!/<script|<link |@import|url\(/.test(html), html);
  });

  it('is deterministic', () => {
    const md = '# R\n\n## Step 1: a\n\n- x\n';
    assert.equal(reportMarkdownToHtml(md), reportMarkdownToHtml(md));
  });
});
