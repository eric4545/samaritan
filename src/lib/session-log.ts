import { readFileSync } from 'node:fs';
import type { RollbackRecord, StepRecord } from '../models/step-record';

export interface SessionEvent {
  ts: string;
  type: string;
  session_id: string;
  [k: string]: unknown;
}

/**
 * Read a JSONL event log into an array of parsed events. Malformed trailing
 * lines (e.g. a partially-written line from a crashed process) are skipped
 * rather than throwing. Returns `[]` if the file doesn't exist.
 */
export function readEvents(jsonlPath: string): SessionEvent[] {
  let content: string;
  try {
    content = readFileSync(jsonlPath, 'utf-8');
  } catch {
    return [];
  }

  const events: SessionEvent[] = [];
  for (const line of content.trim().split('\n').filter(Boolean)) {
    try {
      events.push(JSON.parse(line) as SessionEvent);
    } catch {
      // skip malformed line
    }
  }
  return events;
}

/**
 * Fold a JSONL event stream into structured per-step records and rollback
 * records. Steps are keyed by index so a re-run step (e.g. after `resume`)
 * updates the existing record instead of creating a duplicate.
 */
export function foldEvents(events: SessionEvent[]): {
  steps: StepRecord[];
  rollbacks: RollbackRecord[];
} {
  const stepsByIndex = new Map<number, StepRecord>();
  const rollbacks: RollbackRecord[] = [];

  let currentStep: StepRecord | null = null;
  let currentRollback: RollbackRecord | null = null;

  for (const event of events) {
    switch (event.type) {
      case 'step_start': {
        const index = event.step as number;
        currentStep = {
          index,
          name: event.name as string,
          pic: event.pic as string | undefined,
          reviewer: event.reviewer as string | undefined,
          status: 'pending',
          started_at: event.ts,
          commands: [],
          notes: [],
          evidence: [],
        };
        stepsByIndex.set(index, currentStep);
        break;
      }

      case 'command_sent': {
        if (event.context === 'rollback') {
          currentRollback?.commands.push({
            session: event.session as string,
            command: event.command as string,
          });
        } else if (currentStep) {
          currentStep.commands.push({
            session: event.session as string,
            command: event.command as string,
            displayed: false,
          });
        }
        break;
      }

      case 'command_displayed': {
        if (currentStep) {
          currentStep.commands.push({
            session: event.session as string,
            command: event.command as string,
            displayed: true,
          });
        }
        break;
      }

      case 'pane_captured': {
        const output = event.output as string;
        if (event.context === 'rollback') {
          const last =
            currentRollback?.commands[currentRollback.commands.length - 1];
          if (last) last.output = output;
        } else if (currentStep) {
          const last = [...currentStep.commands]
            .reverse()
            .find((cmd) => !cmd.output);
          if (last) last.output = output;
        }
        break;
      }

      case 'assert_result': {
        if (currentStep) {
          currentStep.verification ??= { pass: true, checks: [] };
          currentStep.verification.checks.push({
            pass: event.pass as boolean,
            actual: event.actual as string | undefined,
            expected: event.expected as string | undefined,
            type: event.assertion_type as string | undefined,
          });
          currentStep.verification.pass =
            currentStep.verification.pass && (event.pass as boolean);
        }
        break;
      }

      case 'user_input': {
        if (currentStep) {
          const action = event.action as string;
          if (action === 'verify_ok') {
            currentStep.verification ??= { pass: true, checks: [] };
            currentStep.verification.verifiedBy = event.actor as string;
            currentStep.verification.verifiedAt = event.ts;
          } else if (action === 'note') {
            const notes = event.notes as string | undefined;
            if (notes) currentStep.notes.push(notes);
          } else if (action === 'approved' || action === 'rejected') {
            currentStep.approval = {
              approver: event.actor as string,
              approved: action === 'approved',
              rationale: event.rationale as string | undefined,
              timestamp: event.ts,
            };
          }
        }
        break;
      }

      case 'evidence_captured': {
        if (currentStep) {
          currentStep.evidence.push({
            id: event.evidence_id as string | undefined,
            type: event.evidence_type as string,
            description: event.description as string | undefined,
            content: event.content as string | undefined,
            filename: event.filename as string | undefined,
            path: event.path as string | undefined,
          });
        }
        break;
      }

      case 'evidence_removed': {
        if (currentStep) {
          const removedId = event.evidence_id as string | undefined;
          currentStep.evidence = currentStep.evidence.filter(
            (e) => e.id !== removedId,
          );
        }
        break;
      }

      case 'step_complete': {
        if (currentStep) {
          currentStep.status = 'completed';
          currentStep.ended_at = event.ts;
          currentStep.duration_ms = durationMs(
            currentStep.started_at,
            event.ts,
          );
        }
        break;
      }

      case 'step_skip': {
        // A jumped-over or explicitly-skipped step. The step may never have
        // emitted step_start (jumped steps are never visited by the loop), so
        // create the record if absent, then mark it skipped.
        const index = event.step as number;
        let rec = stepsByIndex.get(index);
        if (!rec) {
          rec = {
            index,
            name: event.name as string,
            status: 'skipped',
            started_at: event.ts,
            commands: [],
            notes: [],
            evidence: [],
          };
          stepsByIndex.set(index, rec);
        } else {
          rec.status = 'skipped';
        }
        rec.ended_at = event.ts;
        break;
      }

      case 'step_failed': {
        if (currentStep) {
          currentStep.status = 'failed';
          currentStep.ended_at = event.ts;
          currentStep.failedReason = event.reason as string | undefined;
          currentStep.duration_ms = durationMs(
            currentStep.started_at,
            event.ts,
          );
        }
        break;
      }

      case 'rollback_start': {
        currentRollback = {
          step: event.step as number,
          triggeredBy: event.triggered_by as string,
          commands: [],
        };
        rollbacks.push(currentRollback);
        break;
      }

      case 'rollback_complete': {
        if (currentRollback) {
          currentRollback.status = event.status as string;
          currentRollback = null;
        }
        break;
      }
    }
  }

  const steps = [...stepsByIndex.values()].sort((a, b) => a.index - b.index);
  return { steps, rollbacks };
}

/** Convenience wrapper returning just the `StepRecord[]` from `foldEvents`. */
export function buildStepRecords(events: SessionEvent[]): StepRecord[] {
  return foldEvents(events).steps;
}

function durationMs(
  startTs: string | undefined,
  endTs: string,
): number | undefined {
  if (!startTs) return undefined;
  try {
    return new Date(endTs).getTime() - new Date(startTs).getTime();
  } catch {
    return undefined;
  }
}
