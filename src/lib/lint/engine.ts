import type { Operation, Step } from '../../models/operation';
import { BUILTIN_VARIABLE_NAMES } from '../builtin-variables';
import { stepDisplayName, walkOperationSteps } from '../step-walk';
import { parseCommands } from './command-model';
import type { LintConfig, RuleSetting } from './config';
import { type CommandRule, RULES, type Rule, type Tier } from './rules';

export type Severity = 'error' | 'warning';

export interface LintFinding {
  ruleId: string;
  severity: Severity;
  tier: Tier;
  message: string;
}

export interface LintOptions {
  operationFile: string;
  config: LintConfig;
  /**
   * Which rules run: `all` for `samaritan lint`; `validate` for only the
   * command rules `validate` does not already report another way.
   */
  scope?: 'all' | 'validate';
}

export function ruleSetting(rule: Rule, config: LintConfig): RuleSetting {
  return config.rules[rule.id] ?? rule.defaultSeverity;
}

/** Names SAMARITAN substitutes as `${NAME}` anywhere in the operation. */
function operationVariableNames(operation: Operation): Set<string> {
  const names = new Set<string>(BUILTIN_VARIABLE_NAMES);
  for (const vars of Object.values(operation.variables ?? {})) {
    for (const name of Object.keys(vars ?? {})) names.add(name);
  }
  for (const name of Object.keys(operation.common_variables ?? {})) {
    names.add(name);
  }
  for (const env of operation.environments ?? []) {
    for (const name of Object.keys(env.variables ?? {})) names.add(name);
  }
  return names;
}

/**
 * Run the enabled rules over an operation. Pure apart from reading the
 * operation file for `compat/discarded-verify` and evidence paths: no host
 * environment, no working directory.
 */
export function lintOperation(
  operation: Operation,
  options: LintOptions,
): LintFinding[] {
  const scope = options.scope ?? 'all';
  const enabled = RULES.filter(
    (rule) =>
      ruleSetting(rule, options.config) !== 'off' &&
      (scope === 'all' || rule.inValidate === 'warning'),
  );
  const findings: LintFinding[] = [];
  const push = (rule: Rule, message: string) => {
    const severity = ruleSetting(rule, options.config) as Severity;
    const duplicate = findings.some(
      (f) => f.ruleId === rule.id && f.message === message,
    );
    if (!duplicate) {
      findings.push({ ruleId: rule.id, severity, tier: rule.tier, message });
    }
  };

  const commandRules = enabled.filter(
    (r): r is CommandRule => r.kind === 'command',
  );
  if (commandRules.length > 0) {
    const globalVars = operationVariableNames(operation);
    for (const step of walkOperationSteps(operation)) {
      if (!step.command) continue;
      const { commands, unsupported } = parseCommands(step.command);
      const declaredVariables = new Set([
        ...globalVars,
        ...Object.keys((step as Step).variables ?? {}),
      ]);
      const ctx = {
        stepName: stepDisplayName(step),
        text: step.command,
        commands,
        unsupported,
        config: options.config,
        declaredVariables,
      };
      for (const rule of commandRules) {
        for (const hit of rule.check(ctx)) push(rule, hit.message);
      }
    }
  }

  for (const rule of enabled) {
    if (rule.kind !== 'operation') continue;
    for (const hit of rule.check(operation, {
      operationFile: options.operationFile,
      config: options.config,
    })) {
      push(rule, hit.message);
    }
  }

  return findings;
}

export function countBySeverity(findings: LintFinding[]): {
  errors: number;
  warnings: number;
} {
  return {
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warning').length,
  };
}
