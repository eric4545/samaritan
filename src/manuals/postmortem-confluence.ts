import { existsSync, readFileSync } from 'node:fs';
import type { Postmortem, SupportingInfo } from '../models/postmortem';
import {
  DEFAULT_POSTMORTEM_TIMEZONE,
  detectionRows,
  type EventSegment,
  eventLines,
  formatPostmortemTs,
  impactRows,
  incidentDuration,
  type PostmortemRenderOptions,
  resolvePath,
  severityIcon,
  timelineKindIcon,
  timelineView,
} from './postmortem-shared';

/** Escape Confluence macro braces in free text. */
function esc(t: string): string {
  return t.replace(/([{}])/g, '\\$1');
}

/** Escape a value used inside a Confluence table cell (`|` is the separator). */
function cell(t: string): string {
  return esc(t)
    .replace(/\|/g, '\\|')
    .replace(/[\r\n]+/g, ' ');
}

/**
 * A timeline event as one wiki table cell: each YAML line on its own line
 * (`\\` is the wiki line break) and `**bold**` as wiki `*bold*`.
 */
function wikiEventCell(event: string): string {
  return eventLines(event)
    .map((segs) => segs.map(wikiSegment).join(''))
    .join(' \\\\ ');
}

function wikiSegment(seg: EventSegment): string {
  const t = cell(seg.text);
  return seg.bold ? `*${t}*` : t;
}

/**
 * Render a postmortem as Confluence wiki markup. The Mermaid timeline is wrapped
 * in the `{markdown}` macro exactly like the operation Gantt (opening tag on the
 * same line as the mermaid fence, closing `` ``` `` and `{markdown}` on their own
 * lines) so Confluence's Markdown/Mermaid macro renders it.
 */
