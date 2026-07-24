import type { Command, Option } from 'commander';

/**
 * Render the CLI reference from a Commander tree.
 *
 * The command tree is the single source of truth: every command, argument, flag,
 * default and choice list in the output is read off the live objects built by
 * `buildProgram()`. Nothing here is hand-maintained, so a flag cannot be
 * documented until it is registered, and a command that is removed disappears
 * from the docs on the next build.
 */

/** Escape a value for safe inclusion in a Markdown table cell. */
function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
}

/** Commander stores subcommands on `.commands`; `help` is generated, not authored. */
function subcommands(cmd: Command): Command[] {
  return cmd.commands.filter((c) => c.name() !== 'help');
}

/** The invocable path for a command, e.g. `generate manual`. */
function commandPath(cmd: Command): string {
  const parts: string[] = [];
  let current: Command | null = cmd;
  while (current?.parent) {
    parts.unshift(current.name());
    current = current.parent;
  }
  return parts.join(' ');
}

function renderDefault(option: Option): string {
  if (option.defaultValue === undefined) return '—';
  if (option.defaultValue === false) return '—';
  return `\`${JSON.stringify(option.defaultValue)}\``;
}

function renderOptions(cmd: Command): string[] {
  const options = cmd.options;
  if (options.length === 0) return [];

  const lines = [
    '',
    '| Flag | Description | Default |',
    '| ---- | ----------- | ------- |',
  ];
  for (const option of options) {
    const description = option.description || '';
    const choices = option.argChoices
      ? ` Choices: ${option.argChoices.map((c) => `\`${c}\``).join(', ')}.`
      : '';
    lines.push(
      `| \`${cell(option.flags)}\` | ${cell(description + choices)} | ${renderDefault(option)} |`,
    );
  }
  return lines;
}

function renderArguments(cmd: Command): string[] {
  const args = cmd.registeredArguments;
  if (args.length === 0) return [];

  const lines = [
    '',
    '| Argument | Required | Description |',
    '| -------- | -------- | ----------- |',
  ];
  for (const arg of args) {
    lines.push(
      `| \`${cell(arg.name())}\` | ${arg.required ? 'yes' : 'no'} | ${cell(arg.description || '')} |`,
    );
  }
  return lines;
}

/** Render one command (and recursively its subcommands) at the given heading depth. */
function renderCommand(cmd: Command, depth: number): string[] {
  const path = commandPath(cmd);
  const children = subcommands(cmd);
  const lines: string[] = ['', `${'#'.repeat(depth)} \`${path}\``, ''];

  if (cmd.description()) lines.push(cmd.description(), '');

  const usageArgs = cmd.registeredArguments
    .map((a) => (a.required ? `<${a.name()}>` : `[${a.name()}]`))
    .join(' ');
  const usageOpts = cmd.options.length > 0 ? ' [options]' : '';
  const usageSub = children.length > 0 ? ' <subcommand>' : '';
  lines.push(
    '```bash',
    `samaritan ${path}${usageSub}${usageOpts}${usageArgs ? ` ${usageArgs}` : ''}`.trim(),
    '```',
  );

  lines.push(...renderArguments(cmd));
  lines.push(...renderOptions(cmd));

  for (const child of children) {
    lines.push(...renderCommand(child, depth + 1));
  }

  return lines;
}

export function renderCliReference(program: Command): string {
  const top = subcommands(program);

  const lines: string[] = [
    '<!--',
    '  GENERATED FILE — DO NOT EDIT.',
    '  Produced by scripts/gen-docs from the Commander tree in src/cli/program.ts.',
    '  Change a flag in the source and rerun `npm run docs:gen`.',
    '-->',
    '',
    '# CLI reference',
    '',
    'Every command, flag and default below is read directly from the CLI source, so',
    'it cannot drift from the shipped behaviour.',
    '',
    '## Global options',
    '',
  ];

  lines.push(...renderOptions(program).slice(1));

  lines.push(
    '',
    '## Commands',
    '',
    '| Command | Description |',
    '| ------- | ----------- |',
  );
  for (const cmd of top) {
    lines.push(
      `| [\`${cmd.name()}\`](#${cmd.name()}) | ${cell(cmd.description() || '')} |`,
    );
  }

  for (const cmd of top) {
    lines.push(...renderCommand(cmd, 2));
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}
