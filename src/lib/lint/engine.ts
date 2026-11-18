import { dirname, join, relative, resolve } from 'node:path';
import type { Operation, Step } from '../../models/operation';
import { getStepSource, setStepSource } from '../../operations/step-source';
import { BUILTIN_VARIABLE_NAMES } from '../builtin-variables';
import { stepDisplayName } from '../step-walk';
import { parseCommands } from './command-model';
import type { LintConfig, RuleSetting } from './config';
import type {
  AnyStep,
  CommandRuleContext,
  OperationRuleContext,
  Rule,
  RuleHit,
  Severity,
  StepInfo,
  Tier,
} from './rule-types';
import { INVALID_DIRECTIVE_RULE, RULE_IDS, RULES } from './rules';
import { SourceIndex, type SourceLocation, suppresses } from './source-index';
import { BUILTIN_TOOLS, type ToolRegistry } from './tools/registry';

export type { Severity };

export interface LintLocation {
  /** The operation file as given, or another file (a `uses:` file) relative to it. */
  file: string;
  line: number;
  column: number;
}

export interface LintFinding {
  ruleId: string;
  severity: Severity;
  tier: Tier;
  message: string;
  location: LintLocation | null;
}

export interface LintOptions {
  operationFile: string;
  config: LintConfig;
  /**
   * `all` for `samaritan lint`; `validate` for the rules `validate` prints as
   * warnings (the ones it does not already report another way).
   */
  scope?: 'all' | 'validate';
}

/**
 * A rule crashed. The results are incomplete, so callers must say so: `lint`
 * exits 2 for the file, `validate` prints a warning (never an error).
 */
