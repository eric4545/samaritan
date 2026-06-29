import assert from 'node:assert';
import { describe, it } from 'node:test';
import { generateConfluenceContent } from '../../src/cli/commands/generate';
import { generateADFString } from '../../src/manuals/adf-generator';
import {
  generateManual,
  generateSingleEnvManual,
} from '../../src/manuals/generator';
import { parseFixture } from '../fixtures/fixtures';

// Regression (the "rollback substep render manual is broken — no sub-step body"
// report): a step-level rollback (Step.rollback) whose rollback step has its own
// sub_steps used to render as a heading/row with the sub_steps dropped. Root
// cause was two-fold: the parser only copied a fixed set of rollback fields
// (never name/sub_steps), and every per-format rollback renderer was a separate
// copy that forgot sub_steps. Now the parser preserves them and one recursive
// renderer per format handles sub_steps for BOTH step-level and operation-level
// rollback.
describe('Step-level rollback (Step.rollback) with nested sub_steps', () => {
  it('parser preserves rollback name and recursively parses sub_steps', async () => {
    const op = await parseFixture('stepRollbackSubsteps');
    const rb = op.steps[0].rollback?.[0];
    assert.ok(rb, 'step has a rollback');
    assert.strictEqual(rb?.name, 'Multi-part rollback');
    assert.strictEqual(rb?.sub_steps?.length, 3, 'three rollback sub_steps');
    assert.strictEqual(
      rb?.sub_steps?.[1]?.name,
      'Delete pods',
      'nested sub-step name preserved',
    );
    // String-shorthand expect should still be normalized on a nested sub-step
    assert.ok(rb?.sub_steps?.[2]?.expect, 'nested sub-step expect preserved');
  });

  it('renders step-level rollback sub_steps in single-env Markdown', async () => {
    const op = await parseFixture('stepRollbackSubsteps');
    const md = generateSingleEnvManual(op, 'staging');

    assert.match(md, /🔄 Rollback: Multi-part rollback/);
    assert.match(md, /kubectl scale deployment\/app --replicas=0/);
    assert.match(md, /kubectl delete pod -l app=app/);
  });

  it('renders step-level rollback sub_steps in multi-env Markdown', async () => {
    const op = await parseFixture('stepRollbackSubsteps');
    const md = generateManual(op);

    assert.match(md, /🔄 Rollback for Step 1: Deploy app/);
    assert.match(md, /kubectl scale deployment\/app --replicas=0/);
    assert.match(md, /kubectl delete pod -l app=app/);
  });

  it('renders step-level rollback sub_steps in ADF', async () => {
    const op = await parseFixture('stepRollbackSubsteps');
    const adfText = generateADFString(op, undefined, undefined, false);

    assert.match(adfText, /Rollback for: Deploy app/);
    assert.match(adfText, /kubectl scale deployment\\?\/app --replicas=0/);
    assert.match(adfText, /kubectl delete pod -l app=app/);
  });

  it('renders step-level rollback sub_steps in Confluence', async () => {
    const op = await parseFixture('stepRollbackSubsteps');
    const confluence = generateConfluenceContent(op, false);

    assert.match(confluence, /Rollback for Step 1: Deploy app/);
    assert.match(confluence, /kubectl scale deployment\/app --replicas=0/);
    assert.match(confluence, /kubectl delete pod -l app=app/);
  });
});
