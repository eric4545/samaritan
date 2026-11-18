import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { Operation } from '../models/operation';
import { isEvidenceUrl } from './evidence-input';
import { walkOperationSteps } from './step-walk';

const MEDIA_TYPES = new Set(['screenshot', 'photo', 'video']);

/**
 * Warnings for `evidence.results` entries that silently do nothing or render
 * as something other than what was meant. The schema cannot see these: an
 * environment key is any string, and a file path is just a string.
 */
export function lintEvidenceResults(
  operation: Operation,
  operationDir: string,
  fileExists: (path: string) => boolean = existsSync,
): string[] {
  const envNames = operation.environments.map((e) => e.name);
  const warnings: string[] = [];
  for (const step of walkOperationSteps(operation)) {
    const where = `Step "${step.name ?? 'rollback'}"`;
    for (const [env, items] of Object.entries(step.evidence?.results ?? {})) {
      if (!envNames.includes(env)) {
        warnings.push(
          `${where}: evidence.results.${env} is never rendered — no environment is named "${env}" (environments: ${envNames.join(', ') || 'none'})`,
        );
        continue;
      }
      for (const item of items ?? []) {
        const at = `${where}: evidence.results.${env} (${item.type})`;
        if (item.file) {
          const path = isAbsolute(item.file)
            ? item.file
            : resolve(operationDir, item.file);
          if (!fileExists(path)) {
            warnings.push(`${at}: file not found: ${item.file}`);
          }
        } else if (item.type === 'link' && !isEvidenceUrl(item.content ?? '')) {
          warnings.push(
            `${at}: content is not an http(s) URL, so it renders as text, not as a link`,
          );
        } else if (MEDIA_TYPES.has(item.type) && item.content) {
          warnings.push(
            `${at}: inline content renders as a text block, not as an image — use file: for the image, or type: link with the URL in content`,
          );
        }
      }
    }
  }
  return warnings;
}
