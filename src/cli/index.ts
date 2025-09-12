#!/usr/bin/env node

import { Command } from 'commander';
import { generateManualCommand } from './commands/manuals';

const program = new Command();

program
  .name('samaritan')
  .description('Samaritan CLI - Your SRE sidekick')
  .version('1.0.0');

program.addCommand(generateManualCommand);

program.parse(process.argv);
