import assert from 'node:assert';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { after, describe, it } from 'node:test';
import { renderExpectDescription } from '../../src/lib/assertions';
import { getFixturePath } from '../fixtures/fixtures';

describe('renderExpectDescription', () => {
  it('returns a plain string as-is', () => {
    assert.strictEqual(renderExpectDescription('pod is running'), 'pod is running');
  });

  it('renders contains without doubled/escaped quotes', () => {
    const result = renderExpectDescription({ contains: '"Status": "Success"' });
    assert.ok(!result.includes('""'), 'Should not have doubled quotes');
    assert.ok(result.includes('contains'), 'Should mention contains');
    assert.ok(result.includes('Status'), 'Should include the key text');
  });

  it('renders matches with human-readable alternatives', () => {
    const result = renderExpectDescription({ matches: '"Status":\\s*"(Success|Pending)"' });
    assert.ok(result.includes('Success'), 'Should include first alternative');
    assert.ok(result.includes('Pending'), 'Should include second alternative');
    assert.ok(result.includes('or'), 'Should join alternatives with "or"');
    assert.ok(!result.includes('\\s*'), 'Should not include raw regex metacharacters');
  });

  it('renders equals without surrounding quotes', () => {
    const result = renderExpectDescription({ equals: 'ready' });
    assert.strictEqual(result, 'equals ready');
  });

  it('renders not_empty', () => {
    const result = renderExpectDescription({ not_empty: true });
    assert.ok(result.includes('not empty'));
  });

  it('renders numeric_gte with ≥ symbol', () => {
    const result = renderExpectDescription({ numeric_gte: 5 });
    assert.ok(result.includes('≥ 5'));
  });

  it('renders numeric_lte with ≤ symbol', () => {
    const result = renderExpectDescription({ numeric_lte: 100 });
    assert.ok(result.includes('≤ 100'));
  });

  it('renders line_count_gte as plain English', () => {
    const result = renderExpectDescription({ line_count_gte: 3 });
    assert.ok(result.includes('3'), 'Should include count');
    assert.ok(!result.includes('>='), 'Should not use programming operator');
  });
});

describe('CLI Flag Compatibility', () => {
  const outputPath = '/tmp/samaritan-test-cli-flags-manual.md';

  after(() => {
    if (existsSync(outputPath)) unlinkSync(outputPath);
  });

  describe('validate command: --environment and --env aliases', () => {
    it('accepts --environment flag (primary)', () => {
      const fixture = getFixturePath('minimal');
      const result = execSync(
        `node_modules/.bin/tsx src/cli/index.ts validate ${fixture} --environment default`,
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      assert.ok(result.includes('YAML syntax valid'), 'Should run validation with --environment');
    });

    it('accepts --env flag (alias)', () => {
      const fixture = getFixturePath('minimal');
      const result = execSync(
        `node_modules/.bin/tsx src/cli/index.ts validate ${fixture} --env default`,
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      assert.ok(result.includes('YAML syntax valid'), 'Should run validation with --env alias');
    });

    it('accepts -e short flag', () => {
      const fixture = getFixturePath('minimal');
      const result = execSync(
        `node_modules/.bin/tsx src/cli/index.ts validate ${fixture} -e default`,
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      assert.ok(result.includes('YAML syntax valid'), 'Should run validation with -e');
    });
  });

  describe('run command: --environment and --env aliases', () => {
    it('accepts --environment flag without flag-parsing error', () => {
      const fixture = getFixturePath('minimal');
      const result = spawnSync(
        'node_modules/.bin/tsx',
        ['src/cli/index.ts', 'run', fixture, '--environment', 'default', '--dry-run'],
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      // Should not complain about missing --environment flag
      assert.ok(!result.stderr.includes('required option'), 'Should not report missing required option');
    });

    it('accepts --env flag (alias) without flag-parsing error', () => {
      const fixture = getFixturePath('minimal');
      const result = spawnSync(
        'node_modules/.bin/tsx',
        ['src/cli/index.ts', 'run', fixture, '--env', 'default', '--dry-run'],
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      assert.ok(!result.stderr.includes('required option'), 'Should accept --env alias');
    });

    it('errors cleanly when no env flag is provided', () => {
      const fixture = getFixturePath('minimal');
      const result = spawnSync(
        'node_modules/.bin/tsx',
        ['src/cli/index.ts', 'run', fixture, '--dry-run'],
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      assert.notStrictEqual(result.status, 0, 'Should exit non-zero');
      const combined = (result.stdout || '') + (result.stderr || '');
      assert.ok(combined.includes('environment') || combined.includes('env'), 'Should mention the missing flag');
    });
  });

  describe('generate manual --env/--environment: single-env heading format', () => {
    it('generates heading-based manual (not table) when --environment is specified', () => {
      const fixture = getFixturePath('minimal');
      execSync(
        `node_modules/.bin/tsx src/cli/index.ts generate manual ${fixture} --environment default --output ${outputPath}`,
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      assert.ok(existsSync(outputPath), 'Output file should exist');
      const content = readFileSync(outputPath, 'utf-8');
      assert.ok(content.includes('## Step'), 'Should use heading-based format');
      assert.ok(!content.includes('| Step |'), 'Should not use table format');
    });

    it('generates same heading-based manual with --env alias', () => {
      const fixture = getFixturePath('minimal');
      execSync(
        `node_modules/.bin/tsx src/cli/index.ts generate manual ${fixture} --env default --output ${outputPath}`,
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      assert.ok(existsSync(outputPath), 'Output file should exist');
      const content = readFileSync(outputPath, 'utf-8');
      assert.ok(content.includes('## Step'), 'Should use heading-based format');
    });

    it('renders sub_steps hierarchically in single-env mode', () => {
      const fixture = getFixturePath('nestedSubSteps2Levels');
      execSync(
        `node_modules/.bin/tsx src/cli/index.ts generate manual ${fixture} --env staging --output ${outputPath}`,
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      assert.ok(existsSync(outputPath), 'Output file should exist');
      const content = readFileSync(outputPath, 'utf-8');

      // Parent step
      assert.ok(content.includes('## Step 1:'), 'Should render parent step heading');
      // First-level sub-steps
      assert.ok(content.includes('### Step 1.1:'), 'Should render first sub-step');
      assert.ok(content.includes('### Step 1.2:'), 'Should render second sub-step');
      // Nested sub-steps
      assert.ok(content.includes('#### Step 1.1.1:'), 'Should render nested sub-step');
    });

    it('renders sub_step commands in single-env mode', () => {
      const fixture = getFixturePath('nestedSubSteps2Levels');
      execSync(
        `node_modules/.bin/tsx src/cli/index.ts generate manual ${fixture} --env staging --output ${outputPath}`,
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      const content = readFileSync(outputPath, 'utf-8');
      assert.ok(content.includes('kubectl apply -f backend.yaml'), 'Should render sub-step command');
      assert.ok(content.includes('kubectl apply -f frontend.yaml'), 'Should render second sub-step command');
      assert.ok(content.includes('kubectl wait --for=condition=ready pod -l app=backend'), 'Should render nested sub-step command');
    });
  });
});
