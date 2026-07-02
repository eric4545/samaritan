import fs from 'node:fs';
import path from 'node:path';
import { renderExpectDescription } from '../../lib/assertions';
import type {
  Environment,
  EvidenceResult,
  Operation,
  Step,
} from '../../models/operation';
import {
  mergeStepVariant,
  shouldRenderStepForEnvironment,
  substituteExpectVars,
  substituteVariables,
} from '../step-resolution';

/**
 * Per-environment resolved view of a single step's display content. Absent
 * keys mean "nothing to show" (no command, no expect, ...) — NOT "not
 * applicable"; a step that doesn't apply to an environment (via `when`) has
 * no entry at all in `FlatStep.perEnv` for that environment name.
 */
export interface FlatStepEnvView {
  command?: string;
  script?: string;
  scriptContent?: string;
  instruction?: string;
  expect?: string;
  evidence?: {
    required?: boolean;
    types?: string[];
    results?: EvidenceResult[];
  };
}

/**
 * One step (or sub_step, recursively) flattened into a single list with a
 * dotted `label` (e.g. "1", "1.1", "1.1.2") and a per-environment resolved
 * view. Used by the `serve` web UI so the client doesn't need to reimplement
 * variable resolution or `when`/variant logic.
 */
export interface FlatStep {
  index: number;
  label: string;
  name: string;
  phase?: string;
  pic?: string;
  reviewer?: string;
  perEnv: Record<string, FlatStepEnvView>;
}

export interface OperationView {
  meta: {
    id: string;
    name: string;
    version: string;
    description?: string;
  };
  environments: string[];
  steps: FlatStep[];
}

/**
 * Resolve one step's display content for one environment. Reuses the same
 * helpers the manual generators use (`substituteVariables`,
 * `substituteExpectVars`) so the web UI's resolved command/instruction/expect
 * always matches what `generate manual --env <env>` would render.
 */
function buildEnvView(
  effectiveStep: Step,
  env: Environment,
  operationDir?: string,
): FlatStepEnvView {
  const envVars = env.variables ?? {};
  const view: FlatStepEnvView = {};

  if (effectiveStep.command) {
    view.command = substituteVariables(
      effectiveStep.command,
      envVars,
      effectiveStep.variables,
    );
  }

  if (effectiveStep.script) {
    view.script = effectiveStep.script;
    if (operationDir) {
      try {
        const scriptPath = path.resolve(operationDir, effectiveStep.script);
        view.scriptContent = fs.readFileSync(scriptPath, 'utf-8');
      } catch {
        view.scriptContent = `Script file not found: ${effectiveStep.script}`;
      }
    }
  }

  if (effectiveStep.instruction) {
    view.instruction = substituteVariables(
      effectiveStep.instruction,
      envVars,
      effectiveStep.variables,
    );
  }

  if (effectiveStep.expect != null) {
    const resolvedExpect = substituteExpectVars(
      effectiveStep.expect,
      envVars,
      effectiveStep.variables,
    );
    const description = renderExpectDescription(resolvedExpect);
    if (description) view.expect = description;
  }

  if (effectiveStep.evidence) {
    view.evidence = {
      required: effectiveStep.evidence.required,
      types: effectiveStep.evidence.types,
      results: effectiveStep.evidence.results?.[env.name],
    };
  }

  return view;
}

/**
 * Flatten `operation.steps` (recursing into `sub_steps`) into a per-env
 * resolved view, pure function — no I/O beyond reading `script:` files
 * (relative to `operationDir`, mirroring `generateSingleEnvManual`).
 */
export function buildOperationView(
  operation: Operation,
  operationDir?: string,
): OperationView {
  const environments: Environment[] =
    operation.environments && operation.environments.length > 0
      ? operation.environments
      : [
          {
            name: 'default',
            description: '',
            variables: {},
            restrictions: [],
            approval_required: false,
            validation_required: false,
          },
        ];

  const steps: FlatStep[] = [];
  let nextIndex = 0;

  function flatten(stepList: Step[], labelPrefix: string): void {
    stepList.forEach((step, i) => {
      const label = labelPrefix ? `${labelPrefix}.${i + 1}` : `${i + 1}`;
      const index = nextIndex++;

      const perEnv: Record<string, FlatStepEnvView> = {};
      for (const env of environments) {
        if (!shouldRenderStepForEnvironment(step, env.name)) continue;
        const effectiveStep = mergeStepVariant(step, env.name);
        perEnv[env.name] = buildEnvView(effectiveStep, env, operationDir);
      }

      steps.push({
        index,
        label,
        name: step.name,
        phase: step.phase,
        pic: step.pic,
        reviewer: step.reviewer,
        perEnv,
      });

      if (step.sub_steps && step.sub_steps.length > 0) {
        flatten(step.sub_steps, label);
      }
    });
  }

  flatten(operation.steps ?? [], '');

  return {
    meta: {
      id: operation.id,
      name: operation.name,
      version: operation.version,
      description: operation.description,
    },
    environments: environments.map((e) => e.name),
    steps,
  };
}
