#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to the TypeScript CLI entry point
const cliPath = join(__dirname, '../src/cli/index.ts');

// Use tsx (now a production dependency) to run TypeScript directly
const child = spawn('node', [join(__dirname, '../node_modules/tsx/dist/cli.mjs'), cliPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: false
});

child.on('close', (code) => {
  process.exit(code);
});

child.on('error', (error) => {
  console.error('Failed to start SAMARITAN:', error.message);
  console.error('This might be a dependency resolution issue. Try running: npm install');
  process.exit(1);
});