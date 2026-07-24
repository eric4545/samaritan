import { readFileSync } from 'node:fs';
import * as yaml from 'js-yaml';

/**
 * Detect authored `verify:` keys whose contents the parser silently discards.
 *
 * `extractExpect` (src/operations/parser.ts) lifts only `verify.expect` — or a bare
 * string `verify` — into `expect`, and `normalizeRollbackStep` then drops `verify`
 * entirely. Any other key under `verify:` therefore has NO effect. In particular
 * `verify.command:` never runs: a step executes its own `command:`, and `expect` is
 * matched against that output.
 *
 * This scan runs against the RAW YAML, because by the time an Operation is parsed the
 * `verify` key is already gone and the loss is undetectable.
 */

/** Raw YAML is untyped by nature; `noExplicitAny` is disabled project-wide. */
type RawNode = any;

/** Keys under `verify:` that the parser actually reads. */
const HONOURED_VERIFY_KEYS = new Set(['expect']);

export interface DeprecatedVerifyFinding {
  /** Human-readable path to the offending step, e.g. `steps[2].rollback[0]`. */
  path: string;
  /** Step name, when the step declares one. */
  stepName?: string;
  /** The `verify:` keys that are being discarded. */
  discardedKeys: string[];
}

function scanStep(
  step: RawNode,
  path: string,
  findings: DeprecatedVerifyFinding[],
): void {
  if (!step || typeof step !== 'object') return;

  const verify = step.verify;
  if (verify && typeof verify === 'object' && !Array.isArray(verify)) {
    const discardedKeys = Object.keys(verify).filter(
      (key) => !HONOURED_VERIFY_KEYS.has(key),
    );
    if (discardedKeys.length > 0) {
      findings.push({
        path,
        stepName: typeof step.name === 'string' ? step.name : undefined,
        discardedKeys,
      });
    }
  }

  for (const key of ['sub_steps', 'rollback', 'variants']) {
    const children = step[key];
    if (Array.isArray(children)) {
      children.forEach((child: RawNode, i: number) => {
        scanStep(child, `${path}.${key}[${i}]`, findings);
      });
    }
  }
}

/** Scan a parsed YAML document for discarded `verify:` keys. */
export function findDiscardedVerifyKeys(
  document: RawNode,
): DeprecatedVerifyFinding[] {
  const findings: DeprecatedVerifyFinding[] = [];
  if (!document || typeof document !== 'object') return findings;

  if (Array.isArray(document.steps)) {
    document.steps.forEach((step: RawNode, i: number) => {
      scanStep(step, `steps[${i}]`, findings);
    });
  }
  if (Array.isArray(document.rollback?.steps)) {
    document.rollback.steps.forEach((step: RawNode, i: number) => {
      scanStep(step, `rollback.steps[${i}]`, findings);
    });
  }

  return findings;
}

/** Read an operation file and scan it. Returns [] if the file cannot be read or parsed. */
export function findDiscardedVerifyKeysInFile(
  filePath: string,
): DeprecatedVerifyFinding[] {
  try {
    return findDiscardedVerifyKeys(yaml.load(readFileSync(filePath, 'utf-8')));
  } catch {
    // Unreadable or malformed YAML is reported by the parser itself; this scan
    // is advisory and must never be the thing that fails a validation run.
    return [];
  }
}

export function formatDiscardedVerifyFinding(
  finding: DeprecatedVerifyFinding,
): string {
  const where = finding.stepName
    ? `${finding.path} (${finding.stepName})`
    : finding.path;
  const keys = finding.discardedKeys.map((k) => `verify.${k}`).join(', ');
  return (
    `${where}: ${keys} is IGNORED and has no effect. ` +
    'Only `verify.expect` is read, and `verify:` itself is deprecated — use `expect:` instead. ' +
    'A step is verified by matching `expect` against its own `command:` output.'
  );
}
