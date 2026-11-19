import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { OperationSession } from '../models/session';

function getSessionDir(): string {
  const dir = join(homedir(), '.samaritan', 'sessions');
  // 0o700: sessions hold variables and evidence — keep them owner-only
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function sessionPath(sessionId: string): string {
  return join(getSessionDir(), `${sessionId}.json`);
}

/**
 * Per-session directory under `~/.samaritan/sessions/<sessionId>/`, used as
 * a fallback home for run artifacts (events log, report, evidence) when
 * writing beside the operation file isn't possible (e.g. read-only mount).
 */
export function getSessionSubdir(sessionId: string): string {
  const dir = join(getSessionDir(), sessionId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/**
 * Directory where evidence files attached to a session (e.g. dragged-in
 * screenshots/files captured during `samaritan run`) are stored, keeping
 * them alongside the session's persisted JSON under `~/.samaritan/sessions/`.
 */
export function getSessionEvidenceDir(sessionId: string): string {
  const dir = join(getSessionSubdir(sessionId), 'evidence');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/**
 * Directory where a run's JSONL event log and Markdown report are written,
 * placed beside the operation file under `.samaritan-runs/<sessionId>/` so
 * operators can find run artifacts alongside the operation they ran. Falls
 * back to `~/.samaritan/sessions/<sessionId>/` (via `getSessionSubdir`) when
 * the operation's directory isn't writable (e.g. EACCES/EROFS).
 */
export function getRunDir(operationFile: string, sessionId: string): string {
  const dir = join(dirname(operationFile), '.samaritan-runs', sessionId);
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return getSessionSubdir(sessionId);
  }
}

/**
 * Where files attached as evidence during a run are copied: `evidence/`
 * inside the run directory, beside `report.md`, so the report links to them
 * with a relative path and the run directory can be shared as a whole.
 */
export function getRunEvidenceDir(
  operationFile: string,
  sessionId: string,
): string {
  const dir = join(getRunDir(operationFile, sessionId), 'evidence');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Path to the JSONL event log for a run (see `getRunDir`). */
export function getRunLogPath(
  operationFile: string,
  sessionId: string,
): string {
  return join(getRunDir(operationFile, sessionId), 'events.jsonl');
}

/**
 * Candidate JSONL event-log paths for a session, in priority order, WITHOUT any
 * filesystem side effects (unlike `getRunLogPath`, which creates directories).
 * A run may have written to either the beside-the-operation location or the
 * `~/.samaritan/sessions/<id>/` fallback, so readers (e.g. `postmortem
 * from-run`) must check both rather than recomputing a single write-time path.
 */
export function candidateRunLogPaths(
  operationFile: string,
  sessionId: string,
): string[] {
  return [
    join(dirname(operationFile), '.samaritan-runs', sessionId, 'events.jsonl'),
    join(getSessionDir(), sessionId, 'events.jsonl'),
  ];
}

/** Path to the Markdown report for a run (see `getRunDir`). */
export function getRunReportPath(
  operationFile: string,
  sessionId: string,
): string {
  return join(getRunDir(operationFile, sessionId), 'report.md');
}

function reviveDates(session: OperationSession): OperationSession {
  session.started_at = new Date(session.started_at);
  session.updated_at = new Date(session.updated_at);
  session.checkpoints = (session.checkpoints ?? []).map((cp) => ({
    ...cp,
    timestamp: new Date(cp.timestamp),
  }));
  return session;
}

export function saveSession(session: OperationSession): void {
  try {
    writeFileSync(
      sessionPath(session.id),
      JSON.stringify(session, null, 2),
      'utf-8',
    );
  } catch (err: any) {
    // Persistence is best-effort; don't crash the run if writes fail —
    // but surface the failure so a broken resume isn't a surprise later.
    console.error(`⚠️  Failed to persist session ${session.id}: ${err.message}`);
  }
}

export function loadSession(sessionId: string): OperationSession | undefined {
  const path = sessionPath(sessionId);
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as OperationSession;
    return reviveDates(raw);
  } catch {
    return undefined;
  }
}

export function listSavedSessions(): OperationSession[] {
  try {
    return readdirSync(getSessionDir())
      .filter((f) => f.endsWith('.json'))
      .flatMap((f) => {
        const s = loadSession(f.slice(0, -5));
        return s ? [s] : [];
      });
  } catch {
    return [];
  }
}

export function deletePersistedSession(sessionId: string): void {
  const path = sessionPath(sessionId);
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // ignore
    }
  }
}

/**
 * A session named by its full id or by a unique leading part of it, the way
 * git takes a short commit hash: `resume 3f2a9c1e` instead of 36 characters.
 */
export function resolveSessionIdPrefix(
  input: string,
  ids: string[],
): { id: string } | { error: string } | undefined {
  const wanted = input.trim().toLowerCase();
  if (!wanted) return undefined;
  if (ids.includes(wanted)) return { id: wanted };
  const hits = ids.filter((id) => id.toLowerCase().startsWith(wanted));
  if (hits.length === 1) return { id: hits[0] };
  if (hits.length > 1)
    return {
      error: `"${input}" starts ${hits.length} session ids (${hits
        .map((id) => shortSessionId(id, ids))
        .join(', ')}). Type more of it.`,
    };
  return undefined;
}

/**
 * The shortest leading part of `id` (at least 8 characters) that no other
 * session id starts with: what `sessions` prints for `resume`.
 */
export function shortSessionId(id: string, ids: string[]): string {
  const others = ids.filter((other) => other !== id);
  for (let len = 8; len < id.length; len++) {
    const prefix = id.slice(0, len);
    if (!others.some((other) => other.startsWith(prefix))) return prefix;
  }
  return id;
}
