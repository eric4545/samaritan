import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import Ajv from 'ajv';
import yaml from 'js-yaml';
import { compilePattern } from './command-model';

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
  };
}

const STRING_LIST = {
  type: 'array',
  items: { type: 'string', minLength: 1 },
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
  },
} as const;

const validateLintSection = new Ajv({ allErrors: true }).compile(LINT_SCHEMA);

type LintSection = Partial<Omit<LintConfig, 'source'>> & { extends?: string[] };

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
  let dir = dirname(resolve(operationFile));
  for (;;) {
    const candidate = join(dir, CONFIG_FILE_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function readYaml(file: string, label: string): unknown {
  try {
    return yaml.load(readFileSync(file, 'utf8'));
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

/** Apply `layer` over `base`: rules merge, lists of patterns add, other lists replace. */
function merge(base: LintConfig, layer: LintSection): LintConfig {
  const next: LintConfig = {
    ...base,
    rules: { ...base.rules, ...(layer.rules ?? {}) },
    banned: [...base.banned, ...(layer.banned ?? [])],
    required: [...base.required, ...(layer.required ?? [])],
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
    if (!existsSync(file)) {
      throw new LintConfigError(
        `${label}: lint.extends: file not found: ${name}`,
      );
    }
    const document = readYaml(file, file) as { lint?: unknown } | null;
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
  return merge(config, { ...section, extends: undefined });
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
): LintConfig {
  const document = readYaml(configFile, configFile) as {
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
    if (!existsSync(explicitConfig)) {
      throw new LintConfigError(`config file not found: ${explicitConfig}`);
    }
    return readLintConfig(explicitConfig, registry, profiles);
  }
  const found = findConfigFile(operationFile);
  if (found) return readLintConfig(found, registry, profiles);
  return resolveSection(
    { extends: profiles },
    'lint',
    dirname(resolve(operationFile)),
    registry,
    new Set(),
    defaultLintConfig(),
  );
}
