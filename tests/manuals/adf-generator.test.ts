import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  generateADF,
  generateADFString,
} from '../../src/manuals/adf-generator';
import type { Operation } from '../../src/models/operation';
import {
  deploymentOperation,
  operationWithSubSteps,
} from '../fixtures/operations';

describe('ADF Generator', () => {
  // Use shared fixture as the primary test operation
  const mockOperation = deploymentOperation;

  it('should generate valid ADF structure', () => {
    const adf = generateADF(mockOperation);

    // Check basic structure
    assert.strictEqual(typeof adf, 'object', 'ADF should be an object');
    assert.ok('type' in adf, 'ADF should have a type property');
    assert.strictEqual((adf as any).type, 'doc', 'ADF type should be doc');
    assert.ok('content' in adf, 'ADF should have content');
    assert.ok(
      Array.isArray((adf as any).content),
      'Content should be an array',
    );
  });

  it('should include operation title and description', () => {
    const adf = generateADF(mockOperation);
    const content = (adf as any).content;

    // Find title heading
    const titleHeading = content.find(
      (node: any) => node.type === 'heading' && node.attrs?.level === 1,
    );
    assert.ok(titleHeading, 'Should have a level 1 heading for title');

    // Check if title contains operation name and version
    const titleText = titleHeading.content[0].text;
    assert.ok(
      titleText.includes('Deploy Web Server'),
      'Title should include operation name',
    );
    assert.ok(titleText.includes('v1.1.0'), 'Title should include version');
  });

  it('should include environments table', () => {
    const adf = generateADF(mockOperation);
    const content = (adf as any).content;

    // Find table nodes
    const tables = content.filter((node: any) => node.type === 'table');
    assert.ok(tables.length > 0, 'Should have at least one table');

    // Check if environments table exists (should be first table)
    const envTable = tables[0];
    assert.ok(envTable, 'Should have environments table');

    // Verify table has header row and data rows
    assert.ok(
      envTable.content && envTable.content.length > 0,
      'Table should have rows',
    );
  });

  it('should include steps grouped by phase', () => {
    const adf = generateADF(mockOperation);
    const content = (adf as any).content;

    // Find headings for phases
    const headings = content.filter(
      (node: any) => node.type === 'heading' && node.attrs?.level === 2,
    );

    const phaseHeadings = headings.filter((h: any) => {
      const text = h.content?.[0]?.text || '';
      return (
        text.includes('Pre-Flight') ||
        text.includes('Flight Phase') ||
        text.includes('Post-Flight')
      );
    });

    assert.ok(phaseHeadings.length > 0, 'Should have phase headings');

    // Check for pre-flight phase (we have 1 preflight step)
    const preflightHeading = phaseHeadings.find((h: any) =>
      h.content?.[0]?.text?.includes('Pre-Flight'),
    );
    assert.ok(preflightHeading, 'Should have pre-flight phase heading');

    // Check for flight phase (we have 2 flight steps)
    const flightHeading = phaseHeadings.find((h: any) =>
      h.content?.[0]?.text?.includes('Flight Phase'),
    );
    assert.ok(flightHeading, 'Should have flight phase heading');

    // Check for post-flight phase (we have 1 postflight step)
    const postflightHeading = phaseHeadings.find((h: any) =>
      h.content?.[0]?.text?.includes('Post-Flight'),
    );
    assert.ok(postflightHeading, 'Should have post-flight phase heading');
  });

  it('should include rollback procedures for steps with rollback', () => {
    const adf = generateADF(mockOperation);
    const content = (adf as any).content;

    // Find rollback section heading
    const rollbackHeading = content.find(
      (node: any) =>
        node.type === 'heading' &&
        node.attrs?.level === 2 &&
        node.content?.[0]?.text?.includes('Rollback'),
    );

    assert.ok(rollbackHeading, 'Should have rollback procedures section');
  });

  it('should generate valid JSON string', () => {
    const adfString = generateADFString(mockOperation);

    assert.strictEqual(typeof adfString, 'string', 'Should return a string');
    assert.doesNotThrow(() => {
      JSON.parse(adfString);
    }, 'Should be valid JSON');

    const parsed = JSON.parse(adfString);
    assert.strictEqual(parsed.type, 'doc', 'Parsed JSON should be a doc');
  });

  it('should filter by target environment', () => {
    const adf = generateADF(mockOperation, undefined, 'staging');
    const content = (adf as any).content;

    // Find environments table
    const tables = content.filter((node: any) => node.type === 'table');
    const envTable = tables[0];

    // Should only have header row + 1 data row (for staging)
    assert.strictEqual(
      envTable.content.length,
      2,
      'Should have header + 1 environment row',
    );
  });

  it('should throw error for invalid environment', () => {
    assert.throws(
      () => {
        generateADF(mockOperation, undefined, 'invalid-env');
      },
      /Environment 'invalid-env' not found/,
      'Should throw error for invalid environment',
    );
  });

  it('should resolve variables when resolveVariables is true', () => {
    const adfString = generateADFString(
      mockOperation,
      undefined,
      undefined,
      true,
    );
    const _adf = JSON.parse(adfString);

    // Check that variables are resolved (not containing ${REPLICAS})
    const hasUnresolvedVar = adfString.includes('${REPLICAS}');
    const hasResolvedVar =
      adfString.includes('--replicas=2') || adfString.includes('--replicas=5');

    assert.ok(
      !hasUnresolvedVar || hasResolvedVar,
      `Should have resolved REPLICAS variable. Has unresolved: ${hasUnresolvedVar}, Has resolved: ${hasResolvedVar}`,
    );
  });

  it('should include step metadata (PIC, timeline, ticket)', () => {
    const adfString = generateADFString(mockOperation);

    // Check for PIC
    assert.ok(adfString.includes('john.doe'), 'Should include PIC');

    // Check for timeline
    assert.ok(
      adfString.includes('2024-01-15 10:00'),
      'Should include timeline',
    );

    // Check for ticket
    assert.ok(
      adfString.includes('JIRA-123'),
      'Should include ticket reference',
    );
  });

  it('should handle operations with dependencies', () => {
    const opWithDeps: Operation = {
      ...mockOperation,
      needs: ['setup-infrastructure', 'configure-network'],
    };

    const adf = generateADF(opWithDeps);
    const content = (adf as any).content;

    // Find dependencies heading
    const depsHeading = content.find(
      (node: any) =>
        node.type === 'heading' &&
        node.content?.[0]?.text?.includes('Dependencies'),
    );

    assert.ok(depsHeading, 'Should have dependencies section');

    // Check for bullet list with dependencies
    const bulletLists = content.filter(
      (node: any) => node.type === 'bulletList',
    );
    assert.ok(bulletLists.length > 0, 'Should have bullet lists');
  });

  it('should include metadata panel when metadata is provided', () => {
    const metadata = {
      source_file: '/ops/deployment.yaml',
      operation_id: 'test-deployment',
      operation_version: '1.0.0',
      target_environment: 'staging',
      generated_at: '2024-01-15T10:00:00Z',
      git_sha: 'abc123def456',
      git_branch: 'main',
      git_short_sha: 'abc123d',
      git_author: 'test-author',
      git_date: '2024-01-15',
      git_message: 'test commit',
      git_dirty: false,
      generator_version: '1.0.0',
    };

    const adf = generateADF(mockOperation, metadata);
    const content = (adf as any).content;

    // Find info panel
    const panels = content.filter((node: any) => node.type === 'panel');
    assert.ok(panels.length > 0, 'Should have at least one panel');

    // Check if metadata is in the panel
    const adfString = JSON.stringify(adf);
    assert.ok(adfString.includes('abc123def456'), 'Should include git hash');
    assert.ok(adfString.includes('staging'), 'Should include environment');
  });

  it('should handle sub-steps correctly', () => {
    // Use shared fixture with sub-steps
    const adfString = generateADFString(operationWithSubSteps);

    // Check for substep identifiers (1a, 1b)
    assert.ok(adfString.includes('Sub Step 1'), 'Should include substep 1');
    assert.ok(adfString.includes('Sub Step 2'), 'Should include substep 2');
  });

  it('should render overview section with flexible metadata fields', async () => {
    const { parseFixture } = await import('../fixtures/fixtures');
    const operation = await parseFixture('withOverview');

    const adf = generateADF(operation);
    const content = (adf as any).content;

    // Find Overview heading
    const overviewHeading = content.find(
      (node: any) =>
        node.type === 'heading' &&
        node.attrs?.level === 2 &&
        node.content?.[0]?.text === 'Overview',
    );

    assert.ok(overviewHeading, 'Should have Overview section heading');

    // Find overview table (should be right after the heading)
    const overviewHeadingIndex = content.indexOf(overviewHeading);
    const overviewTable = content[overviewHeadingIndex + 1];

    assert.strictEqual(
      overviewTable?.type,
      'table',
      'Should have overview table after heading',
    );

    // Verify table has 2 columns (Item | Specification)
    const headerRow = overviewTable.content[0];
    assert.strictEqual(
      headerRow.content.length,
      2,
      'Overview table should have 2 columns',
    );

    // Verify overview data is present
    const adfString = generateADFString(operation);
    assert.ok(
      adfString.includes('Release Date'),
      'Should include Release Date',
    );
    assert.ok(
      adfString.includes('23 Jul 2025'),
      'Should include Release Date value',
    );
    assert.ok(
      adfString.includes('Release Notes'),
      'Should include Release Notes',
    );
    assert.ok(
      adfString.includes('INPDRP-2489'),
      'Should include Release Ticket value',
    );
    assert.ok(
      adfString.includes('Manual Status'),
      'Should include Manual Status',
    );
    assert.ok(adfString.includes('APPROVED'), 'Should include APPROVED status');
  });
});
