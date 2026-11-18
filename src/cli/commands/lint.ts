import { existsSync } from 'node:fs';
import { Command } from 'commander';
import {
  type LintConfig,
  LintConfigError,
  loadLintConfig,
} from '../../lib/lint/config';
import {
  countBySeverity,
  type LintFinding,
  lintOperation,
  ruleSetting,
} from '../../lib/lint/engine';
import { RULE_IDS, RULES } from '../../lib/lint/rules';
import { parseOperation } from '../../operations/parser';

/** Exit codes: 0 clean (warnings allowed), 1 lint errors, 2 could not lint. */
export const LINT_EXIT = { ok: 0, problems: 1, fatal: 2 } as const;

export interface FileLintResult {
  file: string;
  config?: string;
  findings: LintFinding[];
  errorCount: number;
  warningCount: number;
  /** Set when the file could not be linted (missing, unparseable, bad config). */
  fatal?: string;
}

export async function lintFile(
  file: string,
  explicitConfig?: string,
): Promise<FileLintResult> {
  const empty = { file, findings: [], errorCount: 0, warningCount: 0 };
  if (!existsSync(file)) return { ...empty, fatal: `file not found: ${file}` };

  let config: LintConfig;
  try {
    config = loadLintConfig(file, RULE_IDS, explicitConfig);
  } catch (error) {
    if (error instanceof LintConfigError) {
      return { ...empty, fatal: `lint config: ${error.message}` };
    }
    throw error;
  }

  try {
    const operation = await parseOperation(file);
    const findings = lintOperation(operation, { operationFile: file, config });
    const { errors, warnings } = countBySeverity(findings);
    return {
      file,
      config: config.source,
      findings,
      errorCount: errors,
      warningCount: warnings,
    };
  } catch (error) {
    return {
      ...empty,
      config: config.source,
      fatal: `cannot parse: ${String((error as Error).message).split('\n')[0]}`,
    };
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
    if (!r.fatal && r.findings.length === 0) continue;
    out.push(r.file);
    if (r.fatal) out.push(`  fatal    ${r.fatal}`);
    const width = Math.max(0, ...r.findings.map((f) => f.ruleId.length));
    for (const f of r.findings) {
      out.push(
        `  ${f.severity.padEnd(7)}  ${f.ruleId.padEnd(width)}  ${f.message}`,
      );
    }
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

/** The registry as a Markdown table, with the effective severity. */
export function formatRuleList(config?: LintConfig): string {
  const lines = [
    '| Rule | Default | Tier | What it flags |',
    '| --- | --- | --- | --- |',
  ];
  for (const rule of RULES) {
    const setting = config ? ruleSetting(rule, config) : rule.defaultSeverity;
    lines.push(
      `| \`${rule.id}\` | ${setting} | ${rule.tier} | ${rule.description.replace(/\|/g, '\\|')} |`,
    );
  }
  return lines.join('\n');
}

interface LintCliOptions {
  format: string;
  maxWarnings?: string;
  listRules?: boolean;
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
      process.exit(LINT_EXIT.ok);
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
      results.push(await lintFile(file, explicitConfig));
    }
    console.log(
      options.format === 'json'
        ? formatJson(results)
        : formatText(results, maxWarnings),
    );
    process.exit(lintExitCode(results, maxWarnings));
  });

export { lintCommand };
