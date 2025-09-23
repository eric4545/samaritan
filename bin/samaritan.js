#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to the actual CLI entry point
const cliPath = join(__dirname, '../src/cli/index.ts');

// Use tsx to run TypeScript directly
const tsx = spawn('npx', ['tsx', cliPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true
});

tsx.on('close', (code) => {
  process.exit(code);
});

tsx.on('error', (error) => {
  console.error('Failed to start SAMARITAN:', error.message);
  process.exit(1);
});