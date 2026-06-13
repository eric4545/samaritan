import type { ExpectConfig } from '../models/operation';

/**
 * ${VAR} substitution can resolve a bare-shorthand expect (e.g. "${COUNT}")
 * to a literal number/boolean (type-preserving substitution) — these should
 * be treated the same as the string shorthand rather than dropped as falsy (0).
 */
export function isPrimitiveExpectShorthand(
  expect: unknown,
): expect is number | boolean {
  return typeof expect === 'number' || typeof expect === 'boolean';
}

// Built via constructor so the control characters never appear in a regex
// literal (biome noControlCharactersInRegex).
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
// OSC sequences (window titles etc.): ESC ] ... terminated by BEL or ESC \
const OSC_RE = new RegExp(
  `${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`,
  'g',
);
// CSI sequences (colors, cursor movement): ESC [ params final-byte
const CSI_RE = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
// Remaining two-character escapes: ESC followed by a single 0x40–0x5F byte
const SIMPLE_ESC_RE = new RegExp(`${ESC}[@-_]`, 'g');

/**
 * Clean raw terminal capture (tmux pipe-pane output) before asserting:
 * - strips ANSI/VT100 escape sequences (colors, cursor movement, OSC titles)
 * - resolves carriage-return overwrites (`\r\n` line endings, progress bars)
 *
 * Without this, expected text that is visibly on screen fails `contains` /
 * `equals` checks because color codes interrupt it or every line ends in `\r`.
 */
export function cleanTerminalOutput(raw: string): string {
  const noAnsi = raw
    .replace(OSC_RE, '')
    .replace(CSI_RE, '')
    .replace(SIMPLE_ESC_RE, '');
  return noAnsi
    .split('\n')
    .map((line) => {
      // Drop the \r of a \r\n line ending, then keep only the text after the
      // last remaining \r — emulating how the terminal overwrites the line.
      const stripped = line.endsWith('\r') ? line.slice(0, -1) : line;
      const overwriteIdx = stripped.lastIndexOf('\r');
      return overwriteIdx === -1 ? stripped : stripped.slice(overwriteIdx + 1);
    })
    .join('\n');
}

export interface AssertResult {
  pass: boolean;
  actual: string;
  expected: string;
  type: string;
}

/**
 * Compile a user-supplied pattern, returning undefined for invalid regex
 * syntax instead of throwing mid-run.
 */
export function compileRegex(pattern: string): RegExp | undefined {
  try {
    return new RegExp(pattern);
  } catch {
    return undefined;
  }
}

/**
 * Build all `AssertResult`s for the active fields on a single (non-array,
 * non-shorthand) `ExpectConfig` — no short-circuit. Shared by `assertOutput`
 * (which stops at the first failure) and `assertOutputDetailed` (which keeps
 * every check for richer rendering).
 */
