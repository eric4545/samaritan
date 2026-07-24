import { Command } from 'commander';
import { diffCommand } from './commands/diff';
import { generateCommand } from './commands/generate';
import { postmortemCommand } from './commands/postmortem';
import { projectCommands } from './commands/project';
import { qrhCommand } from './commands/qrh';
import { reportCommand } from './commands/report';
import { resumeCommand, runCommand } from './commands/run';
import { schemaCommand } from './commands/schema';
import { sessionsCommand } from './commands/sessions';
import { validateCommand } from './commands/validate';

/**
 * Build the full CLI command tree.
 *
 * Kept separate from `index.ts` so the tree can be imported and walked without
 * side effects — `index.ts` calls `program.parse()` at module scope, which makes
 * it unusable from the docs generator and from tests. The generated CLI reference
 * (`docs/reference/cli.md`) and the prose linter both introspect this function's
 * return value, so every command must be registered here rather than in `index.ts`.
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name('samaritan')
    .description('SAMARITAN - Operations as Code CLI for SRE teams')
    .version('1.0.0')
    .option('-v, --verbose', 'verbose output')
    .option(
      '--config <path>',
      'path to config file',
      './samaritan.config.yaml',
    );

  // Core project commands
  program.addCommand(projectCommands.init);
  program.addCommand(projectCommands.create);

  // Operation commands
  program.addCommand(validateCommand);
  program.addCommand(generateCommand);
  program.addCommand(runCommand);
  program.addCommand(resumeCommand);
  program.addCommand(sessionsCommand);

  // Schema inspection
  program.addCommand(schemaCommand);

  // Environment comparison
  program.addCommand(diffCommand);

  // Evidence report generation
  program.addCommand(reportCommand);

  // Postmortem / incident report authoring
  program.addCommand(postmortemCommand);

  // Emergency procedures
  program.addCommand(qrhCommand);

  // Global help commands
  program
    .command('help')
    .description('Display help information')
    .action(() => {
      program.help();
    });

  program
    .command('support')
    .description('Get support information')
    .action(() => {
      console.log('💬 Support:');
      console.log(
        '  - GitHub Issues: https://github.com/eric4545/samaritan/issues',
      );
      console.log('  - Documentation: https://eric4545.github.io/samaritan/');
    });

  return program;
}
