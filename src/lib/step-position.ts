/**
 * Where the operator is in a run, expressed in the SAME numbering as the
 * single-environment manual (`generate manual --env <name>`): top-level steps
 * are `1`, `2`, …; sub-steps are dotted (`2.1`, `2.2`, `2.2.1`). The run loop
 * always targets exactly one environment, so its labels must match the manual
 * the operator has open — not the multi-env letter scheme (`2a`, `2b1`).
 */
export interface PositionedStep {
  /** Dotted manual number, e.g. "10" or "10.2". */
  label: string;
  name: string;
  /** Excluded by `when` for the target environment — never visited. */
  filteredByEnv?: boolean;
}

export interface StepPosition {
  /** e.g. "[Step 10.2 · 34/46]" — manual number + flat progress position. */
  heading: string;
  /** Parent section of a sub-step, e.g. "Step 10: deploy". */
  parent?: string;
  /** Next step the run will visit, e.g. "Step 10.3: verify". */
  next?: string;
  /** Steps still to visit after this one (env-filtered steps excluded). */
  remaining: number;
}

/** Dotted manual number for the `index`-th child under `parentLabel`. */
export function childStepLabel(parentLabel: string, index: number): string {
  return parentLabel ? `${parentLabel}.${index + 1}` : String(index + 1);
}

function parentLabelOf(label: string): string | undefined {
  const dot = label.lastIndexOf('.');
  return dot === -1 ? undefined : label.slice(0, dot);
}

export function describeStepPosition(
  steps: PositionedStep[],
  index: number,
): StepPosition {
  const current = steps[index];
  const heading = `[Step ${current.label} · ${index + 1}/${steps.length}]`;

  const parentLabel = parentLabelOf(current.label);
  const parentStep =
    parentLabel === undefined
      ? undefined
      : steps.slice(0, index).find((s) => s.label === parentLabel);

  const ahead = steps.slice(index + 1).filter((s) => !s.filteredByEnv);
  const nextStep = ahead[0];

  return {
    heading,
    parent: parentStep
      ? `Step ${parentStep.label}: ${parentStep.name}`
      : undefined,
    next: nextStep ? `Step ${nextStep.label}: ${nextStep.name}` : undefined,
    remaining: ahead.length,
  };
}
