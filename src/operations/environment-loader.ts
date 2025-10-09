import fs from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import type { Environment } from '../models/operation';

interface EnvironmentManifest {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    description: string;
    version: string;
  };
  environments: Environment[];
}

interface EnvironmentRef {
  manifest: string;
  environments?: string[] | 'all';
}

interface EnvironmentOverride {
  [envName: string]: {
    variables?: { [key: string]: any };
    approval_required?: boolean;
    validation_required?: boolean;
    restrictions?: string[];
    targets?: string[];
  };
}

export class EnvironmentLoader {
  private manifestCache: Map<string, EnvironmentManifest> = new Map();

  constructor(private baseDirectory: string) {}

  async loadEnvironmentManifest(
    manifestName: string,
  ): Promise<EnvironmentManifest> {
    // Check cache first
    if (this.manifestCache.has(manifestName)) {
      return this.manifestCache.get(manifestName)!;
    }

    // Try multiple possible locations for environment manifests
    const possiblePaths = [
      // First try relative to the operation file
      resolve(this.baseDirectory, 'environments', `${manifestName}.yaml`),
      resolve(this.baseDirectory, 'environments', `${manifestName}.yml`),
      resolve(this.baseDirectory, `${manifestName}.yaml`),
      resolve(this.baseDirectory, `${manifestName}.yml`),
      // Then try project root (go up one level from examples/)
      resolve(this.baseDirectory, '../environments', `${manifestName}.yaml`),
      resolve(this.baseDirectory, '../environments', `${manifestName}.yml`),
      resolve(this.baseDirectory, '..', `${manifestName}.yaml`),
      resolve(this.baseDirectory, '..', `${manifestName}.yml`),
    ];

    let manifestPath: string | null = null;
    for (const path of possiblePaths) {
      if (fs.existsSync(path)) {
        manifestPath = path;
        break;
      }
    }

    if (!manifestPath) {
      throw new Error(
        `Environment manifest '${manifestName}' not found. Searched: ${possiblePaths.join(', ')}`,
      );
    }

    try {
      const content = fs.readFileSync(manifestPath, 'utf8');
      const manifest = yaml.load(content) as EnvironmentManifest;

      // Validate manifest structure
      if (
        !manifest.apiVersion ||
        !manifest.kind ||
        manifest.kind !== 'EnvironmentManifest'
      ) {
        throw new Error(`Invalid environment manifest: ${manifestPath}`);
      }

      if (!manifest.environments || !Array.isArray(manifest.environments)) {
        throw new Error(
          `Environment manifest must contain 'environments' array: ${manifestPath}`,
        );
      }

      // Cache the manifest
      this.manifestCache.set(manifestName, manifest);
      return manifest;
    } catch (error) {
      throw new Error(
        `Failed to load environment manifest '${manifestName}' from ${manifestPath}: ${(error as Error).message}`,
      );
    }
  }

  async resolveEnvironments(
    environmentRefs: EnvironmentRef[],
    environmentOverrides?: EnvironmentOverride,
  ): Promise<Environment[]> {
    const resolvedEnvironments: Environment[] = [];
    const seenEnvironments = new Set<string>();

    for (const ref of environmentRefs) {
      const manifest = await this.loadEnvironmentManifest(ref.manifest);

      // Determine which environments to use
      const envsToUse =
        ref.environments === 'all' || !ref.environments
          ? manifest.environments.map((e) => e.name)
          : ref.environments;

      for (const envName of envsToUse) {
        // Skip if already processed
        if (seenEnvironments.has(envName)) {
          continue;
        }
        seenEnvironments.add(envName);

        // Find the environment in the manifest
        const manifestEnv = manifest.environments.find(
          (e) => e.name === envName,
        );
        if (!manifestEnv) {
          throw new Error(
            `Environment '${envName}' not found in manifest '${ref.manifest}'`,
          );
        }

        // Clone the environment and apply overrides
        const resolvedEnv: Environment = {
          name: manifestEnv.name,
          description: manifestEnv.description,
          variables: { ...manifestEnv.variables },
          restrictions: [...(manifestEnv.restrictions || [])],
          approval_required: manifestEnv.approval_required,
          validation_required: manifestEnv.validation_required,
          targets: [...(manifestEnv.targets || [])],
        };

        // Apply environment-specific overrides
        const override = environmentOverrides?.[envName];
        if (override) {
          if (override.variables) {
            resolvedEnv.variables = {
              ...resolvedEnv.variables,
              ...override.variables,
            };
          }
          if (override.approval_required !== undefined) {
            resolvedEnv.approval_required = override.approval_required;
          }
          if (override.validation_required !== undefined) {
            resolvedEnv.validation_required = override.validation_required;
          }
          if (override.restrictions) {
            resolvedEnv.restrictions = [
              ...resolvedEnv.restrictions,
              ...override.restrictions,
            ];
          }
          if (override.targets) {
            resolvedEnv.targets = [...resolvedEnv.targets, ...override.targets];
          }
        }

        resolvedEnvironments.push(resolvedEnv);
      }
    }

    return resolvedEnvironments;
  }

  clearCache(): void {
    this.manifestCache.clear();
  }
}
