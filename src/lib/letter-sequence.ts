/**
 * Convert numeric index to Excel-style letter sequence
 * Supports unlimited letters with wraparound (a-z, aa-zz, aaa-zzz, etc.)
 *
 * Examples:
 * - 0 → 'a'
 * - 25 → 'z'
 * - 26 → 'aa'
 * - 27 → 'ab'
 * - 51 → 'az'
 * - 52 → 'ba'
 * - 701 → 'zz'
 * - 702 → 'aaa'
 */
export function indexToLetters(index: number): string {
  if (index < 0) {
    throw new Error(`Index must be non-negative, got ${index}`);
  }

  let result = '';
  let num = index;

  // Convert to base-26 using letters
  do {
    result = String.fromCharCode(97 + (num % 26)) + result;
    num = Math.floor(num / 26) - 1;
  } while (num >= 0);

  return result;
}
