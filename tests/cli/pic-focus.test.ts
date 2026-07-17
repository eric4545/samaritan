import assert from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import {
  resolveFocusPic,
  stepBelongsToFocus,
} from '../../src/cli/commands/run';

describe('focus mode: stepBelongsToFocus', () => {
  it('a step with no pic is shared (belongs to everyone)', () => {
    assert.strictEqual(stepBelongsToFocus({}, 'alice'), true);
    assert.strictEqual(stepBelongsToFocus({ pic: undefined }, 'bob'), true);
  });

  it('a matching pic belongs (case-insensitive, trimmed)', () => {
    assert.strictEqual(stepBelongsToFocus({ pic: 'alice' }, 'alice'), true);
    assert.strictEqual(stepBelongsToFocus({ pic: 'Alice' }, 'alice'), true);
    assert.strictEqual(stepBelongsToFocus({ pic: '  alice ' }, 'alice'), true);
  });

  it('a different pic does not belong', () => {
    assert.strictEqual(stepBelongsToFocus({ pic: 'bob' }, 'alice'), false);
  });
});

describe('focus mode: resolveFocusPic', () => {
  const original = process.env.USER;
  afterEach(() => {
    if (original === undefined) delete process.env.USER;
    else process.env.USER = original;
  });

  it('returns undefined when the flag is absent (focus off)', () => {
    assert.strictEqual(resolveFocusPic(undefined), undefined);
    assert.strictEqual(resolveFocusPic(false), undefined);
  });

  it('returns the passed name', () => {
    assert.strictEqual(
      resolveFocusPic('alice@example.com'),
      'alice@example.com',
    );
  });

  it('defaults to $USER when the flag is given bare (true)', () => {
    process.env.USER = 'carol';
    assert.strictEqual(resolveFocusPic(true), 'carol');
  });

  it("falls back to 'unknown' when the flag is bare and $USER is unset", () => {
    delete process.env.USER;
    assert.strictEqual(resolveFocusPic(true), 'unknown');
  });
});
