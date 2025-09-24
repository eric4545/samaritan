#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Always use TypeScript source with tsx for reliability
const cliPath = join(__dirname, '../src/cli/index.ts');

// First try to find tsx locally, then globally
const child = spawn('tsx', [cliPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: false
});

child.on('close', (code) => {
  process.exit(code);
});

child.on('error', (error) => {
  // If tsx is not found, try with npx
  if (error.code === 'ENOENT') {
    console.error('tsx not found locally, trying with npx...');
    const fallback = spawn('npx', ['tsx', cliPath, ...process.argv.slice(2)], {
      stdio: 'inherit',
      shell: true
    });

    fallback.on('close', (code) => {
      process.exit(code);
    });

    fallback.on('error', (fallbackError) => {
      console.error('Failed to start SAMARITAN:', fallbackError.message);
      console.error('Make sure tsx is installed: npm install tsx');
      process.exit(1);
    });
  } else {
    console.error('Failed to start SAMARITAN:', error.message);
    process.exit(1);
  }
});