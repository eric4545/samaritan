#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildProgram } from '../../src/cli/program';
import { renderCliReference } from './cli';
import { renderSchemaReference } from './schema';

/**
 * Documentation generator.
 *
 * Emits the reference pages into `docs/reference/`, which is gitignored — the
 * generated tree is a build artifact, never committed, so there is no committed
 * copy that can fall out of sync with the code. Run via `npm run docs:gen`
 * (which `docs:dev` and `docs:build` invoke first).
 */

const REPO_ROOT = join(__dirname, '..', '..');
const OUT_DIR = join(REPO_ROOT, 'docs', 'reference');

export interface GeneratedFile {
  /** Path relative to the repository root. */
  path: string;
  contents: string;
}

export function generateAll(): GeneratedFile[] {
  return [
    {
      path: 'docs/reference/cli.md',
      contents: renderCliReference(buildProgram()),
    },
    {
      path: 'docs/reference/operation-yaml.md',
      contents: renderSchemaReference(),
    },
  ];
}

function main(): void {
  const files = generateAll();
  const write = process.argv.includes('--write');

  if (!write) {
    for (const file of files) {
      console.log(`--- ${file.path} ---`);
      console.log(file.contents);
    }
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  for (const file of files) {
    const absolute = join(REPO_ROOT, file.path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, file.contents, 'utf-8');
    console.log(`✅ ${file.path}`);
  }
}

if (require.main === module) {
  main();
}
