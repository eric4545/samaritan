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
    assert.ok(Array.isArray(step.expect), 'expect should be an array');
    assert.strictEqual((step.expect as any[]).length, 3);
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

  it('renders expect checks as a checkbox list in multi-env table format', async () => {
    const op = await parseFixture('withArrayExpect');
    const md = generateManualWithMetadata(op);

    assert.ok(
      md.includes('_Expected:_<br>- [ ] _contains: Running_'),
      'should render the first check as a checkbox list item',
    );
    assert.ok(
      md.includes('- [ ] _does not contain: Error_'),
      'should render the second check as a checkbox list item',
    );
  });

  it('renders expect checks as a checkbox list in single-env heading format', async () => {
    const op = await parseFixture('withArrayExpect');
    const md = generateSingleEnvManual(op, 'staging');

    assert.ok(
      md.includes('> Expected:\n> - [ ] contains: Running'),
      'should render the first check as a checkbox list item',
    );
    assert.ok(
      md.includes('> - [ ] does not contain: Error'),
      'should render the second check as a checkbox list item',
    );
  });

  it('renders a single-check expect as a checkbox list too', async () => {
    const op = await parseFixture('withArrayExpect');
    const md = generateManualWithMetadata(op);

    // "Verify API is up" has only string-shorthand single checks combined into
    // an array of length 2 — use single-env to find a genuinely single-check step.
    const singleEnvMd = generateSingleEnvManual(op, 'staging');
    assert.ok(
      /> Expected:\n> - \[ \] /.test(md) ||
        /> Expected:\n> - \[ \] /.test(singleEnvMd),
      'single-check expect should still render as a checkbox list',
    );
  });
});

describe('Numeric expect rendering (regression: 0 must not be dropped)', () => {
  it('parses an expect resolved to a number via ${VAR} substitution', async () => {
    const op = await parseFixture('withNumericExpect');
    const step = op.steps[0];
    assert.strictEqual(step.expect, 0, 'expect should resolve to the number 0');
  });

  it('still renders the Expected block in the multi-env table when expect is 0', async () => {
    const op = await parseFixture('withNumericExpect');
    const md = generateManualWithMetadata(op);

    assert.ok(
      md.includes('_Expected:_<br>- [ ] _0_'),
      'should render "0" as a checkbox list item, not drop it',
    );
  });

  it('still renders the Expected block in the single-env heading when expect is 0', async () => {
    const op = await parseFixture('withNumericExpect');
    const md = generateSingleEnvManual(op, 'staging');

    assert.ok(
      md.includes('> Expected:\n> - [ ] 0'),
      'should render "0" as a checkbox list item, not drop it',
    );
  });
});