export function generatePostmortemConfluence(
  pm: Postmortem,
  postmortemDir?: string,
  options: PostmortemRenderOptions = {},
): string {
  const tz = options.timezone ?? DEFAULT_POSTMORTEM_TIMEZONE;
  const out: string[] = [];
  const sev = severityIcon(pm.severity);

  out.push(`h1. ${sev ? `${sev} ` : ''}${esc(pm.title)}`);
  out.push('');

  const badges = [pm.id, pm.severity, pm.status && `status: ${pm.status}`]
    .filter(Boolean)
    .map((b) => esc(String(b)))
    .join(' | ');
  if (badges) {
    out.push(`_${badges}_`);
    out.push('');
  }

  // Metadata / linkage
  const meta: string[] = [];
  if (pm.occurred_at)
    meta.push(`* *Occurred:* ${esc(formatPostmortemTs(pm.occurred_at, tz))}`);
  if (pm.resolved_at)
    meta.push(`* *Resolved:* ${esc(formatPostmortemTs(pm.resolved_at, tz))}`);
  const duration = incidentDuration(pm);
  if (duration) meta.push(`* *Duration:* ${duration}`);
  if (pm.authors?.length)
    meta.push(`* *Authors:* ${esc(pm.authors.join(', '))}`);
  if (pm.reviewers?.length)
    meta.push(`* *Reviewers:* ${esc(pm.reviewers.join(', '))}`);
  if (pm.operation) meta.push(`* *Operation:* ${esc(pm.operation)}`);
  if (pm.manual) meta.push(`* *Manual:* ${pm.manual}`);
  if (pm.run) meta.push(`* *Run record:* ${esc(pm.run)}`);
  if (pm.qrh?.length) meta.push(`* *QRH:* ${esc(pm.qrh.join(', '))}`);
  if (pm.tickets?.length)
    meta.push(`* *Tickets:* ${esc(pm.tickets.join(', '))}`);
  if (meta.length) {
    out.push(...meta);
    out.push('');
  }

  // Summary
  out.push('h2. Summary');
  out.push('');
  out.push(esc(pm.summary.trim()));
  out.push('');

  // Impact
  const impact = impactRows(pm);
  if (impact.length) {
    out.push('h2. Impact');
    out.push('');
    for (const { label, value } of impact) {
      out.push(`* *${label}:* ${esc(value)}`);
    }
    out.push('');
  }

  // Detection
  if (pm.detection) {
    out.push('h2. Detection');
    out.push('');
    for (const { label, value } of detectionRows(pm.detection, tz)) {
      out.push(`* *${label}:* ${esc(value)}`);
    }
    out.push('');
  }

  // Timeline
  const timeline = timelineView(pm, tz);
  if (timeline) {
    out.push('h2. Timeline');
    out.push('');
    if (timeline.mermaid) {
      // Opening {markdown} must be on the same line as the mermaid fence.
      out.push('{markdown} ```mermaid');
      out.push(timeline.mermaid);
      // Closing ``` and {markdown} on separate lines.
      out.push('```');
      out.push('{markdown}');
      out.push('');
    }
    const headers = ['Time', 'Event'];
    if (timeline.showWho) headers.push('Who');
    if (timeline.showRef) headers.push('Ref');
    out.push(`|| ${headers.join(' || ')} ||`);
    for (const entry of timeline.entries) {
      const cells = [
        cell(formatPostmortemTs(entry.at, tz)),
        `${timelineKindIcon(entry.kind)} ${wikiEventCell(entry.event)}`,
      ];
      if (timeline.showWho) cells.push(cell(entry.by ?? ' '));
      if (timeline.showRef) cells.push(cell(entry.ref ?? ' '));
      out.push(`| ${cells.join(' | ')} |`);
    }
    out.push('');
    // Inline any timeline-entry images beneath the table.
    for (const entry of timeline.entries) {
      if (entry.image) {
        const isUrl = /^https?:\/\//.test(entry.image);
        out.push(
          `!${isUrl ? entry.image : resolvePath(postmortemDir, entry.image)}!`,
        );
        out.push('');
      }
    }
  }

  // Root Cause Analysis
  if (pm.root_cause) {
    const rc = pm.root_cause;
    out.push('h2. Root Cause Analysis');
    out.push('');
    out.push(esc(rc.summary.trim()));
    out.push('');
    if (rc.trigger) {
      out.push(`*Trigger:* ${esc(rc.trigger)}`);
      out.push('');
    }
    if (rc.contributing_factors?.length) {
      out.push('*Contributing factors*');
      for (const f of rc.contributing_factors) out.push(`* ${esc(f)}`);
      out.push('');
    }
    if (rc.five_whys?.length) {
      out.push('*5 Whys*');
      for (const why of rc.five_whys) out.push(`# ${esc(why)}`);
      out.push('');
    }
  }

  // Resolution
  if (pm.resolution) {
    out.push('h2. Resolution');
    out.push('');
    out.push(esc(pm.resolution.trim()));
    out.push('');
  }

  // Action Items
  if (pm.action_items?.length) {
    out.push('h2. Action Items');
    out.push('');
    out.push('|| Status || Action || Owner || Type || Ticket || Due ||');
    for (const item of pm.action_items) {
      out.push(
        `| ${cell(item.status ?? ' ')} | ${cell(item.title)} | ${cell(item.owner ?? ' ')} | ${cell(item.type ?? ' ')} | ${cell(item.ticket ?? ' ')} | ${cell(item.due ?? ' ')} |`,
      );
    }
    out.push('');
  }

  // Lessons Learned
  if (pm.lessons_learned) {
    const ll = pm.lessons_learned;
    out.push('h2. Lessons Learned');
    out.push('');
    if (ll.went_well?.length) {
      out.push('h3. What went well');
      for (const x of ll.went_well) out.push(`* ${esc(x)}`);
      out.push('');
    }
    if (ll.went_wrong?.length) {
      out.push('h3. What went wrong');
      for (const x of ll.went_wrong) out.push(`* ${esc(x)}`);
      out.push('');
    }
    if (ll.got_lucky?.length) {
      out.push('h3. Where we got lucky');
      for (const x of ll.got_lucky) out.push(`* ${esc(x)}`);
      out.push('');
    }
  }

  // Supporting Information
  if (pm.supporting_information?.length) {
    out.push('h2. Supporting Information');
    out.push('');
    for (const info of pm.supporting_information) {
      out.push(...renderSupporting(info, postmortemDir));
      out.push('');
    }
  }

  return `${out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}

function renderSupporting(
  info: SupportingInfo,
  pmDir: string | undefined,
): string[] {
  const desc = info.description ?? info.type;

  if (info.type === 'link') return [`* [${esc(desc)}|${info.url ?? ''}]`];

  if (info.type === 'image') {
    if (info.url) return [`*${esc(desc)}*`, `!${info.url}!`];
    if (info.file)
      return [`*${esc(desc)}*`, `!${resolvePath(pmDir, info.file)}!`];
    return [`* ${esc(desc)}`];
  }

  // log / file
  if (info.file) {
    const resolved = resolvePath(pmDir, info.file);
    if (existsSync(resolved)) {
      try {
        const c = readFileSync(resolved, 'utf-8').trimEnd();
        return [`*${esc(desc)}*`, `{code}`, c, `{code}`];
      } catch {
        return [`*${esc(desc)}* _(could not read ${esc(info.file)})_`];
      }
    }
    return [`*${esc(desc)}* ${esc(resolved)}`];
  }

  if (info.url) return [`* [${esc(desc)}|${info.url}]`];
  return [`* ${esc(desc)}`];
}
