import { existsSync, readFileSync } from 'node:fs';
import type {
  ActionItem,
  Postmortem,
  SupportingInfo,
  TimelineEntry,
} from '../models/postmortem';
import { evidenceLang } from './generator';
import {
  buildMermaidTimeline,
  detectionRows,
  formatPostmortemTs,
  impactRows,
  incidentDuration,
  resolvePath,
  severityIcon,
  timelineKindIcon,
} from './postmortem-shared';

const ACTION_STATUS_ICON: Record<string, string> = {
  open: '⬜',
  'in-progress': '🔶',
  done: '✅',
};

/**
 * Render a postmortem / incident report as Markdown.
 *
 * `postmortemDir` (the directory of the source YAML) enables embedding
 * file-based evidence (`type: log|file` / `image` with a `file:` path).
 */
export function generatePostmortemMarkdown(
  pm: Postmortem,
  postmortemDir?: string,
): string {
  const lines: string[] = [];

  // --- Header ---
  const sev = severityIcon(pm.severity);
  lines.push(`# ${sev ? `${sev} ` : ''}${pm.title}`);
  lines.push('');

  const badges: string[] = [];
  if (pm.id) badges.push(pm.id);
  if (pm.severity) badges.push(pm.severity);
  if (pm.status) badges.push(`status: ${pm.status}`);
  if (badges.length) {
    lines.push(badges.join(' | '));
    lines.push('');
  }

  // --- Metadata / linkage ---
  const meta: string[] = [];
  if (pm.occurred_at)
    meta.push(`- **Occurred**: ${formatPostmortemTs(pm.occurred_at)}`);
  if (pm.resolved_at)
    meta.push(`- **Resolved**: ${formatPostmortemTs(pm.resolved_at)}`);
  const duration = incidentDuration(pm);
  if (duration) meta.push(`- **Duration**: ${duration}`);
  if (pm.authors?.length) meta.push(`- **Authors**: ${pm.authors.join(', ')}`);
  if (pm.reviewers?.length)
    meta.push(`- **Reviewers**: ${pm.reviewers.join(', ')}`);
  if (pm.operation)
    meta.push(`- **Operation**: [${pm.operation}](${pm.operation})`);
  if (pm.manual) meta.push(`- **Manual**: ${pm.manual}`);
  if (pm.run) meta.push(`- **Run record**: \`${pm.run}\``);
  if (pm.qrh?.length)
    meta.push(
      `- **QRH**: ${pm.qrh.map((id) => `\`samaritan qrh show ${id}\``).join(', ')}`,
    );
  if (pm.tickets?.length) meta.push(`- **Tickets**: ${pm.tickets.join(', ')}`);
  if (meta.length) {
    lines.push(...meta);
    lines.push('');
  }

  // --- Summary ---
  lines.push('## Summary');
  lines.push('');
  lines.push(pm.summary.trim());
  lines.push('');

  // --- Impact ---
  const impact = impactRows(pm);
  if (impact.length) {
    lines.push('## Impact');
    lines.push('');
    for (const { label, value } of impact) {
      lines.push(`- **${label}**: ${value}`);
    }
    lines.push('');
  }

  // --- Detection ---
  if (pm.detection) {
    lines.push('## Detection');
    lines.push('');
    for (const { label, value } of detectionRows(pm.detection)) {
      lines.push(`- **${label}**: ${value}`);
    }
    lines.push('');
  }

  // --- Timeline ---
  if (pm.timeline?.length) {
    lines.push('## Timeline');
    lines.push('');
    const mermaid = buildMermaidTimeline(pm);
    if (mermaid) {
      lines.push('```mermaid');
      lines.push(mermaid);
      lines.push('```');
      lines.push('');
    }
    lines.push('| Time | Event | Who | Ref |');
    lines.push('| --- | --- | --- | --- |');
    for (const entry of pm.timeline) {
      lines.push(renderTimelineRow(entry));
    }
    lines.push('');
    // Inline any timeline-entry images beneath the table.
    for (const entry of pm.timeline) {
      if (entry.image) {
        lines.push(...renderImage(entry.image, entry.event, postmortemDir));
        lines.push('');
      }
    }
  }

  // --- Root Cause Analysis ---
  if (pm.root_cause) {
    const rc = pm.root_cause;
    lines.push('## Root Cause Analysis');
    lines.push('');
    lines.push(rc.summary.trim());
    lines.push('');
    if (rc.trigger) {
      lines.push(`**Trigger**: ${rc.trigger}`);
      lines.push('');
    }
    if (rc.contributing_factors?.length) {
      lines.push('**Contributing factors**');
      lines.push('');
      for (const f of rc.contributing_factors) lines.push(`- ${f}`);
      lines.push('');
    }
    if (rc.five_whys?.length) {
      lines.push('**5 Whys**');
      lines.push('');
      rc.five_whys.forEach((why, idx) => {
        lines.push(`${idx + 1}. ${why}`);
      });
      lines.push('');
    }
  }

  // --- Resolution ---
  if (pm.resolution) {
    lines.push('## Resolution');
    lines.push('');
    lines.push(pm.resolution.trim());
    lines.push('');
  }

  // --- Action Items ---
  if (pm.action_items?.length) {
    lines.push('## Action Items');
    lines.push('');
    lines.push('| Status | Action | Owner | Type | Ticket | Due |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const item of pm.action_items) lines.push(renderActionRow(item));
    lines.push('');
  }

  // --- Lessons Learned ---
  if (pm.lessons_learned) {
    const ll = pm.lessons_learned;
    lines.push('## Lessons Learned');
    lines.push('');
    if (ll.went_well?.length) {
      lines.push('### What went well');
      lines.push('');
      for (const x of ll.went_well) lines.push(`- ${x}`);
      lines.push('');
    }
    if (ll.went_wrong?.length) {
      lines.push('### What went wrong');
      lines.push('');
      for (const x of ll.went_wrong) lines.push(`- ${x}`);
      lines.push('');
    }
    if (ll.got_lucky?.length) {
      lines.push('### Where we got lucky');
      lines.push('');
      for (const x of ll.got_lucky) lines.push(`- ${x}`);
      lines.push('');
    }
  }

  // --- Supporting Information ---
  if (pm.supporting_information?.length) {
    lines.push('## Supporting Information');
    lines.push('');
    for (const info of pm.supporting_information) {
      lines.push(...renderSupporting(info, postmortemDir));
      lines.push('');
    }
  }

  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}

