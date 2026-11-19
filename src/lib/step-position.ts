import { indexToLetters } from './letter-sequence';

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
  /** The step's authored `id`, when it has one — typed in a picker. */
  id?: string;
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

/**
 * The same step in the MULTI-environment manual's numbering (`generate
 * manual` without `--env`): sub-step levels alternate letters and numbers,
 * so `1.2.1` is printed there as `1b1`. Accepted by the pickers so an
 * operator can type the number from whichever manual is open.
 */
export function multiEnvStepLabel(label: string): string {
  return label
    .split('.')
    .map((part, depth) =>
      depth % 2 === 1 ? indexToLetters(Number.parseInt(part, 10) - 1) : part,
    )
    .join('');
}

/** `Step 1.2: deploy` — how the run refers to a step, everywhere. */
export function stepRef(steps: PositionedStep[], index: number): string {
  const step = steps[index];
  return step ? `Step ${step.label}: ${step.name}` : `Step ${index + 1}`;
}

/**
 * Rows of a step picker (`[b]`, `[j]`, the completion-screen rollback). ONE
 * number per row: the manual's. The flat position is not shown, because a
 * second number per row is what made the list hard to pick from. A step's
 * `id` gets its own aligned column (only when a listed step has one): an id
 * is stable and easy to type, where `2.3.1` has to be read off the list.
 */
export function renderStepPickerRows(
  steps: PositionedStep[],
  indexes: number[],
  statusOf?: (index: number) => string | undefined,
): string[] {
  const listed = indexes.filter((k) => steps[k]);
  const width = Math.max(0, ...listed.map((k) => steps[k].label.length));
  const idWidth = Math.max(0, ...listed.map((k) => steps[k].id?.length ?? 0));
  return listed.map((k) => {
    const status = statusOf?.(k);
    const id = idWidth ? `${(steps[k].id ?? '').padEnd(idWidth)}  ` : '';
    return `      ${steps[k].label.padEnd(width)}  ${id}${steps[k].name}${status ? `  (${status})` : ''}`;
  });
}

/** Prompt under a step picker. */
export const STEP_PICK_PROMPT =
  '    Step (number, id, or part of the name/id to narrow the list) [Enter to cancel]: ';

/**
 * Resolve a step the operator named to a flat step index. `allowed` = the
 * flat indexes on offer. In order:
 *
 * 1. the manual's number (`2`, `2.7`): the step LABEL, never the flat
 *    position. `2` is Step 2 even when it is the 32nd step of the run.
 * 2. the multi-env manual's number for the same step (`2g`, `1b1`).
 * 3. the step's `id`, case-insensitive.
 * 4. the step name: an exact match, else a unique case-insensitive fragment
 *    of the name or the id.
 *
 * Several fragment matches return `matches` as well as the error, so an
 * interactive picker can narrow its list to them and ask again.
 *
 * A leading `Step ` and a trailing `:` are dropped, so text copied from the
 * manual or the run heading works.
 */
export function resolveStepPick(
  answer: string,
  steps: PositionedStep[],
  allowed: number[],
): { index: number } | { error: string; matches?: number[] } {
  const ans = answer
    .trim()
    .replace(/^step\s+/i, '')
    .replace(/:$/, '')
    .trim();
  const offered = allowed.filter((k) => steps[k]);
  const describe = (k: number) => `${steps[k].label} ${steps[k].name}`;
  const lower = ans.toLowerCase();
  const numberOf = (k: number): boolean =>
    steps[k].label === ans || multiEnvStepLabel(steps[k].label) === lower;
  const idOf = (k: number): boolean => steps[k].id?.toLowerCase() === lower;

  const byNumber = offered.find(numberOf);
  if (byNumber !== undefined) return { index: byNumber };
  const byId = offered.find(idOf);
  if (byId !== undefined) return { index: byId };

  const elsewhere = steps.findIndex((_, k) => numberOf(k) || idOf(k));
  if (elsewhere !== -1)
    return {
      error: `${stepRef(steps, elsewhere)} is not one of the steps listed.`,
    };
  // Digits and dots only is always a step number, never a name fragment:
  // `14` must not silently pick the one step whose name holds "14".
  if (/^\d+(\.\d+)*$/.test(ans))
    return {
      error: `There is no Step ${ans}. Steps are numbered as in the manual (1, 1.1, 1.2, …).`,
    };

  const byName = offered.filter((k) => steps[k].name.toLowerCase() === lower);
  const matches =
    byName.length > 0
      ? byName
      : offered.filter(
          (k) =>
            steps[k].name.toLowerCase().includes(lower) ||
            !!steps[k].id?.toLowerCase().includes(lower),
        );
  if (matches.length === 1) return { index: matches[0] };
  if (matches.length > 1)
    return {
      error: `${matches.length} steps match "${ans}": ${matches.map(describe).join(', ')}. Be more specific.`,
      matches,
    };
  return { error: `No listed step matches "${ans}".` };
}
