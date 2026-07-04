import assert from 'node:assert';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { generatePostmortemMarkdown } from '../../src/manuals/postmortem-generator';
import type { Postmortem } from '../../src/models/postmortem';
import { parsePostmortemFile } from '../../src/operations/postmortem-parser';

const examplePath = join(
  __dirname,
  '../../examples/postmortems/checkout-outage.yaml',
);

function renderExample(): string {
  const pm = parsePostmortemFile(examplePath);
  return generatePostmortemMarkdown(pm, dirname(examplePath));
}

describe('generatePostmortemMarkdown', () => {
  it('renders the title with a severity badge', () => {
    const md = renderExample();
    assert.ok(md.startsWith('# 🔴 Checkout Service Outage'));
  });

  it('renders all major sections', () => {
    const md = renderExample();
    for (const heading of [
      '## Summary',
      '## Impact',
      '## Detection',
      '## Timeline',
      '## Root Cause Analysis',
      '## Resolution',
      '## Action Items',
      '## Lessons Learned',
      '## Supporting Information',
    ]) {
      assert.ok(md.includes(heading), `missing ${heading}`);
    }
  });

  it('renders a Mermaid timeline diagram plus a table', () => {
    const md = renderExample();
    assert.ok(md.includes('```mermaid'), 'has mermaid fence');
    assert.ok(md.includes('timeline'), 'has timeline directive');
    assert.ok(
      md.includes('| Time | Event | Who | Ref |'),
      'has timeline table header',
    );
  });

  it('renders MTTD/MTTR and computed duration', () => {
    const md = renderExample();
    assert.ok(md.includes('Time to detect (MTTD)'), 'MTTD');
    assert.ok(md.includes('Time to resolve (MTTR)'), 'MTTR');
    assert.ok(md.includes('**Duration**: 1h 16m'), 'computed duration');
  });

  it('renders 5-whys and contributing factors', () => {
    const md = renderExample();
    assert.ok(md.includes('**5 Whys**'));
    assert.ok(md.includes('1. Why did checkout fail?'));
    assert.ok(md.includes('**Contributing factors**'));
  });

  it('renders action items as a table with status icons', () => {
    const md = renderExample();
    assert.ok(md.includes('| Status | Action | Owner | Type | Ticket | Due |'));
    assert.ok(md.includes('JIRA-1300'));
    assert.ok(md.includes('2026-07-15'), 'due date stays a plain date string');
  });

  it('embeds a file-based log as a code block', () => {
    const md = renderExample();
    assert.ok(md.includes('kubectl rollout undo'), 'log file content embedded');
    assert.ok(md.includes('```'), 'inside a code fence');
  });

  it('links QRH references as `qrh show` hints', () => {
    const md = renderExample();
    assert.ok(md.includes('samaritan qrh show db-failover'));
  });

  it('renders a minimal postmortem with only required fields', () => {
    const pm: Postmortem = {
      title: 'Tiny Incident',
      summary: 'Brief.',
    };
    const md = generatePostmortemMarkdown(pm);
    assert.ok(md.includes('# Tiny Incident'));
    assert.ok(md.includes('## Summary'));
    // Optional sections omitted entirely.
    assert.ok(!md.includes('## Timeline'));
    assert.ok(!md.includes('## Action Items'));
  });
});
