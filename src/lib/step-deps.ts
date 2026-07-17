import type { Step } from '../models/operation';

/**
 * Step dependency graph derived from `step.needs` (like GitHub Actions
 * `jobs.<id>.needs`). References match a step's `id`, `name`, or — for a
 * foreach/matrix-expanded step — its ORIGINAL authored name/id (`foreachSource`),
 * so `needs: [Deploy]` on a foreach step depends on ALL expanded instances.
 *
 * v1 scope: only TOP-LEVEL steps participate. `needs` on sub-steps or rollback
 * steps is reported (as a warning) and otherwise ignored.
 */

export type DepIssueKind =
  | 'unknown-ref'
  | 'forward-ref'
  | 'self-ref'
  | 'cycle'
  | 'sub-step-needs'
  | 'ambiguous-ref';

export interface DepIssue {
  kind: DepIssueKind;
  stepIndex: number;
  ref?: string;
  message: string;
}

export interface StepDepGraph {
  /** For each step index, the indices it depends on (its `needs`, resolved). */
  needsByIndex: number[][];
  /** For each step index, the indices that depend on it (reverse edges). */
  dependentsByIndex: number[][];
  /** Refs that did not resolve to any step, per step index. */
  unknownRefs: Array<{ stepIndex: number; ref: string }>;
}

/** All the tokens a `needs` entry may match for a given step. */
function stepRefTokens(step: Step): string[] {
  const tokens: string[] = [];
  if (step.id) tokens.push(step.id);
  if (step.name) tokens.push(step.name);
  if (step.foreachSource?.id) tokens.push(step.foreachSource.id);
  if (step.foreachSource?.name) tokens.push(step.foreachSource.name);
  return tokens;
}

/**
 * Build the dependency graph for the given top-level steps. Unknown refs are
 * collected (not thrown); cycles are tolerated (the graph just contains the
 * edges). Duplicate-named targets resolve to ALL matches (a safe
 * over-approximation) — surfaced as `ambiguous-ref` by validateStepDeps.
 */
export function buildStepDepGraph(steps: Step[]): StepDepGraph {
  // token -> indices that expose it (a foreach fan-out or duplicate names
  // produce more than one index per token).
  const tokenToIndices = new Map<string, number[]>();
  steps.forEach((step, i) => {
    for (const token of stepRefTokens(step)) {
      const list = tokenToIndices.get(token) ?? [];
      list.push(i);
      tokenToIndices.set(token, list);
    }
  });

  const needsByIndex: number[][] = steps.map(() => []);
  const dependentsByIndex: number[][] = steps.map(() => []);
  const unknownRefs: Array<{ stepIndex: number; ref: string }> = [];

  steps.forEach((step, i) => {
    const refs = step.needs ?? [];
    const resolved = new Set<number>();
    for (const ref of refs) {
      const targets = tokenToIndices.get(ref);
      if (!targets || targets.length === 0) {
        unknownRefs.push({ stepIndex: i, ref });
        continue;
      }
      for (const t of targets) {
        if (t !== i) resolved.add(t);
      }
    }
    const deps = [...resolved].sort((a, b) => a - b);
    needsByIndex[i] = deps;
    for (const d of deps) dependentsByIndex[d].push(i);
  });

  return { needsByIndex, dependentsByIndex, unknownRefs };
}

/**
 * Validate `step.needs`. Returns typed issues (never throws) so the caller
 * decides severity. Detects unknown refs, self refs, forward refs (a step
 * needing a LATER step — can never be satisfied at run time), cycles, ambiguous
 * (duplicate-named) targets, and `needs` authored on sub-steps (ignored in v1).
 */
