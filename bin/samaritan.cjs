#!/usr/bin/env node

// Ultra-robust CommonJS bin script for maximum npx compatibility
const { spawn } = require('child_process');
const { join } = require('path');
const { existsSync } = require('fs');

// Path to TypeScript CLI entry point
const cliPath = join(__dirname, '..', 'src', 'cli', 'index.ts');

function runCli() {
  // Check if dependencies are installed
  const nodeModulesPath = join(__dirname, '..', 'node_modules');
  if (!existsSync(nodeModulesPath)) {
    console.error('Dependencies not installed. Installing...');
    const install = spawn('npm', ['install', '--production'], {
      stdio: 'inherit',
      cwd: join(__dirname, '..')
    });

    install.on('close', (code) => {
      if (code !== 0) {
        console.error('Failed to install dependencies');
        process.exit(1);
      }
      startCli();
    });

    install.on('error', (err) => {
      console.error('Install failed:', err.message);
      process.exit(1);
    });

    return;
  }

  startCli();
}

function startCli() {
  // Try multiple tsx execution methods in order of preference
  const attempts = [
    // Method 1: Local tsx binary
    () => {
      const tsxPath = join(__dirname, '..', 'node_modules', '.bin', 'tsx');
      if (existsSync(tsxPath)) {
        return spawn(tsxPath, [cliPath, ...process.argv.slice(2)], { stdio: 'inherit' });
      }
      return null;
    },

    // Method 2: Direct tsx via node
    () => {
      const tsxMain = join(__dirname, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
      if (existsSync(tsxMain)) {
        return spawn('node', [tsxMain, cliPath, ...process.argv.slice(2)], { stdio: 'inherit' });
      }
      return null;
    },

    // Method 3: Global npx fallback
    () => spawn('npx', ['tsx', cliPath, ...process.argv.slice(2)], { stdio: 'inherit', shell: true })
  ];

  let attemptIndex = 0;

  function tryNextAttempt() {
    if (attemptIndex >= attempts.length) {
      console.error('All execution methods failed. Please install tsx globally: npm install -g tsx');
      process.exit(1);
      return;
    }

    const child = attempts[attemptIndex]();
    attemptIndex++;

    if (!child) {
      tryNextAttempt();
      return;
    }

    child.on('error', (err) => {
      if (err.code === 'ENOENT' && attemptIndex < attempts.length) {
        tryNextAttempt();
      } else {
        console.error('SAMARITAN CLI error:', err.message);
        process.exit(1);
      }
    });

    child.on('close', (code) => process.exit(code || 0));
  }

  tryNextAttempt();
}

runCli();