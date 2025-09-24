#!/usr/bin/env node

import { Command } from 'commander';
import { generateManualCommand } from './commands/manuals';
import { projectCommands } from './commands/project';
import { validateCommand } from './commands/validate';
import { generateCommand } from './commands/generate';
import { qrhCommand } from './commands/qrh';
import { runCommand, resumeCommand } from './commands/run';

const program = new Command();

program
  .name('samaritan')
  .description('SAMARITAN - Operations as Code CLI for SRE teams')
  .version('1.0.0')
  .option('-v, --verbose', 'verbose output')
  .option('--config <path>', 'path to config file', './samaritan.config.yaml');

// Legacy command for backward compatibility
program.addCommand(generateManualCommand);

// Core project commands
program.addCommand(projectCommands.init);
program.addCommand(projectCommands.create);

// Operation commands
program.addCommand(validateCommand);
program.addCommand(generateCommand);
program.addCommand(runCommand);
program.addCommand(resumeCommand);

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
  .command('docs')
  .description('Open documentation')
  .action(() => {
    console.log('📚 Documentation: https://github.com/samaritan/docs');
    console.log('🚀 Quickstart: https://github.com/samaritan/docs/quickstart.md');
  });

program
  .command('support')
  .description('Get support information')
  .action(() => {
    console.log('💬 Support:');
    console.log('  - GitHub Issues: https://github.com/samaritan/cli/issues');
    console.log('  - Community: https://github.com/samaritan/community');
  });

// Error handling
program.exitOverride();

try {
  program.parse(process.argv);
} catch (error: any) {
  if (error.code === 'commander.unknownCommand') {
    console.error(`❌ Unknown command: ${error.message}`);
    console.log('💡 Use "samaritan help" to see available commands');
    process.exit(1);
  }
  throw error;
}
