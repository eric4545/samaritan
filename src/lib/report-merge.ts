import { existsSync } from 'node:fs';
import type { RollbackRecord, StepRecord } from '../models/step-record';
import { renderReport } from './report-generator';
import { foldEvents, readEvents, type SessionEvent } from './session-log';
import { candidateRunLogPaths, loadSession } from './session-persistence';

/** A single operator's folded run of the operation. */
interface SessionFold {
  sessionId: string;
  operationFile: string;
  operator: string;
  events: SessionEvent[];
  steps: StepRecord[];
  rollbacks: RollbackRecord[];
}

/**
 * Rank a step status by "completeness" so the merge prefers a record that was
 * actually run over one that was skipped/never reached. A step executed by one
 * operator wins over the same step skipped by another (the focus-mode case).
 */
function statusRank(status: StepRecord['status']): number {
  switch (status) {
    case 'completed':
      return 3;
    case 'failed':
      return 2;
    case 'skipped':
      return 1;
    default:
      return 0; // pending
  }
}

/**
 * Load a saved session's folded run. Resolves the JSONL event log from the
 * beside-the-operation location or the `~/.samaritan/sessions/` fallback via
 * `candidateRunLogPaths`. Throws with actionable context when the session or
 * its event log can't be found.
 */
function loadSessionFold(sessionId: string): SessionFold {
  const session = loadSession(sessionId);
  if (!session) {
    throw new Error(
      `Session not found: ${sessionId} (looked in ~/.samaritan/sessions/)`,
    );
  }
  if (!session.operation_file) {
    throw new Error(
      `Session ${sessionId} has no recorded operation file; cannot locate its event log.`,
    );
  }

  const candidates = candidateRunLogPaths(session.operation_file, sessionId);
  const jsonlPath = candidates.find((p) => existsSync(p));
  if (!jsonlPath) {
    throw new Error(
      `No event log found for session ${sessionId}. Checked:\n  ${candidates.join('\n  ')}`,
    );
  }

  const events = readEvents(jsonlPath);
  const { steps, rollbacks } = foldEvents(events);
  return {
    sessionId,
    operationFile: session.operation_file,
    operator: session.operator || 'unknown',
    events,
    steps,
    rollbacks,
  };
}

/**
 * Merge several operators' partial runs of the SAME operation into one
 * consolidated set of step records. Each operator focused on their own steps
 * (`run --pic <name>`), so any given step is executed in one session and
 * skipped/absent in the others. For each step index the most-complete record
 * wins, and the winning executed record is attributed to the session's operator
 * via `executed_by`.
 */
export function mergeStepRecords(
  folds: Array<{ steps: StepRecord[]; operator: string }>,
): StepRecord[] {
  const byIndex = new Map<number, { rec: StepRecord; operator: string }>();

  for (const fold of folds) {
    for (const rec of fold.steps) {
      const existing = byIndex.get(rec.index);
      if (
        !existing ||
        statusRank(rec.status) > statusRank(existing.rec.status)
      ) {
        byIndex.set(rec.index, { rec, operator: fold.operator });
      }
    }
  }

  return [...byIndex.values()]
    .map(({ rec, operator }) => ({
      ...rec,
      // Attribute a step to whoever actually ran it; a step that ended up
      // skipped by everyone has no operator to credit.
      executed_by: rec.status === 'skipped' ? rec.executed_by : operator,
    }))
    .sort((a, b) => a.index - b.index);
}

/**
 * Build a merged Markdown report from several saved sessions of the same
 * operation. Validates that every session ran the same operation, folds each
 * run, merges per-step by completeness (attributing `executed_by`), and renders
 * with the shared `renderReport` — the header/duration come from the combined,
 * timestamp-sorted event stream while the per-step body comes from the merge.
 */
export function mergeSessions(sessionIds: string[]): string {
  if (sessionIds.length < 2) {
    throw new Error('report merge requires at least two session IDs.');
  }

  const folds = sessionIds.map(loadSessionFold);

  // "Same operation" is keyed by the operation FILE, not operation_id — an
  // operation without an explicit `id:` gets a fresh random id each parse, so
  // two runs of the same file would otherwise look like different operations.
  const operationFiles = new Set(folds.map((f) => f.operationFile));
  if (operationFiles.size > 1) {
    throw new Error(
      `Cannot merge sessions from different operations: ${[...operationFiles].join(', ')}`,
    );
  }

  const steps = mergeStepRecords(folds);
  const rollbacks = folds.flatMap((f) => f.rollbacks);

  // Combined, timestamp-sorted event stream feeds the report header (op file,
  // total_steps, duration). Per-step selection is driven by the merged `steps`.
  const events = folds
    .flatMap((f) => f.events)
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  return renderReport(events, { steps, rollbacks });
}
