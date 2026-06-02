import type { ExpectConfig } from '../models/operation';

export interface AssertResult {
  pass: boolean;
  actual: string;
  expected: string;
  type: string;
}

export function assertOutput(
  output: string,
  expect: ExpectConfig | string,
): AssertResult {
  if (typeof expect === 'string') {
    return assertOutput(output, { contains: expect });
  }

  const trimmed = output.trim();
  const lines = trimmed.split('\n').filter((l) => l.trim() !== '');

  if (expect.equals !== undefined) {
    if (expect.jsonpath !== undefined) {
      return evalJsonPath(output, expect.jsonpath, expect.equals);
    }
    return {
      pass: trimmed === expect.equals,
      actual: trimmed,
      expected: expect.equals,
      type: 'equals',
    };
  }

  if (expect.contains !== undefined) {
    return {
      pass: output.includes(expect.contains),
      actual: trimmed,
      expected: expect.contains,
      type: 'contains',
    };
  }

  if (expect.not_contains !== undefined) {
    return {
      pass: !output.includes(expect.not_contains),
      actual: trimmed,
      expected: `not contains "${expect.not_contains}"`,
      type: 'not_contains',
    };
  }

  if (expect.matches !== undefined) {
    const re = new RegExp(expect.matches);
    return {
      pass: re.test(output),
      actual: trimmed,
      expected: expect.matches,
      type: 'matches',
    };
  }

  if (expect.not_empty !== undefined) {
    return {
      pass: trimmed.length > 0,
      actual: trimmed,
      expected: 'non-empty',
      type: 'not_empty',
    };
  }

  if (expect.any_line_contains !== undefined) {
    const target = expect.any_line_contains;
    return {
      pass: lines.some((l) => l.includes(target)),
      actual: trimmed,
      expected: target,
      type: 'any_line_contains',
    };
  }

  if (expect.no_line_contains !== undefined) {
    const target = expect.no_line_contains;
    return {
      pass: !lines.some((l) => l.includes(target)),
      actual: trimmed,
      expected: `no line contains "${target}"`,
      type: 'no_line_contains',
    };
  }

  if (expect.all_lines_match !== undefined) {
    const re = new RegExp(expect.all_lines_match);
    return {
      pass: lines.every((l) => re.test(l)),
      actual: trimmed,
      expected: expect.all_lines_match,
      type: 'all_lines_match',
    };
  }

  if (expect.line_count !== undefined) {
    return {
      pass: lines.length === expect.line_count,
      actual: String(lines.length),
      expected: String(expect.line_count),
      type: 'line_count',
    };
  }

  if (expect.line_count_gte !== undefined) {
    return {
      pass: lines.length >= expect.line_count_gte,
      actual: String(lines.length),
      expected: `>= ${expect.line_count_gte}`,
      type: 'line_count_gte',
    };
  }

  if (expect.numeric_gte !== undefined) {
    const match = output.match(/[-\d.]+/);
    const num = match ? Number(match[0]) : Number.NaN;
    return {
      pass: !Number.isNaN(num) && num >= expect.numeric_gte,
      actual: String(num),
      expected: `>= ${expect.numeric_gte}`,
      type: 'numeric_gte',
    };
  }

  if (expect.numeric_lte !== undefined) {
    const match = output.match(/[-\d.]+/);
    const num = match ? Number(match[0]) : Number.NaN;
    return {
      pass: !Number.isNaN(num) && num <= expect.numeric_lte,
      actual: String(num),
      expected: `<= ${expect.numeric_lte}`,
      type: 'numeric_lte',
    };
  }

  if (expect.jsonpath !== undefined) {
    return evalJsonPath(output, expect.jsonpath, undefined);
  }

  return {
    pass: true,
    actual: trimmed,
    expected: '(no assertion)',
    type: 'none',
  };
}

function evalJsonPath(
  output: string,
  path: string,
  expectedValue: string | undefined,
): AssertResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.trim());
  } catch {
    return {
      pass: false,
      actual: 'invalid JSON',
      expected: path,
      type: 'jsonpath',
    };
  }

  const actual = resolveSimpleJsonPath(parsed, path);
  const actualStr =
    typeof actual === 'string' ? actual : JSON.stringify(actual);

  if (expectedValue !== undefined) {
    return {
      pass: actualStr === expectedValue,
      actual: actualStr,
      expected: expectedValue,
      type: 'jsonpath',
    };
  }

  return {
    pass: actual !== undefined && actual !== null,
    actual: actualStr,
    expected: `${path} exists`,
    type: 'jsonpath',
  };
}

function resolveSimpleJsonPath(obj: unknown, path: string): unknown {
  // Supports simple paths: $.key.nested or $.items[0].field
  const parts = path
    .replace(/^\$\.?/, '')
    .split(/[.[\]]/)
    .filter(Boolean);

  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Convert an assertion expectation to clean, human-readable text for manuals.
 * Avoids escaped regex artifacts and doubled quotes.
 */
export function renderExpectDescription(
  expect: ExpectConfig | string | undefined,
): string {
  if (!expect) return '';
  if (typeof expect === 'string') return expect;
  if (expect.equals !== undefined) {
    if (expect.jsonpath) return `${expect.jsonpath} equals ${expect.equals}`;
    return `equals ${expect.equals}`;
  }
  if (expect.contains !== undefined) {
    // Strip surrounding quotes added by JSON serialisation
    const val = String(expect.contains).replace(/^"|"$/g, '');
    return `contains: ${val}`;
  }
  if (expect.not_contains !== undefined) {
    const val = String(expect.not_contains).replace(/^"|"$/g, '');
    return `does not contain: ${val}`;
  }
  if (expect.matches !== undefined) {
    // Extract human-readable alternatives from regex groups like (A|B|C)
    const pattern = String(expect.matches);
    const altMatch = pattern.match(/\(([^)]+)\)/);
    if (altMatch) {
      return `matches ${altMatch[1].split('|').join(' or ')}`;
    }
    // Strip common metacharacters for a readable approximation
    const readable = pattern
      .replace(/\\[^\\]/g, '')
      .replace(/[\\^$.*+?[\]{}|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return `matches: ${readable}`;
  }
  if (expect.not_empty) return 'is not empty';
  if (expect.any_line_contains !== undefined)
    return `any line contains: ${expect.any_line_contains}`;
  if (expect.no_line_contains !== undefined)
    return `no line contains: ${expect.no_line_contains}`;
  if (expect.all_lines_match !== undefined)
    return `all lines match: ${expect.all_lines_match}`;
  if (expect.line_count !== undefined)
    return `exactly ${expect.line_count} line(s)`;
  if (expect.line_count_gte !== undefined)
    return `at least ${expect.line_count_gte} line(s)`;
  if (expect.numeric_gte !== undefined) return `value ≥ ${expect.numeric_gte}`;
  if (expect.numeric_lte !== undefined) return `value ≤ ${expect.numeric_lte}`;
  return '';
}
