import assert from 'node:assert';
import { describe, it } from 'node:test';
import { parseEvidenceLink } from '../../src/lib/evidence-link';

describe('parseEvidenceLink', () => {
  it('recognises a single http(s) URL and labels it host + path', () => {
    const link = parseEvidenceLink(
      '  https://jenkins.example.com/job/deploy/123/  ',
    );
    assert.deepStrictEqual(link, {
      url: 'https://jenkins.example.com/job/deploy/123/',
      label: 'jenkins.example.com/job/deploy/123',
      strippedCredentials: false,
    });
  });

  it('keeps the query string (Grafana/Jenkins links need it)', () => {
    const link = parseEvidenceLink(
      'https://grafana.example.com/d/abc?from=now-1h&to=now',
    );
    assert.strictEqual(
      link?.url,
      'https://grafana.example.com/d/abc?from=now-1h&to=now',
    );
  });

  it('strips user:token credentials before storing', () => {
    const link = parseEvidenceLink(
      'https://bot:s3cr3t@jenkins.example.com/job/x/1/console',
    );
    assert.strictEqual(
      link?.url,
      'https://jenkins.example.com/job/x/1/console',
    );
    assert.strictEqual(link?.strippedCredentials, true);
    assert.ok(!link?.url.includes('s3cr3t'));
  });

  it('returns undefined for plain text, multi-word text and non-http schemes', () => {
    assert.strictEqual(parseEvidenceLink('pods healthy, 3/3 ready'), undefined);
    assert.strictEqual(
      parseEvidenceLink('see https://jenkins.example.com/job/1'),
      undefined,
    );
    assert.strictEqual(parseEvidenceLink('ftp://host/file'), undefined);
    assert.strictEqual(parseEvidenceLink('https://'), undefined);
    assert.strictEqual(parseEvidenceLink(''), undefined);
  });

  it('truncates a very long label', () => {
    const link = parseEvidenceLink(`https://ci.example.com/${'a'.repeat(200)}`);
    assert.ok(link && link.label.length <= 60, link?.label);
    assert.ok(link?.label.endsWith('…'));
  });
});
