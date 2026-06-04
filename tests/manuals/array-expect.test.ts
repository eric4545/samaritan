import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  generateManualWithMetadata,
  generateSingleEnvManual,
} from '../../src/manuals/generator';
import { parseFixture } from '../fixtures/fixtures';

describe('Array expect rendering', () => {
  it('parses array expect from YAML fixture', async () => {
    const op = await parseFixture('withArrayExpect');
    const step = op.steps[0];
    assert.ok(Array.isArray(step.verify?.expect), 'expect should be an array');
    assert.strictEqual((step.verify?.expect as any[]).length, 3);
  });

  it('renders joined expect descriptions in multi-env table format', async () => {
    const op = await parseFixture('withArrayExpect');
    const md = generateManualWithMetadata(op);

    assert.ok(
      md.includes('contains: Running'),
      'should include first check description',
    );
    assert.ok(
      md.includes('does not contain: Error'),
      'should include second check description',
    );
    assert.ok(
      md.includes('at least 3 line(s)'),
      'should include third check description',
    );
  });

  it('renders joined expect descriptions in single-env heading format', async () => {
    const op = await parseFixture('withArrayExpect');
    const md = generateSingleEnvManual(op, 'staging');

    assert.ok(
      md.includes('contains: Running'),
      'single-env should include first check description',
    );
    assert.ok(
      md.includes('does not contain: Error'),
      'single-env should include second check description',
    );
  });
});
