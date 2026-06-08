import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  diffEnvironments,
  formatDiffAsMarkdown,
  formatDiffAsText,
} from '../../src/lib/environment-diff';
import { parseFixture } from '../fixtures/fixtures';

describe('Environment Diff', () => {
  describe('diffEnvironments', () => {
    it('should report steps that only apply to one environment via `when`', async () => {
      const operation = await parseFixture('whenAndVariants');
      const report = diffEnvironments(operation, 'staging', 'prod');

      const monitoring = report.entries.find(
        (entry) => entry.name === 'Enable production monitoring',
      );
      assert.ok(monitoring, 'expected an entry for the prod-only step');
      assert.strictEqual(monitoring?.status, 'envB-only');
      assert.deepStrictEqual(monitoring?.fieldDiffs, []);

      const integrationTests = report.entries.find(
        (entry) => entry.name === 'Run integration tests',
      );
      assert.ok(
        integrationTests,
        'expected an entry for the staging-only step',
      );
      assert.strictEqual(integrationTests?.status, 'envA-only');
    });

    it('should report resolved field-level differences from `variants`', async () => {
      const operation = await parseFixture('whenAndVariants');
      const report = diffEnvironments(operation, 'staging', 'prod');

      const deploy = report.entries.find(
        (entry) => entry.name === 'Deploy application',
      );
      assert.ok(deploy, 'expected an entry for the step with variants');
      assert.strictEqual(deploy?.status, 'both');

      const command = deploy?.fieldDiffs.find((d) => d.field === 'command');
      assert.strictEqual(
        command?.valueA,
        'kubectl apply -f deployment-staging.yaml --replicas=2',
      );
      assert.strictEqual(
        command?.valueB,
        'kubectl apply -f deployment.yaml --replicas=10 --strategy=blue-green',
      );

      const pic = deploy?.fieldDiffs.find((d) => d.field === 'pic');
      assert.strictEqual(pic?.valueA, undefined);
      assert.strictEqual(pic?.valueB, 'senior-sre@example.com');
    });

    it('should treat env-keyed evidence.results as expected and not flag it', async () => {
      const operation = await parseFixture('whenAndVariants');
      const report = diffEnvironments(operation, 'staging', 'prod');

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
      assert.strictEqual(evidenceRequired?.valueA, undefined);
      assert.strictEqual(evidenceRequired?.valueB, 'true');
    });

    it('should report no differences when comparing an environment to itself', async () => {
      const operation = await parseFixture('whenAndVariants');
      const report = diffEnvironments(operation, 'staging', 'staging');

      assert.deepStrictEqual(report.entries, []);
      assert.strictEqual(report.identicalCount, report.totalSteps);
    });

    it('should throw a clear error for an unknown environment', async () => {
      const operation = await parseFixture('whenAndVariants');

      assert.throws(
        () => diffEnvironments(operation, 'staging', 'bogus'),
        /Environment not found in operation: bogus/,
      );
    });
  });

  describe('formatDiffAsText', () => {
    it('should render a readable terminal report with a summary line', async () => {
      const operation = await parseFixture('whenAndVariants');
      const report = diffEnvironments(operation, 'staging', 'prod');
      const text = formatDiffAsText(report);

      assert.match(text, /Comparing staging vs prod/);
      assert.match(text, /Step \d+: Deploy application/);
      assert.match(text, /command:/);
      assert.match(text, /Summary: \d+ steps compared/);
    });
  });

  describe('formatDiffAsMarkdown', () => {
    it('should render a Markdown report with per-step tables', async () => {
      const operation = await parseFixture('whenAndVariants');
      const report = diffEnvironments(operation, 'staging', 'prod');
      const markdown = formatDiffAsMarkdown(report);

      assert.match(markdown, /# Environment Diff Report: staging vs prod/);
      assert.match(markdown, /\| Field \| staging \| prod \|/);
      assert.match(markdown, /Only present in: \*\*prod\*\*/);
      assert.match(markdown, /## Summary/);
    });
  });
});
