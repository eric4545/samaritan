import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { after, describe, it } from 'node:test';
import { getFixturePath } from '../fixtures/fixtures';

describe('Diff Command', () => {
  const fixturePath = getFixturePath('whenAndVariants');
  const outputPath = '/tmp/samaritan-test-diff-report.md';

  after(() => {
    if (existsSync(outputPath)) {
      unlinkSync(outputPath);
    }
  });

  it('should print a terminal report comparing two environments', () => {
    const result = execSync(
      `npx tsx src/cli/index.ts diff ${fixturePath} staging prod`,
      { cwd: process.cwd(), encoding: 'utf-8' },
    );

    assert.ok(result.includes('Comparing staging, prod (anchor: staging)'));
    assert.ok(result.includes('Deploy application'));
    assert.ok(result.includes('command:'));
    assert.ok(result.includes('--- staging'));
    assert.ok(result.includes('+++ prod'));
    assert.ok(result.includes('Summary:'));
  });

  it('should print a terminal report comparing more than two environments', () => {
    const result = execSync(
      `npx tsx src/cli/index.ts diff ${fixturePath} staging preprod prod`,
      { cwd: process.cwd(), encoding: 'utf-8' },
    );

    assert.ok(
      result.includes('Comparing staging, preprod, prod (anchor: staging)'),
    );
    assert.ok(result.includes('--- staging'));
    assert.ok(result.includes('+++ preprod'));
    assert.ok(result.includes('+++ prod'));
  });

  it('should report 0 differences when comparing an environment to itself', () => {
    const result = execSync(
      `npx tsx src/cli/index.ts diff ${fixturePath} staging staging`,
      { cwd: process.cwd(), encoding: 'utf-8' },
    );

    assert.ok(result.includes('Summary: 3 steps compared'));
    assert.ok(result.includes('0 differ'));
  });

  it('should write a Markdown report file with --output', () => {
    const result = execSync(
      `npx tsx src/cli/index.ts diff ${fixturePath} staging prod --output ${outputPath}`,
      { cwd: process.cwd(), encoding: 'utf-8' },
    );

    assert.ok(result.includes('Diff report written to'));
    assert.ok(existsSync(outputPath), 'Markdown report file should exist');

    const content = readFileSync(outputPath, 'utf-8');
    assert.ok(content.startsWith('# Environment Diff Report: staging vs prod'));
    assert.ok(content.includes('**Comparison anchor:** staging'));
    assert.ok(content.includes('```diff'));
    assert.ok(content.includes('--- staging'));
    assert.ok(content.includes('+++ prod'));
  });

  it('should fail with a clear error for an unknown environment', () => {
    assert.throws(() => {
      execSync(`npx tsx src/cli/index.ts diff ${fixturePath} staging bogus`, {
        cwd: process.cwd(),
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    }, /Environment not found in operation: bogus/);
  });

  it('should fail with a clear error when fewer than two environments are given', () => {
    assert.throws(() => {
      execSync(`npx tsx src/cli/index.ts diff ${fixturePath} staging`, {
        cwd: process.cwd(),
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    }, /at least two environments are required/);
  });
});
