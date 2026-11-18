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

/** The `lint:` section of `samaritan.config.yaml`. */
export interface LintConfig {
  rules: Record<string, RuleSetting>;
  banned: BannedPattern[];
  required: RequiredFlags[];
  protected_branches: string[];
  /** File the config came from; undefined for built-in defaults. */
  source?: string;
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
  };
}

const LINT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
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
    protected_branches: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
    },
  },
} as const;

const validateLintSection = new Ajv({ allErrors: true }).compile(LINT_SCHEMA);

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

/**
 * Read the `lint:` section of a config file. A file without one gives the
 * defaults. Throws `LintConfigError` for an unreadable file, an unknown key,
 * a bad severity, an unknown rule id or a pattern that is not one command.
 */
export function readLintConfig(
  configFile: string,
  knownRuleIds: ReadonlySet<string>,
): LintConfig {
  let document: unknown;
  try {
    document = yaml.load(readFileSync(configFile, 'utf8'));
  } catch (error) {
    throw new LintConfigError(
      `${configFile}: cannot read config: ${(error as Error).message.split('\n')[0]}`,
    );
  }
  const section = (document as { lint?: unknown } | null)?.lint;
  const config = { ...defaultLintConfig(), source: configFile };
  if (section === undefined || section === null) return config;

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
    throw new LintConfigError(`${configFile}: ${problems.join('; ')}`);
  }

  const lint = section as Partial<LintConfig>;
  for (const id of Object.keys(lint.rules ?? {})) {
    if (!knownRuleIds.has(id)) {
      throw new LintConfigError(
        `${configFile}: lint.rules: unknown rule '${id}'`,
      );
    }
  }
  for (const entry of [...(lint.banned ?? []), ...(lint.required ?? [])]) {
    try {
      compilePattern(entry.pattern);
    } catch (error) {
      throw new LintConfigError(`${configFile}: ${(error as Error).message}`);
    }
  }

  return {
    rules: lint.rules ?? {},
    banned: lint.banned ?? [],
    required: lint.required ?? [],
    protected_branches: lint.protected_branches ?? config.protected_branches,
    source: configFile,
  };
}

/**
 * Config for linting `operationFile`: the explicit file when given, else the
 * nearest `samaritan.config.yaml`, else the defaults.
 */
export function loadLintConfig(
  operationFile: string,
  knownRuleIds: ReadonlySet<string>,
  explicitConfig?: string,
): LintConfig {
  if (explicitConfig) {
    if (!existsSync(explicitConfig)) {
      throw new LintConfigError(`config file not found: ${explicitConfig}`);
    }
    return readLintConfig(explicitConfig, knownRuleIds);
  }
  const found = findConfigFile(operationFile);
  return found ? readLintConfig(found, knownRuleIds) : defaultLintConfig();
}
