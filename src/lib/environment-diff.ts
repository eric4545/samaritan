import {
  mergeStepVariant,
  shouldRenderStepForEnvironment,
  substituteVariables,
} from '../manuals/generator';
import type { Operation, Step } from '../models/operation';

export interface FieldDiff {
  field: string;
  valueA: string | undefined;
  valueB: string | undefined;
}

export interface StepDiffEntry {
  path: string;
  name: string;
  status: 'both' | 'envA-only' | 'envB-only';
  fieldDiffs: FieldDiff[];
}

export interface EnvironmentDiffReport {
  operationName: string;
  envA: string;
  envB: string;
  entries: StepDiffEntry[];
  totalSteps: number;
  identicalCount: number;
}

const COMPARED_FIELDS = [
  'command',
  'script',
  'instruction',
  'description',
  'pic',
  'reviewer',
  'timeout',
] as const;

function resolvedValue(
  step: Step,
  field: (typeof COMPARED_FIELDS)[number],
  envVariables: Record<string, any>,
): string | undefined {
  const raw = step[field];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') return String(raw);
  return substituteVariables(raw, envVariables, step.variables);
}

function evidenceFieldValue(
  step: Step,
  field: 'required' | 'types',
): string | undefined {
  if (!step.evidence) return undefined;
  const value = step.evidence[field];
  if (value === undefined || value === null) return undefined;
  return Array.isArray(value) ? value.join(', ') : String(value);
}

function compareStep(
  stepA: Step,
  stepB: Step,
  envVariablesA: Record<string, any>,
  envVariablesB: Record<string, any>,
): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  for (const field of COMPARED_FIELDS) {
    const valueA = resolvedValue(stepA, field, envVariablesA);
    const valueB = resolvedValue(stepB, field, envVariablesB);
    if (valueA !== valueB) {
      diffs.push({ field, valueA, valueB });
    }
  }

  for (const field of ['required', 'types'] as const) {
    const valueA = evidenceFieldValue(stepA, field);
    const valueB = evidenceFieldValue(stepB, field);
    if (valueA !== valueB) {
      diffs.push({ field: `evidence.${field}`, valueA, valueB });
    }
  }

  return diffs;
}

function diffSteps(
  steps: Step[],
  envA: string,
  envB: string,
  envVariablesA: Record<string, any>,
  envVariablesB: Record<string, any>,
  parentPath: string,
  entries: StepDiffEntry[],
  counts: { total: number; identical: number },
): void {
  steps.forEach((step, index) => {
    const path = parentPath ? `${parentPath}.${index + 1}` : `${index + 1}`;
    const inA = shouldRenderStepForEnvironment(step, envA);
    const inB = shouldRenderStepForEnvironment(step, envB);

    if (!inA && !inB) {
      return;
    }

    counts.total += 1;

    if (inA !== inB) {
      entries.push({
        path,
        name: step.name,
        status: inA ? 'envA-only' : 'envB-only',
        fieldDiffs: [],
      });
    } else {
      const mergedA = mergeStepVariant(step, envA);
      const mergedB = mergeStepVariant(step, envB);
      const fieldDiffs = compareStep(
        mergedA,
        mergedB,
        envVariablesA,
        envVariablesB,
      );

      if (fieldDiffs.length > 0) {
        entries.push({ path, name: step.name, status: 'both', fieldDiffs });
      } else {
        counts.identical += 1;
      }
    }

    if (step.sub_steps && step.sub_steps.length > 0) {
      diffSteps(
        step.sub_steps,
        envA,
        envB,
        envVariablesA,
        envVariablesB,
        path,
        entries,
        counts,
      );
    }
  });
}

