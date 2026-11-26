import type { Step } from '../models/operation';
import { getBuiltinVariables } from './builtin-variables';
import { mergeStepVariables } from './step-resolution';
import { listUnresolvedVars, resolveVarsSafe } from './variable-resolver';

/** One flat step of the run (`prepareFlatOperation` output). */
export interface DryRunStep {
  step: Step;
  label: string;
  filteredByEnv?: boolean;
}

export interface DryRunPlan {
  /** Printable lines, one block per step this environment runs. */
  lines: string[];
  /** `${NAME}`s a command still holds after resolution, each once. */
  unresolved: string[];
  /** Steps listed (this environment's). */
  steps: number;
}

const INDENT = '      ';

/**
 * What `run --dry-run` would do, step by step: each step's resolved command
 * as `[dry-run] Would execute: …` (with the run's variables, the step's own
 * and the built-ins, the same layering as the run loop), or what the step
 * would wait for. Steps for other environments are left out. Nothing here
 * runs or sends anything.
 */
export function buildDryRunPlan(
  flatSteps: DryRunStep[],
  vars: Record<string, any>,
  startTime: Date = new Date(),
): DryRunPlan {
  const lines: string[] = [];
  const unresolved: string[] = [];
  let steps = 0;
  const builtins = getBuiltinVariables({ startTime });
  for (const { step, label, filteredByEnv } of flatSteps) {
    if (filteredByEnv) continue;
    steps++;
    const session = step.session ? ` · session ${step.session}` : '';
    lines.push(
      `  Step ${label}  ${step.name}  [${step.type ?? 'manual'}]${session}`,
    );
    const scope = mergeStepVariables({ ...builtins, ...vars }, step.variables);
    const action = step.command ?? (step.script && `bash ${step.script}`);
    if (action) {
      const [first, ...rest] = resolveVarsSafe(action, scope)
        .replace(/\n+$/, '')
        .split('\n');
      lines.push(`${INDENT}[dry-run] Would execute: ${first}`);
      for (const line of rest) lines.push(`${INDENT}  ${line}`);
      const missing = listUnresolvedVars(action, scope);
      for (const name of missing) {
        if (!unresolved.includes(name)) unresolved.push(name);
      }
      if (missing.length > 0) {
        lines.push(
          `${INDENT}⚠️  unresolved: ${missing.map((n) => `\${${n}}`).join(', ')}`,
        );
      }
    } else if (step.type === 'approval') {
      lines.push(`${INDENT}[dry-run] Would wait for approval`);
    } else if (!step.sub_steps?.length || step.instruction) {
      lines.push(
        `${INDENT}[dry-run] Would wait for the operator to mark it done`,
      );
    }
  }
  return { lines, unresolved, steps };
}

/**
 * The closing statement of a dry run: what it checked and what it did not,
 * so exit 0 is never read as "the procedure works".
 */
export function dryRunCoverageLines(opts: {
  environment: string;
  steps: number;
  errors: number;
  warnings: number;
  unresolved: number;
}): string[] {
  const findings =
    opts.errors + opts.warnings === 0
      ? 'no findings'
      : `${opts.errors} error(s), ${opts.warnings} warning(s), listed above`;
  return [
    '🔎 What this dry run checked:',
    `   ✅ YAML and schema, environment '${opts.environment}', all ${opts.steps} step(s) traversed`,
    `   ✅ The checks of \`samaritan validate --env ${opts.environment}\` (lint rules included): ${findings}`,
    ...(opts.unresolved > 0
      ? [`   ⚠️  ${opts.unresolved} variable(s) left unresolved in commands`]
      : []),
    '   ❌ Not checked: that any command succeeds, `expect` against real output, or that panes and hosts are reachable',
    '   💡 `samaritan run --mock` replays each `expect` against the recorded `evidence.results`',
  ];
}
