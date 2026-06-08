import { diffLines } from 'diff';
import type { Operation, Step } from '../models/operation';
import {
  mergeStepVariant,
  shouldRenderStepForEnvironment,
  substituteVariables,
} from './step-resolution';

export interface FieldDiff {
  field: string;
  values: Record<string, string | undefined>;
}

export interface StepDiffEntry {
  path: string;
  name: string;
  presentIn: string[];
  absentIn: string[];
  fieldDiffs: FieldDiff[];
}

export interface EnvironmentDiffReport {
  operationName: string;
  environments: string[];
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
  resolvedSteps: Record<string, Step>,
  envVariables: Record<string, Record<string, any>>,
  presentIn: string[],
): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  for (const { field, getValue } of FIELD_DESCRIPTORS) {
    const values: Record<string, string | undefined> = {};
    for (const env of presentIn) {
      values[env] = getValue(resolvedSteps[env], envVariables[env]);
    }

    if (new Set(Object.values(values)).size > 1) {
      diffs.push({ field, values });
    }
  }

  return diffs;
}

function diffSteps(
  steps: Step[],
  environments: string[],
  envVariables: Record<string, Record<string, any>>,
  parentPath: string,
  entries: StepDiffEntry[],
): number {
  let identicalCount = 0;

  for (const [index, step] of steps.entries()) {
    const path = parentPath ? `${parentPath}.${index + 1}` : `${index + 1}`;
    const presentIn = environments.filter((env) =>
      shouldRenderStepForEnvironment(step, env),
    );
    const absentIn = environments.filter((env) => !presentIn.includes(env));

    if (presentIn.length > 0) {
      if (presentIn.length < environments.length) {
        entries.push({
          path,
          name: step.name,
          presentIn,
          absentIn,
          fieldDiffs: [],
        });
      } else {
        const resolvedSteps: Record<string, Step> = {};
        for (const env of presentIn) {
          resolvedSteps[env] = mergeStepVariant(step, env);
        }

        const fieldDiffs = compareStep(resolvedSteps, envVariables, presentIn);

        if (fieldDiffs.length > 0) {
          entries.push({
            path,
            name: step.name,
            presentIn,
            absentIn,
            fieldDiffs,
          });
        } else {
          identicalCount += 1;
        }
      }
    }

    if (step.sub_steps && step.sub_steps.length > 0) {
      identicalCount += diffSteps(
        step.sub_steps,
        environments,
        envVariables,
        path,
        entries,
      );
    }
  }

  return identicalCount;
}

export function diffEnvironments(
  operation: Operation,
  environments: string[],
): EnvironmentDiffReport {
  if (environments.length < 2) {
    throw new Error(
      'At least two environments are required to compare (got ' +
        `${environments.length})`,
    );
  }

  const envVariables: Record<string, Record<string, any>> = {};
  for (const envName of environments) {
    const environment = operation.environments.find(
      (env) => env.name === envName,
    );
    if (!environment) {
      throw new Error(`Environment not found in operation: ${envName}`);
    }
    envVariables[envName] = environment.variables ?? {};
  }

  const entries: StepDiffEntry[] = [];
  const identicalCount = diffSteps(
    operation.steps,
    environments,
    envVariables,
    '',
    entries,
  );

  const differingCount = entries.filter(
    (entry) => entry.absentIn.length === 0 && entry.fieldDiffs.length > 0,
  ).length;
  const envSpecificCount = entries.filter(
    (entry) => entry.absentIn.length > 0,
  ).length;

  return {
    operationName: operation.name,
    environments,
    entries,
    totalSteps: entries.length + identicalCount,
    identicalCount,
    differingCount,
    envSpecificCount,
  };
}

const NOT_SET = '(not set)';

/**
 * Renders a full unified-diff (`--- a` / `+++ b` / `-`/`+`/` ` lines) between
 * two values. Unlike a typical `diff -u`, context is never collapsed — every
 * line of both values is shown, so nothing gets hidden from the operator.
 */
