import assert from 'node:assert';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { generateADF } from '../../src/manuals/adf-generator';
import {
  generateManual,
  generateSingleEnvManual,
} from '../../src/manuals/generator';
import { parseOperation } from '../../src/operations/parser';

/**
 * `on_failure` is an operation-level section, so it has to be added to EVERY
 * render path or the formats silently diverge (the exact trap documented in
 * .claude/rules/manuals.md). This pins all of them.
 */

const EXAMPLE = resolve('examples/deployment-with-hooks.yaml');
const OP_DIR = resolve('examples');

async function op() {
  return parseOperation(EXAMPLE);
}

function adfHeadings(doc: any): string[] {
  return (doc.content ?? [])
    .filter((n: any) => n.type === 'heading')
    .map((n: any) => (n.content ?? []).map((c: any) => c.text ?? '').join(''));
}

describe('on_failure renders in the multi-env Markdown manual', () => {
  it('emits the section with both failure steps', async () => {
    const md = generateManual(await op(), false, OP_DIR);
    assert.ok(md.includes('## 🚨 On Failure'), 'section heading present');
    assert.ok(md.includes('Page the on-call engineer'));
    assert.ok(md.includes('Capture pod diagnostics for the postmortem'));
  });

  it('renders a column per environment', async () => {
    const md = generateManual(await op(), false, OP_DIR);
    const section = md.slice(md.indexOf('## 🚨 On Failure'));
    assert.ok(
      section.includes('| Step | staging | production |'),
      `on-failure table must carry every environment column:\n${section.slice(0, 400)}`,
    );
  });

  it('keeps on_failure steps out of the flow section', async () => {
    const md = generateManual(await op(), false, OP_DIR);
    const flow = md.slice(0, md.indexOf('## 🚨 On Failure'));
    assert.ok(
      !flow.includes('Page the on-call engineer'),
      'on-failure steps must not appear among the flow steps',
    );
  });
});

describe('on_failure renders in the single-env Markdown manual', () => {
  it('emits the section for the selected environment', async () => {
    const md = generateSingleEnvManual(await op(), 'staging', false, OP_DIR);
    assert.ok(md.includes('## 🚨 On Failure'));
    assert.ok(md.includes('Failure Step 1: Page the on-call engineer'));
    assert.ok(
      md.includes('Failure Step 2: Capture pod diagnostics for the postmortem'),
    );
  });

  it('renders full step content, not just the name', async () => {
    const md = generateSingleEnvManual(await op(), 'staging', false, OP_DIR);
    const section = md.slice(md.indexOf('## 🚨 On Failure'));
    assert.ok(
      section.includes('kubectl describe pods'),
      'the failure step command must render',
    );
    assert.ok(
      section.includes('Evidence Required'),
      'evidence metadata must render on failure steps too',
    );
  });

  it('resolves variables when asked', async () => {
    const md = generateSingleEnvManual(await op(), 'staging', true, OP_DIR);
    const section = md.slice(md.indexOf('## 🚨 On Failure'));
    assert.ok(
      section.includes('--context=staging-cluster'),
      `--resolve-vars must reach the on-failure section:\n${section.slice(0, 600)}`,
    );
  });
});

describe('on_failure renders in ADF', () => {
  it('emits an On Failure heading', async () => {
    const doc = generateADF(await op(), undefined, undefined, false, OP_DIR);
    assert.ok(
      adfHeadings(doc).includes('🚨 On Failure'),
      `ADF headings: ${adfHeadings(doc).join(' | ')}`,
    );
  });

  it('emits a table after the heading', async () => {
    const doc = generateADF(await op(), undefined, undefined, false, OP_DIR);
    const idx = doc.content.findIndex(
      (n: any) =>
        n.type === 'heading' &&
        (n.content ?? []).some((c: any) => c.text === '🚨 On Failure'),
    );
    const after = doc.content.slice(idx + 1);
    assert.ok(
      after.some((n: any) => n.type === 'table'),
      'the On Failure section must contain a steps table',
    );
  });
});

describe('an operation without hooks renders no On Failure section', () => {
  it('multi-env Markdown', async () => {
    const plain = await parseOperation(resolve('examples/deployment.yaml'));
    assert.ok(!generateManual(plain, false, OP_DIR).includes('On Failure'));
  });

  it('single-env Markdown', async () => {
    const plain = await parseOperation(resolve('examples/deployment.yaml'));
    const envName = plain.environments[0].name;
    assert.ok(
      !generateSingleEnvManual(plain, envName, false, OP_DIR).includes(
        'On Failure',
      ),
    );
  });

  it('ADF', async () => {
    const plain = await parseOperation(resolve('examples/deployment.yaml'));
    assert.ok(
      !adfHeadings(
        generateADF(plain, undefined, undefined, false, OP_DIR),
      ).includes('🚨 On Failure'),
    );
  });
});
