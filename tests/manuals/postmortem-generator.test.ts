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

  it('derives MTTD/MTTR from timestamps when not authored', () => {
    // The example omits detected_after/resolved_after; they come from the
    // occurred_at -> detected_at (4m) and occurred_at -> resolved_at (76m) gaps.
    const md = renderExample();
    assert.ok(md.includes('**Time to detect (MTTD)**: 4m'), 'derived MTTD');
    assert.ok(
      md.includes('**Time to resolve (MTTR)**: 1h 16m'),
      'derived MTTR',
    );
    assert.ok(md.includes('**Duration**: 1h 16m'), 'computed duration');
  });

  it('lets an explicit impact value override the derived one', () => {
    const pm: Postmortem = {
      title: 'X',
      summary: 'Y',
      occurred_at: '2026-07-01T14:32:00Z',
      resolved_at: '2026-07-01T15:48:00Z',
      impact: { resolved_after: 'about an hour' },
    };
    const md = generatePostmortemMarkdown(pm);
    assert.ok(md.includes('**Time to resolve (MTTR)**: about an hour'));
    assert.ok(
      !md.includes('**Time to resolve (MTTR)**: 1h 16m'),
      'explicit MTTR value wins over the derived one',
    );
  });

  it('renders a timeline-entry image', () => {
    const md = renderExample();
    assert.ok(
      md.includes(
        '![Rolled back to v2.3.0](https://grafana.example.com/render/d/checkout/error-rate.png)',
      ),
      'timeline image embedded as Markdown image',
    );
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
