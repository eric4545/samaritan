import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { evidenceLang } from '../manuals/generator';
import type {
  RollbackRecord,
  StepApproval,
  StepEvidenceRef,
  StepRecord,
} from '../models/step-record';
import { cleanTerminalOutput } from './assertions';
import { redactLocalPaths } from './path-redact';
import { foldEvents, readEvents, type SessionEvent } from './session-log';

/** Redacts operator-local path prefixes; identity when no bases are known. */
type Redact = (text: string) => string;

export function generateReport(jsonlPath: string): string {
  const events = readEvents(jsonlPath);
  return renderReport(events, foldEvents(events), dirname(jsonlPath));
}

/**
 * Render the Markdown report from an already-read event stream and its fold.
 * Lets callers that have just folded the events (e.g. the run loop persisting
 * `step_log`) reuse the result instead of re-reading and re-folding the file.
 */
export function renderReport(
  events: SessionEvent[],
  folded: { steps: StepRecord[]; rollbacks: RollbackRecord[] },
  runDir?: string,
): string {
  const sessionStart = events.find((e) => e.type === 'session_start');
  const sessionEnd = events.find((e) => e.type === 'session_end');

  const sessionId = events[0]?.session_id ?? 'unknown';
  const opFile = (sessionStart?.op as string) ?? 'unknown';

  // Strip operator-local path prefixes (home, run dir, operation dir) so a
  // shared report doesn't leak machine-specific locations.
  const redact: Redact = (text) =>
    redactLocalPaths(text, {
      home: homedir(),
      runDir,
      opDir: opFile !== 'unknown' ? dirname(opFile) : undefined,
    });
  const status = (sessionEnd?.status as string) ?? 'unknown';
  const startTs = events[0]?.ts ? formatTs(events[0].ts) : 'unknown';

  const { steps, rollbacks } = folded;

  // Calculate duration
  const firstTs = events[0]?.ts;
  const lastTs = events[events.length - 1]?.ts;
  const duration =
    firstTs && lastTs ? calcDuration(firstTs, lastTs) : 'unknown';

  const stepsCompleted = steps.filter((s) => s.status === 'completed').length;
  const stepsSkipped = steps.filter((s) => s.status === 'skipped').length;

  // Identify where an aborted/cancelled run actually stopped. A step that
  // emitted step_start but never completed (or failed/skipped) is left
  // `pending` with a `started_at` — that's the in-progress step at abort time.
  // Take the highest-index such step so the report can flag the stop point.
  const isAborted = status === 'cancelled' || status === 'aborted';
  const abortedStep = isAborted
    ? [...steps].reverse().find((s) => s.status === 'pending' && s.started_at)
    : undefined;
  const abortedIndex = abortedStep?.index;

  // Build Markdown
  const lines: string[] = [];

  lines.push(`# Evidence Report: ${opFile}`);
  lines.push(
    `Session: ${sessionId} | Date: ${startTs} | Status: ${statusIcon(status)} ${status}`,
  );
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  const declaredTotal =
    typeof sessionStart?.total_steps === 'number'
      ? sessionStart.total_steps
      : 0;
  const totalSteps = Math.max(declaredTotal, steps.length);
  lines.push(`- Steps completed: ${stepsCompleted}/${totalSteps}`);
  if (stepsSkipped > 0) {
    lines.push(`- Steps skipped: ${stepsSkipped}`);
  }
  if (abortedStep) {
    lines.push(
      `- Aborted at step ${abortedStep.index + 1}: ${abortedStep.name}`,
    );
  }
  lines.push(`- Duration: ${duration}`);

  const pics = [...new Set(steps.flatMap((s) => (s.pic ? [s.pic] : [])))];
  const reviewers = [
    ...new Set(steps.flatMap((s) => (s.reviewer ? [s.reviewer] : []))),
  ];
  if (pics.length) lines.push(`- PIC: ${pics.join(', ')}`);
  if (reviewers.length) lines.push(`- Reviewer: ${reviewers.join(', ')}`);

  lines.push('');

  for (const step of steps) {
    lines.push(...renderStep(step, redact, abortedIndex));
  }

  // Approval Trail — aggregates every step-level approve/reject decision so
  // the change-management gate is auditable in one place.
  const approved = steps.flatMap((s) =>
    s.approval ? [{ step: s, approval: s.approval }] : [],
  );
  lines.push('## Approval Trail');
  lines.push('');
  if (approved.length === 0) {
    lines.push('_(none)_');
  } else {
    for (const { step, approval } of approved) {
      const decision = approval.approved ? '✅ approved' : '❌ rejected';
      const who = `${approval.approver} at ${formatTs(approval.timestamp)}`;
      lines.push(
        `- **Step ${step.index + 1}: ${step.name}** — ${decision} by ${who}`,
      );
      if (approval.rationale)
        lines.push(`  - Rationale: ${approval.rationale}`);
    }
  }
  lines.push('');

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
        lines.push(
          `**Command**: \`${redact(cmd.command)}\` (session: ${cmd.session})`,
        );
        if (cmd.output) {
          lines.push('```');
          lines.push(redact(cleanTerminalOutput(cmd.output)).trim());
          lines.push('```');
        }
      }
      if (rb.status) lines.push(`**Status**: ${rb.status}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function renderStep(
  step: StepRecord,
  redact: Redact,
  abortedIndex?: number,
): string[] {
  const lines: string[] = [];
  const stepNum = step.index + 1;
  const firstCmd = step.commands[0];
  const skippedSuffix = step.status === 'skipped' ? ' ⏭ (skipped)' : '';
  // The step that was in progress when the operator aborted — flag it so the
  // report makes the stop point obvious instead of looking like a clean step.
  const abortedSuffix =
    step.index === abortedIndex ? ' 🛑 (aborted here — in progress)' : '';
  lines.push(
    `## Step ${stepNum}: ${step.name}${skippedSuffix}${abortedSuffix}`,
  );
  lines.push('');

  if (step.started_at) {
    lines.push(
      `**Time**: ${formatTs(step.started_at)}${firstCmd ? ` | **Session**: ${firstCmd.session}` : ''}`,
    );
  }

  for (const cmd of step.commands) {
    lines.push('');
    if (cmd.displayed) {
      lines.push(`**Command (run by operator)**: \`${redact(cmd.command)}\``);
    } else {
      lines.push(`**Command sent**: \`${redact(cmd.command)}\``);
    }
    if (cmd.output) {
      lines.push('');
      lines.push('Output');
      lines.push('');
      lines.push('```');
      lines.push(redact(cleanTerminalOutput(cmd.output)).trim());
      lines.push('```');
    }
  }

  if (step.verification) lines.push(...renderVerification(step));

  if (step.verification?.verifiedBy) {
    lines.push('');
    lines.push(
      `**Verified by**: ${step.verification.verifiedBy} at ${formatTs(step.verification.verifiedAt ?? '')} ✅`,
    );
  }
  if (step.status === 'failed') {
    lines.push('');
    lines.push(`**Failed**: ${step.failedReason ?? 'unknown reason'} ❌`);
  }

  if (step.approval) lines.push(...renderApproval(step.approval));

  if (step.notes.length) {
    lines.push('');
    lines.push('**Notes**');
    for (const note of step.notes) lines.push(`- ${note}`);
  }

  for (const evidence of step.evidence) {
    lines.push('');
    lines.push(...renderEvidenceBlock(evidence, redact));
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  return lines;
}

