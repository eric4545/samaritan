#!/usr/bin/env node

import { buildProgram } from './program';

const program = buildProgram();

// Error handling
program.exitOverride();

try {
  program.parse(process.argv);
} catch (error: any) {
  if (error.code === 'commander.unknownCommand') {
    console.error(`❌ Unknown command: ${error.message}`);
    console.log('💡 Use "samaritan help" to see available commands');
    process.exit(1);
  } else if (
    error.code === 'commander.helpDisplayed' ||
    error.code === 'commander.help'
  ) {
    process.exit(0);
  } else if (error.code === 'commander.version') {
    process.exit(0);
  } else {
    throw error;
  }
}