function buildChecks(output: string, expect: ExpectConfig): AssertResult[] {
  const trimmed = output.trim();
  const lines = trimmed.split('\n').filter((l) => l.trim() !== '');

  const checks: AssertResult[] = [];

  if (expect.jsonpath !== undefined) {
    checks.push(evalJsonPath(output, expect.jsonpath, expect.equals));
  } else if (expect.equals !== undefined) {
    checks.push({
      pass: trimmed === expect.equals,
      actual: trimmed,
      expected: expect.equals,
      type: 'equals',
    });
  }

  if (expect.contains !== undefined) {
    checks.push({
      pass: output.includes(expect.contains),
      actual: trimmed,
      expected: expect.contains,
      type: 'contains',
    });
  }

  if (expect.not_contains !== undefined) {
    checks.push({
      pass: !output.includes(expect.not_contains),
      actual: trimmed,
      expected: `not contains "${expect.not_contains}"`,
      type: 'not_contains',
    });
  }

  if (expect.matches !== undefined) {
    const re = compileRegex(expect.matches);
    checks.push({
      pass: re?.test(output) ?? false,
      actual: trimmed,
      expected: re
        ? expect.matches
        : `valid regex (invalid pattern: ${expect.matches})`,
      type: 'matches',
    });
  }

  if (expect.not_empty !== undefined) {
    checks.push({
      pass: trimmed.length > 0,
      actual: trimmed,
      expected: 'non-empty',
      type: 'not_empty',
    });
  }

  if (expect.any_line_contains !== undefined) {
    const target = expect.any_line_contains;
    checks.push({
      pass: lines.some((l) => l.includes(target)),
      actual: trimmed,
      expected: target,
      type: 'any_line_contains',
    });
  }

  if (expect.no_line_contains !== undefined) {
    const target = expect.no_line_contains;
    checks.push({
      pass: !lines.some((l) => l.includes(target)),
      actual: trimmed,
      expected: `no line contains "${target}"`,
      type: 'no_line_contains',
    });
  }

  if (expect.all_lines_match !== undefined) {
    const re = compileRegex(expect.all_lines_match);
    checks.push({
      pass: re !== undefined && lines.every((l) => re.test(l)),
      actual: trimmed,
      expected: re
        ? expect.all_lines_match
        : `valid regex (invalid pattern: ${expect.all_lines_match})`,
      type: 'all_lines_match',
    });
  }

  if (expect.line_count !== undefined) {
    checks.push({
      pass: lines.length === expect.line_count,
      actual: String(lines.length),
      expected: String(expect.line_count),
      type: 'line_count',
    });
  }

  if (expect.line_count_gte !== undefined) {
    checks.push({
      pass: lines.length >= expect.line_count_gte,
      actual: String(lines.length),
      expected: `>= ${expect.line_count_gte}`,
      type: 'line_count_gte',
    });
  }

  if (expect.numeric_gte !== undefined) {
    const match = output.match(/[-\d.]+/);
    const num = match ? Number(match[0]) : Number.NaN;
    checks.push({
      pass: !Number.isNaN(num) && num >= expect.numeric_gte,
      actual: String(num),
      expected: `>= ${expect.numeric_gte}`,
      type: 'numeric_gte',
    });
  }

  if (expect.numeric_lte !== undefined) {
    const match = output.match(/[-\d.]+/);
    const num = match ? Number(match[0]) : Number.NaN;
    checks.push({
      pass: !Number.isNaN(num) && num <= expect.numeric_lte,
      actual: String(num),
      expected: `<= ${expect.numeric_lte}`,
      type: 'numeric_lte',
    });
  }

  if (expect.equals_captured !== undefined) {
    checks.push({
      pass: false,
      actual: trimmed,
      expected: `captured variable "${expect.equals_captured}" (not found in session state)`,
      type: 'equals_captured',
    });
  }

  return checks;
}

export function assertOutput(
  output: string,
  expect: ExpectConfig | ExpectConfig[] | string,
): AssertResult {
  if (typeof expect === 'string') {
    return assertOutput(output, { contains: expect });
  }

  if (isPrimitiveExpectShorthand(expect)) {
    return assertOutput(output, { contains: String(expect) });
  }

  if (Array.isArray(expect)) {
    for (const check of expect) {
      const result = assertOutput(output, check);
      if (!result.pass) return result;
    }
    return {
      pass: true,
      actual: output.trim(),
      expected: '(all checks passed)',
      type: 'all',
    };
  }

  const trimmed = output.trim();
  const checks = buildChecks(output, expect);

  if (checks.length === 0) {
    return {
      pass: true,
      actual: trimmed,
      expected: '(no assertion)',
      type: 'none',
    };
  }

  const failure = checks.find((r) => !r.pass);
  if (failure) return failure;
  return checks.length === 1
    ? checks[0]
    : {
        pass: true,
        actual: trimmed,
        expected: '(all checks passed)',
        type: 'all',
      };
}

