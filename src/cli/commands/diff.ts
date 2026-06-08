import { writeFileSync } from 'node:fs';
import { Command } from 'commander';
import {
  diffEnvironments,
  formatDiffAsMarkdown,
  formatDiffAsText,
} from '../../lib/environment-diff';
import { parseOperation } from '../../operations/parser';

interface DiffOptions {
  output?: string;
}

export const diffCommand = new Command('diff')
  .description('Compare how steps render across two environments')
  .argument('<operation>', 'Path to operation YAML file')
  .argument('<envA>', 'First environment to compare')
  .argument('<envB>', 'Second environment to compare')
  .option(
    '-o, --output <file>',
    'Write Markdown report to file (in addition to terminal output)',
  )
  .action(
    async (
      operationFile: string,
      envA: string,
      envB: string,
      options: DiffOptions,
    ) => {
      try {
        const operation = await parseOperation(operationFile);
        const report = diffEnvironments(operation, envA, envB);

        console.log(formatDiffAsText(report));

        if (options.output) {
          writeFileSync(options.output, formatDiffAsMarkdown(report), 'utf-8');
          console.log(`📄 Diff report written to ${options.output}`);
        }
      } catch (error: any) {
        console.error(`❌ Failed to compare environments: ${error.message}`);
        process.exit(1);
      }
    },
  );
