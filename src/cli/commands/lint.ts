import { Command } from 'commander';
import { exitAfterFlush } from '../../lib/exit-after-flush';
import {
  type LintConfig,
  LintConfigError,
  loadLintConfig,
} from '../../lib/lint/config';
import {
  countBySeverity,
  formatLocation,
  type LintFinding,
  LintRuleError,
  lintOperation,
  ruleSetting,
} from '../../lib/lint/engine';
import { BUILTIN_PRESETS, LINT_REGISTRY, RULES } from '../../lib/lint/rules';
import { isShellcheckAvailable } from '../../lib/shell-lint';
import { parseOperation } from '../../operations/parser';

/** Exit codes: 0 clean (warnings allowed), 1 lint errors, 2 could not lint. */
export const LINT_EXIT = { ok: 0, problems: 1, fatal: 2 } as const;

export interface FileLintResult {
  file: string;
  config?: string;
  findings: LintFinding[];
  errorCount: number;
  warningCount: number;
  /** Set when the file could not be linted (missing, unparseable, bad config, a rule crashed). */
  fatal?: string;
  /** Things that did not run but do not fail the file (shellcheck missing). */
  notices?: string[];
}

export async function lintFile(
  file: string,
  explicitConfig?: string,
  profiles: string[] = [],
): Promise<FileLintResult> {
  const empty = { file, findings: [], errorCount: 0, warningCount: 0 };

  let config: LintConfig;
  try {
    config = loadLintConfig(file, LINT_REGISTRY, explicitConfig, profiles);
  } catch (error) {
    if (error instanceof LintConfigError) {
      return { ...empty, fatal: `lint config: ${error.message}` };
    }
    throw error;
  }

  let operation: Awaited<ReturnType<typeof parseOperation>>;
  try {
    operation = await parseOperation(file);
  } catch (error) {
    // The parser reads the file; a missing one fails there (no check-then-read).
    const missing = /^Failed to read file/.test(
      String((error as Error).message),
    );
    return {
      ...empty,
      config: config.source,
      fatal: missing
        ? `file not found: ${file}`
        : `cannot parse: ${String((error as Error).message).split('\n')[0]}`,
    };
  }

  const notices: string[] = [];
  const shellcheck = RULES.find((r) => r.id === 'shell/shellcheck');
  if (
    shellcheck &&
    ruleSetting(shellcheck, config) !== 'off' &&
    !isShellcheckAvailable()
  ) {
    notices.push(
      'shell/shellcheck is on but shellcheck is not on PATH; it was skipped',
    );
  }

  try {
    const findings = lintOperation(operation, { operationFile: file, config });
    const { errors, warnings } = countBySeverity(findings);
    return {
      file,
      config: config.source,
      findings,
      errorCount: errors,
      warningCount: warnings,
      ...(notices.length > 0 ? { notices } : {}),
    };
  } catch (error) {
    if (!(error instanceof LintRuleError)) throw error;
    return { ...empty, config: config.source, fatal: error.message };
  }
}

export function lintExitCode(
  results: FileLintResult[],
  maxWarnings?: number,
): number {
  if (results.some((r) => r.fatal)) return LINT_EXIT.fatal;
  const errors = results.reduce((n, r) => n + r.errorCount, 0);
  const warnings = results.reduce((n, r) => n + r.warningCount, 0);
  if (errors > 0) return LINT_EXIT.problems;
  if (maxWarnings !== undefined && warnings > maxWarnings) {
    return LINT_EXIT.problems;
  }
  return LINT_EXIT.ok;
}

export function formatText(
  results: FileLintResult[],
  maxWarnings?: number,
): string {
  const out: string[] = [];
  for (const r of results) {
    if (!r.fatal && r.findings.length === 0 && !r.notices) continue;
    out.push(r.file);
    if (r.fatal) out.push(`  fatal    ${r.fatal}`);
    for (const notice of r.notices ?? []) out.push(`  notice   ${notice}`);
    const where = r.findings.map((f) => formatLocation(f.location, r.file));
    const width = Math.max(0, ...r.findings.map((f) => f.ruleId.length));
    const whereWidth = Math.max(0, ...where.map((w) => w.length));
    r.findings.forEach((f, k) => {
      out.push(
        `  ${where[k].padEnd(whereWidth)}  ${f.severity.padEnd(7)}  ${f.ruleId.padEnd(width)}  ${f.message}`,
      );
    });
    out.push('');
  }
  const errors = results.reduce((n, r) => n + r.errorCount, 0);
  const warnings = results.reduce((n, r) => n + r.warningCount, 0);
  const fatal = results.filter((r) => r.fatal).length;
  const total = errors + warnings;
  if (total === 0 && fatal === 0) {
    out.push(`✔ No problems in ${results.length} file(s)`);
  } else {
    out.push(
      `✖ ${total} problem${total === 1 ? '' : 's'} (${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'})${fatal ? `, ${fatal} file(s) not linted` : ''}`,
    );
  }
  if (maxWarnings !== undefined && warnings > maxWarnings) {
    out.push(`✖ ${warnings} warnings exceed --max-warnings ${maxWarnings}`);
  }
  return out.join('\n');
}

