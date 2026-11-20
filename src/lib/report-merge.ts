import { existsSync } from 'node:fs';
import type { RollbackRecord, StepRecord } from '../models/step-record';
import { type ReportOptions, renderReport } from './report-generator';
import { type RecordedStep, recordedStepList } from './resume-state';
import { foldEvents, readEvents, type SessionEvent } from './session-log';
import { candidateRunLogPaths, loadSession } from './session-persistence';

/** A single operator's folded run of the operation. */
interface SessionFold {
  sessionId: string;
  operationFile: string;
  group?: string;
  environment?: string;
  stepList?: RecordedStep[];
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
    group: session.group,
    environment: session.environment,
    stepList: recordedStepList(events),
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
 * Refuse to merge runs of different runbooks from one file. Steps are merged
 * by INDEX, and the step list depends on the group (`--group` drops other
 * groups' steps) — two groups merged would pair unrelated steps and report
 * them as one complete run. Environments differ in variables and `when:`
 * steps, so their evidence must not be blended either.
 */
export function assertSameRunbook(
  folds: Array<{
    sessionId: string;
    group?: string;
    environment?: string;
    /** `session_start.steps`; absent in logs written before it existed. */
    stepList?: RecordedStep[];
  }>,
): void {
  const axes = [
    ['group', 'groups'],
    ['environment', 'environments'],
  ] as const;
  for (const [key, plural] of axes) {
    if (new Set(folds.map((f) => f[key] ?? '')).size <= 1) continue;
    const detail = folds
      .map((f) => `${f.sessionId} (${f[key] ?? `no ${key}`})`)
      .join(', ');
    throw new Error(
      `Cannot merge sessions from different ${plural}: ${detail}. Merge the sessions of one ${key} at a time.`,
    );
  }
  // The same file edited between two runs: compare the step names each run
  // recorded (runs from before step lists were recorded are not checked).
  const listed = folds.filter((f) => f.stepList);
  const shapes = new Set(
    listed.map((f) => JSON.stringify(f.stepList?.map((s) => s.name))),
  );
  if (shapes.size > 1) {
    const detail = listed
      .map((f) => `${f.sessionId} (${f.stepList?.length} steps)`)
      .join(', ');
    throw new Error(
      `Cannot merge runs of different versions of the runbook: ${detail}. Their steps are not at the same positions.`,
    );
  }
}

/**
 * Build a merged Markdown report from several saved sessions of the same
 * operation. Validates that every session ran the same operation, folds each
 * run, merges per-step by completeness (attributing `executed_by`), and renders
 * with the shared `renderReport` — the header/duration come from the combined,
 * timestamp-sorted event stream while the per-step body comes from the merge.
 */
export function mergeSessions(
  sessionIds: string[],
  options: ReportOptions = {},
): string {
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

  assertSameRunbook(folds);

  const steps = mergeStepRecords(folds);
  const rollbacks = folds.flatMap((f) => f.rollbacks);

  // Combined, timestamp-sorted event stream feeds the report header (op file,
  // total_steps, duration). Per-step selection is driven by the merged `steps`.
  const events = folds
    .flatMap((f) => f.events)
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  return renderReport(events, { steps, rollbacks }, undefined, options);
}
