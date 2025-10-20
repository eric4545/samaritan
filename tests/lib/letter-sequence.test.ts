import assert from 'node:assert';
import { describe, it } from 'node:test';
import { indexToLetters } from '../../src/lib/letter-sequence';

describe('indexToLetters', () => {
  describe('single letter range (0-25)', () => {
    it('converts 0 to "a"', () => {
      assert.strictEqual(indexToLetters(0), 'a');
    });

    it('converts 25 to "z"', () => {
      assert.strictEqual(indexToLetters(25), 'z');
    });

    it('converts 5 to "f"', () => {
      assert.strictEqual(indexToLetters(5), 'f');
    });

    it('converts 12 to "m"', () => {
      assert.strictEqual(indexToLetters(12), 'm');
    });
  });

  describe('double letter range (26+)', () => {
    it('converts 26 to "aa"', () => {
      assert.strictEqual(indexToLetters(26), 'aa');
    });

    it('converts 27 to "ab"', () => {
      assert.strictEqual(indexToLetters(27), 'ab');
    });

    it('converts 51 to "az"', () => {
      assert.strictEqual(indexToLetters(51), 'az');
    });

    it('converts 52 to "ba"', () => {
      assert.strictEqual(indexToLetters(52), 'ba');
    });

    it('converts 701 to "zz"', () => {
      assert.strictEqual(indexToLetters(701), 'zz');
    });
  });

  describe('triple letter range (702+)', () => {
    it('converts 702 to "aaa"', () => {
      assert.strictEqual(indexToLetters(702), 'aaa');
    });

    it('converts 703 to "aab"', () => {
      assert.strictEqual(indexToLetters(703), 'aab');
    });

    it('converts 727 to "aaz"', () => {
      assert.strictEqual(indexToLetters(727), 'aaz');
    });

    it('converts 728 to "aba"', () => {
      assert.strictEqual(indexToLetters(728), 'aba');
    });
  });

  describe('edge cases', () => {
    it('throws error for negative index', () => {
      assert.throws(() => indexToLetters(-1));
    });

    it('handles large indices correctly', () => {
      // Just verify these don't crash and return strings
      const result = indexToLetters(10000);
      assert.strictEqual(typeof result, 'string');
      assert(result.length > 0);
    });
  });

  describe('numbering sequence', () => {
    // Verify that substep numbers follow expected pattern
    it('generates substep sequence a-z', () => {
      const sequence = Array.from({ length: 26 }, (_, i) => indexToLetters(i));
      const expected = 'abcdefghijklmnopqrstuvwxyz'.split('');
      assert.deepStrictEqual(sequence, expected);
    });

    it('generates substep sequence after z starting with aa', () => {
      const sequence = Array.from({ length: 26 }, (_, i) =>
        indexToLetters(26 + i),
      );
      const expected = [
        'aa',
        'ab',
        'ac',
        'ad',
        'ae',
        'af',
        'ag',
        'ah',
        'ai',
        'aj',
        'ak',
        'al',
        'am',
        'an',
        'ao',
        'ap',
        'aq',
        'ar',
        'as',
        'at',
        'au',
        'av',
        'aw',
        'ax',
        'ay',
        'az',
      ];
      assert.deepStrictEqual(sequence, expected);
    });

    it('generates correct transition from zz to aaa', () => {
      assert.strictEqual(indexToLetters(701), 'zz');
      assert.strictEqual(indexToLetters(702), 'aaa');
    });
  });
});