export function formatJson(results: FileLintResult[]): string {
  return JSON.stringify(
    {
      files: results,
      errorCount: results.reduce((n, r) => n + r.errorCount, 0),
      warningCount: results.reduce((n, r) => n + r.warningCount, 0),
    },
    null,
    2,
  );
}

const CELL_ENTITIES: Record<string, string> = {
  '|': '&#124;',
  '<': '&lt;',
  '>': '&gt;',
};

/**
 * Text for one Markdown table cell. Outside code spans `|` is written as an
 * entity (no backslash escaping, so nothing to double-escape), and for a page
 * rendered as HTML (`html`) `<` and `>` too: `in <env>` would otherwise open
 * a tag (VitePress fails the build on it). An entity is not decoded inside a
 * code span, so a `|` there cannot be written at all: rule descriptions never
 * contain one (tests/lib/lint-conformance.test.ts).
 */
export function tableCell(text: string, html = false): string {
  return text
    .split(/(`[^`]*`)/)
    .map((part) => {
      if (part.startsWith('`')) {
        if (part.includes('|')) {
          throw new Error(`a table cell cannot hold | in a code span: ${part}`);
        }
        return part;
      }
      return part.replace(html ? /[|<>]/g : /\|/g, (c) => CELL_ENTITIES[c]);
    })
    .join('');
}

/** The registry as a Markdown table, with the effective severity. */
export function formatRuleList(config?: LintConfig, html = false): string {
  const lines = [
    '| Rule | Default | `samaritan:strict` | `samaritan:all` | Tier | What it flags |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const rule of RULES) {
    const setting = config ? ruleSetting(rule, config) : rule.defaultSeverity;
    const strict = BUILTIN_PRESETS['samaritan:strict'][rule.id] ?? setting;
    const all = BUILTIN_PRESETS['samaritan:all'][rule.id] ?? setting;
    lines.push(
      `| \`${rule.id}\` | ${setting} | ${strict} | ${all} | ${rule.tier} | ${tableCell(rule.description, html)} |`,
    );
  }
  return lines.join('\n');
}

interface LintCliOptions {
  format: string;
  maxWarnings?: string;
  listRules?: boolean;
  strict?: boolean;
}

const lintCommand = new Command('lint')
  .description(
    'Lint operations with named rules: command shapes, team bans and required flags (see docs/linting.md)',
  )
  .argument('[files...]', 'Operation YAML files')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .option(
    '--max-warnings <n>',
    'Fail (exit 1) when there are more than <n> warnings',
  )
  .option(
    '--strict',
    'Apply the samaritan:strict profile (before the config file, which can still override it)',
  )
  .option('--list-rules', 'Print every rule with its default severity and tier')
  .action(async (files: string[], options: LintCliOptions, cmd: Command) => {
    // The global --config applies only when given on the command line;
    // otherwise each file uses its nearest samaritan.config.yaml.
    const root = cmd.parent;
    const explicitConfig =
      root?.getOptionValueSource('config') === 'cli'
        ? (root.opts().config as string)
        : undefined;

    if (options.listRules) {
      console.log(formatRuleList());
      return exitAfterFlush(LINT_EXIT.ok);
    }
    if (files.length === 0) {
      console.error('error: give at least one operation file');
      process.exit(LINT_EXIT.fatal);
    }
    if (!['text', 'json'].includes(options.format)) {
      console.error(`error: unknown --format '${options.format}' (text, json)`);
      process.exit(LINT_EXIT.fatal);
    }
    let maxWarnings: number | undefined;
    if (options.maxWarnings !== undefined) {
      maxWarnings = Number(options.maxWarnings);
      if (!Number.isInteger(maxWarnings) || maxWarnings < 0) {
        console.error('error: --max-warnings needs a whole number ≥ 0');
        process.exit(LINT_EXIT.fatal);
      }
    }

    const results: FileLintResult[] = [];
    for (const file of files) {
      results.push(
        await lintFile(
          file,
          explicitConfig,
          options.strict ? ['samaritan:strict'] : [],
        ),
      );
    }
    console.log(
      options.format === 'json'
        ? formatJson(results)
        : formatText(results, maxWarnings),
    );
    return exitAfterFlush(lintExitCode(results, maxWarnings));
  });

export { lintCommand };
