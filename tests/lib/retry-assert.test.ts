import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  extractRetryConfig,
  isRetryableOutput,
  parseInterval,
  shouldRetry,
} from '../../src/lib/retry-assert';

describe('parseInterval', () => {
  it('parses seconds, milliseconds, and minutes', () => {
    assert.strictEqual(parseInterval('5s'), 5000);
    assert.strictEqual(parseInterval('500ms'), 500);
    assert.strictEqual(parseInterval('2m'), 120_000);
  });

  it('treats a bare number as milliseconds', () => {
    assert.strictEqual(parseInterval('250'), 250);
    assert.strictEqual(parseInterval(250), 250);
  });

  it('returns 0 for unparseable input', () => {
    assert.strictEqual(parseInterval('soon'), 0);
    assert.strictEqual(parseInterval(''), 0);
  });
});

describe('extractRetryConfig', () => {
  it('returns undefined for string shorthand or missing retry', () => {
    assert.strictEqual(extractRetryConfig('Running'), undefined);
    assert.strictEqual(extractRetryConfig({ contains: 'ok' }), undefined);
    assert.strictEqual(extractRetryConfig(undefined), undefined);
  });

  it('reads retry from a single config', () => {
    const retry = extractRetryConfig({
      contains: 'Ready',
      retry: { interval: '5s', max: 3 },
    });
    assert.deepStrictEqual(retry, { interval: '5s', max: 3 });
  });

  it('returns the first retry found in an array expect', () => {
    const retry = extractRetryConfig([
      { contains: 'a' },
      { contains: 'b', retry: { interval: '1s', max: 5 } },
    ]);
    assert.deepStrictEqual(retry, { interval: '1s', max: 5 });
  });
});

describe('isRetryableOutput', () => {
  it('retries any failure when no while guard is set', () => {
    assert.strictEqual(
      isRetryableOutput('anything', { interval: '1s', max: 3 }),
      true,
    );
  });

  it('only retries when output matches the while substring', () => {
    const retry = { interval: '1s', max: 3, while: 'connection refused' };
    assert.strictEqual(
      isRetryableOutput('Error: connection refused', retry),
      true,
    );
    assert.strictEqual(isRetryableOutput('permission denied', retry), false);
  });

  it('supports a regex while guard', () => {
    const retry = { interval: '1s', max: 3, while: 'timeout|refused' };
    assert.strictEqual(isRetryableOutput('i/o timeout', retry), true);
    assert.strictEqual(isRetryableOutput('all good', retry), false);
  });
});

describe('shouldRetry', () => {
  const retry = { interval: '1s', max: 2, while: 'temporary' };

  it('is false once attempts are exhausted', () => {
    assert.strictEqual(shouldRetry(2, retry, 'temporary failure'), false);
  });

  it('is true with attempts left and a retryable output', () => {
    assert.strictEqual(shouldRetry(0, retry, 'temporary failure'), true);
  });

  it('is false when the output is not retryable, even with attempts left', () => {
    assert.strictEqual(shouldRetry(0, retry, 'fatal error'), false);
  });
});