export class LintRuleError extends Error {
  constructor(
    readonly ruleId: string,
    cause: unknown,
  ) {
    super(
      `rule ${ruleId} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

export function ruleSetting(rule: Rule, config: LintConfig): RuleSetting {
  return config.rules[rule.id] ?? rule.defaultSeverity;
}

const LEGACY_BUILTINS = ['DATE', 'TIME', 'USER', 'environment'];

/** Names SAMARITAN substitutes as `${NAME}` anywhere in the operation. */
function operationVariableNames(operation: Operation): Set<string> {
  const names = new Set<string>([
    ...BUILTIN_VARIABLE_NAMES,
    ...LEGACY_BUILTINS,
  ]);
  const add = (vars: Record<string, unknown> | undefined) => {
    for (const name of Object.keys(vars ?? {})) names.add(name);
  };
  for (const vars of Object.values(operation.variables ?? {})) add(vars);
  add(operation.common_variables);
  for (const env of operation.environments ?? []) add(env.variables);
  for (const group of operation.groups ?? []) add(group.variables);
  return names;
}

/** Forward steps in run order, then every rollback, with parsed commands. */
function buildStepInfos(
  operation: Operation,
  tools: ToolRegistry,
): {
  forward: StepInfo[];
  all: StepInfo[];
  declared: Set<string>;
} {
  const declared = operationVariableNames(operation);
  const forward: StepInfo[] = [];
  const rollbacks: StepInfo[] = [];

  const make = (
    step: AnyStep,
    ancestors: AnyStep[],
    rollback: boolean,
    order: number,
    owner?: Step,
  ): StepInfo => {
    const text = step.command ?? '';
    const parsed = text
      ? parseCommands(text, tools.specOf)
      : { commands: [], unsupported: [] as string[] };
    const scoped = new Set(declared);
    for (const s of [...ancestors, ...(owner ? [owner] : []), step]) {
      for (const name of Object.keys((s as Step).variables ?? {})) {
        scoped.add(name);
      }
    }
    return {
      step,
      stepName: stepDisplayName(step),
      text,
      commands: parsed.commands,
      unsupported: parsed.unsupported,
      declaredVariables: scoped,
      rollback,
      order,
      owner,
      ancestors,
    };
  };

  const visitRollback = (
    steps: AnyStep[] | undefined,
    ancestors: AnyStep[],
    owner?: Step,
    onlyEnv?: string,
  ) => {
    for (const step of steps ?? []) {
      rollbacks.push({ ...make(step, ancestors, true, -1, owner), onlyEnv });
      visitRollback(step.sub_steps, [...ancestors, step], owner, onlyEnv);
    }
  };
  /** A variant's rollback list is raw YAML: give its entries their paths. */
  const stampRaw = (
    steps: AnyStep[] | undefined,
    file: string,
    path: (string | number)[],
  ) => {
    (steps ?? []).forEach((step, k) => {
      if (!step || typeof step !== 'object') return;
      setStepSource(step, { file, path: [...path, k] });
      stampRaw(step.sub_steps, file, [...path, k, 'sub_steps']);
    });
  };
  const variants: StepInfo[] = [];
  /** One entry per `variants.<env>`: only the fields that variant sets. */
  const visitVariants = (base: StepInfo, ancestors: AnyStep[]) => {
    const step = base.step as Step;
    for (const [env, variant] of Object.entries(step.variants ?? {})) {
      const own = {
        ...variant,
        name: `${stepDisplayName(step)} [variants.${env}]`,
        variables: { ...(step.variables ?? {}), ...(variant?.variables ?? {}) },
        when: step.when,
      } as Step;
      const source = getStepSource(step);
      if (source) {
        setStepSource(own, {
          file: source.file,
          path: [...source.path, 'variants', env],
        });
      }
      variants.push({
        ...make(
          { ...own, rollback: undefined },
          ancestors,
          base.rollback,
          base.order,
          base.owner,
        ),
        step: own,
        onlyEnv: env,
        base,
      });
      const variantRollback = Array.isArray(variant?.rollback)
        ? (variant.rollback as AnyStep[])
        : undefined;
      if (source && variantRollback) {
        stampRaw(variantRollback, source.file, [
          ...source.path,
          'variants',
          env,
          'rollback',
        ]);
      }
      visitRollback(variantRollback, [], step, env);
    }
  };
  const visit = (steps: Step[] | undefined, ancestors: Step[]) => {
    for (const step of steps ?? []) {
      const info = make(step, ancestors, false, forward.length);
      forward.push(info);
      visitVariants(info, ancestors);
      visit(step.sub_steps, [...ancestors, step]);
      visitRollback(step.rollback, [], step);
    }
  };
  visit(operation.steps, []);
  visitRollback(operation.rollback?.steps, []);
  return {
    forward,
    all: [...forward, ...variants, ...rollbacks],
    declared,
  };
}

/**
 * Run the enabled rules over an operation, locate each finding in its source
 * file, and drop the ones a `# samaritan-lint-disable…` comment covers.
 * Deterministic: no host environment, no working directory, no network.
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
  const tools = BUILTIN_TOOLS.with(options.config.tools);
  const { forward, all, declared } = buildStepInfos(operation, tools);
  const environments = (operation.environments ?? []).map((e) => e.name);
  const opFile = resolve(options.operationFile);
  const index = new SourceIndex();

  const hits: { rule: Rule; hit: RuleHit }[] = [];
  const opCtx: OperationRuleContext = {
    operation,
    operationFile: options.operationFile,
    config: options.config,
    forward,
    all,
    environments,
    declaredVariables: declared,
    tools,
  };
  for (const rule of enabled) {
    try {
      if (rule.kind === 'command') {
        for (const info of all) {
          if (!info.text) continue;
          const ctx: CommandRuleContext = {
            ...info,
            config: options.config,
            tools,
          };
          for (const hit of rule.check(ctx)) hits.push({ rule, hit });
        }
      } else {
        for (const hit of rule.check(opCtx)) hits.push({ rule, hit });
      }
    } catch (error) {
      throw new LintRuleError(rule.id, error);
    }
  }

  const displayFile = (file: string): string => {
    if (file === opFile) return options.operationFile;
    if (/^https?:\/\//.test(file)) return file;
    return join(
      dirname(options.operationFile),
      relative(dirname(opFile), file),
    );
  };

  const locate = (hit: RuleHit): SourceLocation | undefined => {
    const source = hit.step ? getStepSource(hit.step) : undefined;
    if (source) {
      return index.locate(source.file, source.path, hit.field, hit.commandLine);
    }
    if (hit.path) return index.locate(opFile, hit.path);
    return undefined;
  };

  const findings: (LintFinding & { order: number })[] = [];
  const seen = new Set<string>();
  hits.forEach(({ rule, hit }, order) => {
    const where = locate(hit);
    if (
      where &&
      index.directives(where.file).some((d) => suppresses(d, rule.id, where))
    ) {
      return;
    }
    const key = `${rule.id}\u0000${hit.message}\u0000${where?.file}:${where?.line}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      ruleId: rule.id,
      severity: ruleSetting(rule, options.config) as Severity,
      tier: rule.tier,
      message: hit.message,
      location: where
        ? {
            file: displayFile(where.file),
            line: where.line,
            column: where.column,
          }
        : null,
      order,
    });
  });

  // Directives naming rules that do not exist.
  if (
    (scope === 'all' || INVALID_DIRECTIVE_RULE.inValidate === 'warning') &&
    ruleSetting(INVALID_DIRECTIVE_RULE, options.config) !== 'off'
  ) {
    const files = new Set([opFile]);
    for (const info of all) {
      const source = getStepSource(info.step);
      if (source) files.add(source.file);
    }
    for (const file of files) {
      for (const d of index.directives(file)) {
        const unknown = d.rules.filter((id) => !RULE_IDS.has(id));
        if (unknown.length === 0) continue;
        findings.push({
          ruleId: INVALID_DIRECTIVE_RULE.id,
          severity: ruleSetting(
            INVALID_DIRECTIVE_RULE,
            options.config,
          ) as Severity,
          tier: INVALID_DIRECTIVE_RULE.tier,
          message: `\`samaritan-lint-${d.kind}\` names unknown rule${unknown.length > 1 ? 's' : ''} ${unknown.map((u) => `'${u}'`).join(', ')}`,
          location: {
            file: displayFile(file),
            line: d.line,
            column: d.column,
          },
          order: hits.length,
        });
      }
    }
  }

  findings.sort((a, b) => {
    const fa = a.location?.file ?? '￿';
    const fb = b.location?.file ?? '￿';
    const ownA = fa === options.operationFile ? 0 : 1;
    const ownB = fb === options.operationFile ? 0 : 1;
    return (
      ownA - ownB ||
      fa.localeCompare(fb) ||
      (a.location?.line ?? 0) - (b.location?.line ?? 0) ||
      (a.location?.column ?? 0) - (b.location?.column ?? 0) ||
      a.order - b.order
    );
  });
  return findings.map(({ order: _order, ...f }) => f);
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

/** `12:7` for the operation file, `common/x.yaml:12:7` for another. */
export function formatLocation(
  location: LintLocation | null,
  operationFile: string,
): string {
  if (!location) return '-';
  const lc = `${location.line}:${location.column}`;
  return location.file === operationFile ? lc : `${location.file}:${lc}`;
}
