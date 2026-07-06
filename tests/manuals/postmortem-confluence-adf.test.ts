import assert from 'node:assert';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import {
  generatePostmortemADF,
  generatePostmortemADFString,
} from '../../src/manuals/postmortem-adf-generator';
import { generatePostmortemConfluence } from '../../src/manuals/postmortem-confluence';
import { parsePostmortemFile } from '../../src/operations/postmortem-parser';

const examplePath = join(
  __dirname,
  '../../examples/postmortems/checkout-outage.yaml',
);
const pm = () => parsePostmortemFile(examplePath);
const dir = dirname(examplePath);

describe('generatePostmortemConfluence', () => {
  it('wraps the Mermaid timeline in a {markdown} macro', () => {
    const c = generatePostmortemConfluence(pm(), dir);
    assert.ok(
      c.includes('{markdown} ```mermaid'),
      'opening macro on same line as mermaid fence',
    );
    assert.ok(c.includes('timeline'), 'mermaid timeline directive');
    assert.ok(
      c.includes('```\n{markdown}'),
      'closing fence and macro on separate lines',
    );
  });

  it('renders headings and tables in wiki markup', () => {
    const c = generatePostmortemConfluence(pm(), dir);
    assert.ok(c.startsWith('h1. '), 'h1 title');
    assert.ok(c.includes('h2. Root Cause Analysis'));
    assert.ok(
      c.includes('|| Status || Action || Owner || Type || Ticket || Due ||'),
      'action items table header',
    );
  });

  it('embeds a file-based log in a {code} block', () => {
    const c = generatePostmortemConfluence(pm(), dir);
    assert.ok(c.includes('{code}'), 'code macro present');
    assert.ok(c.includes('kubectl rollout undo'), 'log content embedded');
  });

  it('renders a timeline-entry image with the ! ! macro', () => {
    const c = generatePostmortemConfluence(pm(), dir);
    assert.ok(
      c.includes(
        '!https://grafana.example.com/render/d/checkout/error-rate.png!',
      ),
      'timeline image as Confluence image markup',
    );
  });

  it('derives MTTD/MTTR when not authored', () => {
    const c = generatePostmortemConfluence(pm(), dir);
    assert.ok(c.includes('* *Time to detect (MTTD):* 4m'));
    assert.ok(c.includes('* *Time to resolve (MTTR):* 1h 16m'));
  });
});

describe('generatePostmortemADF', () => {
  it('produces a valid ADF doc object', () => {
    const adf = generatePostmortemADF(pm(), dir) as {
      type: string;
      content: unknown[];
    };
    assert.equal(adf.type, 'doc');
    assert.ok(Array.isArray(adf.content) && adf.content.length > 0);
  });

  it('serializes to valid JSON with a mermaid code block', () => {
    const json = generatePostmortemADFString(pm(), dir);
    const parsed = JSON.parse(json);
    assert.equal(parsed.type, 'doc');
    const hasMermaid = JSON.stringify(parsed).includes('timeline');
    assert.ok(hasMermaid, 'timeline diagram present in ADF');
  });

  it('renders the title heading with severity badge', () => {
    const json = generatePostmortemADFString(pm(), dir);
    assert.ok(json.includes('Checkout Service Outage'));
    assert.ok(json.includes('🔴'), 'severity badge in title');
  });

  it('references a timeline-entry image and derives MTTD/MTTR', () => {
    const json = generatePostmortemADFString(pm(), dir);
    assert.ok(
      json.includes(
        'https://grafana.example.com/render/d/checkout/error-rate.png',
      ),
      'timeline image referenced in ADF',
    );
    assert.ok(json.includes('Time to detect (MTTD): 4m'), 'derived MTTD');
    assert.ok(json.includes('Time to resolve (MTTR): 1h 16m'), 'derived MTTR');
  });
});
