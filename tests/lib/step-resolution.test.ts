import assert from 'node:assert';
import { describe, it } from 'node:test';
import { substituteVariables } from '../../src/lib/step-resolution';

describe('substituteVariables (security hardening)', () => {
  it('substitutes plain variable names', () => {
    const result = substituteVariables('deploy to ${ENV}', { ENV: 'staging' });
    assert.strictEqual(result, 'deploy to staging');
  });

  it('treats regex metacharacters in variable names literally', () => {
    // A name like "a|b" must only match ${a|b} — not ${a} or ${b}
    const result = substituteVariables('${a|b} ${a} ${b}', {
      'a|b': 'X',
      a: 'A',
      b: 'B',
    });
    assert.strictEqual(result, 'X A B');
  });

  it('inserts values containing replacement patterns literally', () => {
    // $& in a value must not be expanded to the matched text
    const result = substituteVariables('pass: ${SECRET}', {
      SECRET: 'pa$&word',
    });
    assert.strictEqual(result, 'pass: pa$&word');
  });

  it('step variables take priority over environment variables', () => {
    const result = substituteVariables(
      '${TARGET}',
      { TARGET: 'env' },
      { TARGET: 'step' },
    );
    assert.strictEqual(result, 'step');
  });
});
