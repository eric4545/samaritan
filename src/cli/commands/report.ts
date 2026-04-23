import { writeFileSync } from 'node:fs';
import { Command } from 'commander';
import { generateReport } from '../../lib/report-generator';

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
