import type {
  ExpectConfig,
  Operation,
  RollbackStep,
  Step,
} from '../models/operation';
import { EXPECT_STRING_FIELDS } from './step-resolution';

// A bare `$NAME` (not `${NAME}`): a shell variable reference.
const SHELL_VAR_RE = /\$([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * Names of bare `$NAME` shell-variable references in `text` (in order, unique).
 * `${NAME}` operation variables are not matched.
 */
export function findShellVarRefs(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(SHELL_VAR_RE)) names.add(match[1]);
  return [...names];
}

/**
 * One `$NAME` found in an `expect` field that nothing will resolve: `expect`
 * values are compared against the captured output as written, and the shell
 * that expanded `$NAME` in the command never sees `expect`.
 */
export interface ExpectShellVarFinding {
  stepName: string;
  field: string;
  name: string;
}

function lintExpect(
  expect: ExpectConfig | ExpectConfig[] | string | number | boolean | undefined,
  stepName: string,
  isDefined: (name: string) => boolean,
): ExpectShellVarFinding[] {
  if (expect === undefined || expect === null) return [];
  const pick = (field: string, value: unknown): ExpectShellVarFinding[] =>
    typeof value === 'string'
      ? findShellVarRefs(value)
          .filter((name) => !isDefined(name))
          .map((name) => ({ stepName, field, name }))
      : [];
  if (typeof expect === 'string') return pick('contains', expect);
  if (typeof expect !== 'object') return [];
  if (Array.isArray(expect))
    return expect.flatMap((e) => lintExpect(e, stepName, isDefined));
  return EXPECT_STRING_FIELDS.flatMap((field) => pick(field, expect[field]));
}

/**
 * Find bare `$NAME` references in `expect` fields across every step (sub-steps
 * and rollback steps included). A `$NAME` that is an operation variable
 * (`common_variables`, any environment's `variables`, or the step's own
 * `variables`) IS resolved at verify time, so only undefined names are reported.
 */
export function lintExpectShellVars(
  operation: Operation,
): ExpectShellVarFinding[] {
  const operationVars = new Set<string>([
    ...Object.keys(operation.common_variables ?? {}),
    ...Object.values(operation.variables ?? {}).flatMap((vars) =>
      Object.keys(vars ?? {}),
    ),
  ]);
  const findings: ExpectShellVarFinding[] = [];

  const visit = (
    steps: (Step | RollbackStep)[] | undefined,
    inherited: Set<string>,
  ): void => {
    for (const step of steps ?? []) {
      const scope = new Set([
        ...inherited,
        ...Object.keys(step.variables ?? {}),
      ]);
      const name = step.name ?? '(rollback)';
      findings.push(...lintExpect(step.expect, name, (n) => scope.has(n)));
      visit(step.sub_steps, scope);
      if ('rollback' in step) visit(step.rollback, scope);
    }
  };

  visit(operation.steps, operationVars);
  visit(operation.rollback?.steps, operationVars);
  return findings;
}

export function formatExpectShellVarFinding(f: ExpectShellVarFinding): string {
  return `step "${f.stepName}" (expect.${f.field}): "$${f.name}" is compared literally — expect does not expand shell variables. Use \${${f.name}} with a variable defined under variables: (or --var ${f.name}=…), or a literal value.`;
}

/**
 * An `expect` value that can pass for the wrong reason:
 * - `self-match` — a substring check whose text also appears in the step's
 *   own command, so it can match the echoed command line instead of the
 *   output (seen in the field: `ls -la dist/main.js` + `contains: dist/main.js`).
 * - `bare-number` — `contains: 2` is a substring check, so it also matches
 *   `12`, `20` or a timestamp.
 */
export interface ExpectMatchFinding {
  stepName: string;
  field: string;
  value: string;
  kind: 'self-match' | 'bare-number';
}

// Positive substring checks: the only ones an echoed command can satisfy.
const SUBSTRING_FIELDS = ['contains', 'any_line_contains'] as const;
const BARE_NUMBER_RE = /^\d{1,3}$/;

function lintExpectValues(
  expect: ExpectConfig | ExpectConfig[] | string | number | boolean | undefined,
  stepName: string,
  command: string | undefined,
): ExpectMatchFinding[] {
  if (expect === undefined || expect === null) return [];
  const check = (field: string, raw: unknown): ExpectMatchFinding[] => {
    if (typeof raw !== 'string' && typeof raw !== 'number') return [];
    const value = String(raw);
    if (!value.trim()) return [];
    if (command?.includes(value))
      return [{ stepName, field, value, kind: 'self-match' }];
    if (BARE_NUMBER_RE.test(value.trim()))
      return [{ stepName, field, value, kind: 'bare-number' }];
    return [];
  };
  if (typeof expect === 'string' || typeof expect === 'number')
    return check('contains', expect);
  if (typeof expect !== 'object') return [];
  if (Array.isArray(expect))
    return expect.flatMap((e) => lintExpectValues(e, stepName, command));
  return SUBSTRING_FIELDS.flatMap((field) => check(field, expect[field]));
}

/**
 * Find `expect` substring checks that can pass without the expected output:
 * text also present in the step's own command (self-match), or a bare short
 * number. Walks every step, sub-step and rollback entry.
 */
export function lintExpectMatches(operation: Operation): ExpectMatchFinding[] {
  const findings: ExpectMatchFinding[] = [];
  const visit = (steps: (Step | RollbackStep)[] | undefined): void => {
    for (const step of steps ?? []) {
      findings.push(
        ...lintExpectValues(
          step.expect,
          step.name ?? '(rollback)',
          step.command,
        ),
      );
      visit(step.sub_steps);
      if ('rollback' in step) visit(step.rollback);
    }
  };
  visit(operation.steps);
  visit(operation.rollback?.steps);
  return findings;
}

export function formatExpectMatchFinding(f: ExpectMatchFinding): string {
  if (f.kind === 'self-match')
    return `step "${f.stepName}" (expect.${f.field}): "${f.value}" also appears in the step's command, so it can match the echoed command line instead of the output. Expect something only the output contains.`;
  return `step "${f.stepName}" (expect.${f.field}): ${f.value} is a substring check, so it also matches ${f.value}0, 1${f.value} or a timestamp. Use matches: '\\b${f.value}\\b' or equals: '${f.value}'.`;
}
