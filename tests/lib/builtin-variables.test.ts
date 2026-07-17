import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  BUILTIN_VARIABLE_NAMES,
  getBuiltinVariables,
} from '../../src/lib/builtin-variables';

describe('getBuiltinVariables', () => {
  const start = new Date('2026-07-17T09:00:00');
  const now = new Date('2026-07-17T10:16:00');

  it('formats dates as YYYY-MM-DD and times as HH:MM:SS (local)', () => {
    const vars = getBuiltinVariables({ startTime: start, now });
    assert.strictEqual(vars.RUN_START_DATE, '2026-07-17');
    assert.strictEqual(vars.RUN_START_TIME, '09:00:00');
    assert.strictEqual(vars.CURRENT_DATE, '2026-07-17');
    assert.strictEqual(vars.CURRENT_TIME, '10:16:00');
    assert.strictEqual(vars.CURRENT_DATETIME, '2026-07-17 10:16:00');
  });

  it('humanizes ELAPSED_TIME between start and now', () => {
    const vars = getBuiltinVariables({ startTime: start, now });
    assert.strictEqual(vars.ELAPSED_TIME, '1h 16m');
  });

  it('renders a 0-minute elapsed as 0m', () => {
    const vars = getBuiltinVariables({ startTime: start, now: start });
    assert.strictEqual(vars.ELAPSED_TIME, '0m');
  });

  it('omits ELAPSED_TIME when includeElapsed is false', () => {
    const vars = getBuiltinVariables({
      startTime: start,
      now,
      includeElapsed: false,
    });
    assert.ok(!('ELAPSED_TIME' in vars), 'ELAPSED_TIME should be omitted');
    // Other built-ins still present.
    assert.strictEqual(vars.CURRENT_DATE, '2026-07-17');
  });

  it('exposes exactly the documented built-in names', () => {
    const vars = getBuiltinVariables({ startTime: start, now });
    assert.deepStrictEqual(
      Object.keys(vars).sort(),
      [...BUILTIN_VARIABLE_NAMES].sort(),
    );
  });

  it('defaults now to a fresh Date when omitted', () => {
    const vars = getBuiltinVariables({ startTime: new Date() });
    assert.match(vars.CURRENT_DATE, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(vars.CURRENT_TIME, /^\d{2}:\d{2}:\d{2}$/);
  });
});
