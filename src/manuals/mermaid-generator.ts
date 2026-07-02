import { groupByPhase } from '../lib/phase-grouping';
import type { Operation, Step } from '../models/operation';

/**
 * Recursively collect every step (and nested sub_steps) that carries a
 * `timeline`, in document order. Shared by the Gantt builders (both the pure
 * Mermaid output and the fenced `--gantt` embed in the Markdown generator).
 */
export function collectAllStepsWithTimeline(steps: Step[]): Step[] {
  const result: Step[] = [];

  function traverse(step: Step) {
    if (step.timeline) {
      result.push(step);
    }
    if (step.sub_steps && step.sub_steps.length > 0) {
      step.sub_steps.forEach(traverse);
    }
  }

  steps.forEach(traverse);
  return result;
}

/**
 * Build a **pure** Mermaid `gantt` diagram (no ``` code fences, no Confluence
 * `{markdown}` wrapper) from an operation's step timelines.
 *
 * Steps are grouped into flight phases via {@link groupByPhase} (block-aware),
 * and each `timeline` (string or structured `TimelineConfig`) is converted to
 * Mermaid task syntax. Unlike the fenced embed used by `--gantt`, this always
 * returns a valid diagram — when no step has timeline data it emits the gantt
 * header plus a `%% No timeline data found` comment rather than an empty string.
 */
export function generateMermaidGantt(operation: Operation): string {
  const stepsWithTimeline = collectAllStepsWithTimeline(operation.steps);

  let gantt = 'gantt\n';
  gantt += `    title ${operation.name} Timeline\n`;
  gantt += '    dateFormat YYYY-MM-DD HH:mm\n';
  gantt += '    axisFormat %m-%d %H:%M\n\n';

  if (stepsWithTimeline.length === 0) {
    gantt += '    %% No timeline data found\n';
    return gantt;
  }

  // Group steps by phase (block-aware: `uses:` blocks stay contiguous)
  const phases = groupByPhase(stepsWithTimeline, (step) => step);

  // Note: Emojis removed from section names as Mermaid doesn't render them correctly
  const phaseNames = {
    preflight: 'Pre-Flight Phase',
    flight: 'Flight Phase',
    postflight: 'Post-Flight Phase',
  };

  // Track previous step name across all phases for auto-dependency
  let previousStepName: string | null = null;

  Object.entries(phases).forEach(([phaseName, phaseSteps]) => {
    if (phaseSteps.length === 0) return;

    gantt += `    section ${phaseNames[phaseName as keyof typeof phaseNames]}\n`;

    phaseSteps.forEach((step) => {
      const taskName = step.name.replace(/:/g, ''); // Remove colons as they break Mermaid syntax
      const pic = step.pic ? ` (${step.pic})` : '';

      // Convert timeline to Mermaid syntax
      let timelineSyntax = '';
      if (step.timeline) {
        if (typeof step.timeline === 'string') {
          // Legacy string format - use as-is
          timelineSyntax = step.timeline;
        } else {
          // Structured format - convert to Mermaid syntax
          const parts: string[] = [];

          if (step.timeline.status) {
            parts.push(step.timeline.status);
          }

          if (step.timeline.start) {
            parts.push(step.timeline.start);
          } else if (step.timeline.after) {
            parts.push(`after ${step.timeline.after.replace(/:/g, '')}`);
          } else if (previousStepName) {
            parts.push(`after ${previousStepName}`);
          }

          if (step.timeline.duration) {
            parts.push(step.timeline.duration);
          }

          timelineSyntax = parts.join(', ');
        }
      }

      gantt += `    ${taskName}${pic} :${timelineSyntax}\n`;
      previousStepName = taskName;
    });
    gantt += '\n';
  });

  return gantt;
}

/**
 * Strip characters that break Mermaid node/edge labels and collapse whitespace,
 * so an arbitrary step name renders safely inside `["..."]`/`{"..."}`.
 */
function sanitizeLabel(text: string): string {
  return text
    .replace(/["[\]{}|;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildNodeLabel(step: Step): string {
  const base = sanitizeLabel(step.name || 'step');
  const subCount = step.sub_steps?.length ?? 0;
  return subCount > 0 ? `${base} (${subCount} steps)` : base;
}

export interface MermaidFlowchartOptions {
  /** Flowchart layout direction. `TD` (top-down, default) or `LR` (left-right). */
  direction?: 'TD' | 'LR';
}

/**
 * Build a **pure** Mermaid `flowchart` (no ``` code fences) from an operation.
 *
 * Top-level steps become nodes (`step_<index>`), grouped into per-phase
 * `subgraph`s via {@link groupByPhase}. Steps carrying an `approval` or `if`
 * gate render as decision diamonds; all others as rounded process nodes. Nodes
 * are wired sequentially in document order from `Start` to `Done`, and — when
 * the operation declares a top-level `rollback:` — a dashed "on failure" edge
 * points at a `Rollback Plan` node.
 */
export function generateMermaidFlowchart(
  operation: Operation,
  options: MermaidFlowchartOptions = {},
): string {
  const direction = options.direction ?? 'TD';
  const steps = operation.steps ?? [];

  const lines: string[] = [];
  lines.push(`flowchart ${direction}`);
  lines.push('    Start(["Start"])');
  lines.push('    End(["Done"])');

  // Map each top-level step to its stable node id (document index).
  const indexOf = new Map<Step, number>();
  steps.forEach((step, i) => {
    indexOf.set(step, i);
  });

  // Phase subgraphs (block-aware). Only emit non-empty buckets.
  const phases = groupByPhase(steps, (step) => step);
  const phaseMeta: Array<[keyof typeof phases, string]> = [
    ['preflight', 'Pre-Flight'],
    ['flight', 'Flight'],
    ['postflight', 'Post-Flight'],
  ];

  for (const [key, label] of phaseMeta) {
    const bucket = phases[key];
    if (!bucket || bucket.length === 0) continue;
    lines.push(`    subgraph phase_${key}["${label}"]`);
    for (const step of bucket) {
      const i = indexOf.get(step) ?? 0;
      const nodeLabel = buildNodeLabel(step);
      const isDecision = Boolean(step.approval || step.if);
      lines.push(
        isDecision
          ? `        step_${i}{"${nodeLabel}"}`
          : `        step_${i}["${nodeLabel}"]`,
      );
    }
    lines.push('    end');
  }

  // Sequential edges in document order.
  if (steps.length === 0) {
    lines.push('    Start --> End');
  } else {
    lines.push('    Start --> step_0');
    for (let i = 1; i < steps.length; i++) {
      lines.push(`    step_${i - 1} --> step_${i}`);
    }
    lines.push(`    step_${steps.length - 1} --> End`);

    // Dashed recovery edge to the global rollback plan, if declared.
    if (operation.rollback) {
      lines.push('    Rollback[["Rollback Plan"]]');
      lines.push(`    step_${steps.length - 1} -.->|on failure| Rollback`);
    }
  }

  return `${lines.join('\n')}\n`;
}