export function validateStepDeps(steps: Step[]): DepIssue[] {
  const issues: DepIssue[] = [];
  const graph = buildStepDepGraph(steps);

  // token counts for ambiguity detection (only among distinct steps)
  const tokenCount = new Map<string, Set<number>>();
  steps.forEach((step, i) => {
    for (const token of stepRefTokens(step)) {
      const set = tokenCount.get(token) ?? new Set<number>();
      set.add(i);
      tokenCount.set(token, set);
    }
  });

  for (const { stepIndex, ref } of graph.unknownRefs) {
    issues.push({
      kind: 'unknown-ref',
      stepIndex,
      ref,
      message: `Step ${stepIndex + 1} (${steps[stepIndex].name}): dependency '${ref}' not found among step names or IDs`,
    });
  }

  steps.forEach((step, i) => {
    for (const ref of step.needs ?? []) {
      // self reference (ref matches this step's own tokens)
      if (stepRefTokens(step).includes(ref)) {
        issues.push({
          kind: 'self-ref',
          stepIndex: i,
          ref,
          message: `Step ${i + 1} (${step.name}): cannot depend on itself ('${ref}')`,
        });
      }
      // ambiguous: ref matches two or more distinct steps
      const matches = tokenCount.get(ref);
      if (matches && matches.size > 1) {
        // A foreach fan-out shares one foreachSource token across instances,
        // which is intentional (depend on all) — only flag when the matches are
        // NOT all part of the same foreach group.
        const distinctSources = new Set(
          [...matches].map(
            (idx) =>
              steps[idx].foreachSource?.name ??
              steps[idx].foreachSource?.id ??
              `#${idx}`,
          ),
        );
        if (distinctSources.size > 1) {
          issues.push({
            kind: 'ambiguous-ref',
            stepIndex: i,
            ref,
            message: `Step ${i + 1} (${step.name}): dependency '${ref}' is ambiguous (matches multiple steps)`,
          });
        }
      }
    }
    // forward refs: any resolved dep at a LATER index
    for (const dep of graph.needsByIndex[i]) {
      if (dep > i) {
        issues.push({
          kind: 'forward-ref',
          stepIndex: i,
          message: `Step ${i + 1} (${step.name}): depends on a later step (${dep + 1} - ${steps[dep].name}); dependencies must come earlier`,
        });
      }
    }
    // sub-step needs are ignored in v1
    const flagSubStepNeeds = (subs: Step[] | undefined): void => {
      for (const sub of subs ?? []) {
        if (sub.needs && sub.needs.length > 0) {
          issues.push({
            kind: 'sub-step-needs',
            stepIndex: i,
            message: `Step ${i + 1} (${step.name}): 'needs' on sub-step '${sub.name}' is ignored (v1 supports needs on top-level steps only)`,
          });
        }
        flagSubStepNeeds(sub.sub_steps);
      }
    };
    flagSubStepNeeds(step.sub_steps);
  });

  // cycle detection (Kahn): any node left with in-degree > 0 is in a cycle
  const cycleIndices = detectCycleIndices(graph);
  for (const i of cycleIndices) {
    issues.push({
      kind: 'cycle',
      stepIndex: i,
      message: `Step ${i + 1} (${steps[i].name}): part of a dependency cycle`,
    });
  }

  return issues;
}

/** Indices that participate in a cycle (Kahn's algorithm remainder). */
function detectCycleIndices(graph: StepDepGraph): number[] {
  const n = graph.needsByIndex.length;
  const indeg = graph.needsByIndex.map((deps) => deps.length);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (indeg[i] === 0) queue.push(i);
  let removed = 0;
  const gone = new Array<boolean>(n).fill(false);
  while (queue.length > 0) {
    const node = queue.shift() as number;
    gone[node] = true;
    removed++;
    for (const dependent of graph.dependentsByIndex[node]) {
      indeg[dependent]--;
      if (indeg[dependent] === 0) queue.push(dependent);
    }
  }
  if (removed === n) return [];
  const cyclic: number[] = [];
  for (let i = 0; i < n; i++) if (!gone[i]) cyclic.push(i);
  return cyclic;
}

/**
 * Reorder steps into a stable topological order (a dependency comes before its
 * dependents), breaking ties by original document order. Cycle-safe: any nodes
 * left in a cycle are appended in document order rather than dropped or thrown —
 * this runs at RUN time, where validation has not necessarily gated the doc.
 */
export function sortStepsByDependencies<T extends Step>(steps: T[]): T[] {
  const graph = buildStepDepGraph(steps);
  const n = steps.length;
  const indeg = graph.needsByIndex.map((deps) => deps.length);
  // Ready set kept in ascending index order for stable output.
  const ready: number[] = [];
  for (let i = 0; i < n; i++) if (indeg[i] === 0) ready.push(i);
  const order: number[] = [];
  const placed = new Array<boolean>(n).fill(false);
  while (ready.length > 0) {
    ready.sort((a, b) => a - b);
    const node = ready.shift() as number;
    order.push(node);
    placed[node] = true;
    for (const dependent of graph.dependentsByIndex[node]) {
      indeg[dependent]--;
      if (indeg[dependent] === 0) ready.push(dependent);
    }
  }
  // Append any cyclic remainder in document order (cycle-safe fallback).
  for (let i = 0; i < n; i++) if (!placed[i]) order.push(i);
  return order.map((i) => steps[i]);
}

/** Transitive set of steps that depend on `index` (ascending index order). */
export function dependentsOf(graph: StepDepGraph, index: number): number[] {
  const seen = new Set<number>();
  const stack = [...graph.dependentsByIndex[index]];
  while (stack.length > 0) {
    const cur = stack.pop() as number;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const d of graph.dependentsByIndex[cur]) stack.push(d);
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * Direct `needs` of `index` that are NOT yet satisfied, per the caller's
 * predicate (e.g. "status === completed"). Ascending index order.
 */
export function unmetNeeds(
  graph: StepDepGraph,
  index: number,
  isSatisfied: (depIndex: number) => boolean,
): number[] {
  return graph.needsByIndex[index].filter((dep) => !isSatisfied(dep));
}
