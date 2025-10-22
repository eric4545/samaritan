import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { after, describe, it } from 'node:test';
import { getFixturePath } from '../fixtures/fixtures';

describe('Generate Command', () => {
  const scheduleOutputPath = '/tmp/samaritan-test-schedule.md';
  const confluenceOutputPath = '/tmp/samaritan-test-confluence.confluence';

  after(() => {
    // Cleanup test files
    if (existsSync(scheduleOutputPath)) {
      unlinkSync(scheduleOutputPath);
    }
    if (existsSync(confluenceOutputPath)) {
      unlinkSync(confluenceOutputPath);
    }
  });

  describe('Schedule Generation', () => {
    it('should generate schedule with timeline data (await fix regression test)', () => {
      // Regression test for missing await bug
      // Bug: parseOperation was not awaited, causing "Cannot read properties of undefined (reading 'forEach')"
      const fixtureFile = getFixturePath('ganttTimeline');

      // Execute schedule generation command
      const result = execSync(
        `npx tsx src/cli/index.ts generate schedule ${fixtureFile} --output ${scheduleOutputPath}`,
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );

      // Verify success message
      assert.ok(
        result.includes('Generating schedule for'),
        'Should show generating message',
      );
      assert.ok(
        result.includes('Schedule generated'),
        'Should show success message',
      );

      // Verify output file exists
      assert.ok(existsSync(scheduleOutputPath), 'Schedule file should exist');

      // Verify file content
      const content = readFileSync(scheduleOutputPath, 'utf-8');

      // Check for schedule header
      assert.ok(
        content.includes('# Schedule for:'),
        'Should have schedule header',
      );

      // Check for timeline steps (from gantt-timeline.yaml fixture)
      assert.ok(
        content.includes('Pre-deployment Check'),
        'Should include first step',
      );
      assert.ok(
        content.includes('Deploy Backend'),
        'Should include second step',
      );

      // Check for timeline data
      assert.ok(
        content.includes('2024-01-15 09:00'),
        'Should include start time',
      );
      assert.ok(content.includes('30m'), 'Should include duration');

      // Check for table structure
      assert.ok(
        content.includes('| Step Name | Phase | Start Time | Duration | PIC |'),
        'Should have table header',
      );
    });

    it('should handle operations without timeline data gracefully', () => {
      // Test with operation that has no timeline data
      const fixtureFile = getFixturePath('minimal');

      // Execute schedule generation command
      const result = execSync(
        `npx tsx src/cli/index.ts generate schedule ${fixtureFile} --output ${scheduleOutputPath}`,
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );

      // Verify success message
      assert.ok(result.includes('Schedule generated'), 'Should succeed');

      // Verify output file content
      const content = readFileSync(scheduleOutputPath, 'utf-8');
      assert.ok(
        content.includes('No steps with timeline information found'),
        'Should indicate no timeline data',
      );
    });
  });

  describe('Rollback Positioning', () => {
    it('should render rollbacks only at the end, not inline (rollback positioning regression test)', () => {
      // Regression test for inline rollback rendering bug
      // Bug: Rollbacks were rendered both inline (after each step) AND at the end
      // Expected: Rollbacks should only appear in the aggregate section at the end
      const fixtureFile = getFixturePath('globalRollback');

      // Execute confluence generation command
      const result = execSync(
        `npx tsx src/cli/index.ts generate manual ${fixtureFile} --format confluence --output ${confluenceOutputPath}`,
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );

      // Verify success
      assert.ok(
        result.includes('Confluence manual generated'),
        'Should generate successfully',
      );

      // Read generated content
      const content = readFileSync(confluenceOutputPath, 'utf-8');

      // Find all rollback headings
      const h2RollbackMatches = content.match(/h2\. \(<\) Rollback/g) || [];
      const h3RollbackMatches =
        content.match(/h3\. \(<\) Rollback for Step/g) || [];

      // Verify: Should have ONE h2 rollback section (aggregate at end)
      assert.strictEqual(
        h2RollbackMatches.length,
        1,
        'Should have exactly one h2 Rollback Procedures section (at the end)',
      );

      // Verify: Should have NO h3 inline rollback sections
      assert.strictEqual(
        h3RollbackMatches.length,
        0,
        'Should NOT have inline h3 rollback sections (they should be at the end only)',
      );

      // Verify: Rollback section is near the end (before footer)
      const rollbackSectionIndex = content.indexOf(
        'h2. (<) Rollback Procedures',
      );
      const footerIndex = content.indexOf('panel:title=Generated Information');

      assert.ok(rollbackSectionIndex > 0, 'Should have rollback section');
      assert.ok(
        footerIndex > rollbackSectionIndex,
        'Rollback section should be before footer',
      );

      // Verify: No inline rollback tables between steps
      const stepTableStart = content.indexOf('|| Step ||');
      const rollbackTableStart = content.indexOf(
        '|| Step || staging || production ||',
        stepTableStart + 10,
      );

      // The rollback table should only appear in the rollback section, not inline
      if (rollbackTableStart > 0) {
        assert.ok(
          rollbackTableStart > rollbackSectionIndex,
          'Rollback table should only appear in the rollback section at the end',
        );
      }
    });

    it('should include global rollback plan in the aggregate section', () => {
      const fixtureFile = getFixturePath('globalRollback');

      execSync(
        `npx tsx src/cli/index.ts generate manual ${fixtureFile} --format confluence --output ${confluenceOutputPath}`,
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );

      const content = readFileSync(confluenceOutputPath, 'utf-8');

      // Verify rollback section exists
      const rollbackSectionStart = content.indexOf(
        'h2. (<) Rollback Procedures',
      );
      assert.ok(
        rollbackSectionStart > 0,
        'Should have rollback procedures section',
      );

      const rollbackSection = content.substring(rollbackSectionStart);

      // Check for global rollback plan
      assert.ok(
        rollbackSection.includes('Global Rollback Plan'),
        'Should have Global Rollback Plan section',
      );

      // Verify it has rollback conditions
      assert.ok(
        rollbackSection.includes('health_check_failure'),
        'Should include rollback conditions',
      );

      // Verify it's in a table format
      assert.ok(
        rollbackSection.includes('|| Step ||'),
        'Should have rollback table header',
      );
    });
  });
});
