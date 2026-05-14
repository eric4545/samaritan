import assert from 'node:assert';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { after, describe, it } from 'node:test';
import { renderExpectDescription } from '../../src/lib/assertions';
import { getFixturePath } from '../fixtures/fixtures';

describe('renderExpectDescription', () => {
  it('returns a plain string as-is', () => {
    assert.strictEqual(
      renderExpectDescription('pod is running'),
      'pod is running',
    );
  });

  it('renders contains without doubled/escaped quotes', () => {
    const result = renderExpectDescription({ contains: '"Status": "Success"' });
    assert.ok(!result.includes('""'), 'Should not have doubled quotes');
    assert.ok(result.includes('contains'), 'Should mention contains');
    assert.ok(result.includes('Status'), 'Should include the key text');
  });

  it('renders matches with human-readable alternatives from regex groups', () => {
    const result = renderExpectDescription({
      matches: '"Status":\\s*"(Success|Pending)"',
    });
    assert.ok(result.includes('Success'), 'Should include first alternative');
    assert.ok(result.includes('Pending'), 'Should include second alternative');
    assert.ok(result.includes('or'), 'Should join alternatives with "or"');
    assert.ok(
      !result.includes('\\s*'),
      'Should not include raw regex metacharacters',
    );
  });

  it('renders equals without surrounding quotes', () => {
    assert.strictEqual(
      renderExpectDescription({ equals: 'ready' }),
      'equals ready',
    );
  });

  it('renders not_empty', () => {
    assert.ok(
      renderExpectDescription({ not_empty: true }).includes('not empty'),
    );
  });

  it('renders numeric_gte with ≥ symbol', () => {
    assert.ok(renderExpectDescription({ numeric_gte: 5 }).includes('≥ 5'));
  });

  it('renders numeric_lte with ≤ symbol', () => {
    assert.ok(renderExpectDescription({ numeric_lte: 100 }).includes('≤ 100'));
  });

  it('renders line_count_gte as plain English without programming operators', () => {
    const result = renderExpectDescription({ line_count_gte: 3 });
    assert.ok(result.includes('3'));
    assert.ok(!result.includes('>='), 'Should not use >= operator');
  });
});

describe('CLI --env flag', () => {
  const outputPath = '/tmp/samaritan-test-cli-flags-manual.md';

  after(() => {
    if (existsSync(outputPath)) unlinkSync(outputPath);
  });

  describe('validate: --env flag', () => {
    it('accepts --env flag', () => {
      const fixture = getFixturePath('minimal');
      const result = execSync(
        `node_modules/.bin/tsx src/cli/index.ts validate ${fixture} --env default`,
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      assert.ok(result.includes('YAML syntax valid'));
    });

    it('accepts -e short flag', () => {
      const fixture = getFixturePath('minimal');
      const result = execSync(
        `node_modules/.bin/tsx src/cli/index.ts validate ${fixture} -e default`,
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      assert.ok(result.includes('YAML syntax valid'));
    });
  });

  describe('run: --env flag', () => {
    it('accepts --env flag without flag-parsing error', () => {
      const fixture = getFixturePath('minimal');
      const result = spawnSync(
        'node_modules/.bin/tsx',
        ['src/cli/index.ts', 'run', fixture, '--env', 'default', '--dry-run'],
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      assert.ok(
        !result.stderr.includes('unknown option'),
        'Should recognise --env',
      );
    });

    it('errors when --env is omitted', () => {
      const fixture = getFixturePath('minimal');
      const result = spawnSync(
        'node_modules/.bin/tsx',
        ['src/cli/index.ts', 'run', fixture, '--dry-run'],
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      assert.notStrictEqual(result.status, 0, 'Should exit non-zero');
      const combined = (result.stdout || '') + (result.stderr || '');
      assert.ok(combined.includes('env'), 'Error message should mention --env');
    });
  });

  describe('generate manual --env: single-env heading format', () => {
    it('generates heading-based manual (not table)', () => {
      const fixture = getFixturePath('minimal');
      execSync(
        `node_modules/.bin/tsx src/cli/index.ts generate manual ${fixture} --env default --output ${outputPath}`,
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      assert.ok(existsSync(outputPath));
      const content = readFileSync(outputPath, 'utf-8');
      assert.ok(content.includes('## Step'), 'Should use heading-based format');
      assert.ok(!content.includes('| Step |'), 'Should not use table format');
    });

    it('renders sub_steps as hierarchical headings', () => {
      const fixture = getFixturePath('nestedSubSteps2Levels');
      execSync(
        `node_modules/.bin/tsx src/cli/index.ts generate manual ${fixture} --env staging --output ${outputPath}`,
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      const content = readFileSync(outputPath, 'utf-8');
      assert.ok(content.includes('## Step 1:'), 'Parent step heading');
      assert.ok(content.includes('### Step 1.1:'), 'First sub-step heading');
      assert.ok(content.includes('### Step 1.2:'), 'Second sub-step heading');
      assert.ok(
        content.includes('#### Step 1.1.1:'),
        'Nested sub-step heading',
      );
    });

    it('includes sub_step commands in output', () => {
      const fixture = getFixturePath('nestedSubSteps2Levels');
      execSync(
        `node_modules/.bin/tsx src/cli/index.ts generate manual ${fixture} --env staging --output ${outputPath}`,
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      const content = readFileSync(outputPath, 'utf-8');
      assert.ok(content.includes('kubectl apply -f backend.yaml'));
      assert.ok(content.includes('kubectl apply -f frontend.yaml'));
      assert.ok(
        content.includes(
          'kubectl wait --for=condition=ready pod -l app=backend',
        ),
      );
    });
  });
});
