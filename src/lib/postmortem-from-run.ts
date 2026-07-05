import { existsSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import type { Postmortem, TimelineEntry } from '../models/postmortem';
import { foldEvents, readEvents, type SessionEvent } from './session-log';
import { getRunLogPath, loadSession } from './session-persistence';

/**
 * Resolve a `from-run` argument to a JSONL events path. Accepts either a direct
 * path to an `events.jsonl` file, or a saved session id (looked up via the
 * session store to find its run log). Returns the path plus any operation file
 * discovered from the session (used to back-reference the operation).
 */
export function resolveRunLog(arg: string): {
  jsonlPath: string;
  operationFile?: string;
} {
  // Direct file path (events.jsonl or any readable file).
  if (existsSync(arg) && statSync(arg).isFile()) {
    return { jsonlPath: arg };
  }

  // Otherwise treat it as a session id.
  const session = loadSession(arg);
  if (!session) {
    throw new Error(
      `No events log or saved session found for '${arg}'. Pass a path to events.jsonl or a valid session id (see 'samaritan sessions --all').`,
    );
  }
  const operationFile = session.operation_file;
  if (!operationFile) {
    throw new Error(
      `Session '${arg}' has no operation_file recorded; cannot locate its run log.`,
    );
  }
  return { jsonlPath: getRunLogPath(operationFile, arg), operationFile };
}

/** Build a chronological timeline from the raw event stream (uses event `ts`). */
function buildTimelineFromEvents(events: SessionEvent[]): TimelineEntry[] {
  const timeline: TimelineEntry[] = [];
  for (const e of events) {
    switch (e.type) {
      case 'step_start':
        timeline.push({
          at: e.ts,
          event: `Started: ${e.name ?? `step ${e.step}`}`,
          kind: 'action',
          by: (e.pic as string) ?? undefined,
        });
        break;
      case 'step_failed':
      case 'step_timeout':
        timeline.push({
          at: e.ts,
          event: `Failed: ${e.name ?? `step ${e.step}`}${e.reason ? ` — ${e.reason}` : ''}`,
          kind: 'cause',
        });
        break;
      case 'rollback_start':
        timeline.push({
          at: e.ts,
          event: `Rollback started (step ${(e.step as number) + 1})`,
          kind: 'action',
        });
        break;
      case 'rollback_complete':
        timeline.push({
          at: e.ts,
          event: `Rollback complete${e.status ? `: ${e.status}` : ''}`,
          kind: 'recovery',
        });
        break;
      case 'session_end':
        timeline.push({
          at: e.ts,
          event: `Run ended: ${e.status ?? 'unknown'}`,
          kind: 'recovery',
        });
        break;
    }
  }
  return timeline;
}

/**
 * Seed a `Postmortem` skeleton from a captured run record. Timeline,
 * participants, incident window (occurred/resolved), duration, and the
 * operation/run back-references are populated from the events; narrative fields
 * (summary, root cause, action items) are left as `TODO` placeholders for a
 * human to complete. The result is schema-valid so it renders immediately.
 */
export function postmortemFromRun(arg: string): Postmortem {
  const { jsonlPath, operationFile } = resolveRunLog(arg);
  const events = readEvents(jsonlPath);
  if (events.length === 0) {
    throw new Error(`No events found in run log: ${jsonlPath}`);
  }

  const { steps } = foldEvents(events);
  const sessionStart = events.find((e) => e.type === 'session_start');
  const sessionEnd = events.find((e) => e.type === 'session_end');

  const opRef = operationFile ?? (sessionStart?.op as string | undefined);
  const opName = opRef ? basename(opRef, '.yaml') : 'operation';

  const firstTs = events[0]?.ts;
  const lastTs = events[events.length - 1]?.ts;

  // Participants from step PIC/reviewer.
  const participants = [
    ...new Set(
      steps.flatMap((s) => [s.pic, s.reviewer].filter(Boolean) as string[]),
    ),
  ];

  const failed = steps.filter((s) => s.status === 'failed');
  const endStatus = (sessionEnd?.status as string) ?? 'unknown';

  const pm: Postmortem = {
    title: `Incident: ${opName}`,
    status: 'draft',
    occurred_at: firstTs,
    resolved_at: lastTs,
    authors: participants.length ? participants : undefined,
    operation: opRef,
    run: jsonlPath,
    summary:
      'TODO: Summarize what happened, in one paragraph. Seeded from a SAMARITAN run record — edit before publishing.',
    impact: {
      scope: `TODO: describe impact. Run ended: ${endStatus}.`,
    },
    timeline: buildTimelineFromEvents(events),
    root_cause: {
      summary: failed.length
        ? `TODO: root cause. Run had ${failed.length} failed step(s): ${failed
            .map((s) => s.name)
            .join(', ')}.`
        : 'TODO: identify the root cause (blameless — systems and processes, not people).',
    },
    action_items: [
      {
        title: 'TODO: add a follow-up action item',
        type: 'prevent',
        status: 'open',
      },
    ],
    lessons_learned: {
      went_well: ['TODO'],
      went_wrong: ['TODO'],
      got_lucky: ['TODO'],
    },
  };

  return pm;
}
