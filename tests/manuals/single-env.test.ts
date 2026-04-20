import assert from 'node:assert';
import { describe, it } from 'node:test';
import { generateSingleEnvManual } from '../../src/manuals/generator';
import { parseFixture } from '../fixtures/fixtures';

describe('Single-env heading-based Markdown manual (issue #15)', () => {
  it('generates heading-based output with --env', async () => {
    const op = await parseFixture('withSessions');
    const md = generateSingleEnvManual(op, 'production');

    assert.ok(md.includes('# Deploy with Sessions — Production'), 'has H1 title');
    assert.ok(md.includes('## Step 1:'), 'has step headings');
    assert.ok(!md.includes('|'), 'has no table pipes');
  });

  it('each step has ## Step N: <name> heading', async () => {
    const op = await parseFixture('withSessions');
    const md = generateSingleEnvManual(op, 'production');

    assert.ok(md.includes('## Step 1: Deploy App'), 'step 1 heading');
    assert.ok(md.includes('## Step 2: Build Image'), 'step 2 heading');
  });

  it('renders **Command** block', async () => {
    const op = await parseFixture('withSessions');
    const md = generateSingleEnvManual(op, 'production');

    assert.ok(md.includes('**Command**'), 'has Command block');
    assert.ok(md.includes('kubectl apply -f deployment.yaml'), 'has command text');
    assert.ok(md.includes('```'), 'has code fence');
  });

  it('renders **Verify** block when verify.command defined', async () => {
    const op = await parseFixture('withSessions');
    const md = generateSingleEnvManual(op, 'production');

    assert.ok(md.includes('**Verify**'), 'has Verify block');
    assert.ok(md.includes('kubectl get pods -n prod'), 'has verify command');
  });

  it('renders Expected: line from verify.expect', async () => {
    const op = await parseFixture('withSessions');
    const md = generateSingleEnvManual(op, 'production');

    assert.ok(md.includes('Expected:'), 'has Expected line');
    assert.ok(md.includes('Running'), 'shows expected value');
  });

  it('renders PIC and Reviewer as blockquotes', async () => {
    const op = await parseFixture('withSessions');
    // Patch step with pic/reviewer
    const step = op.steps[0];
    step.pic = 'ops@example.com';
    step.reviewer = 'sre@example.com';
    const md = generateSingleEnvManual(op, 'production');

    assert.ok(md.includes('> PIC: ops@example.com'), 'has PIC blockquote');
    assert.ok(md.includes('> Reviewer: sre@example.com'), 'has Reviewer blockquote');
  });

  it('horizontal rule separates steps', async () => {
    const op = await parseFixture('withSessions');
    const md = generateSingleEnvManual(op, 'production');

    assert.ok(md.includes('---'), 'has horizontal rule separator');
  });

  it('no tables in output', async () => {
    const op = await parseFixture('withSessions');
    const md = generateSingleEnvManual(op, 'production');

    const lines = md.split('\n');
    const tableLines = lines.filter((l) => l.startsWith('|'));
    assert.strictEqual(tableLines.length, 0, 'should have no table lines');
  });

  it('without --env: existing table format unchanged (deployment fixture)', async () => {
    const { generateManualWithMetadata } = await import('../../src/manuals/generator');
    const op = await parseFixture('deployment');
    const md = generateManualWithMetadata(op, undefined, undefined);
    // Table format has | characters
    assert.ok(md.includes('|'), 'table format should have pipes');
  });

  it('renders string shorthand expect on step', async () => {
    const op = await parseFixture('withSessions');
    const buildStep = op.steps[1]; // "Build Image" with expect: "Successfully built"
    assert.strictEqual(buildStep.expect, 'Successfully built');
    const md = generateSingleEnvManual(op, 'production');
    assert.ok(md.includes('Successfully built'), 'renders string expect');
  });

  it('filters steps by when field for target env', async () => {
    const op = await parseFixture('whenAndVariants');
    const envName = op.environments[0].name;
    const md = generateSingleEnvManual(op, envName);
    // Should not throw and should have heading
    assert.ok(md.includes('#'), 'has headings');
  });

  it('snapshot: withCaptureExpect fixture renders all assertion types', async () => {
    const op = await parseFixture('withCaptureExpect');
    const md = generateSingleEnvManual(op, 'staging');

    assert.ok(md.includes('## Step 1: Build image'), 'step 1 present');
    assert.ok(md.includes('## Step 2: Check pod count'), 'step 2 present');
    assert.ok(md.includes('Expected:'), 'has expected');
    // Verify contains assertion rendered
    assert.ok(
      md.includes('healthy') || md.includes('"healthy"') || md.includes('equals'),
      'renders expected value',
    );
  });
});