export function buildUnifiedDiffLines(
  labelA: string,
  valueA: string | undefined,
  labelB: string,
  valueB: string | undefined,
): string[] {
  const lines: string[] = [`--- ${labelA}`, `+++ ${labelB}`];

  if (valueA === undefined || valueB === undefined) {
    if (valueA === undefined) {
      lines.push(`-${NOT_SET}`);
    } else {
      for (const line of valueA.split('\n')) lines.push(`-${line}`);
    }
    if (valueB === undefined) {
      lines.push(`+${NOT_SET}`);
    } else {
      for (const line of valueB.split('\n')) lines.push(`+${line}`);
    }
    return lines;
  }

  for (const part of diffLines(valueA, valueB)) {
    const partLines = part.value.split('\n');
    if (partLines[partLines.length - 1] === '') partLines.pop();

    const prefix = part.added ? '+' : part.removed ? '-' : ' ';
    for (const line of partLines) {
      lines.push(`${prefix}${line}`);
    }
  }

  return lines;
}

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function colorizeDiffLine(line: string): string {
  if (line.startsWith('--- ') || line.startsWith('+++ ')) {
    return `${BOLD}${line}${RESET}`;
  }
  if (line.startsWith('+')) return `${GREEN}${line}${RESET}`;
  if (line.startsWith('-')) return `${RED}${line}${RESET}`;
  return line;
}

function renderFieldDiff(
  fieldDiff: FieldDiff,
  anchor: string,
  others: string[],
  useColor: boolean,
): string[] {
  const lines: string[] = [];

  for (const env of others) {
    if (fieldDiff.values[env] === fieldDiff.values[anchor]) continue;

    for (const diffLine of buildUnifiedDiffLines(
      anchor,
      fieldDiff.values[anchor],
      env,
      fieldDiff.values[env],
    )) {
      lines.push(useColor ? colorizeDiffLine(diffLine) : diffLine);
    }
  }

  return lines;
}

export function formatDiffAsText(report: EnvironmentDiffReport): string {
  const useColor = process.stdout.isTTY === true;
  const [anchor, ...others] = report.environments;
  const lines: string[] = [];
  lines.push(
    `🔍 Comparing ${report.environments.join(', ')} ` +
      `(anchor: ${anchor}) — ${report.operationName}`,
  );
  lines.push('');

  for (const entry of report.entries) {
    lines.push(`📋 Step ${entry.path}: ${entry.name}`);

    if (entry.absentIn.length > 0) {
      lines.push(
        `   ⚠️  present in: ${entry.presentIn.join(', ')} · ` +
          `absent in: ${entry.absentIn.join(', ')}`,
      );
    } else {
      for (const fieldDiff of entry.fieldDiffs) {
        lines.push(`   ${fieldDiff.field}:`);
        for (const line of renderFieldDiff(
          fieldDiff,
          anchor,
          others,
          useColor,
        )) {
          lines.push(`     ${line}`);
        }
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
  const [anchor, ...others] = report.environments;
  const lines: string[] = [];
  lines.push(`# Environment Diff Report: ${report.environments.join(' vs ')}`);
  lines.push('');
  lines.push(`**Operation:** ${report.operationName}`);
  lines.push(`**Comparison anchor:** ${anchor}`);
  lines.push('');

  for (const entry of report.entries) {
    lines.push(`## Step ${entry.path}: ${entry.name}`);
    lines.push('');

    if (entry.absentIn.length > 0) {
      lines.push(
        `> ⚠️ Present in: **${entry.presentIn.join(', ')}** — ` +
          `absent in: **${entry.absentIn.join(', ')}**`,
      );
    } else {
      for (const fieldDiff of entry.fieldDiffs) {
        lines.push(`### ${fieldDiff.field}`);
        lines.push('');
        lines.push('```diff');
        lines.push(...renderFieldDiff(fieldDiff, anchor, others, false));
        lines.push('```');
        lines.push('');
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
