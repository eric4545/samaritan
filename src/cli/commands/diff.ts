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
  .description('Compare how steps render across two or more environments')
  .argument('<operation>', 'Path to operation YAML file')
  .argument(
    '<environments...>',
    'Environments to compare (the first one is the comparison anchor)',
  )
  .option(
    '-o, --output <file>',
    'Write Markdown report to file (in addition to terminal output)',
  )
  .action(
    async (
      operationFile: string,
      environments: string[],
      options: DiffOptions,
    ) => {
      try {
        if (environments.length < 2) {
          console.error(
            '❌ Failed to compare environments: at least two environments are required',
          );
          process.exit(1);
        }

        const operation = await parseOperation(operationFile);
        const report = diffEnvironments(operation, environments);

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
