import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import Ajv from 'ajv';
import yaml from 'js-yaml';
import { compilePattern } from './command-model';
import type { ToolProfile, Verb } from './tools/types';

export type RuleSetting = 'off' | 'warning' | 'error';

export interface BannedPattern {
  pattern: string;
  message?: string;
}

export interface RequiredFlags {
  pattern: string;
  flags: string[];
  message?: string;
}

/** The `lint:` section of `samaritan.config.yaml`, with presets applied. */
export interface LintConfig {
  rules: Record<string, RuleSetting>;
  banned: BannedPattern[];
  required: RequiredFlags[];
  protected_branches: string[];
  /** Personal names / usernames `style/hardcoded-identity` looks for. */
  identities: string[];
  /** Extra programs `cmd/unknown-binary` accepts. */
  known_binaries: string[];
  /** Sessions `aws` commands must run in (`flow/aws-local-session`). */
  aws_sessions: string[];
  /** Extra `aws … create-*` operations `aws/cli-create-managed` accepts. */
  aws_create_allowlist: string[];
  /** Team phrases `instruction/vague-decision` flags, besides its built-in ones. */
  vague_phrases: string[];
  /** Team tool profiles (`lint.tools`), merged over the built-in ones. */
  tools: ToolProfile[];
  /** File the config came from; undefined for built-in defaults. */
  source?: string;
}

/** What the loader needs from the rule registry (avoids an import cycle). */
export interface LintRegistry {
  ids: ReadonlySet<string>;
  presets: Record<string, Record<string, RuleSetting>>;
}

export const CONFIG_FILE_NAME = 'samaritan.config.yaml';
export const DEFAULT_PROTECTED_BRANCHES = ['main', 'master'];

export class LintConfigError extends Error {}

export function defaultLintConfig(): LintConfig {
  return {
    rules: {},
    banned: [],
    required: [],
    protected_branches: [...DEFAULT_PROTECTED_BRANCHES],
    identities: [],
    known_binaries: [],
    aws_sessions: [],
    aws_create_allowlist: [],
    vague_phrases: [],
    tools: [],
  };
}

const STRING_LIST = {
  type: 'array',
  items: { type: 'string', minLength: 1 },
} as const;

const OPTION_LIST = {
  type: 'array',
  items: { type: 'string', pattern: '^-' },
} as const;

const VERB = {
  oneOf: [
    { type: 'string' },
    {
      type: 'object',
      additionalProperties: false,
      minProperties: 1,
      properties: {
        verb: { type: 'string' },
        option: { type: 'string', pattern: '^-' },
        matches: { type: 'string' },
        any_operand: STRING_LIST,
        redirect: { type: 'boolean' },
      },
    },
  ],
} as const;

const VERB_LIST = { type: 'array', items: VERB } as const;

/** A `lint.tools` entry: a tool profile in YAML (snake_case). */
const TOOL = {
  type: 'object',
  additionalProperties: false,
  required: ['binaries'],
  properties: {
    binaries: { ...STRING_LIST, minItems: 1 },
    value_options: OPTION_LIST,
    boolean_options: OPTION_LIST,
    long_options_take_value: { type: 'boolean' },
    combine_short: { type: 'boolean' },
    verb_depth: { type: 'integer', minimum: 1 },
    mutating: VERB_LIST,
    dry_run: VERB_LIST,
    backup: VERB_LIST,
    deletes_data: VERB_LIST,
    resource_options: OPTION_LIST,
    resource_operand: { type: 'integer', minimum: 0 },
    output_options: OPTION_LIST,
  },
} as const;

const LINT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    extends: STRING_LIST,
    rules: {
      type: 'object',
      additionalProperties: { enum: ['off', 'warning', 'error'] },
    },
    banned: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['pattern'],
        properties: {
          pattern: { type: 'string', minLength: 1 },
          message: { type: 'string' },
        },
      },
    },
    required: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['pattern', 'flags'],
        properties: {
          pattern: { type: 'string', minLength: 1 },
          flags: {
            type: 'array',
            minItems: 1,
            items: { type: 'string', pattern: '^-' },
          },
          message: { type: 'string' },
        },
      },
    },
    protected_branches: STRING_LIST,
    identities: STRING_LIST,
    known_binaries: STRING_LIST,
    aws_sessions: STRING_LIST,
    aws_create_allowlist: STRING_LIST,
    vague_phrases: STRING_LIST,
    tools: { type: 'array', items: TOOL },
  },
} as const;

const validateLintSection = new Ajv({ allErrors: true }).compile(LINT_SCHEMA);