function renderTimelineRow(entry: TimelineEntry): string {
  const icon = timelineKindIcon(entry.kind);
  const time = formatPostmortemTs(entry.at);
  const event = `${icon} ${entry.event}`.replace(/\|/g, '\\|');
  const who = (entry.by ?? '').replace(/\|/g, '\\|');
  const ref = (entry.ref ?? '').replace(/\|/g, '\\|');
  return `| ${time} | ${event} | ${who} | ${ref} |`;
}

function renderActionRow(item: ActionItem): string {
  const status = item.status
    ? `${ACTION_STATUS_ICON[item.status] ?? ''} ${item.status}`.trim()
    : '';
  const cells = [
    status,
    item.title,
    item.owner ?? '',
    item.type ?? '',
    item.ticket ?? '',
    item.due ?? '',
  ].map((c) => c.replace(/\|/g, '\\|'));
  return `| ${cells.join(' | ')} |`;
}

/** Render an image reference (path or URL) as an embedded Markdown image. */
function renderImage(
  ref: string,
  alt: string,
  pmDir: string | undefined,
): string[] {
  const isUrl = /^https?:\/\//.test(ref);
  const target = isUrl ? ref : resolvePath(pmDir, ref);
  return [`![${alt}](${target})`];
}

/** Render a supporting-information item (image / link / log / file). */
function renderSupporting(
  info: SupportingInfo,
  pmDir: string | undefined,
): string[] {
  const desc = info.description ?? info.type;

  if (info.type === 'link' || (info.url && !info.file)) {
    const url = info.url ?? '';
    return [`- [${desc}](${url})`];
  }

  if (info.type === 'image') {
    if (info.url) return [`**${desc}**`, '', `![${desc}](${info.url})`];
    if (info.file)
      return [`**${desc}**`, '', ...renderImage(info.file, desc, pmDir)];
    return [`- ${desc}`];
  }

  // log / file → embed file content as a code block when readable.
  if (info.file) {
    const resolved = resolvePath(pmDir, info.file);
    const out = [`**${desc}**`, ''];
    if (existsSync(resolved)) {
      try {
        const content = readFileSync(resolved, 'utf-8').trimEnd();
        out.push(`\`\`\`${evidenceLang(info.type === 'log' ? 'log' : 'file')}`);
        out.push(content);
        out.push('```');
      } catch {
        out.push(`_(could not read ${info.file})_`);
      }
    } else {
      out.push(`[${info.file}](${resolved})`);
    }
    return out;
  }

  if (info.url) return [`- [${desc}](${info.url})`];
  return [`- ${desc}`];
}
