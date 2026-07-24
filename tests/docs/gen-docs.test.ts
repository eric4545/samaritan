import assert from 'node:assert';
import { describe, it } from 'node:test';
import type { Command } from 'commander';
import { renderCliReference } from '../../scripts/gen-docs/cli';
import { renderSchemaReference } from '../../scripts/gen-docs/schema';
import { buildProgram } from '../../src/cli/program';

// The generated reference is a build artifact (docs/reference/ is gitignored), so
// there is no committed copy to diff against. What must be guaranteed instead is
// that the generator is COMPLETE: a command or flag that exists in the CLI but is
// skipped by the renderer would silently reintroduce exactly the drift this whole
// mechanism exists to remove.

function allCommands(cmd: Command, acc: Command[] = []): Command[] {
  for (const child of cmd.commands) {
    if (child.name() === 'help') continue;
    acc.push(child);
    allCommands(child, acc);
  }
  return acc;
}

describe('CLI reference generator', () => {
  const program = buildProgram();
  const output = renderCliReference(program);

  it('documents every registered command', () => {
    // Commands are rendered under their full invocable path (`generate manual`),
    // not their bare name, so assert on the path.
    const fullPath = (cmd: Command): string => {
      const parts: string[] = [];
      let current: Command | null = cmd;
      while (current?.parent) {
        parts.unshift(current.name());
        current = current.parent;
      }
      return parts.join(' ');
    };
    const missing = allCommands(program)
      .map(fullPath)
      .filter((path) => !output.includes(`\`${path}\``));
    assert.deepStrictEqual(
      missing,
      [],
      `commands missing from generated docs: ${missing}`,
    );
  });

  it('documents every flag of every command', () => {
    const missing: string[] = [];
    for (const cmd of [program, ...allCommands(program)]) {
      for (const option of cmd.options) {
        if (!output.includes(option.flags)) {
          missing.push(`${cmd.name()} ${option.flags}`);
        }
      }
    }
    assert.deepStrictEqual(
      missing,
      [],
      `flags missing from generated docs: ${missing}`,
    );
  });

  it('documents every positional argument', () => {
    const missing: string[] = [];
    for (const cmd of allCommands(program)) {
      for (const arg of cmd.registeredArguments) {
        if (!output.includes(`\`${arg.name()}\``)) {
          missing.push(`${cmd.name()} <${arg.name()}>`);
        }
      }
    }
    assert.deepStrictEqual(
      missing,
      [],
      `arguments missing from generated docs: ${missing}`,
    );
  });

  it('records that it is generated, so nobody hand-edits it', () => {
    assert.match(output, /GENERATED FILE — DO NOT EDIT/);
  });

  it('does not invent commands that the CLI does not have', () => {
    // `generate confluence` was documented in three files for a long time and has
    // never existed; the real subcommands are manual/docs/postmortem/schedule.
    assert.ok(!output.includes('generate confluence'));
  });
});

describe('operation YAML reference generator', () => {
  const output = renderSchemaReference();

  it('renders a table for every documented section', () => {
    for (const heading of [
      '## Operation',
      '## Environment',
      '## Step',
      '## Expect config',
    ]) {
      assert.ok(output.includes(heading), `missing section: ${heading}`);
    }
  });

  it('resolves $refs into links rather than leaking pointers', () => {
    assert.ok(
      !output.includes('#/definitions/'),
      'raw $ref pointer leaked into docs',
    );
    assert.ok(
      !output.includes('#/properties/'),
      'raw $ref pointer leaked into docs',
    );
  });

  it('renders oneOf object branches as objects, not "any"', () => {
    // `environments` and `steps` are arrays of oneOf branches that declare no
    // explicit `type`; without object inference they collapse to a useless
    // "any[]". (`foreach.values` is legitimately untyped, so this is targeted.)
    const row = (field: string) =>
      output.split('\n').find((line) => line.startsWith(`| \`${field}\``)) ??
      '';
    assert.match(row('environments'), /object\[\]/);
    assert.match(row('steps'), /object\[\]/);
  });

  it('documents verify as deprecated, everywhere it is accepted', () => {
    // The type column contains escaped pipes (`string \| object`), so match the
    // whole row rather than counting columns.
    const rows = output
      .split('\n')
      .filter((line) => line.startsWith('| `verify`'));
    assert.ok(
      rows.length >= 2,
      'verify should appear on both step and rollback step',
    );
    for (const row of rows) {
      assert.match(
        row,
        /deprecated/i,
        `verify row not marked deprecated: ${row}`,
      );
    }
  });
});
