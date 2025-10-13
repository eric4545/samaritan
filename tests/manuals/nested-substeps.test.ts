import assert from 'node:assert';
import { test } from 'node:test';
import { generateConfluenceContent } from '../../src/cli/commands/generate';
import { generateADFString } from '../../src/manuals/adf-generator';
import { generateManual } from '../../src/manuals/generator';
import { parseFixture } from '../fixtures/fixtures';

/**
 * Test nested sub-steps support across all generator formats
 */

test('Markdown generator should handle 2 levels of nested sub-steps', async () => {
  const operation = await parseFixture('nestedSubSteps2Levels');
  const markdown = generateManual(operation);

  // Should contain all step numbering levels
  assert.ok(markdown.includes('Step 1:'), 'Should have top-level step');
  assert.ok(markdown.includes('Step 1a:'), 'Should have first sub-step');
  assert.ok(markdown.includes('Step 1b:'), 'Should have second sub-step');
  assert.ok(
    markdown.includes('Step 1a1:'),
    'Should have nested sub-step (numbers)',
  );
  assert.ok(
    markdown.includes('Step 1a2:'),
    'Should have second nested sub-step',
  );
  assert.ok(
    markdown.includes('Step 1b1:'),
    'Should have nested sub-step under 1b',
  );

  // Verify content
  assert.ok(markdown.includes('Deploy Backend'));
  assert.ok(markdown.includes('Wait for Backend Pods'));
  assert.ok(markdown.includes('Verify Backend Health'));
});

test('Markdown generator should handle 3 levels of nested sub-steps', async () => {
  const operation = await parseFixture('nestedSubSteps3Levels');
  const markdown = generateManual(operation);

  // Should contain all step numbering levels
  assert.ok(markdown.includes('Step 1:'), 'Should have top-level step');
  assert.ok(
    markdown.includes('Step 1a:'),
    'Should have level 1 sub-step (letters)',
  );
  assert.ok(
    markdown.includes('Step 1a1:'),
    'Should have level 2 sub-step (numbers)',
  );
  assert.ok(
    markdown.includes('Step 1a1a:'),
    'Should have level 3 sub-step (letters again)',
  );
  assert.ok(
    markdown.includes('Step 1a1b:'),
    'Should have second level 3 sub-step',
  );

  // Verify section headings work at different levels
  assert.ok(
    markdown.includes('### Database Tier'),
    'Should have section heading for Database Tier',
  );
  assert.ok(
    markdown.includes('### Application Tier'),
    'Should have section heading for Application Tier',
  );

  // Verify PIC information
  assert.ok(markdown.includes('DBA Team'));
  assert.ok(markdown.includes('Backend Team'));
});

test('Markdown generator should handle 4 levels of nested sub-steps', async () => {
  const operation = await parseFixture('nestedSubSteps4Levels');
  const markdown = generateManual(operation);

  // Should contain all 4 levels of numbering
  assert.ok(markdown.includes('Step 1:'), 'Should have level 0');
  assert.ok(markdown.includes('Step 1a:'), 'Should have level 1 (letters)');
  assert.ok(markdown.includes('Step 1a1:'), 'Should have level 2 (numbers)');
  assert.ok(markdown.includes('Step 1a1a:'), 'Should have level 3 (letters)');
  assert.ok(markdown.includes('Step 1a1a1:'), 'Should have level 4 (numbers)');

  // Verify content from deepest level
  assert.ok(markdown.includes('Configure Health Checks'));
  assert.ok(markdown.includes('Verify SSL Configuration'));
});

test('Markdown generator should handle section headings at multiple nesting levels', async () => {
  const operation = await parseFixture('nestedSubStepsWithSections');
  const markdown = generateManual(operation);

  // Verify section headings at different depths
  assert.ok(
    markdown.includes('### Build Phase'),
    'Should have h3 for first level section',
  );
  assert.ok(
    markdown.includes('#### Backend Unit Tests'),
    'Should have h4 for nested section',
  );
  assert.ok(
    markdown.includes('### Deploy Phase'),
    'Should have another h3 section',
  );

  // Verify step numbering continues correctly
  assert.ok(markdown.includes('Step 1:'));
  assert.ok(markdown.includes('Step 1a:'));
  assert.ok(markdown.includes('Step 1a1:'));
  assert.ok(markdown.includes('Step 1a1a:'));
});

test('ADF generator should handle 2 levels of nested sub-steps', async () => {
  const operation = await parseFixture('nestedSubSteps2Levels');
  const adfString = generateADFString(operation);
  const adf = JSON.parse(adfString);

  // Verify it's valid ADF structure
  assert.strictEqual(adf.type, 'doc');
  assert.ok(Array.isArray(adf.content));

  // Verify all step levels are present in content
  const jsonStr = JSON.stringify(adf);
  assert.ok(jsonStr.includes('Step 1:'), 'Should have top-level step');
  assert.ok(jsonStr.includes('Step 1a:'), 'Should have first sub-step');
  assert.ok(jsonStr.includes('Step 1a1:'), 'Should have nested sub-step');
  assert.ok(jsonStr.includes('Deploy Backend'));
  assert.ok(jsonStr.includes('Wait for Backend Pods'));
});