/** `lint.tools` entries as written in YAML. */
interface RawVerb {
  verb?: string;
  option?: string;
  matches?: string;
  any_operand?: string[];
  redirect?: boolean;
}
interface RawTool {
  binaries: string[];
  value_options?: string[];
  boolean_options?: string[];
  long_options_take_value?: boolean;
  combine_short?: boolean;
  verb_depth?: number;
  mutating?: (string | RawVerb)[];
  dry_run?: (string | RawVerb)[];
  backup?: (string | RawVerb)[];
  deletes_data?: (string | RawVerb)[];
  resource_options?: string[];
  resource_operand?: number;
  output_options?: string[];
}

type LintSection = Partial<Omit<LintConfig, 'source' | 'tools'>> & {
  extends?: string[];
  tools?: RawTool[];
};

function toVerb(raw: string | RawVerb, label: string): Verb {
  if (typeof raw === 'string') return raw;
  if (raw.matches !== undefined) {
    try {
      new RegExp(raw.matches);
    } catch {
      throw new LintConfigError(
        `${label}: lint.tools: \`matches: ${raw.matches}\` is not a valid regex`,
      );
    }
  }
  return {
    verb: raw.verb,
    option: raw.option,
    matches: raw.matches,
    anyOperand: raw.any_operand,
    redirect: raw.redirect,
  };
}

/** A `lint.tools` entry → a tool profile (the same shape as the built-ins). */
export function toolProfile(raw: RawTool, label = 'lint'): ToolProfile {
  const verbs = (list?: (string | RawVerb)[]) =>
    list?.map((v) => toVerb(v, label));
  return {
    id: raw.binaries.join(','),
    binaries: raw.binaries,
    spec: {
      // A resource option names something, so it takes a value.
      valueOptions:
        raw.value_options || raw.resource_options
          ? [...(raw.value_options ?? []), ...(raw.resource_options ?? [])]
          : undefined,
      booleanOptions: raw.boolean_options,
      longTakesValue: raw.long_options_take_value,
      combineShort: raw.combine_short,
    },
    verbDepth: raw.verb_depth,
    mutating: verbs(raw.mutating),
    dryRun: verbs(raw.dry_run),
    backup: verbs(raw.backup),
    deletesData: verbs(raw.deletes_data),
    resourceOptions: raw.resource_options,
    resourceOperands:
      raw.resource_operand !== undefined
        ? { index: raw.resource_operand }
        : undefined,
    output: raw.output_options ? { options: raw.output_options } : undefined,
  };
}

const LIST_KEYS = [
  'protected_branches',
  'identities',
  'known_binaries',
  'aws_sessions',
  'aws_create_allowlist',
] as const;

/**
 * Nearest `samaritan.config.yaml` at or above the operation file's directory
 * (ESLint-style discovery), or undefined.
 */
export function findConfigFile(operationFile: string): string | undefined {
  return findConfig(operationFile)?.file;
}

/** The nearest config file and its text, read once (no check-then-read). */
function findConfig(
  operationFile: string,
): { file: string; text: string } | undefined {
  let dir = dirname(resolve(operationFile));
  for (;;) {
    const file = join(dir, CONFIG_FILE_NAME);
    const text = readIfPresent(file);
    if (text !== undefined) return { file, text };
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** A file's text, or undefined when there is no such file. */
function readIfPresent(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') {
      return undefined;
    }
    throw new LintConfigError(
      `${file}: cannot read config: ${(error as Error).message}`,
    );
  }
}

function parseYaml(text: string, label: string): unknown {
  try {
    return yaml.load(text);
  } catch (error) {
    throw new LintConfigError(
      `${label}: cannot read config: ${(error as Error).message.split('\n')[0]}`,
    );
  }
}

function checkSection(
  section: unknown,
  label: string,
  registry: LintRegistry,
): LintSection {
  if (!validateLintSection(section)) {
    const problems = (validateLintSection.errors ?? []).map((e) => {
      // JSON pointer → dotted path; `~1` is an escaped `/` (rule ids have one).
      const where = ['lint', ...e.instancePath.split('/').slice(1)]
        .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
        .join('.');
      const extra =
        'additionalProperty' in e.params
          ? ` '${e.params.additionalProperty}'`
          : '';
      return `${where}: ${e.message}${extra}`;
    });
    throw new LintConfigError(`${label}: ${problems.join('; ')}`);
  }
  const lint = section as LintSection;
  for (const id of Object.keys(lint.rules ?? {})) {
    if (!registry.ids.has(id)) {
      throw new LintConfigError(`${label}: lint.rules: unknown rule '${id}'`);
    }
  }
  for (const entry of [...(lint.banned ?? []), ...(lint.required ?? [])]) {
    try {
      compilePattern(entry.pattern);
    } catch (error) {
      throw new LintConfigError(`${label}: ${(error as Error).message}`);
    }
  }
  return lint;
}

