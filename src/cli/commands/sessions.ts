import { Command } from 'commander';
import { SessionUtils } from '../../lib/session-manager';
import { listSavedSessions } from '../../lib/session-persistence';

const RESUMABLE_STATUSES = new Set(['running', 'paused', 'failed']);

export const sessionsCommand = new Command('sessions')
  .description(
    'List saved run sessions from ~/.samaritan/sessions/ (resumable by default)',
  )
  .option('-a, --all', 'Include completed and cancelled sessions')
  .action((options: { all?: boolean }) => {
    const sessions = listSavedSessions()
      .filter((s) => options.all || RESUMABLE_STATUSES.has(s.status))
      .sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime());

    if (sessions.length === 0) {
      console.log(
        options.all
          ? 'No saved sessions.'
          : 'No resumable sessions. Use --all to include completed/cancelled ones.',
      );
      return;
    }

    console.log(`📋 ${sessions.length} session(s):\n`);
    for (const s of sessions) {
      const emoji = SessionUtils.getSessionStatusEmoji(s.status);
      console.log(`${emoji} ${s.id}`);
      console.log(
        `   Operation: ${s.operation_id}  Env: ${s.environment}  Mode: ${s.mode ?? '-'}`,
      );
      console.log(
        `   Status: ${s.status}  Step: ${s.current_step_index + 1}  Progress: ${s.completion_percentage ?? 0}%`,
      );
      console.log(`   Updated: ${s.updated_at.toISOString()}`);
      if (RESUMABLE_STATUSES.has(s.status)) {
        console.log(`   Resume:  samaritan resume ${s.id}`);
      }
      console.log('');
    }
  });
