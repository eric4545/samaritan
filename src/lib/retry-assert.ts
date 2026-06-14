import type { ExpectConfig, RetryAssertConfig } from '../models/operation';

/**
 * Parse a verify-retry interval into milliseconds. Accepts `'5s'`, `'500ms'`,
 * `'2m'`, or a bare number (treated as milliseconds). Returns 0 for anything
 * unparseable (so a misconfigured interval polls immediately rather than
 * hanging).
 */
export function parseInterval(interval: string | number): number {
  if (typeof interval === 'number') return Math.max(0, interval);
  const match = String(interval)
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(ms|s|m)?$/);
  if (!match) return 0;
  const value = Number(match[1]);
  switch (match[2]) {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60_000;
    default:
      return value; // 'ms' or bare number
  }
}

/**
 * Extract the `retry` config from an `expect` (string shorthand, single config,
 * or array). For an array, the first config that defines `retry` wins.
 */
export function extractRetryConfig(
  expect: ExpectConfig | ExpectConfig[] | string | undefined,
): RetryAssertConfig | undefined {
  if (!expect || typeof expect === 'string') return undefined;
  if (Array.isArray(expect)) {
    for (const e of expect) {
      const retry = extractRetryConfig(e);
      if (retry) return retry;
    }
    return undefined;
  }
  return expect.retry;
}

/** Whether `output` matches `pattern` as a literal substring OR a regex. */
function matchesPattern(output: string, pattern: string): boolean {
  if (output.includes(pattern)) return true;
  try {
    return new RegExp(pattern).test(output);
  } catch {
    // Invalid regex — fall back to the substring result (already false here).
    return false;
  }
}

/**
 * Whether a failed verification is "retryable" given the captured output. With
 * no `while` guard every failure is retryable (up to `max`); with a `while`
 * guard only outputs that match the transient pattern are retryable — anything
 * else should fail fast.
 */
export function isRetryableOutput(
  output: string,
  retry: RetryAssertConfig,
): boolean {
  if (!retry.while) return true;
  return matchesPattern(output, retry.while);
}

/**
 * Decide whether to poll again after a failed verification: there must be
 * attempts left AND the output must be retryable. `attempt` is 0-based (the
 * number of retries already performed).
 */
export function shouldRetry(
  attempt: number,
  retry: RetryAssertConfig,
  output: string,
): boolean {
  return attempt < retry.max && isRetryableOutput(output, retry);
}
