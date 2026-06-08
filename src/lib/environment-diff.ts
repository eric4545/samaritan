import type { Operation, Step } from '../models/operation';
import {
  mergeStepVariant,
  shouldRenderStepForEnvironment,
  substituteVariables,
} from './step-resolution';

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
  differingCount: number;
  envSpecificCount: number;
}

function asComparableString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

interface FieldDescriptor {
  field: string;
  getValue: (
    step: Step,
    envVariables: Record<string, any>,
  ) => string | undefined;
}

const CONTENT_FIELDS: ReadonlyArray<keyof Step & string> = [
  'command',
  'script',
  'instruction',
  'description',
  'pic',
  'reviewer',
  'timeout',
];

const EVIDENCE_FIELDS: ReadonlyArray<'required' | 'types'> = [
  'required',
  'types',
];

const FIELD_DESCRIPTORS: FieldDescriptor[] = [
  ...CONTENT_FIELDS.map((field) => ({
    field,
    getValue: (step: Step, envVariables: Record<string, any>) => {
      const raw = step[field];
      if (typeof raw !== 'string') return asComparableString(raw);
      return substituteVariables(raw, envVariables, step.variables);
    },
  })),
  ...EVIDENCE_FIELDS.map((field) => ({
    field: `evidence.${field}`,
    getValue: (step: Step) => asComparableString(step.evidence?.[field]),
  })),
];

function compareStep(
  stepA: Step,
  stepB: Step,
  envVariablesA: Record<string, any>,
  envVariablesB: Record<string, any>,
): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  for (const { field, getValue } of FIELD_DESCRIPTORS) {
    const valueA = getValue(stepA, envVariablesA);
    const valueB = getValue(stepB, envVariablesB);
    if (valueA !== valueB) {
      diffs.push({ field, valueA, valueB });
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
): number {
  let identicalCount = 0;

  for (const [index, step] of steps.entries()) {
    const path = parentPath ? `${parentPath}.${index + 1}` : `${index + 1}`;
    const inA = shouldRenderStepForEnvironment(step, envA);
    const inB = shouldRenderStepForEnvironment(step, envB);

    if (inA || inB) {
      if (inA !== inB) {
        entries.push({
          path,
          name: step.name,
          status: inA ? 'envA-only' : 'envB-only',
          fieldDiffs: [],
        });
      } else {
        const fieldDiffs = compareStep(
          mergeStepVariant(step, envA),
          mergeStepVariant(step, envB),
          envVariablesA,
          envVariablesB,
        );

        if (fieldDiffs.length > 0) {
          entries.push({ path, name: step.name, status: 'both', fieldDiffs });
        } else {
          identicalCount += 1;
        }
      }
    }

    if (step.sub_steps && step.sub_steps.length > 0) {
      identicalCount += diffSteps(
        step.sub_steps,
        envA,
        envB,
        envVariablesA,
        envVariablesB,
        path,
        entries,
      );
    }
  }

  return identicalCount;
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
  const identicalCount = diffSteps(
    operation.steps,
    envA,
    envB,
    environmentA.variables ?? {},
    environmentB.variables ?? {},
    '',
    entries,
  );

  const differingCount = entries.filter(
    (entry) => entry.status === 'both',
  ).length;
  const envSpecificCount = entries.length - differingCount;

  return {
    operationName: operation.name,
    envA,
    envB,
    entries,
    totalSteps: entries.length + identicalCount,
    identicalCount,
    differingCount,
    envSpecificCount,
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

  lines.push('─'.repeat(40));
  lines.push(
    `Summary: ${report.totalSteps} steps compared · ${report.differingCount} differ · ` +
      `${report.envSpecificCount} environment-specific · ${report.identicalCount} identical`,
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

  lines.push('## Summary');
  lines.push('');
  lines.push(`- ${report.totalSteps} steps compared`);
  lines.push(`- ${report.differingCount} steps differ`);
  lines.push(`- ${report.envSpecificCount} environment-specific steps`);
  lines.push(`- ${report.identicalCount} identical steps`);
  lines.push('');

  return lines.join('\n');
}