/**
 * Like `assertOutput`, but evaluates EVERY active check with no
 * short-circuit — used by the sidecar-mode verify UX to show a full
 * checklist of pass/fail results rather than stopping at the first failure.
 *
 * For array `expect`, flattens all elements' checks into a single list.
 * For string/primitive shorthand, delegates the same way `assertOutput` does.
 */
export function assertOutputDetailed(
  output: string,
  expect: ExpectConfig | ExpectConfig[] | string,
): { pass: boolean; actual: string; checks: AssertResult[] } {
  if (typeof expect === 'string') {
    return assertOutputDetailed(output, { contains: expect });
  }

  if (isPrimitiveExpectShorthand(expect)) {
    return assertOutputDetailed(output, { contains: String(expect) });
  }

  const trimmed = output.trim();

  if (Array.isArray(expect)) {
    const checks = expect.flatMap(
      (e) => assertOutputDetailed(output, e).checks,
    );
    return {
      pass: checks.every((c) => c.pass),
      actual: trimmed,
      checks,
    };
  }

  const checks = buildChecks(output, expect);
  return {
    pass: checks.every((c) => c.pass),
    actual: trimmed,
    checks,
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
 * Returns all active assertion fields as human-readable strings.
 * Used by generators to render bullet lists of checks.
 */
export function renderExpectParts(
  expect: ExpectConfig | ExpectConfig[] | string | undefined,
): string[] {
  if (expect === undefined || expect === null) return [];
  if (typeof expect === 'string') return [expect];
  if (isPrimitiveExpectShorthand(expect)) return [String(expect)];
  if (Array.isArray(expect)) {
    return expect.flatMap((e) => renderExpectParts(e)).filter(Boolean);
  }
  const parts: string[] = [];
  if (expect.jsonpath !== undefined) {
    parts.push(
      expect.equals !== undefined
        ? `${expect.jsonpath} equals ${expect.equals}`
        : `${expect.jsonpath} exists`,
    );
  } else if (expect.equals !== undefined) {
    parts.push(`equals ${expect.equals}`);
  }
  if (expect.contains !== undefined) {
    const val = String(expect.contains).replace(/^"|"$/g, '');
    parts.push(`contains: ${val}`);
  }
  if (expect.not_contains !== undefined) {
    const val = String(expect.not_contains).replace(/^"|"$/g, '');
    parts.push(`does not contain: ${val}`);
  }
  if (expect.matches !== undefined) {
    const pattern = String(expect.matches);
    const altMatch = pattern.match(/\(([^)]+)\)/);
    if (altMatch) {
      parts.push(`matches ${altMatch[1].split('|').join(' or ')}`);
    } else {
      const readable = pattern
        .replace(/\\[^\\]/g, '')
        .replace(/[\\^$.*+?[\]{}|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      parts.push(`matches: ${readable}`);
    }
  }
  if (expect.not_empty) parts.push('is not empty');
  if (expect.any_line_contains !== undefined)
    parts.push(`any line contains: ${expect.any_line_contains}`);
  if (expect.no_line_contains !== undefined)
    parts.push(`no line contains: ${expect.no_line_contains}`);
  if (expect.all_lines_match !== undefined)
    parts.push(`all lines match: ${expect.all_lines_match}`);
  if (expect.line_count !== undefined)
    parts.push(`exactly ${expect.line_count} line(s)`);
  if (expect.line_count_gte !== undefined)
    parts.push(`at least ${expect.line_count_gte} line(s)`);
  if (expect.numeric_gte !== undefined)
    parts.push(`value ≥ ${expect.numeric_gte}`);
  if (expect.numeric_lte !== undefined)
    parts.push(`value ≤ ${expect.numeric_lte}`);
  return parts;
}

/**
 * Convert an assertion expectation to clean, human-readable text for manuals.
 * Thin wrapper over renderExpectParts — joins with '; '.
 */
export function renderExpectDescription(
  expect: ExpectConfig | ExpectConfig[] | string | undefined,
): string {
  return renderExpectParts(expect).join('; ');
}
