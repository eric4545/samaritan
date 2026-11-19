import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Command, Option } from 'commander';
import {
  generateReport,
  REPORT_FORMATS,
  type ReportFormat,
  type ReportOptions,
} from '../../lib/report-generator';
import { mergeSessions } from '../../lib/report-merge';

interface ReportCliOptions {
  output?: string;
  format?: ReportFormat;
}

function reportOptions(options: ReportCliOptions): ReportOptions {
  return {
    format: options.format ?? 'markdown',
    // Evidence files are linked relative to where the report is written.
    ...(options.output ? { linkFrom: dirname(resolve(options.output)) } : {}),
  };
}

/**
 * `-f, --format`. No Commander default on purpose: `report merge` reads the
 * options through `optsWithGlobals()`, and a parent default would overwrite
 * the value given to `merge` (see below).
 */
const formatOption = (): Option =>
  new Option(
    '-f, --format <format>',
    'Output format; html is one self-contained file with screenshot/photo evidence embedded (default: markdown)',
  ).choices(REPORT_FORMATS);

function writeOrPrint(
  text: string,
  options: ReportCliOptions,
  what: string,
): void {
  if (options.output) {
    writeFileSync(options.output, text, 'utf-8');
    console.log(`📄 ${what} written to ${options.output}`);
  } else {
    console.log(text);
  }
}

export const reportCommand = new Command('report')
  .description(
    'Generate an evidence report (Markdown or HTML) from a JSONL session log',
  )
  .argument('<jsonl>', 'Path to the JSONL session log file')
  .option('-o, --output <file>', 'Output file path (default: stdout)')
  .addOption(formatOption())
  .action((jsonlPath: string, options: ReportCliOptions) => {
    writeOrPrint(
      generateReport(jsonlPath, reportOptions(options)),
      options,
      'Evidence report',
    );
  });

// `report merge <sessions...>` — consolidate several operators' partial runs of
// the SAME operation (each focused via `run --pic <name>`) into one report,
// attributing every step to the operator who actually ran it.
reportCommand
  .command('merge')
  .description(
    'Merge multiple run sessions of the same operation into one consolidated report',
  )
  .argument('<sessions...>', 'Two or more session IDs to merge')
  .option('-o, --output <file>', 'Output file path (default: stdout)')
  .addOption(formatOption())
  .action(
    (sessions: string[], _options: ReportCliOptions, command: Command) => {
      // The parent `report` declares the same flags, and Commander lets a
      // parent take its own options after the subcommand name: `report merge
      // a b -o out.md` set the PARENT's `output`, so merge printed to stdout
      // and wrote nothing. Read both levels.
      const options = command.optsWithGlobals<ReportCliOptions>();
      let text: string;
      try {
        text = mergeSessions(sessions, reportOptions(options));
      } catch (err: any) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
      }
      writeOrPrint(text, options, 'Merged report');
    },
  );
