import {
  defaultLintConfig,
  type LintConfig,
} from '../../../src/lib/lint/config';
import { type LintFinding, lintOperation } from '../../../src/lib/lint/engine';
import type { Operation } from '../../../src/models/operation';

/** Lint one inline `command` with every rule on (unless the config says off). */
export function lintCommand(
  command: string,
  config: Partial<LintConfig> = {},
  variables: Record<string, string> = {},
): LintFinding[] {
  const operation = {
    name: 'lint-test',
    version: '1.0.0',
    description: 'mock',
    environments: [{ name: 'staging', variables }],
    variables: { staging: variables },
    steps: [{ name: 'Step', type: 'automatic', command }],
  } as unknown as Operation;
  return lintOperation(operation, {
    operationFile: 'tests/fixtures/none.yaml',
    config: { ...defaultLintConfig(), ...config },
  });
}

export const ids = (findings: LintFinding[]): string[] =>
  findings.map((f) => f.ruleId);
