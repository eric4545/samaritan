import fs from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import yaml from 'js-yaml';
import { isRemoteTemplate } from '../lib/template-fetcher';
import { OperationParseError } from './parser';

// Raw YAML merge operates on untyped objects before schema validation.
type RawOperation = Record<string, any>;

/**
 * Top-level fields merged "last layer defined wins" — everything that isn't
 * spread-merged (variables/common_variables), concatenated (environments/steps),
 * or replaced-as-a-whole (rollback). See CLAUDE.md `extends:` merge semantics.
 */
const LAST_WINS_FIELDS = [
  'name',
  'version',
  'description',
  'author',
  'category',
  'emergency',
  'overview',
  'sessions',
  'run',
  'reporting',
  'needs',
  'with',
  'matrix',
  'env_file',
  'metadata',
  'uses',
  'template',
  'tags',
];

/**
 * Rebase a single relative-path field to an absolute path anchored at `dir`.
 * Skips non-strings, empty strings, remote refs (`github:`/`https:`), and
 * already-absolute paths.
 */
function rebasePathValue(value: unknown, dir: string): unknown {
  if (typeof value !== 'string' || value.length === 0) return value;
  if (isRemoteTemplate(value)) return value;
  if (isAbsolute(value)) return value;
  return resolve(dir, value);
}

/** Rebase every `evidence.results[<env>][].file` on a node (step/rollback step/variant). */
function rebaseEvidenceResults(node: RawOperation, dir: string): void {
  const results = node.evidence?.results;
  if (!results || typeof results !== 'object') return;
  for (const envResults of Object.values(results)) {
    if (!Array.isArray(envResults)) continue;
    for (const result of envResults) {
      if (result && typeof result === 'object' && result.file !== undefined) {
        result.file = rebasePathValue(result.file, dir);
      }
    }
  }
}

/**
 * Recursively rebase relative-path fields inside a list of steps and every
 * nested structure (sub_steps, rollback, variants). A rollback step and a
 * variant are structurally steps with fewer fields populated, so one walker
 * handles all three — the `!== undefined` / `Array.isArray` guards no-op on
 * fields a given node doesn't carry.
 */
function walkStepsRebase(steps: RawOperation[] | undefined, dir: string): void {
  if (!Array.isArray(steps)) return;
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;

    if (step.uses !== undefined) step.uses = rebasePathValue(step.uses, dir);
    if (step.script !== undefined)
      step.script = rebasePathValue(step.script, dir);
    rebaseEvidenceResults(step, dir);

    if (Array.isArray(step.rollback)) walkStepsRebase(step.rollback, dir);
    if (Array.isArray(step.sub_steps)) walkStepsRebase(step.sub_steps, dir);
    if (step.variants && typeof step.variants === 'object') {
      walkStepsRebase(Object.values(step.variants) as RawOperation[], dir);
    }
  }
}

/**
 * Rebase every relative-path field authored in a single raw operation file to
 * an absolute path anchored at that file's own directory (`dir`). Mutates
 * `raw` in place. Must run BEFORE merging layers together, so every layer's
 * paths resolve correctly regardless of which file (base or child) ends up
 * "hosting" the merged value.
 *
 * NOT rebased (documented limitation): `environments[].from` is a manifest
 * *name* (resolved as `baseDir/environments/<name>.yaml` at env-parse time),
 * not a path — use `environments: - uses: ./shared-envs.yaml` in a base
 * instead, which IS rebased below.
 */
function rebaseOperationPaths(raw: RawOperation, dir: string): void {
  if (raw.env_file !== undefined) {
    raw.env_file = rebasePathValue(raw.env_file, dir);
  }

  if (Array.isArray(raw.environments)) {
    for (const env of raw.environments) {
      if (env && typeof env === 'object' && env.uses !== undefined) {
        env.uses = rebasePathValue(env.uses, dir);
      }
    }
  }

  if (raw.rollback && Array.isArray(raw.rollback.steps)) {
    walkStepsRebase(raw.rollback.steps, dir);
  }

  walkStepsRebase(raw.steps, dir);
}

/**
 * Merge raw operation layers left-to-right (bases first, child last).
 * See CLAUDE.md `extends:` merge semantics table for the per-field rules.
 */
function mergeRawOperations(layers: RawOperation[]): RawOperation {
  const result: RawOperation = {};

  for (const layer of layers) {
    for (const field of LAST_WINS_FIELDS) {
      if (layer[field] !== undefined) {
        result[field] = layer[field];
      }
    }

    if (layer.variables !== undefined) {
      result.variables = { ...(result.variables || {}), ...layer.variables };
    }
    if (layer.common_variables !== undefined) {
      result.common_variables = {
        ...(result.common_variables || {}),
        ...layer.common_variables,
      };
    }

    if (Array.isArray(layer.environments)) {
      result.environments = [
        ...(result.environments || []),
        ...layer.environments,
      ];
    }

    if (Array.isArray(layer.steps)) {
      result.steps = [...(result.steps || []), ...layer.steps];
    }

    if (layer.rollback !== undefined) {
      result.rollback = layer.rollback;
    }
  }

  return result;
}

