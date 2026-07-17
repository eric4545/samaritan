import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExpectConfig, Operation, Step } from '../models/operation';
import {
  type AssertResult,
  assertOutputDetailed,
  cleanTerminalOutput,
} from './assertions';
import { getBuiltinVariables } from './builtin-variables';
import { substituteExpectVars } from './step-resolution';

/**
 * Outcome of replaying one step's `expect` against its pre-captured evidence.
 */
export interface MockStepResult {
  stepName: string;
  status: 'pass' | 'fail' | 'skipped';
  /** Why the step was skipped (only set when status === 'skipped'). */
  reason?: string;
  /** The env-resolved expect that was evaluated. */
  expect?: ExpectConfig | ExpectConfig[] | string;
  /** Full per-check detail (only set when the step was actually evaluated). */
  detailed?: { pass: boolean; actual: string; checks: AssertResult[] };
}

export interface MockRunResult {
  results: MockStepResult[];
  passed: number;
  failed: number;
  skipped: number;
}

/**
 * Concatenate the `command_output`/`log` evidence captured for a given
 * environment into a single output string — the "sample" a mock run asserts
 * against. Inline `content` is used as-is; `file` references are read relative
 * to the operation directory (unreadable files are skipped). Returns
 * `undefined` when the step has no replayable output for the environment.
 */
export function sampleOutputForEnv(
  step: Step,
  environmentName: string,
  operationDir: string,
): string | undefined {
  const results = step.evidence?.results?.[environmentName];
  if (!results || results.length === 0) return undefined;

  const parts: string[] = [];
  for (const r of results) {
    if (r.type !== 'command_output' && r.type !== 'log') continue;
    if (typeof r.content === 'string') {
      parts.push(r.content);
    } else if (r.file) {
      try {
        parts.push(readFileSync(resolve(operationDir, r.file), 'utf-8'));
      } catch {
        // Unreadable evidence file — skip it; other parts may still apply.
      }
    }
  }
  return parts.length > 0 ? parts.join('\n') : undefined;
}

/**
 * Replay each step's `expect` assertions against its pre-captured
 * `evidence.results[<env>]` output — without tmux, a terminal, or any command
 * execution. This validates that the documented verification rules actually
 * match the output that was captured, which is handy in CI.
 *
 * Steps without an `expect` are ignored; steps that have an `expect` but no
 * replayable output for the environment are reported as `skipped`.
 */
export function runMockExpect(
  operation: Operation,
  environmentName: string,
  operationDir: string,
): MockRunResult {
  // Mirror `run`'s variable layering: built-in run-time variables (as low
  // priority defaults) + common variables + env-specific overrides.
  const now = new Date();
  const envVars: Record<string, any> = {
    ...getBuiltinVariables({ startTime: now, now }),
    ...(operation.common_variables ?? {}),
    ...(operation.variables?.[environmentName] ?? {}),
  };

  const results: MockStepResult[] = [];

  const visit = (steps?: Step[]): void => {
    if (!steps) return;
    for (const step of steps) {
      if (step.expect !== undefined) {
        const sample = sampleOutputForEnv(step, environmentName, operationDir);
        if (sample === undefined) {
          results.push({
            stepName: step.name,
            status: 'skipped',
            reason: `no command_output/log evidence for environment "${environmentName}"`,
            expect: step.expect,
          });
        } else {
          const resolvedExpect = substituteExpectVars(
            step.expect,
            envVars,
            step.variables,
          );
          const detailed = assertOutputDetailed(
            cleanTerminalOutput(sample),
            resolvedExpect,
          );
          results.push({
            stepName: step.name,
            status: detailed.pass ? 'pass' : 'fail',
            expect: resolvedExpect,
            detailed,
          });
        }
      }
      visit(step.sub_steps);
    }
  };

  visit(operation.steps);

  return {
    results,
    passed: results.filter((r) => r.status === 'pass').length,
    failed: results.filter((r) => r.status === 'fail').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
  };
}
