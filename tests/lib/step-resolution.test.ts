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

describe('substituteVariables (chained step variable resolution)', () => {
  it('resolves a step variable whose value is itself a ${VAR} reference against env vars', () => {
    // step.variables.TEST_RECIPIENT = "${EMAIL_A}" (e.g. injected by foreach expansion)
    const result = substituteVariables(
      'echo ${TEST_RECIPIENT}',
      { EMAIL_A: 'a@example.com' },
      { TEST_RECIPIENT: '${EMAIL_A}' },
    );
    assert.strictEqual(result, 'echo a@example.com');
  });

  it('leaves a step variable referencing an undefined env var literal', () => {
    const result = substituteVariables(
      'echo ${TEST_RECIPIENT}',
      { EMAIL_A: 'a@example.com' },
      { TEST_RECIPIENT: '${EMAIL_B}' },
    );
    assert.strictEqual(result, 'echo ${EMAIL_B}');
  });

  it('passes non-string step variable values through untouched', () => {
    const result = substituteVariables(
      'retry count: ${RETRY_COUNT}',
      {},
      { RETRY_COUNT: 3 },
    );
    assert.strictEqual(result, 'retry count: 3');
  });

  it('substitutes keys sequentially, so earlier-inserted values can be expanded by later keys', () => {
    // Substitution iterates keys in insertion order over the working string:
    // EMAIL_A inserts "${X}", then the later X key expands it. A placeholder
    // referencing a key that was already processed stays literal instead.
    const cascaded = substituteVariables(
      'echo ${TEST_RECIPIENT}',
      { EMAIL_A: '${X}', X: 'expanded' },
      { TEST_RECIPIENT: '${EMAIL_A}' },
    );
    assert.strictEqual(cascaded, 'echo expanded');

    const literal = substituteVariables(
      'echo ${TEST_RECIPIENT}',
      { X: 'expanded', EMAIL_A: '${X}' },
      { TEST_RECIPIENT: '${EMAIL_A}' },
    );
    assert.strictEqual(literal, 'echo ${X}');
  });
});
