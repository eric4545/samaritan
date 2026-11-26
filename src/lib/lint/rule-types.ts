import type { Operation, RollbackStep, Step } from '../../models/operation';
import type { NormalizedCommand } from './command-model';
import type { LintConfig, RuleSetting } from './config';
import type { ToolRegistry } from './tools/registry';

/**
 * Claim strength of a rule (docs/linting.md):
 * 1 = the shape is in the procedure text, exactly;
 * 2 = a reliable signal from an analysis with known gaps;
 * 3 = a presence heuristic, a review tripwire.
 * Config may change a rule's severity, never its tier.
 */
export type Tier = 1 | 2 | 3;
export type Severity = 'error' | 'warning';
export type AnyStep = Step | RollbackStep;

/** What a rule reports; `step`/`field`/`commandLine` locate it in the YAML. */
export interface RuleHit {
  message: string;
  step?: AnyStep;
  /** The step field the finding is about: `command`, `expect`, `capture`, … */
  field?: string;
  /** 1-based line inside a multi-line `command`. */
  commandLine?: number;
  /** YAML path in the operation file, when no step object is at hand. */
  path?: (string | number)[];
}

/** One step, its command parsed once for every rule. */
export interface StepInfo {
  step: AnyStep;
  stepName: string;
  /** `command` text ('' when the step has none). */
  text: string;
  commands: NormalizedCommand[];
  unsupported: string[];
  /** Names SAMARITAN substitutes as `${NAME}` for this step. */
  declaredVariables: ReadonlySet<string>;
  /** Part of a rollback (step-level or operation-level). */
  rollback: boolean;
  /** Forward run order (0-based) for forward steps; -1 for rollback steps. */
  order: number;
  /** The forward step a step-level rollback belongs to. */
  owner?: Step;
  /** Ancestors (outermost first) for sub-steps. */
  ancestors: AnyStep[];
  /**
   * The session the step runs in when it sets none (`withInheritedSessions`):
   * a sub-step's nearest ancestor's `session:`; a step-level rollback entry's
   * owner step's (then its nearest rollback ancestor's); a variant's base
   * step's. Undefined for top-level steps and the operation-level plan's top
   * entries. Read it via `sessionOf`.
   */
  inheritedSession?: string;
  /**
   * A `variants.<env>` entry: `step` holds only what the variant sets (plus
   * the name, `variables` and `when`), and it applies in `onlyEnv` alone.
   */
  onlyEnv?: string;
  /** For a variant: the step it overrides. */
  base?: StepInfo;
}

/** Does this step (with its ancestors / owner) run in `env`? */
export function runsIn(info: StepInfo, env: string): boolean {
  if (info.onlyEnv !== undefined && info.onlyEnv !== env) return false;
  const chain = [
    ...info.ancestors,
    ...(info.owner ? [info.owner] : []),
    ...(info.base ? [info.base.step] : [info.step]),
  ];
  return chain.every((s) => {
    const when = (s as { when?: string[] }).when;
    return !when || when.length === 0 || when.includes(env);
  });
}

/**
 * The session a step runs in: its own `session:`, else the one it inherits
 * from its nearest ancestor. Undefined means the run's default pane.
 */
export function sessionOf(info: StepInfo): string | undefined {
  return info.step.session ?? info.inheritedSession;
}

/**
 * The value of `field` for this step in `env`: a base step's field does not
 * apply in an environment whose variant sets the same field.
 */
export function fieldIn<K extends keyof AnyStep>(
  info: StepInfo,
  field: K,
  env: string,
): AnyStep[K] | undefined {
  if (!runsIn(info, env)) return undefined;
  if (info.onlyEnv === undefined) {
    const variant = (
      info.step as { variants?: Record<string, Record<string, unknown>> }
    ).variants?.[env];
    if (variant && variant[field as string] !== undefined) return undefined;
  }
  return info.step[field];
}

export interface CommandRuleContext extends StepInfo {
  config: LintConfig;
  /** What lint knows about programs: built-in profiles + `lint.tools`. */
  tools: ToolRegistry;
}

export interface OperationRuleContext {
  operation: Operation;
  operationFile: string;
  config: LintConfig;
  /** Forward steps in run order (parents before their sub-steps). */
  forward: StepInfo[];
  /** Forward steps, then every rollback step. */
  all: StepInfo[];
  environments: string[];
  /** Variables declared anywhere in the operation (all environments). */
  declaredVariables: ReadonlySet<string>;
  /** What lint knows about programs: built-in profiles + `lint.tools`. */
  tools: ToolRegistry;
}

interface RuleBase {
  id: string;
  tier: Tier;
  defaultSeverity: RuleSetting;
  /** Severity under the `samaritan:all` preset (default: defaultSeverity or warning). */
  presetSeverity?: Severity;
  /** Severity under the `samaritan:strict` profile / `lint --strict`. */
  strictSeverity?: RuleSetting;
  description: string;
  /**
   * `already`: `validate` reports this check its own way.
   * `warning`: `validate` prints this rule's findings as warnings.
   * Unset: only `samaritan lint` runs it.
   */
  inValidate?: 'already' | 'warning';
}

export interface CommandRule extends RuleBase {
  kind: 'command';
  check(ctx: CommandRuleContext): RuleHit[];
}

export interface OperationRule extends RuleBase {
  kind: 'operation';
  check(ctx: OperationRuleContext): RuleHit[];
}

export type Rule = CommandRule | OperationRule;

/** `step "Deploy"` or `step "Deploy" (line 3)` for multi-line commands. */
export function stepAt(
  ctx: { stepName: string; text: string },
  line?: number,
): string {
  return line !== undefined && ctx.text.includes('\n')
    ? `step "${ctx.stepName}" (line ${line})`
    : `step "${ctx.stepName}"`;
}

/** Hit on a command line of a step. */
export function commandHit(
  ctx: StepInfo,
  cmd: { line: number },
  message: string,
): RuleHit {
  return {
    message: `${stepAt(ctx, cmd.line)}: ${message}`,
    step: ctx.step,
    field: 'command',
    commandLine: cmd.line,
  };
}

/** `${NAME}` references (plain identifiers only; `${X:?}` is shell syntax). */
export function templateRefs(text: string | undefined): string[] {
  if (!text) return [];
  return [...text.matchAll(/\$\{(\w+)\}/g)].map((m) => m[1]);
}

/** Every string inside an `expect` (string, object or list form). */
export function expectStrings(expect: AnyStep['expect']): string[] {
  if (expect === undefined || expect === null) return [];
  if (typeof expect === 'string') return [expect];
  const list = Array.isArray(expect) ? expect : [expect];
  const out: string[] = [];
  for (const check of list) {
    for (const value of Object.values(check ?? {})) {
      if (typeof value === 'string') out.push(value);
    }
  }
  return out;
}

/** Expect checks as a list of objects (a string is `contains`). */
export function expectChecks(
  expect: AnyStep['expect'],
): Record<string, unknown>[] {
  if (expect === undefined || expect === null) return [];
  if (typeof expect === 'string') return [{ contains: expect }];
  return (Array.isArray(expect) ? expect : [expect]) as Record<
    string,
    unknown
  >[];
}