test('ADF generator should handle 3 levels of nested sub-steps', async () => {
  const operation = await parseFixture('nestedSubSteps3Levels');
  const adfString = generateADFString(operation);
  const adf = JSON.parse(adfString);

  const jsonStr = JSON.stringify(adf);
  assert.ok(jsonStr.includes('Step 1:'));
  assert.ok(jsonStr.includes('Step 1a:'));
  assert.ok(jsonStr.includes('Step 1a1:'));
  assert.ok(jsonStr.includes('Step 1a1a:'));
  assert.ok(jsonStr.includes('Database Tier'));
  assert.ok(jsonStr.includes('Application Tier'));
});

test('ADF generator should handle 4 levels of nested sub-steps', async () => {
  const operation = await parseFixture('nestedSubSteps4Levels');
  const adfString = generateADFString(operation);
  const adf = JSON.parse(adfString);

  const jsonStr = JSON.stringify(adf);
  assert.ok(jsonStr.includes('Step 1a1a1:'), 'Should have 4th level numbering');
  assert.ok(jsonStr.includes('Configure Health Checks'));
});

test('Confluence Wiki Markup should handle 2 levels of nested sub-steps', async () => {
  const operation = await parseFixture('nestedSubSteps2Levels');
  const confluence = generateConfluenceContent(operation);

  // Verify all step numbering levels
  assert.ok(confluence.includes('Step 1:'), 'Should have top-level step');
  assert.ok(confluence.includes('Step 1a:'), 'Should have first sub-step');
  assert.ok(confluence.includes('Step 1b:'), 'Should have second sub-step');
  assert.ok(confluence.includes('Step 1a1:'), 'Should have nested sub-step');
  assert.ok(
    confluence.includes('Step 1a2:'),
    'Should have second nested sub-step',
  );

  // Verify Confluence markup format
  assert.ok(confluence.includes('|| Step ||'), 'Should have table header');
  assert.ok(
    confluence.includes('| (*) Step 1a:') ||
      confluence.includes('| (i) Step 1a:'),
    'Should have step with icon',
  );
});

test('Confluence Wiki Markup should handle 3 levels of nested sub-steps', async () => {
  const operation = await parseFixture('nestedSubSteps3Levels');
  const confluence = generateConfluenceContent(operation);

  // Verify all levels
  assert.ok(confluence.includes('Step 1:'));
  assert.ok(confluence.includes('Step 1a:'));
  assert.ok(confluence.includes('Step 1a1:'));
  assert.ok(confluence.includes('Step 1a1a:'));

  // Verify section headings in Confluence format
  assert.ok(
    confluence.includes('h4. Database Tier'),
    'Should have h4 section heading',
  );
  assert.ok(
    confluence.includes('h4. Application Tier'),
    'Should have h4 section heading',
  );

  // Verify PIC information
  assert.ok(confluence.includes('(i) PIC: DBA Team'));
  assert.ok(confluence.includes('(i) PIC: Backend Team'));
});

test('Confluence Wiki Markup should handle 4 levels of nested sub-steps', async () => {
  const operation = await parseFixture('nestedSubSteps4Levels');
  const confluence = generateConfluenceContent(operation);

  // Verify all 4 levels of numbering
  assert.ok(confluence.includes('Step 1:'));
  assert.ok(confluence.includes('Step 1a:'));
  assert.ok(confluence.includes('Step 1a1:'));
  assert.ok(confluence.includes('Step 1a1a:'));
  assert.ok(
    confluence.includes('Step 1a1a1:'),
    'Should have 4th level numbering',
  );

  // Verify deep content
  assert.ok(confluence.includes('Configure Health Checks'));
  assert.ok(confluence.includes('Verify SSL Configuration'));
});

test('Confluence Wiki Markup should handle section headings at multiple nesting levels', async () => {
  const operation = await parseFixture('nestedSubStepsWithSections');
  const confluence = generateConfluenceContent(operation);

  // Verify section headings with appropriate h-levels
  assert.ok(
    confluence.includes('h4. Build Phase'),
    'Should have h4 for first level section',
  );
  assert.ok(
    confluence.includes('h5. Backend Unit Tests'),
    'Should have h5 for nested section',
  );
  assert.ok(
    confluence.includes('h4. Deploy Phase'),
    'Should have another h4 section',
  );

  // Verify PIC in sections
  assert.ok(confluence.includes('(i) PIC: Build Team'));
  assert.ok(confluence.includes('(i) PIC: DevOps Team'));
});

test('All generators should produce consistent numbering for nested sub-steps', async () => {
  const operation = await parseFixture('nestedSubSteps3Levels');
  const markdown = generateManual(operation);
  const adfString = generateADFString(operation);
  const confluence = generateConfluenceContent(operation);

  // All formats should have the same step numbering
  const stepNumbers = ['Step 1:', 'Step 1a:', 'Step 1a1:', 'Step 1a1a:'];

  for (const stepNum of stepNumbers) {
    assert.ok(markdown.includes(stepNum), `Markdown should have ${stepNum}`);
    assert.ok(adfString.includes(stepNum), `ADF should have ${stepNum}`);
    assert.ok(
      confluence.includes(stepNum),
      `Confluence should have ${stepNum}`,
    );
  }
});
