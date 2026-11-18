import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Operation } from '../models/operation';
import { stepDisplayName, walkOperationSteps } from './step-walk';

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

/**
 * shellcheck codes never reported for step commands (actionlint's list for
 * masked placeholders). SC2050/SC2194/SC2157/SC2043: a masked `${VAR}` reads
 * as a constant. SC2154: a step's command runs in the operation's persistent
 * shell, so a variable set by an earlier step looks unassigned. SC1091:
 * `source`d files are not on the linting machine.
 */
export const SHELLCHECK_EXCLUDED = [
  'SC1091',
  'SC2050',
  'SC2194',
  'SC2154',
  'SC2157',
  'SC2043',
];

/**
 * Replace SAMARITAN `${NAME}` placeholders with underscores of the same
 * length (columns stay put). SAMARITAN substitutes them before the command
 * reaches the shell, so shellcheck must not see them as shell variables
 * (`rm -rf ${DIR}` is not SC2086). Shell expansions such as `${X:?}`, `$X`
 * and `${X%.txt}` are not placeholders and are kept.
 */
export function maskTemplateVars(command: string): string {
  return command.replace(/\$\{\w+\}/g, (m) => '_'.repeat(m.length));
}

function runShellcheck(script: string, exclude: string[] = []): string {
  // `-s bash` so shell fragments without a shebang are still analyzed; `-`
  // reads the script from stdin. shellcheck exits non-zero when it finds
  // issues, but still writes the JSON report to stdout.
  const args = ['-f', 'json', '-s', 'bash'];
  if (exclude.length > 0) args.push('-e', exclude.join(','));
  const res = spawnSync('shellcheck', [...args, '-'], {
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
  // Inline commands go through SAMARITAN substitution first: mask its
  // placeholders and drop the codes they (and the shared shell) trigger.
  // Script files run as they are.
  const text = source === 'command' ? maskTemplateVars(script) : script;
  const exclude = source === 'command' ? SHELLCHECK_EXCLUDED : [];
  return parseShellcheckJson(runShellcheck(text, exclude), stepName, source);
}

/**
 * Walk every step, sub-step and rollback step (step-level and operation-level)
 * of an operation, linting inline `command`s and
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

  for (const step of walkOperationSteps(operation)) {
    const name = stepDisplayName(step);
    if (step.command) {
      findings.push(...lintScript(step.command, name, 'command'));
    }
    if (step.script) {
      // Read once: a missing script file is skipped (no check-then-read).
      let text: string | undefined;
      try {
        text = readFileSync(resolve(operationDir, step.script), 'utf8');
      } catch {
        text = undefined;
      }
      if (text !== undefined) {
        findings.push(...lintScript(text, name, 'script'));
      }
    }
  }
  return findings;
}

/**
 * Format a finding as a single human-readable line, e.g.
 * `step "Deploy" (command) line 2: [SC2086] Double quote to prevent globbing`.
 */
export function formatFinding(f: ShellLintFinding): string {
  return `step "${f.stepName}" (${f.source}) line ${f.line}: [SC${f.code}] ${f.message}`;
}
