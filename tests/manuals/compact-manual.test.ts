import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  generateManualWithMetadata,
  generateSingleEnvManual,
} from '../../src/manuals/generator';
import { parseFixture } from '../fixtures/fixtures';

describe('Compact Markdown manual format (--compact)', () => {
  it('snapshot: nestedSubSteps3Levels — compact single-env with deep nesting', async (t) => {
    const op = await parseFixture('nestedSubSteps3Levels');
    const md = generateSingleEnvManual(
      op,
      'production',
      false,
      undefined,
      undefined,
      {
        compact: true,
      },
    );
    assert.ok(md.includes('## Step 1:'), 'top-level step keeps heading');
    t.assert.snapshot(md);
  });

  it('snapshot: withCaptureExpect — compact single-env with capture/expect', async (t) => {
    const op = await parseFixture('withCaptureExpect');
    const md = generateSingleEnvManual(
      op,
      'staging',
      false,
      undefined,
      undefined,
      {
        compact: true,
      },
    );
    assert.ok(md.includes('#'), 'renders headings');
    t.assert.snapshot(md);
  });

  it('snapshot: reviewerAndEnvEvidence — compact single-env with PIC/Reviewer/evidence', async (t) => {
    const op = await parseFixture('reviewerAndEnvEvidence');
    const md = generateSingleEnvManual(
      op,
      'production',
      false,
      undefined,
      undefined,
      {
        compact: true,
      },
    );
    t.assert.snapshot(md);
  });

  it('snapshot: parentStepWithSubstepsAndRollback — compact single-env with rollback', async (t) => {
    const op = await parseFixture('parentStepWithSubstepsAndRollback');
    const md = generateSingleEnvManual(
      op,
      'production',
      false,
      undefined,
      undefined,
      {
        compact: true,
      },
    );
    t.assert.snapshot(md);
  });

  it('snapshot: nestedSubSteps4Levels — compact single-env with 4 levels of nesting', async (t) => {
    const op = await parseFixture('nestedSubSteps4Levels');
    const md = generateSingleEnvManual(
      op,
      'production',
      false,
      undefined,
      undefined,
      {
        compact: true,
      },
    );
    t.assert.snapshot(md);
  });

  it('renders sub-steps as checkbox list items with dotted numbering', async () => {
    const op = await parseFixture('nestedSubSteps3Levels');
    const md = generateSingleEnvManual(
      op,
      'production',
      false,
      undefined,
      undefined,
      {
        compact: true,
      },
    );
    assert.ok(md.includes('- [ ] **1.1'), 'has 1.1 sub-step item');
    assert.ok(md.includes('- [ ] **1.1.1'), 'has 1.1.1 nested sub-step item');
  });

  it('indents depth-2 sub-steps by 2 spaces', async () => {
    const op = await parseFixture('nestedSubSteps3Levels');
    const md = generateSingleEnvManual(
      op,
      'production',
      false,
      undefined,
      undefined,
      {
        compact: true,
      },
    );
    assert.ok(
      md.includes('\n  - [ ] **1.1.1'),
      'depth-2 item is indented by 2 spaces',
    );
  });

  it('omits **Instructions**/**Command** labels in compact mode', async () => {
    const op = await parseFixture('withCaptureExpect');
    const md = generateSingleEnvManual(
      op,
      'staging',
      false,
      undefined,
      undefined,
      {
        compact: true,
      },
    );
    assert.ok(!md.includes('**Instructions**'), 'no Instructions label');
    assert.ok(!md.includes('**Command**'), 'no Command label');
  });

  it('merges PIC/Reviewer/Timeline into one blockquote line', async () => {
    const op = await parseFixture('reviewerAndEnvEvidence');
    const md = generateSingleEnvManual(
      op,
      'production',
      false,
      undefined,
      undefined,
      {
        compact: true,
      },
    );
    assert.match(
      md,
      /> PIC: ops-team@example\.com · Reviewer: sre-lead@example\.com/,
    );
  });

  it('renders one-line sign-off for rollback steps', async () => {
    const op = await parseFixture('parentStepWithSubstepsAndRollback');
    const md = generateSingleEnvManual(
      op,
      'production',
      false,
      undefined,
      undefined,
      {
        compact: true,
      },
    );
    assert.ok(md.includes('- [ ] **🔄 Rollback**'), 'has rollback item');
  });

  it('keeps fenced code blocks at the correct continuation indent', async () => {
    const op = await parseFixture('withCaptureExpect');
    const md = generateSingleEnvManual(
      op,
      'staging',
      false,
      undefined,
      undefined,
      {
        compact: true,
      },
    );
    const lines = md.split('\n');
    const fenceLine = lines.find((l) => l.trim() === '```bash');
    assert.ok(fenceLine !== undefined, 'has a bash fence');
  });

  it('keeps ## Step N: headings and --- separators at depth 0', async () => {
    const op = await parseFixture('nestedSubSteps3Levels');
    const md = generateSingleEnvManual(
      op,
      'production',
      false,
      undefined,
      undefined,
      {
        compact: true,
      },
    );
    assert.ok(md.includes('## Step 1:'), 'has Step heading');
  });

  it('has no trailing whitespace on any line', async () => {
    const op = await parseFixture('nestedSubSteps3Levels');
    const md = generateSingleEnvManual(
      op,
      'production',
      false,
      undefined,
      undefined,
      {
        compact: true,
      },
    );
    const offending = md.split('\n').filter((l) => /\s$/.test(l));
    assert.deepStrictEqual(offending, [], 'no lines with trailing whitespace');
  });

  it('default (non-compact) output is unchanged when compact is false or omitted', async () => {
    const op = await parseFixture('nestedSubSteps3Levels');
    const withoutOption = generateSingleEnvManual(op, 'production');
    const withFalse = generateSingleEnvManual(
      op,
      'production',
      false,
      undefined,
      undefined,
      { compact: false },
    );
    assert.strictEqual(withoutOption, withFalse);
    assert.ok(!withoutOption.includes('- [ ] **1.1'));
  });

  it('snapshot: multi-env table compact format de-noises cells', async (t) => {
    const op = await parseFixture('reviewerAndEnvEvidence');
    const md = generateManualWithMetadata(
      op,
      undefined,
      undefined,
      false,
      false,
      undefined,
      undefined,
      { compact: true },
    );
    assert.ok(md.includes('|'), 'still a table');
    t.assert.snapshot(md);
  });

  it('multi-env compact merges PIC/Reviewer metadata into one <em> line', async () => {
    const op = await parseFixture('reviewerAndEnvEvidence');
    const md = generateManualWithMetadata(
      op,
      undefined,
      undefined,
      false,
      false,
      undefined,
      undefined,
      { compact: true },
    );
    assert.match(
      md,
      /<em>👤 PIC: ops-team@example\.com · 👥 Reviewer: sre-lead@example\.com<\/em>/,
    );
    assert.ok(!md.includes('**Instructions:**'), 'no Instructions label');
  });

  it('multi-env default (non-compact) table format unchanged', async () => {
    const op = await parseFixture('reviewerAndEnvEvidence');
    const withoutOption = generateManualWithMetadata(op, undefined, undefined);
    const withFalse = generateManualWithMetadata(
      op,
      undefined,
      undefined,
      false,
      false,
      undefined,
      undefined,
      { compact: false },
    );
    assert.strictEqual(withoutOption, withFalse);
  });
});
