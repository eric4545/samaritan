import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  buildUnifiedDiffLines,
  diffEnvironments,
  formatDiffAsMarkdown,
  formatDiffAsText,
} from '../../src/lib/environment-diff';
import { parseFixture } from '../fixtures/fixtures';

describe('Environment Diff', () => {
  describe('diffEnvironments', () => {
    it('should report steps that only apply to one environment via `when`', async () => {
      const operation = await parseFixture('whenAndVariants');
      const report = diffEnvironments(operation, ['staging', 'prod']);

      const monitoring = report.entries.find(
        (entry) => entry.name === 'Enable production monitoring',
      );
      assert.ok(monitoring, 'expected an entry for the prod-only step');
      assert.deepStrictEqual(monitoring?.presentIn, ['prod']);
      assert.deepStrictEqual(monitoring?.absentIn, ['staging']);
      assert.deepStrictEqual(monitoring?.fieldDiffs, []);

      const integrationTests = report.entries.find(
        (entry) => entry.name === 'Run integration tests',
      );
      assert.ok(
        integrationTests,
        'expected an entry for the staging-only step',
      );
      assert.deepStrictEqual(integrationTests?.presentIn, ['staging']);
      assert.deepStrictEqual(integrationTests?.absentIn, ['prod']);
    });

    it('should report resolved field-level differences from `variants`', async () => {
      const operation = await parseFixture('whenAndVariants');
      const report = diffEnvironments(operation, ['staging', 'prod']);

      const deploy = report.entries.find(
        (entry) => entry.name === 'Deploy application',
      );
      assert.ok(deploy, 'expected an entry for the step with variants');
      assert.deepStrictEqual(deploy?.absentIn, []);

      const command = deploy?.fieldDiffs.find((d) => d.field === 'command');
      assert.strictEqual(
        command?.values.staging,
        'kubectl apply -f deployment-staging.yaml --replicas=2',
      );
      assert.strictEqual(
        command?.values.prod,
        'kubectl apply -f deployment.yaml --replicas=10 --strategy=blue-green',
      );

      const pic = deploy?.fieldDiffs.find((d) => d.field === 'pic');
      assert.strictEqual(pic?.values.staging, undefined);
      assert.strictEqual(pic?.values.prod, 'senior-sre@example.com');
    });

    it('should treat env-keyed evidence.results as expected and not flag it', async () => {
      const operation = await parseFixture('whenAndVariants');
      const report = diffEnvironments(operation, ['staging', 'prod']);

      const verify = report.entries.find(
        (entry) => entry.name === 'Verify deployment',
      );
      assert.ok(verify);
      assert.ok(
        !verify?.fieldDiffs.some((d) => d.field.startsWith('evidence.results')),
        'evidence.results should be excluded from comparison',
      );

      const evidenceRequired = verify?.fieldDiffs.find(
        (d) => d.field === 'evidence.required',
      );
      assert.strictEqual(evidenceRequired?.values.staging, undefined);
      assert.strictEqual(evidenceRequired?.values.prod, 'true');
    });

    it('should report no differences when comparing an environment to itself', async () => {
      const operation = await parseFixture('whenAndVariants');
      const report = diffEnvironments(operation, ['staging', 'staging']);

      assert.deepStrictEqual(report.entries, []);
      assert.strictEqual(report.identicalCount, report.totalSteps);
    });

    it('should throw a clear error for an unknown environment', async () => {
      const operation = await parseFixture('whenAndVariants');

      assert.throws(
        () => diffEnvironments(operation, ['staging', 'bogus']),
        /Environment not found in operation: bogus/,
      );
    });

    it('should throw a clear error when fewer than two environments are given', async () => {
      const operation = await parseFixture('whenAndVariants');

      assert.throws(
        () => diffEnvironments(operation, ['staging']),
        /At least two environments are required/,
      );
    });

    it('should compare more than two environments at once, anchored on the first', async () => {
      const operation = await parseFixture('whenAndVariants');
      const report = diffEnvironments(operation, [
        'staging',
        'preprod',
        'prod',
      ]);

      assert.deepStrictEqual(report.environments, [
        'staging',
        'preprod',
        'prod',
      ]);

      const verify = report.entries.find(
        (entry) => entry.name === 'Verify deployment',
      );
      assert.ok(verify, 'expected an entry comparing all three environments');
      assert.deepStrictEqual(verify?.absentIn, []);

      const pic = verify?.fieldDiffs.find((d) => d.field === 'pic');
      assert.strictEqual(pic?.values.staging, 'junior-dev@example.com');
      assert.strictEqual(pic?.values.preprod, 'mid-dev@example.com');
      assert.strictEqual(pic?.values.prod, 'senior-sre@example.com');

      const migration = report.entries.find(
        (entry) => entry.name === 'Database migration',
      );
      assert.ok(migration, 'expected an entry for the preprod/prod-only step');
      assert.deepStrictEqual(migration?.presentIn, ['preprod', 'prod']);
      assert.deepStrictEqual(migration?.absentIn, ['staging']);
    });
  });

  describe('buildUnifiedDiffLines', () => {
    it('should render every line of multi-line values, not just the first', () => {
      const lines = buildUnifiedDiffLines(
        'staging',
        'Deploy to staging\n\nUse rolling update strategy',
        'prod',
        'Deploy to production with extra caution\n\nUse blue-green deployment strategy',
      );
      const text = lines.join('\n');

      assert.match(text, /^--- staging$/m);
      assert.match(text, /^\+\+\+ prod$/m);
      assert.match(text, /^-Deploy to staging$/m);
      assert.match(text, /^-Use rolling update strategy$/m);
      assert.match(text, /^\+Deploy to production with extra caution$/m);
      assert.match(text, /^\+Use blue-green deployment strategy$/m);
    });

    it('should mark a value that is absent on one side as not set', () => {
      const lines = buildUnifiedDiffLines(
        'staging',
        undefined,
        'prod',
        'senior-sre@example.com',
      );
      const text = lines.join('\n');

      assert.match(text, /^-\(not set\)$/m);
      assert.match(text, /^\+senior-sre@example\.com$/m);
    });
  });

  describe('formatDiffAsText', () => {
    it('should render a readable terminal report with a summary line', async () => {
      const operation = await parseFixture('whenAndVariants');
      const report = diffEnvironments(operation, ['staging', 'prod']);
      const text = formatDiffAsText(report);

      assert.match(text, /Comparing staging, prod \(anchor: staging\)/);
      assert.match(text, /Step \d+: Deploy application/);
      assert.match(text, /command:/);
      assert.match(text, /^\s*--- staging$/m);
      assert.match(text, /^\s*\+\+\+ prod$/m);
      assert.match(text, /Summary: \d+ steps compared/);
    });

    it('should render unified diffs against the anchor for every other environment', async () => {
      const operation = await parseFixture('whenAndVariants');
      const report = diffEnvironments(operation, [
        'staging',
        'preprod',
        'prod',
      ]);
      const text = formatDiffAsText(report);

      assert.match(
        text,
        /Comparing staging, preprod, prod \(anchor: staging\)/,
      );
      assert.match(text, /^\s*--- staging$/m);
      assert.match(text, /^\s*\+\+\+ preprod$/m);
      assert.match(text, /^\s*\+\+\+ prod$/m);
    });
  });

  describe('formatDiffAsMarkdown', () => {
    it('should render a Markdown report with fenced diff blocks', async () => {
      const operation = await parseFixture('whenAndVariants');
      const report = diffEnvironments(operation, ['staging', 'prod']);
      const markdown = formatDiffAsMarkdown(report);

      assert.match(markdown, /# Environment Diff Report: staging vs prod/);
      assert.match(markdown, /\*\*Comparison anchor:\*\* staging/);
      assert.match(markdown, /```diff/);
      assert.match(markdown, /^--- staging$/m);
      assert.match(markdown, /^\+\+\+ prod$/m);
      assert.match(
        markdown,
        /Present in: \*\*prod\*\* — absent in: \*\*staging\*\*/,
      );
      assert.match(markdown, /## Summary/);
    });
  });
});
