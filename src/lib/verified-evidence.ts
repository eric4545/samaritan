import { randomUUID } from 'node:crypto';
import { detectMimeType } from '../evidence/collector';
import type { EvidenceItem } from '../models/evidence';

/**
 * Build a `command_output` EvidenceItem from pane output that just PASSED a
 * verify — closing the loop between `expect` and `evidence` so the output an
 * operator checked also becomes the output recorded in the session/report.
 *
 * Marked `automatic` and `validated` (it passed verification), with
 * `metadata.source = 'verify'` so the report can distinguish auto-captured
 * verification output from operator-attached evidence.
 */
export function buildVerifiedEvidenceItem(
  stepIndex: number,
  output: string,
  operator: string,
): EvidenceItem {
  return {
    id: randomUUID(),
    step_id: String(stepIndex),
    type: 'command_output',
    content: output,
    timestamp: new Date(),
    operator,
    automatic: true,
    validated: true,
    metadata: {
      size: Buffer.byteLength(output, 'utf-8'),
      format: detectMimeType('command_output', output),
      source: 'verify',
    },
    description: 'Auto-captured on passing verify',
  };
}
