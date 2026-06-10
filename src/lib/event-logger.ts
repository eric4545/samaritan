import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type EventType =
  | 'session_start'
  | 'session_open'
  | 'session_error'
  | 'step_start'
  | 'command_sent'
  | 'command_displayed'
  | 'capture_attach'
  | 'pane_captured'
  | 'evidence_captured'
  | 'evidence_removed'
  | 'user_input'
  | 'step_complete'
  | 'step_failed'
  | 'step_timeout'
  | 'rollback_start'
  | 'rollback_complete'
  | 'session_end'
  | 'iterm2_pane_opened'
  | 'assert_result';

export interface BaseEvent {
  ts: string;
  type: EventType;
  session_id: string;
}

export type LogEvent = Omit<BaseEvent, 'ts' | 'session_id'> &
  Record<string, unknown>;

export interface EventLogger {
  emit(event: LogEvent): void;
  close(extra?: Record<string, unknown>): void;
  path: string;
}

export function createEventLogger(sessionId: string): EventLogger {
  const logPath = join(tmpdir(), `samaritan-${sessionId}.jsonl`);

  function emit(event: LogEvent): void {
    const fullEvent: BaseEvent & Record<string, unknown> = {
      ts: new Date().toISOString(),
      session_id: sessionId,
      ...event,
    };
    appendFileSync(logPath, `${JSON.stringify(fullEvent)}\n`, 'utf-8');
  }

  function close(extra?: Record<string, unknown>): void {
    emit({ type: 'session_end', ...extra });
  }

  return { emit, close, path: logPath };
}
