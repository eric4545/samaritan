import type { StepRecord } from '../models/step-record';
import { foldEvents, type SessionEvent } from './session-log';

/**
 * What `resume` needs to know from a run's `events.jsonl` before it picks
 * up again. Pure: no file access, no console. The run's step indices are
 * only meaningful against the step list they were recorded for, so these
 * helpers also detect a runbook edited between the abort and the resume.
 */

/** One step of the flat step list a run walked (`session_start.steps`). */
export interface RecordedStep {
  label?: string;
  name: string;
}

/**
 * The status each step ended with, folded from the events (the same fold
 * the report uses). `undefined` for a step the run never reached.
 */
export function recordedStatusOf(
  events: SessionEvent[],
): (index: number) => StepRecord['status'] | undefined {
  const byIndex = new Map(
    foldEvents(events).steps.map((s) => [s.index, s.status] as const),
  );
  return (index) => byIndex.get(index);
}

/** The step list of the latest `session_start` that recorded one. */
export function recordedStepList(
  events: SessionEvent[],
): RecordedStep[] | undefined {
  for (let k = events.length - 1; k >= 0; k--) {
    const e = events[k];
    if (e.type === 'session_start' && Array.isArray(e.steps)) {
      return e.steps as RecordedStep[];
    }
  }
  return undefined;
}

/** A recorded step that is no longer at the same position in the runbook. */
export interface RunbookMismatch {
  index: number;
  label?: string;
  recorded: string;
  /** The step now at that position; `undefined` when the list got shorter. */
  now?: string;
}

/**
 * The positions where the runbook no longer matches what the run recorded.
 * Checked: every step the run has a record for (started, done, skipped)
 * and the step it resumes at. Steps after that which the run never reached
 * may change freely. Identity is the step name as the run showed it
 * (variables resolved), because events address steps by index only:
 * a step added or removed before the resume point would make every later
 * record, and the resume position itself, point at a different step.
 */
export function runbookMismatches(
  events: SessionEvent[],
  current: RecordedStep[],
  resumeIndex: number,
): RunbookMismatch[] {
  const recordedNames = new Map<number, { name: string; label?: string }>();
  for (const s of foldEvents(events).steps) {
    if (s.name) recordedNames.set(s.index, { name: s.name, label: s.label });
  }
  const list = recordedStepList(events);
  const atResume = list?.[resumeIndex];
  if (atResume && !recordedNames.has(resumeIndex)) {
    recordedNames.set(resumeIndex, atResume);
  }

  return [...recordedNames.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([index, rec]) => current[index]?.name !== rec.name)
    .map(([index, rec]) => ({
      index,
      label: rec.label,
      recorded: rec.name,
      now: current[index]?.name,
    }));
}

/** What happened on a step that was left unfinished when the run stopped. */
export interface InterruptedStepRecap {
  index: number;
  label?: string;
  name: string;
  startedAt: string;
  /** The last command pasted or sent for it. */
  command?: string;
  pastedAt?: string;
  /** Enter pressed from samaritan (`[y]`, `[!]`, re-run). */
  enterSentAt?: string;
  verify?: { pass: boolean; at: string };
  /** The last output captured for it (verify or capture). */
  output?: string;
}

const STEP_END = new Set(['step_complete', 'step_skip', 'step_failed']);

/**
 * Recap of the step a run stopped on, for `resume`: everything recorded for
 * it since it last finished (a step aborted twice keeps the first attempt's
 * Enter: that command may have run). Rollback activity (`context`) is not
 * the step's own command and is left out. `undefined` when the step's last
 * attempt ended (done, skipped, failed) or never started.
 */
export function interruptedStepRecap(
  events: SessionEvent[],
  index: number,
): InterruptedStepRecap | undefined {
  // Where the attempts since the step last finished begin.
  let from = -1;
  for (let k = events.length - 1; k >= 0; k--) {
    const e = events[k];
    if (e.step !== index) continue;
    if (STEP_END.has(e.type)) break;
    if (e.type === 'step_start') from = k;
  }
  if (from < 0) return undefined;

  const start = events[from];
  const recap: InterruptedStepRecap = {
    index,
    label: typeof start.label === 'string' ? start.label : undefined,
    name: String(start.name ?? ''),
    startedAt: start.ts,
  };

  let current: number | undefined = index;
  for (const e of events.slice(from + 1)) {
    if (e.type === 'step_start' || e.type === 'step_skip') {
      current = e.step as number;
      continue;
    }
    if (current !== index || e.context) continue;
    if (e.step !== undefined && e.step !== index) continue;
    if (e.type === 'user_input' && e.action === 'send_to_pane') {
      recap.pastedAt = e.ts;
      recap.command = (e.command as string | undefined) ?? recap.command;
    } else if (e.type === 'user_input' && e.action === 'enter_sent') {
      recap.enterSentAt = e.ts;
      recap.command = (e.command as string | undefined) ?? recap.command;
    } else if (e.type === 'assert_result') {
      recap.verify = { pass: e.pass === true, at: e.ts };
      if (typeof e.output === 'string') recap.output = e.output;
    } else if (e.type === 'pane_captured' && typeof e.output === 'string') {
      recap.output = e.output;
    }
  }
  return recap;
}

/** `09:12:04` from an event timestamp (UTC, like the report). */
function clockOf(ts: string): string {
  return ts.slice(11, 19);
}

/** True when samaritan sent the command to the pane before the abort. */
export function mayHaveRun(recap: InterruptedStepRecap): boolean {
  return recap.enterSentAt !== undefined;
}

/**
 * What `resume` prints above the step it picks up again: what was done on
 * it before the run stopped, and what that means for running it again.
 */
export function recapLines(recap: InterruptedStepRecap): string[] {
  const facts: string[] = [];
  if (recap.pastedAt)
    facts.push(`pasted into the pane at ${clockOf(recap.pastedAt)}`);
  if (recap.enterSentAt) {
    facts.push(`Enter sent from samaritan at ${clockOf(recap.enterSentAt)}`);
  }
  if (recap.verify) {
    facts.push(
      `verify ${recap.verify.pass ? 'PASS' : 'FAIL'} at ${clockOf(recap.verify.at)}`,
    );
  }
  const head = `↻  This step was started before the run stopped (${clockOf(recap.startedAt)}).`;
  if (facts.length === 0) {
    return [
      head,
      '   Nothing was pasted or sent from samaritan. A command typed by hand is not recorded: check the pane before running it.',
    ];
  }
  return [
    head,
    ...facts.map((f) => `   • ${f}`),
    mayHaveRun(recap)
      ? '   The command may already have run. Check its result before running it again.'
      : '   The paste was not run from samaritan. It may still be on the pane, or have been run by hand.',
  ];
}

/** The step note `resume` records, so `report.md` shows the interruption. */
export function recapNote(recap: InterruptedStepRecap): string {
  const facts = [
    recap.pastedAt && 'pasted',
    recap.enterSentAt && 'Enter sent from samaritan',
    recap.verify && `verify ${recap.verify.pass ? 'PASS' : 'FAIL'}`,
  ].filter(Boolean);
  return facts.length > 0
    ? `↻ Resumed after the run stopped on this step. Before it: ${facts.join(', ')}.`
    : '↻ Resumed after the run stopped on this step. Nothing was pasted or sent from samaritan before it.';
}
