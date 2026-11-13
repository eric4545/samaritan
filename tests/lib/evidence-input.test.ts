import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  classifyEvidenceInput,
  evidenceHeaderLine,
  evidenceLinkUrl,
  evidencePromptLines,
  evidenceTypeMismatch,
  inferEvidenceTypeFromExtension,
  isEvidenceUrl,
  resolveDroppedPath,
  storedEvidenceName,
} from '../../src/lib/evidence-input';

const exists =
  (...paths: string[]) =>
  (p: string): boolean =>
    paths.includes(p);

describe('classifyEvidenceInput', () => {
  it('a bare Enter is empty (the pane capture, when there is one)', () => {
    assert.deepStrictEqual(classifyEvidenceInput('  \n'), { kind: 'empty' });
  });

  it('a URL is a link, whatever service it points at', () => {
    for (const url of [
      'https://chat.example.com/archives/C000/p1700000000',
      'https://ci.example.com/job/web-server-deploy/42/console',
      'http://dashboard.example.org/d/abc?orgId=1&from=now-1h',
    ]) {
      assert.deepStrictEqual(classifyEvidenceInput(` ${url}\n`), {
        kind: 'link',
        url,
      });
    }
  });

  it('a sentence that merely contains a URL stays text', () => {
    const text = 'see https://ci.example.com/job/42 for the build';
    assert.deepStrictEqual(classifyEvidenceInput(text), { kind: 'text', text });
  });

  it('an existing path is a file: plain, quoted, escaped (as dragged in)', () => {
    const fileExists = exists('/tmp/shots/dash board.png');
    for (const raw of [
      "'/tmp/shots/dash board.png'",
      '"/tmp/shots/dash board.png"',
      '/tmp/shots/dash\\ board.png ',
    ]) {
      assert.deepStrictEqual(classifyEvidenceInput(raw, fileExists), {
        kind: 'file',
        path: '/tmp/shots/dash board.png',
      });
    }
  });

  it('a path that is not there is reported, not recorded as text', () => {
    assert.deepStrictEqual(
      classifyEvidenceInput('/nope/missing.png', exists()),
      { kind: 'missing_file', path: '/nope/missing.png' },
    );
    assert.strictEqual(
      classifyEvidenceInput('~/shots/a.png', exists()).kind,
      'missing_file',
    );
  });

  it('prose that starts with a slash is text', () => {
    assert.strictEqual(
      classifyEvidenceInput('/health returned 200 on all pods', exists()).kind,
      'text',
    );
  });

  it('a multi-line paste is ONE text, never a file or a link', () => {
    const pasted =
      'web-server pods: 3/3 ready\r\ny\r\n\r\nhttps://ci.example.com/x\n';
    assert.deepStrictEqual(classifyEvidenceInput(pasted, exists()), {
      kind: 'text',
      text: 'web-server pods: 3/3 ready\ny\n\nhttps://ci.example.com/x',
    });
  });
});

describe('evidence input helpers', () => {
  it('isEvidenceUrl accepts only a lone http(s) URL', () => {
    assert.ok(isEvidenceUrl('https://example.com/a'));
    assert.ok(!isEvidenceUrl('ftp://example.com/a'));
    assert.ok(!isEvidenceUrl('https://'));
    assert.ok(!isEvidenceUrl('https://example.com/a b'));
  });

  it('resolveDroppedPath keeps a quoted path verbatim', () => {
    assert.strictEqual(resolveDroppedPath("'/a/b c.png'"), '/a/b c.png');
    assert.strictEqual(resolveDroppedPath('   '), undefined);
  });

  it('infers the evidence type from the extension', () => {
    assert.strictEqual(inferEvidenceTypeFromExtension('a.PNG'), 'screenshot');
    assert.strictEqual(inferEvidenceTypeFromExtension('a.mov'), 'video');
    assert.strictEqual(inferEvidenceTypeFromExtension('deploy.log'), 'file');
  });

  it('the stored name has nothing a Markdown link trips over', () => {
    assert.strictEqual(
      storedEvidenceName('dash board (1).png', '0123abcd-ffff'),
      '0123abcd-dash-board-1-.png',
    );
  });

  it('says when the recorded kind is not what evidence.types asks for', () => {
    const wants = { required: true, types: ['screenshot' as const] };
    assert.match(
      evidenceTypeMismatch(wants, 'link') ?? '',
      /asks for screenshot; recorded: link/,
    );
    assert.strictEqual(evidenceTypeMismatch(wants, 'photo'), undefined);
    assert.strictEqual(
      evidenceTypeMismatch({ types: ['command_output'] }, 'text'),
      undefined,
    );
    assert.strictEqual(
      evidenceTypeMismatch({ required: true }, 'link'),
      undefined,
    );
  });

  it('the step header line names the requirement and the types', () => {
    assert.strictEqual(
      evidenceHeaderLine(
        { required: true, types: ['screenshot', 'command_output'] },
        { enforced: true },
      ),
      'Evidence : required — screenshot, command_output  ([e] adds it)',
    );
    assert.match(
      evidenceHeaderLine({ required: true }, { enforced: false }) ?? '',
      /not enforced: --no-require-evidence/,
    );
    assert.match(
      evidenceHeaderLine({ types: ['log'] }, { enforced: true }) ?? '',
      /optional — log/,
    );
    assert.strictEqual(evidenceHeaderLine({}, { enforced: true }), undefined);
    assert.strictEqual(
      evidenceHeaderLine(undefined, { enforced: true }),
      undefined,
    );
  });

  it('the prompt offers the pane capture only when there is one', () => {
    const withPane = evidencePromptLines({
      wanted: 'screenshot',
      captureLabel: 'capture pane output since step start',
    }).join('\n');
    assert.match(withPane, /this step asks for: screenshot/);
    assert.match(withPane, /↵ alone {4}capture pane output since step start/);
    const without = evidencePromptLines({}).join('\n');
    assert.ok(!without.includes('↵ alone'));
    assert.match(without, /link {7}paste a URL/);
  });

  it('evidenceLinkUrl: only a link-typed result holding a URL', () => {
    assert.strictEqual(
      evidenceLinkUrl({ type: 'link', content: ' https://example.com/x\n' }),
      'https://example.com/x',
    );
    assert.strictEqual(
      evidenceLinkUrl({ type: 'log', content: 'https://example.com/x' }),
      undefined,
    );
    assert.strictEqual(
      evidenceLinkUrl({ type: 'link', content: 'n/a' }),
      undefined,
    );
  });
});
