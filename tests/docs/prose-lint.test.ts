import assert from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';
import type { Command } from 'commander';
import { buildProgram } from '../../src/cli/program';

// The generated reference cannot drift, because it is derived from the command
// tree. Hand-written PROSE still can — and did: `generate confluence` was
// documented in three separate files despite never existing, `create operation
// --env` named a command and a flag that are both absent, and `init [directory]`
// invented a positional argument.
//
// This test parses every `samaritan ...` invocation out of the committed prose and
// resolves it against the real command tree, so a command or flag that does not
// exist fails the build instead of misleading an operator mid-incident.

const REPO_ROOT = join(__dirname, '..', '..');

/** Committed prose. `docs/reference/` is generated, so it is not prose. */
const SCAN_ROOTS = [
  'README.md',
  'USAGE.md',
  'CLAUDE.md',
  'ROADMAP.md',
  'docs',
  '.claude',
];
const SKIP_DIRS = new Set(['reference', 'node_modules', '.vitepress']);

/** Flags Commander provides on every command without registering them. */
const IMPLICIT_FLAGS = new Set(['-h', '--help', '-V', '--version']);

function markdownFiles(target: string, acc: string[] = []): string[] {
  const absolute = join(REPO_ROOT, target);
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(absolute);
  } catch {
    return acc;
  }

  if (stats.isFile()) {
    if (absolute.endsWith('.md')) acc.push(absolute);
    return acc;
  }

  for (const entry of readdirSync(absolute)) {
    if (SKIP_DIRS.has(entry)) continue;
    markdownFiles(join(target, entry), acc);
  }
  return acc;
}

/** Flag names declared by an option, e.g. `-e, --env <x>` -> ['-e', '--env']. */
function flagNames(option: { flags: string }): string[] {
  return option.flags.split(/[\s,|]+/).filter((token) => token.startsWith('-'));
}

function allowedFlags(cmd: Command): Set<string> {
  const allowed = new Set<string>(IMPLICIT_FLAGS);
  let current: Command | null = cmd;
  while (current) {
    for (const option of current.options) {
      for (const name of flagNames(option)) allowed.add(name);
    }
    current = current.parent;
  }
  return allowed;
}

function findSubcommand(cmd: Command, name: string): Command | undefined {
  return cmd.commands.find(
    (c) => c.name() === name || c.aliases().includes(name),
  );
}

interface Invocation {
  file: string;
  line: number;
  raw: string;
  path: string[];
  flags: string[];
}

/** Recognises `samaritan …`, `npx github:owner/samaritan …` and `npm start -- …`. */
const INVOCATION =
  /(?:npx\s+[^\s]*samaritan|npm\s+(?:run\s+)?start\s+--|samaritan)\s+([^\n`|]*)/g;

function parseInvocations(file: string, contents: string): Invocation[] {
  const invocations: Invocation[] = [];
  contents.split('\n').forEach((line, index) => {
    if (line.includes('prose-lint-ignore')) return;

    for (const match of line.matchAll(INVOCATION)) {
      const tokens = match[1]
        .trim()
        .split(/\s+/)
        .filter((t) => t.length > 0);
      const path: string[] = [];
      const flags: string[] = [];

      for (const token of tokens) {
        if (token.startsWith('-')) {
          // Strip `=value`; keep the flag itself.
          flags.push(token.split('=')[0].replace(/[.,;:)]+$/, ''));
        } else if (
          flags.length === 0 &&
          /^[a-z][a-z-]*$/.test(token) &&
          path.length < 3
        ) {
          path.push(token);
        }
      }

      if (path.length > 0 || flags.length > 0) {
        invocations.push({
          file,
          line: index + 1,
          raw: match[0].trim(),
          path,
          flags,
        });
      }
    }
  });
  return invocations;
}

describe('prose references real CLI commands and flags', () => {
  const program = buildProgram();
  const files = SCAN_ROOTS.flatMap((root) => markdownFiles(root));
  const invocations = files.flatMap((file) =>
    parseInvocations(relative(REPO_ROOT, file), readFileSync(file, 'utf-8')),
  );

  it('scans a non-trivial amount of prose', () => {
    // Guards against the linter silently passing because its file discovery or
    // its regex quietly stopped matching anything.
    assert.ok(files.length > 0, 'no markdown files discovered');
    assert.ok(
      invocations.length > 0,
      'no samaritan invocations found in prose — the parser is probably broken',
    );
  });

  it('every documented subcommand exists', () => {
    const failures: string[] = [];

    for (const invocation of invocations) {
      let cmd: Command = program;
      for (const segment of invocation.path) {
        const next = findSubcommand(cmd, segment);
        // A non-command token is a positional argument (a file path, a session
        // id); once one appears the rest of the path is data, not commands.
        if (!next) break;
        cmd = next;
      }

      // A token that looks like a subcommand of the resolved command's PARENT but
      // is not one of its own is the `generate confluence` failure mode.
      const consumed: string[] = [];
      let walker: Command = program;
      for (const segment of invocation.path) {
        const next = findSubcommand(walker, segment);
        if (!next) {
          if (
            walker !== program &&
            walker.commands.length > 0 &&
            consumed.length > 0
          ) {
            failures.push(
              `${invocation.file}:${invocation.line}: "${consumed.join(' ')} ${segment}" — ` +
                `"${segment}" is not a subcommand of "${consumed.join(' ')}" ` +
                `(valid: ${walker.commands.map((c) => c.name()).join(', ')})`,
            );
          }
          break;
        }
        consumed.push(segment);
        walker = next;
      }
    }

    assert.deepStrictEqual(failures, [], `\n${failures.join('\n')}\n`);
  });

  it('every documented flag exists on the command it is used with', () => {
    const failures: string[] = [];

    for (const invocation of invocations) {
      let cmd: Command = program;
      for (const segment of invocation.path) {
        const next = findSubcommand(cmd, segment);
        if (!next) break;
        cmd = next;
      }

      const allowed = allowedFlags(cmd);
      for (const flag of invocation.flags) {
        if (!allowed.has(flag)) {
          failures.push(
            `${invocation.file}:${invocation.line}: "${flag}" is not a flag of ` +
              `"samaritan ${invocation.path.join(' ')}" (in: ${invocation.raw})`,
          );
        }
      }
    }

    assert.deepStrictEqual(failures, [], `\n${failures.join('\n')}\n`);
  });
});
