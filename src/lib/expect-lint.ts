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
