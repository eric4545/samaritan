import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { dirname, resolve } from 'node:path';
import yaml from 'js-yaml';
import type { RunManifest } from '../models/run-manifest';

export class RunManifestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunManifestValidationError';
  }
}

function validate(data: any, filePath: string): void {
  if (typeof data !== 'object' || data === null) {
    throw new RunManifestValidationError(`${filePath}: must be a YAML object`);
  }
  for (const field of ['id', 'operation', 'environment', 'status']) {
    if (typeof data[field] !== 'string' || !data[field]) {
      throw new RunManifestValidationError(
        `${filePath}: missing required field '${field}'`,
      );
    }
  }
  const validStatuses = ['in_progress', 'completed', 'failed', 'aborted'];
  if (!validStatuses.includes(data.status)) {
    throw new RunManifestValidationError(
      `${filePath}: status must be one of: ${validStatuses.join(', ')}`,
    );
  }
}

/**
 * Parse a run manifest YAML file and return a validated RunManifest.
 * File paths inside the manifest (evidence.file) are resolved to absolute
 * paths relative to the manifest file's directory so generators can read them.
 */
export function parseRunManifest(filePath: string): RunManifest {
  const absolutePath = resolve(filePath);
  const content = fs.readFileSync(absolutePath, 'utf-8');
  const data: any = yaml.load(content);

  validate(data, filePath);

  const manifestDir = dirname(absolutePath);

  const steps: RunManifest['steps'] = {};
  if (data.steps && typeof data.steps === 'object') {
    for (const [stepKey, stepData] of Object.entries<any>(data.steps)) {
      if (!Array.isArray(stepData?.evidence)) {
        throw new RunManifestValidationError(
          `${filePath}: steps.${stepKey}.evidence must be an array`,
        );
      }
      steps[stepKey] = {
        evidence: stepData.evidence.map((item: any) => ({
          type: item.type,
          // Resolve file paths to absolute so generators can read them
          // regardless of their own working directory
          file: item.file ? resolve(manifestDir, item.file) : undefined,
          content: item.content,
          description: item.description,
          captured_at: item.captured_at,
        })),
        captured_at: stepData.captured_at,
        operator: stepData.operator,
      };
    }
  }

  return {
    id: data.id,
    operation: data.operation,
    operation_hash: data.operation_hash,
    operation_commit: data.operation_commit,
    environment: data.environment,
    started_at: data.started_at,
    completed_at: data.completed_at,
    operator: data.operator,
    status: data.status,
    steps: Object.keys(steps).length > 0 ? steps : undefined,
  };
}

/**
 * Compute the SHA-256 hash of a file for version drift detection.
 * Returns a string in the form "sha256:<hex>" matching the operation_hash field.
 */
export function computeFileHash(filePath: string): string {
  const content = fs.readFileSync(resolve(filePath));
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}
