import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { OperationSession } from '../models/session';

function getSessionDir(): string {
  const dir = join(homedir(), '.samaritan', 'sessions');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function sessionPath(sessionId: string): string {
  return join(getSessionDir(), `${sessionId}.json`);
}

/**
 * Directory where evidence files attached to a session (e.g. dragged-in
 * screenshots/files captured during `samaritan run`) are stored, keeping
 * them alongside the session's persisted JSON under `~/.samaritan/sessions/`.
 */
export function getSessionEvidenceDir(sessionId: string): string {
  const dir = join(getSessionDir(), sessionId, 'evidence');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
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
  } catch {
    // Persistence is best-effort; don't crash the run if writes fail.
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
