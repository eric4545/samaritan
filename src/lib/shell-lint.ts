import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Operation, Step } from '../models/operation';

/**
 * A single shellcheck finding, annotated with the step it came from.
 */
export interface ShellLintFinding {
  stepName: string;
  source: 'command' | 'script';
  line: number;
  level: string; // shellcheck level: error | warning | info | style
  code: number; // SCxxxx (numeric part)
  message: string;
}

interface ShellcheckComment {
  line: number;
  level: string;
  code: number;
  message: string;
}

/**
 * Whether the `shellcheck` binary is callable on the current PATH. Used to
 * gracefully skip linting (with a notice) when it isn't installed — linting is
 * an optional best-effort pass, never a hard requirement.
 */
export function isShellcheckAvailable(): boolean {
  const probe = spawnSync('shellcheck', ['--version'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}

/**
 * Map shellcheck's JSON output to annotated findings. Pure (no process
 * spawning) so it can be unit-tested with captured fixtures regardless of
 * whether shellcheck is installed.
 */
export function parseShellcheckJson(
  json: string,
  stepName: string,
  source: 'command' | 'script',
): ShellLintFinding[] {
  if (!json.trim()) return [];
  let comments: unknown;
  try {
    comments = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(comments)) return [];
  return (comments as ShellcheckComment[]).map((c) => ({
    stepName,
    source,
    line: c.line,
    level: c.level,
    code: c.code,
    message: c.message,
  }));
}

function runShellcheck(script: string): string {
  // `-s bash` so shell fragments without a shebang are still analyzed; `-`
  // reads the script from stdin. shellcheck exits non-zero when it finds
  // issues, but still writes the JSON report to stdout.
  const res = spawnSync('shellcheck', ['-f', 'json', '-s', 'bash', '-'], {
    input: script,
    encoding: 'utf8',
  });
  return res.stdout || '';
}

/**
 * Lint a single shell snippet (an inline command or a script file's contents).
 */
export function lintScript(
  script: string,
  stepName: string,
  source: 'command' | 'script',
): ShellLintFinding[] {
  if (!script.trim()) return [];
  return parseShellcheckJson(runShellcheck(script), stepName, source);
}

/**
 * Walk every step (and sub-step) of an operation, linting inline `command`s and
 * the contents of referenced `script` files. Script paths resolve relative to
 * the operation file; missing script files are skipped silently (the generator
 * surfaces that separately).
 */
export function lintOperationCommands(
  operation: Operation,
  operationFile: string,
): ShellLintFinding[] {
  const operationDir = dirname(resolve(operationFile));
  const findings: ShellLintFinding[] = [];

  const visit = (steps: Step[] | undefined): void => {
    if (!steps) return;
    for (const step of steps) {
      if (step.command) {
        findings.push(...lintScript(step.command, step.name, 'command'));
      }
      if (step.script) {
        const scriptPath = resolve(operationDir, step.script);
        if (existsSync(scriptPath)) {
          findings.push(
            ...lintScript(
              readFileSync(scriptPath, 'utf8'),
              step.name,
              'script',
            ),
          );
        }
      }
      visit(step.sub_steps);
    }
  };

  visit(operation.steps);
  return findings;
}

/**
 * Format a finding as a single human-readable line, e.g.
 * `step "Deploy" (command) line 2: [SC2086] Double quote to prevent globbing`.
 */
export function formatFinding(f: ShellLintFinding): string {
  return `step "${f.stepName}" (${f.source}) line ${f.line}: [SC${f.code}] ${f.message}`;
}