/** Normalize `raw.extends` into an ordered list of base-file references (declared order). */
function normalizeExtendsField(raw: RawOperation): string[] {
  const value = raw.extends;
  if (value === undefined) return [];

  // A bare scalar always yields length 1, so an empty list means `extends: []`.
  const entries = Array.isArray(value) ? value : [value];
  if (entries.length === 0) {
    throw new OperationParseError("'extends' array must not be empty", [
      { field: 'extends', message: 'extends: [] is not allowed' },
    ]);
  }

  for (const entry of entries) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new OperationParseError(
        "'extends' must be a non-empty string or an array of non-empty strings",
        [
          {
            field: 'extends',
            message: `Invalid extends entry: ${JSON.stringify(entry)}`,
          },
        ],
      );
    }
    if (isRemoteTemplate(entry)) {
      throw new OperationParseError(
        `Remote 'extends' targets are not supported yet: ${entry}`,
        [
          {
            field: 'extends',
            message: `Remote base operations (github:/https:) are not supported: ${entry}`,
          },
        ],
      );
    }
  }

  return entries;
}

/**
 * Load a single raw operation YAML file (no schema validation — that happens
 * once, on the fully merged result, in parseOperation).
 */
function loadRawYamlFile(absolutePath: string, refPath: string): RawOperation {
  let content: string;
  try {
    content = fs.readFileSync(absolutePath, 'utf8');
  } catch (error) {
    throw new OperationParseError(`Failed to read file: ${refPath}`, [
      { field: 'extends', message: (error as Error).message },
    ]);
  }

  let data: unknown;
  try {
    data = yaml.load(content);
  } catch (error) {
    throw new OperationParseError(`Invalid YAML format in '${refPath}'`, [
      { field: 'extends', message: (error as Error).message },
    ]);
  }

  if (typeof data !== 'object' || data === null) {
    throw new OperationParseError(
      `Invalid YAML: root must be an object in '${refPath}'`,
      [{ field: 'extends', message: `Root must be an object: ${refPath}` }],
    );
  }

  return data as RawOperation;
}

/**
 * Load a raw operation file and, if it declares `extends:`, recursively load
 * and merge its base(s) — bases first, this file last (child wins) — before
 * returning ONE merged raw operation object with `extends` removed.
 *
 * `stack` is the ordered chain of absolute paths currently being resolved,
 * used to detect circular `extends` chains. A legitimate diamond (two bases
 * sharing a common ancestor) is NOT circular and is expected to duplicate the
 * shared ancestor's steps (append semantics).
 *
 * `isRoot` distinguishes the file `parseOperation` was originally asked to
 * load from every file reached via `extends` (bases, and bases-of-bases).
 * Only NON-root files get their relative-path fields rebased to absolute:
 * the root file's paths are already correct relative to its own directory
 * (`baseDirectory` downstream is `dirname(filePath)` of the root), so
 * rebasing them too would needlessly turn authored relative paths (e.g.
 * `script: ./deploy.sh`) into absolute ones in the parsed/rendered output
 * for the common case of an operation that doesn't use `extends` at all.
 * Non-root files, by contrast, are merged INTO the root's structure and
 * resolved against the root's directory, so their paths must become
 * absolute to keep resolving correctly regardless of the root's location.
 */
export function loadRawOperationWithExtends(
  filePath: string,
  stack: string[] = [],
  isRoot = true,
): RawOperation {
  const abs = resolve(filePath);

  if (stack.includes(abs)) {
    const chain = [...stack, abs].join(' -> ');
    throw new OperationParseError(`Circular extends detected: ${chain}`, [
      { field: 'extends', message: `Circular extends detected: ${chain}` },
    ]);
  }

  stack.push(abs);
  try {
    const raw = loadRawYamlFile(abs, filePath);
    const dir = dirname(abs);

    const baseRefs = normalizeExtendsField(raw);

    // Absolutize this file's own authored paths BEFORE merging, so every
    // layer resolves correctly regardless of which file "hosts" the merge.
    // Skipped for the root file — see the `isRoot` doc above.
    if (!isRoot) {
      rebaseOperationPaths(raw, dir);
    }

    if (baseRefs.length === 0) {
      delete raw.extends;
      return raw;
    }

    const bases: RawOperation[] = [];
    for (const baseRef of baseRefs) {
      const baseAbs = resolve(dir, baseRef);
      bases.push(loadRawOperationWithExtends(baseAbs, stack, false));
    }

    const merged = mergeRawOperations([...bases, raw]);
    delete merged.extends;
    return merged;
  } finally {
    stack.pop();
  }
}