/**
 * Apply `layer` over `base`: rules merge, lists of patterns, vague phrases
 * and tools add up, other lists replace.
 */
function merge(
  base: LintConfig,
  layer: LintSection,
  label = 'lint',
): LintConfig {
  const next: LintConfig = {
    ...base,
    rules: { ...base.rules, ...(layer.rules ?? {}) },
    banned: [...base.banned, ...(layer.banned ?? [])],
    required: [...base.required, ...(layer.required ?? [])],
    vague_phrases: [...base.vague_phrases, ...(layer.vague_phrases ?? [])],
    tools: [
      ...base.tools,
      ...(layer.tools ?? []).map((t) => toolProfile(t, label)),
    ],
  };
  for (const key of LIST_KEYS) {
    if (layer[key] !== undefined) next[key] = [...(layer[key] as string[])];
  }
  return next;
}

/**
 * Resolve a `lint:` section and its `extends:` chain. Each preset applies
 * first, in order; the section's own keys apply last. A preset is a built-in
 * name (`samaritan:recommended|strict|all`) or a path, relative to the file
 * naming it, to a YAML file holding a `lint:` section (or the section itself).
 */
function resolveSection(
  section: LintSection,
  label: string,
  baseDir: string,
  registry: LintRegistry,
  seen: Set<string>,
  base: LintConfig,
): LintConfig {
  let config = base;
  for (const name of section.extends ?? []) {
    if (name.startsWith('samaritan:')) {
      const preset = registry.presets[name];
      if (!preset) {
        throw new LintConfigError(
          `${label}: lint.extends: unknown preset '${name}' (${Object.keys(registry.presets).join(', ')})`,
        );
      }
      config = merge(config, { rules: preset });
      continue;
    }
    const file = resolve(baseDir, name);
    if (seen.has(file)) {
      throw new LintConfigError(
        `${label}: lint.extends: cycle through ${name}`,
      );
    }
    const text = readIfPresent(file);
    if (text === undefined) {
      throw new LintConfigError(
        `${label}: lint.extends: file not found: ${name}`,
      );
    }
    const document = parseYaml(text, file) as { lint?: unknown } | null;
    const inner =
      document && typeof document === 'object' && 'lint' in document
        ? document.lint
        : document;
    const checked = checkSection(inner ?? {}, file, registry);
    config = resolveSection(
      checked,
      file,
      dirname(file),
      registry,
      new Set([...seen, file]),
      config,
    );
  }
  return merge(config, { ...section, extends: undefined }, label);
}

/**
 * Read the `lint:` section of a config file. A file without one gives the
 * defaults. Throws `LintConfigError` for an unreadable file, an unknown key,
 * a bad severity, an unknown rule id or preset, an `extends` cycle, or a
 * pattern that is not one command.
 */
export function readLintConfig(
  configFile: string,
  registry: LintRegistry,
  profiles: string[] = [],
  text?: string,
): LintConfig {
  const content = text ?? readIfPresent(configFile);
  if (content === undefined) {
    throw new LintConfigError(`config file not found: ${configFile}`);
  }
  const document = parseYaml(content, configFile) as {
    lint?: unknown;
  } | null;
  const section = document?.lint ?? {};
  const checked = checkSection(section, configFile, registry);
  const config = resolveSection(
    { ...checked, extends: [...profiles, ...(checked.extends ?? [])] },
    configFile,
    dirname(configFile),
    registry,
    new Set([resolve(configFile)]),
    defaultLintConfig(),
  );
  return { ...config, source: configFile };
}

/**
 * Config for linting `operationFile`: the explicit file when given, else the
 * nearest `samaritan.config.yaml`, else the defaults. `profiles` (e.g.
 * `samaritan:strict` from `lint --strict`) apply before the file's own
 * `extends:` and rules.
 */
export function loadLintConfig(
  operationFile: string,
  registry: LintRegistry,
  explicitConfig?: string,
  profiles: string[] = [],
): LintConfig {
  if (explicitConfig) {
    return readLintConfig(explicitConfig, registry, profiles);
  }
  const found = findConfig(operationFile);
  if (found) return readLintConfig(found.file, registry, profiles, found.text);
  return resolveSection(
    { extends: profiles },
    'lint',
    dirname(resolve(operationFile)),
    registry,
    new Set(),
    defaultLintConfig(),
  );
}
