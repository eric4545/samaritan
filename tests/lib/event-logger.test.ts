import assert from 'node:assert';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { describe, it } from 'node:test';
import { createEventLogger } from '../../src/lib/event-logger';

describe('EventLogger (issue #7)', () => {
  it('creates log file at expected path', () => {
    const logger = createEventLogger('test-abc123');
    assert.ok(logger.path.includes('samaritan-test-abc123.jsonl'));
    logger.close();
    if (existsSync(logger.path)) unlinkSync(logger.path);
  });

  it('appends one valid JSON line per emit', () => {
    const logger = createEventLogger('test-emit1');
    logger.emit({
      type: 'session_start',
      op: 'test.yaml',
      tmux_session: 'sam-test-emit1',
    });
    logger.emit({ type: 'step_start', step: 1, name: 'Deploy' });
    logger.close();

    const content = readFileSync(logger.path, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    assert.ok(lines.length >= 2, 'should have at least 2 lines');
    const first = JSON.parse(lines[0]);
    assert.strictEqual(first.type, 'session_start');
    assert.ok(first.ts, 'should have ts field');
    assert.strictEqual(first.session_id, 'test-emit1');
    if (existsSync(logger.path)) unlinkSync(logger.path);
  });

  it('close() writes session_end event', () => {
    const logger = createEventLogger('test-close1');
    logger.emit({ type: 'step_start', step: 0, name: 'first' });
    logger.close();

    const content = readFileSync(logger.path, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]);
    assert.strictEqual(last.type, 'session_end');
    if (existsSync(logger.path)) unlinkSync(logger.path);
  });

  it('each event has ts in ISO 8601 format', () => {
    const logger = createEventLogger('test-ts1');
    logger.emit({ type: 'command_sent', session: 'exec', command: 'ls' });
    logger.close();

    const content = readFileSync(logger.path, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const event = JSON.parse(line);
      assert.ok(event.ts, `event ${event.type} should have ts`);
      assert.ok(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(event.ts),
        `ts should be ISO 8601: ${event.ts}`,
      );
    }
    if (existsSync(logger.path)) unlinkSync(logger.path);
  });

  it('log is queryable by type (all event types round-trip as JSON)', () => {
    const logger = createEventLogger('test-query1');
    const events = [
      {
        type: 'session_start' as const,
        op: 'dep.yaml',
        tmux_session: 'sam-q1',
      },
      {
        type: 'session_open' as const,
        name: 'execution',
        host: 'bastion',
        pane: 'sam-q1:0.1',
      },
      {
        type: 'step_start' as const,
        step: 1,
        name: 'Deploy',
        pic: 'ops@example.com',
      },
      {
        type: 'command_sent' as const,
        session: 'execution',
        command: 'kubectl apply -f dep.yaml',
      },
      {
        type: 'pane_captured' as const,
        session: 'execution',
        output: 'deployment created',
      },
      {
        type: 'user_input' as const,
        action: 'verify_ok',
        step: 1,
        actor: 'ops@example.com',
      },
      { type: 'step_complete' as const, step: 1 },
    ];
    for (const e of events) logger.emit(e);
    logger.close();

    const content = readFileSync(logger.path, 'utf-8');
    const parsed = content
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));

    const commandEvents = parsed.filter((e) => e.type === 'command_sent');
    assert.strictEqual(commandEvents.length, 1);
    assert.strictEqual(commandEvents[0].command, 'kubectl apply -f dep.yaml');

    if (existsSync(logger.path)) unlinkSync(logger.path);
  });
});
