import { readFileSync } from 'node:fs';

interface SessionEvent {
  ts: string;
  type: string;
  session_id: string;
  [key: string]: unknown;
}

interface StepSummary {
  index: number;
  name: string;
  pic?: string;
  reviewer?: string;
  startTs?: string;
  endTs?: string;
  commands: Array<{ session: string; command: string; output?: string }>;
  verifiedBy?: string;
  verifiedAt?: string;
  failed?: boolean;
  failedReason?: string;
}

interface RollbackEvent {
  step: number;
  triggeredBy: string;
  commands: Array<{ session: string; command: string; output?: string }>;
  status?: string;
}

export function generateReport(jsonlPath: string): string {
  const content = readFileSync(jsonlPath, 'utf-8');
  const events: SessionEvent[] = content
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const sessionStart = events.find((e) => e.type === 'session_start');
  const sessionEnd = events.find((e) => e.type === 'session_end');

  const sessionId = events[0]?.session_id ?? 'unknown';
  const opFile = (sessionStart?.op as string) ?? 'unknown';
  const status = (sessionEnd?.status as string) ?? 'unknown';
  const startTs = events[0]?.ts ? formatTs(events[0].ts) : 'unknown';

  // Reconstruct step summaries
  const steps: StepSummary[] = [];
  const rollbacks: RollbackEvent[] = [];

  let currentStep: StepSummary | null = null;
  const pendingOutput: Map<string, string> = new Map();
  let currentRollback: RollbackEvent | null = null;

  for (const event of events) {
    switch (event.type) {
      case 'step_start': {
        currentStep = {
          index: event.step as number,
          name: event.name as string,
          pic: event.pic as string | undefined,
          reviewer: event.reviewer as string | undefined,
          startTs: event.ts,
          commands: [],
        };
        steps.push(currentStep);
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
          });
          pendingOutput.delete(event.session as string);
        }
        break;
      }

      case 'pane_captured': {
        const _sessionName = event.session as string;
        const output = event.output as string;
        if (event.context === 'rollback') {
          const last =
            currentRollback?.commands[currentRollback.commands.length - 1];
          if (last) last.output = output;
        } else if (currentStep?.commands.length) {
          const last = currentStep.commands[currentStep.commands.length - 1];
          if (last && !last.output) last.output = output;
        }
        break;
      }

      case 'step_complete': {
        if (currentStep) currentStep.endTs = event.ts;
        break;
      }

      case 'step_failed': {
        if (currentStep) {
          currentStep.failed = true;
          currentStep.failedReason = event.reason as string;
          currentStep.endTs = event.ts;
        }
        break;
      }

      case 'user_input': {
        if (currentStep) {
          const action = event.action as string;
          if (action === 'verify_ok') {
            currentStep.verifiedBy = event.actor as string;
            currentStep.verifiedAt = event.ts;
          }
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

  // Calculate duration
  const firstTs = events[0]?.ts;
  const lastTs = events[events.length - 1]?.ts;
  const duration =
    firstTs && lastTs ? calcDuration(firstTs, lastTs) : 'unknown';

  const stepsCompleted = steps.filter((s) => !s.failed).length;

  // Build Markdown
  const lines: string[] = [];

  lines.push(`# Evidence Report: ${opFile}`);
  lines.push(
    `Session: ${sessionId} | Date: ${startTs} | Status: ${statusIcon(status)} ${status}`,
  );
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Steps completed: ${stepsCompleted}/${steps.length}`);
  lines.push(`- Duration: ${duration}`);

  const pics = [...new Set(steps.filter((s) => s.pic).map((s) => s.pic!))];
  const reviewers = [
    ...new Set(steps.filter((s) => s.reviewer).map((s) => s.reviewer!)),
  ];
  if (pics.length) lines.push(`- PIC: ${pics.join(', ')}`);
  if (reviewers.length) lines.push(`- Reviewer: ${reviewers.join(', ')}`);

  lines.push('');

  for (const step of steps) {
    const stepNum = step.index + 1;
    const firstCmd = step.commands[0];
    lines.push(`## Step ${stepNum}: ${step.name}`);
    lines.push('');

    if (step.startTs) {
      lines.push(
        `**Time**: ${formatTs(step.startTs)}${firstCmd ? ` | **Session**: ${firstCmd.session}` : ''}`,
      );
    }

    for (const cmd of step.commands) {
      lines.push('');
      lines.push(`**Command sent**: \`${cmd.command}\``);
      if (cmd.output) {
        lines.push('');
        lines.push('Output');
        lines.push('');
        lines.push('```');
        lines.push(cmd.output.trim());
        lines.push('```');
      }
    }

    if (step.verifiedBy) {
      lines.push('');
      lines.push(
        `**Verified by**: ${step.verifiedBy} at ${formatTs(step.verifiedAt ?? '')} ✅`,
      );
    }
    if (step.failed) {
      lines.push('');
      lines.push(`**Failed**: ${step.failedReason ?? 'unknown reason'} ❌`);
    }

    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // Rollback section
  lines.push('## Rollback Events');
  lines.push('');

  if (rollbacks.length === 0) {
    lines.push('_(none)_');
  } else {
    for (const rb of rollbacks) {
      lines.push(`### Rollback for Step ${rb.step + 1}`);
      lines.push(`**Triggered by**: ${rb.triggeredBy}`);
      lines.push('');
      for (const cmd of rb.commands) {
        lines.push(`**Command**: \`${cmd.command}\` (session: ${cmd.session})`);
        if (cmd.output) {
          lines.push('```');
          lines.push(cmd.output.trim());
          lines.push('```');
        }
      }
      if (rb.status) lines.push(`**Status**: ${rb.status}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function formatTs(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toUTCString().replace(' GMT', ' UTC');
  } catch {
    return ts;
  }
}

function calcDuration(start: string, end: string): string {
  try {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
  } catch {
    return 'unknown';
  }
}

function statusIcon(status: string): string {
  if (status === 'completed') return '✅';
  if (status === 'rolled_back') return '↩️';
  if (status === 'aborted') return '🛑';
  return '❓';
}
