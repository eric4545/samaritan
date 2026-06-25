import type {
  ExpectConfig,
  Operation,
  RollbackStep,
  Step,
} from '../models/operation';

/**
 * `ExpectConfig` fields whose value is interpreted as a regular expression at
 * verify time. Patterns here are compiled with `new RegExp(pattern)` (default
 * flags) and tested against captured output, so an uncompilable pattern means
 * the check can never pass.
 */
const REGEX_EXPECT_FIELDS = [
  'matches',
  'all_lines_match',
  'any_line_matches',
  'no_line_matches',
] as const satisfies ReadonlyArray<keyof ExpectConfig>;

/**
 * A single regex-lint finding, annotated with the step and expect field it
 * came from. `level: 'error'` = the pattern is uncompilable (a real authoring
 * bug); `level: 'warning'` = the pattern is syntactically valid but looks
 * catastrophic (ReDoS-prone) per a best-effort heuristic.
 */
export interface RegexLintFinding {
  stepName: string;
  field: string;
  pattern: string;
  level: 'error' | 'warning';
  message: string;
}

/**
 * Whether `pattern` compiles as a JS regex. Mirrors `compileRegex` in
 * assertions.ts but returns a boolean (we don't need the compiled value here).
 */
function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort detection of catastrophic-backtracking (ReDoS) patterns. Flags a
 * nested unbounded quantifier — a quantified group whose body itself ends in an
 * unbounded quantifier — e.g. `(a+)+`, `(a*)*`, `(.*)+`, `(a+)*`. This is the
 * classic star-height-2 footgun. Intentionally conservative: it does not try to
 * catch every pathological case, only the common, unambiguous one.
 */
export function isCatastrophicRegex(pattern: string): boolean {
  // A group `( ... )` whose contents end in `+`/`*` (optionally `?`-lazy),
  // immediately followed by another `+`/`*` quantifier on the group.
  return /\([^()]*[+*]\??\)[+*]/.test(pattern);
}

/**
 * Classify a single regex pattern, returning a finding or undefined when it's
 * clean.
 */
function lintPattern(
  pattern: string,
  stepName: string,
  field: string,
): RegexLintFinding | undefined {
  if (!isValidRegex(pattern)) {
    return {
      stepName,
      field,
      pattern,
      level: 'error',
      message: `invalid regex: ${pattern}`,
    };
  }
  if (isCatastrophicRegex(pattern)) {
    return {
      stepName,
      field,
      pattern,
      level: 'warning',
      message: `potentially catastrophic regex (nested unbounded quantifier): ${pattern}`,
    };
  }
  return undefined;
}

/**
 * Lint every regex-bearing field of a single `ExpectConfig` (or its
 * string-shorthand / array forms). The `expect.retry.while` guard is also a
 * regex-or-substring value, so it's linted too. String/primitive shorthand
 * `expect` is a `contains` literal (not a regex) and is skipped.
 */
function lintExpect(
  expect: ExpectConfig | ExpectConfig[] | string | number | boolean | undefined,
  stepName: string,
): RegexLintFinding[] {
  if (expect === undefined || expect === null) return [];
  if (typeof expect !== 'object') return [];
  if (Array.isArray(expect)) {
    return expect.flatMap((e) => lintExpect(e, stepName));
  }

  const findings: RegexLintFinding[] = [];
  for (const field of REGEX_EXPECT_FIELDS) {
    const value = expect[field];
    if (typeof value === 'string') {
      const finding = lintPattern(value, stepName, field);
      if (finding) findings.push(finding);
    }
  }
  if (typeof expect.retry?.while === 'string') {
    // `while` is a "retry only while output matches" guard: a substring OR a
    // regex. Only flag it when it fails to compile — substrings are valid
    // regexes, so this never false-positives on a plain substring.
    if (!isValidRegex(expect.retry.while)) {
      findings.push({
        stepName,
        field: 'retry.while',
        pattern: expect.retry.while,
        level: 'error',
        message: `invalid regex: ${expect.retry.while}`,
      });
    } else if (isCatastrophicRegex(expect.retry.while)) {
      findings.push({
        stepName,
        field: 'retry.while',
        pattern: expect.retry.while,
        level: 'warning',
        message: `potentially catastrophic regex (nested unbounded quantifier): ${expect.retry.while}`,
      });
    }
  }
  return findings;
}

/**
 * Walk every step (sub-steps recursively, plus rollback steps) of an operation
 * and lint all regex-bearing `expect` fields. `expect` lives on the shared
 * `StepContent` base, so rollback steps carry it too.
 */
export function lintOperationRegex(operation: Operation): RegexLintFinding[] {
  const findings: RegexLintFinding[] = [];

  const visit = (steps: (Step | RollbackStep)[] | undefined): void => {
    if (!steps) return;
    for (const step of steps) {
      const name = 'name' in step && step.name ? step.name : '(rollback)';
      findings.push(...lintExpect(step.expect, name));
      if ('sub_steps' in step) visit(step.sub_steps);
      if ('rollback' in step) visit(step.rollback);
    }
  };

  visit(operation.steps);
  return findings;
}

/**
 * Format a finding as a single human-readable line, e.g.
 * `step "Check rollout" (matches): invalid regex: [unterminated`.
 */
export function formatRegexFinding(f: RegexLintFinding): string {
  return `step "${f.stepName}" (${f.field}): ${f.message}`;
}