function renderVerification(step: StepRecord): string[] {
  const v = step.verification;
  if (!v || v.checks.length === 0) return [];
  const lines: string[] = [''];
  lines.push(`**Verification**: ${v.pass ? '✅ PASS' : '❌ FAIL'}`);
  for (const check of v.checks) {
    const icon = check.pass ? '✅' : '❌';
    const type = check.type ? ` (${check.type})` : '';
    const detail = formatCheckDetail(check.expected, check.actual);
    lines.push(`- ${icon}${type}${detail}`);
  }
  return lines;
}

function formatCheckDetail(expected?: string, actual?: string): string {
  const parts: string[] = [];
  if (expected) parts.push(`expected: \`${expected}\``);
  if (actual) parts.push(`actual: \`${actual}\``);
  return parts.length ? ` — ${parts.join(', ')}` : '';
}

function renderApproval(approval: StepApproval): string[] {
  const decision = approval.approved ? '✅ approved' : '❌ rejected';
  const lines = [''];
  lines.push(
    `**Approval**: ${decision} by ${approval.approver} at ${formatTs(approval.timestamp)}`,
  );
  if (approval.rationale) lines.push(`- Rationale: ${approval.rationale}`);
  return lines;
}

function renderEvidenceBlock(
  evidence: StepEvidenceRef,
  redact: Redact,
): string[] {
  const lines: string[] = [];
  const label = evidence.description
    ? `**Evidence**: ${evidence.type} — ${evidence.description}`
    : `**Evidence**: ${evidence.type}`;
  lines.push(label);
  lines.push('');

  if (evidence.path) {
    if (evidence.type === 'screenshot' || evidence.type === 'photo') {
      lines.push(`![Evidence](${redact(evidence.path)})`);
    } else {
      lines.push(`[View ${evidence.type}](${redact(evidence.path)})`);
    }
  } else if (evidence.content) {
    // Reuse evidenceLang() so captured-evidence code blocks fence
    // consistently with evidence.results rendering in the manual generator.
    // Clean terminal noise then redact local paths so auto-captured verify
    // output reads well and doesn't leak the operator's filesystem.
    lines.push(`\`\`\`${evidenceLang(evidence.type)}`);
    lines.push(redact(cleanTerminalOutput(evidence.content)).trim());
    lines.push('```');
  }

  return lines;
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
  if (status === 'aborted' || status === 'cancelled') return '🛑';
  if (status === 'paused') return '⏸️';
  return '❓';
}