export function diffEnvironments(
  operation: Operation,
  envA: string,
  envB: string,
): EnvironmentDiffReport {
  const environmentA = operation.environments.find((env) => env.name === envA);
  const environmentB = operation.environments.find((env) => env.name === envB);

  if (!environmentA) {
    throw new Error(`Environment not found in operation: ${envA}`);
  }
  if (!environmentB) {
    throw new Error(`Environment not found in operation: ${envB}`);
  }

  const entries: StepDiffEntry[] = [];
  const counts = { total: 0, identical: 0 };

  diffSteps(
    operation.steps,
    envA,
    envB,
    environmentA.variables ?? {},
    environmentB.variables ?? {},
    '',
    entries,
    counts,
  );

  return {
    operationName: operation.name,
    envA,
    envB,
    entries,
    totalSteps: counts.total,
    identicalCount: counts.identical,
  };
}

function formatValue(value: string | undefined): string {
  if (value === undefined) return '(not set)';
  return value.includes('\n') ? value.split('\n')[0] : value;
}

export function formatDiffAsText(report: EnvironmentDiffReport): string {
  const lines: string[] = [];
  lines.push(
    `🔍 Comparing ${report.envA} vs ${report.envB} — ${report.operationName}`,
  );
  lines.push('');

  for (const entry of report.entries) {
    lines.push(`📋 Step ${entry.path}: ${entry.name}`);

    if (entry.status === 'envA-only') {
      lines.push(`   ⚠️  ${report.envA} only (not present for ${report.envB})`);
    } else if (entry.status === 'envB-only') {
      lines.push(`   ⚠️  ${report.envB} only (not present for ${report.envA})`);
    } else {
      for (const fieldDiff of entry.fieldDiffs) {
        lines.push(`   ${fieldDiff.field}:`);
        lines.push(
          `     ${report.envA}:`.padEnd(18) + formatValue(fieldDiff.valueA),
        );
        lines.push(
          `     ${report.envB}:`.padEnd(18) + formatValue(fieldDiff.valueB),
        );
      }
    }

    lines.push('');
  }

  const differingCount = report.entries.filter(
    (entry) => entry.status === 'both',
  ).length;
  const envSpecificCount = report.entries.length - differingCount;

  lines.push('─'.repeat(40));
  lines.push(
    `Summary: ${report.totalSteps} steps compared · ${differingCount} differ · ` +
      `${envSpecificCount} environment-specific · ${report.identicalCount} identical`,
  );

  return lines.join('\n');
}

export function formatDiffAsMarkdown(report: EnvironmentDiffReport): string {
  const lines: string[] = [];
  lines.push(`# Environment Diff Report: ${report.envA} vs ${report.envB}`);
  lines.push('');
  lines.push(`**Operation:** ${report.operationName}`);
  lines.push('');

  for (const entry of report.entries) {
    lines.push(`## Step ${entry.path}: ${entry.name}`);
    lines.push('');

    if (entry.status === 'envA-only') {
      lines.push(`> ⚠️ Only present in: **${report.envA}**`);
    } else if (entry.status === 'envB-only') {
      lines.push(`> ⚠️ Only present in: **${report.envB}**`);
    } else {
      lines.push(`| Field | ${report.envA} | ${report.envB} |`);
      lines.push('|---|---|---|');
      for (const fieldDiff of entry.fieldDiffs) {
        const valueA = formatValue(fieldDiff.valueA).replace(/\|/g, '\\|');
        const valueB = formatValue(fieldDiff.valueB).replace(/\|/g, '\\|');
        lines.push(`| ${fieldDiff.field} | ${valueA} | ${valueB} |`);
      }
    }

    lines.push('');
  }

  const differingCount = report.entries.filter(
    (entry) => entry.status === 'both',
  ).length;
  const envSpecificCount = report.entries.length - differingCount;

  lines.push('## Summary');
  lines.push('');
  lines.push(`- ${report.totalSteps} steps compared`);
  lines.push(`- ${differingCount} steps differ`);
  lines.push(`- ${envSpecificCount} environment-specific steps`);
  lines.push(`- ${report.identicalCount} identical steps`);
  lines.push('');

  return lines.join('\n');
}
