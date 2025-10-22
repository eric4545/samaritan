import assert from 'node:assert';
import { describe, it } from 'node:test';
import { generateConfluenceContent } from '../../src/cli/commands/generate';
import { generateADFString } from '../../src/manuals/adf-generator';
import { generateManual } from '../../src/manuals/generator';
import { parseFixture } from '../fixtures/fixtures';

describe('Parent Step Rollback Rendering', () => {
  it('should render rollback for parent step with sub_steps in Markdown', async () => {
    const operation = await parseFixture('parentStepWithSubstepsAndRollback');
    const manual = generateManual(operation);

    // The rollback should appear AFTER all sub-steps
    assert.match(manual, /Step 1a: Update Configuration/);
    assert.match(manual, /Step 1b: Deploy Pods/);
    assert.match(manual, /Step 1c: Verify Deployment/);

    // CRITICAL: Rollback should be rendered INLINE after all sub-steps, NOT only in aggregate section
    const step1cIndex = manual.indexOf('Step 1c: Verify Deployment');
    const rollbackAggregateIndex = manual.indexOf('## 🔄 Rollback Procedures');
    const rollbackInlineIndex = manual.indexOf(
      '### 🔄 Rollback for Step 1: Stage 1 (1% Traffic)',
    );

    // The inline rollback should exist and appear BETWEEN the last sub-step and aggregate section
    assert.ok(rollbackInlineIndex > 0, 'Rollback should be rendered inline');
    assert.ok(
      rollbackInlineIndex > step1cIndex,
      'Rollback should appear after last sub-step',
    );
    assert.ok(
      rollbackInlineIndex < rollbackAggregateIndex,
      'Rollback should appear BEFORE aggregate section',
    );

    // Verify rollback content
    const rollbackSection = manual.substring(
      rollbackInlineIndex,
      rollbackAggregateIndex,
    );
    assert.match(rollbackSection, /Rollback to previous deployment version/);
    assert.match(rollbackSection, /kubectl rollout undo deployment\/app/);
  });

  it('should render rollback for parent step with sub_steps in ADF', async () => {
    const operation = await parseFixture('parentStepWithSubstepsAndRollback');
    const adfString = generateADFString(operation, undefined, undefined, true);
    const adf = JSON.parse(adfString);

    // Convert ADF to string for easier searching
    const adfText = JSON.stringify(adf);

    // Verify sub-steps are present
    assert.match(adfText, /Update Configuration/);
    assert.match(adfText, /Deploy Pods/);
    assert.match(adfText, /Verify Deployment/);

    // CRITICAL: Rollback should be present (ADF uses "Rollback for:" format)
    assert.match(adfText, /Rollback for: Stage 1/);
    assert.match(adfText, /Rollback to previous deployment version/);
    assert.match(adfText, /kubectl rollout undo/);
  });

  it('should render rollback for parent step with sub_steps in Confluence', async () => {
    const operation = await parseFixture('parentStepWithSubstepsAndRollback');
    const confluence = generateConfluenceContent(operation, true);

    // Verify sub-steps are present
    assert.match(confluence, /Step 1a: Update Configuration/);
    assert.match(confluence, /Step 1b: Deploy Pods/);
    assert.match(confluence, /Step 1c: Verify Deployment/);

    // CRITICAL: Rollback should be rendered INLINE after sub-steps, not just in aggregate
    const step1cIndex = confluence.indexOf('Step 1c: Verify Deployment');
    const aggregateIndex = confluence.indexOf('h2. (<) Rollback Procedures');

    // Find the inline rollback (uses "Step 1:" format for inline, not aggregate format)
    const inlineRollbackIndex = confluence.indexOf(
      'h3. (<) Rollback for Step 1: Stage 1 (1% Traffic)',
    );

    // The inline rollback should appear BETWEEN last sub-step and aggregate section
    assert.ok(inlineRollbackIndex > 0, 'Rollback should exist inline');
    assert.ok(
      inlineRollbackIndex > step1cIndex,
      'Rollback should appear after last sub-step (Step 1c)',
    );
    assert.ok(
      inlineRollbackIndex < aggregateIndex,
      'Rollback should appear INLINE (before aggregate section)',
    );

    // Verify rollback content in inline section
    const inlineSection = confluence.substring(step1cIndex, aggregateIndex);
    assert.match(inlineSection, /Rollback to previous deployment version/);
    assert.match(inlineSection, /kubectl rollout undo/);
  });

  it('should render rollback for nested sub-step with its own sub-steps in Confluence', async () => {
    const operation = await parseFixture('nestedSubstepWithRollback');
    const confluence = generateConfluenceContent(operation, true);

    // Verify nested structure
    assert.match(confluence, /Step 1a: Stage 1 \(1% Traffic\)/);
    assert.match(confluence, /Step 1a1: Update Configuration/);
    assert.match(confluence, /Step 1a2: Verify Changes/);
    assert.match(confluence, /Step 1a3: Apply Changes/);

    // CRITICAL: Rollback should appear AFTER nested sub-steps
    const lastNestedStepIndex = confluence.indexOf('Step 1a3: Apply Changes');

    // Find inline rollback for the nested sub-step (parentheses need exact match)
    const inlineRollbackIndex = confluence.indexOf('Rollback for Step 1a:');

    // Rollback should appear after last nested step
    assert.ok(
      inlineRollbackIndex > 0,
      'Nested sub-step rollback should exist inline',
    );
    assert.ok(
      inlineRollbackIndex > lastNestedStepIndex,
      'Rollback should appear after last nested step',
    );

    // Verify rollback content appears after the nested steps
    const rollbackSection = confluence.substring(inlineRollbackIndex);
    assert.match(rollbackSection, /Restore previous traffic weights/);
    assert.match(rollbackSection, /git restore config\.hcl/);
  });
});
