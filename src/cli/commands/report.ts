import { writeFileSync } from 'node:fs';
import { Command } from 'commander';
import { generateReport } from '../../lib/report-generator';
import { mergeSessions } from '../../lib/report-merge';

export const reportCommand = new Command('report')
  .description('Generate a Markdown evidence report from a JSONL session log')
  .argument('<jsonl>', 'Path to the JSONL session log file')
  .option('-o, --output <file>', 'Output file path (default: stdout)')
  .action((jsonlPath: string, options: { output?: string }) => {
    const md = generateReport(jsonlPath);

    if (options.output) {
      writeFileSync(options.output, md, 'utf-8');
      console.log(`📄 Evidence report written to ${options.output}`);
    } else {
      console.log(md);
    }
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
  .action((sessions: string[], options: { output?: string }) => {
    let md: string;
    try {
      md = mergeSessions(sessions);
    } catch (err: any) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }

    if (options.output) {
      writeFileSync(options.output, md, 'utf-8');
      console.log(`📄 Merged report written to ${options.output}`);
    } else {
      console.log(md);
    }
  });
