import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { Postmortem, SupportingInfo } from '../models/postmortem';
import {
  buildMermaidTimeline,
  formatPostmortemTs,
  incidentDuration,
  severityIcon,
  timelineKindIcon,
} from './postmortem-shared';

function resolvePath(pmDir: string | undefined, p: string): string {
  if (!pmDir || isAbsolute(p)) return p;
  return join(pmDir, p);
}

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
 * Render a postmortem as Confluence wiki markup. The Mermaid timeline is wrapped
 * in the `{markdown}` macro exactly like the operation Gantt (opening tag on the
 * same line as the mermaid fence, closing `` ``` `` and `{markdown}` on their own
 * lines) so Confluence's Markdown/Mermaid macro renders it.
 */
export function generatePostmortemConfluence(
  pm: Postmortem,
  postmortemDir?: string,
): string {
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
    meta.push(`* *Occurred:* ${esc(formatPostmortemTs(pm.occurred_at))}`);
  if (pm.resolved_at)
    meta.push(`* *Resolved:* ${esc(formatPostmortemTs(pm.resolved_at))}`);
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
  if (pm.impact) {
    const i = pm.impact;
    out.push('h2. Impact');
    out.push('');
    if (i.detected_after)
      out.push(`* *Time to detect (MTTD):* ${esc(i.detected_after)}`);
    if (i.resolved_after)
      out.push(`* *Time to resolve (MTTR):* ${esc(i.resolved_after)}`);
    if (i.scope) out.push(`* *Scope:* ${esc(i.scope)}`);
    if (i.services?.length)
      out.push(`* *Services:* ${esc(i.services.join(', '))}`);
    if (i.customers_affected)
      out.push(`* *Customers affected:* ${esc(i.customers_affected)}`);
    if (i.notes) out.push(`* *Notes:* ${esc(i.notes)}`);
    out.push('');
  }

  // Detection
  if (pm.detection) {
    const d = pm.detection;
    out.push('h2. Detection');
    out.push('');
    if (d.method) out.push(`* *Method:* ${esc(d.method)}`);
    if (d.source) out.push(`* *Source:* ${esc(d.source)}`);
    if (d.detected_at)
      out.push(`* *Detected at:* ${esc(formatPostmortemTs(d.detected_at))}`);
    out.push('');
  }

  // Timeline
  if (pm.timeline?.length) {
    out.push('h2. Timeline');
    out.push('');
    const mermaid = buildMermaidTimeline(pm);
    if (mermaid) {
      // Opening {markdown} must be on the same line as the mermaid fence.
      out.push('{markdown} ```mermaid');
      out.push(mermaid);
      // Closing ``` and {markdown} on separate lines.
      out.push('```');
      out.push('{markdown}');
      out.push('');
    }
    out.push('|| Time || Event || Who || Ref ||');
    for (const entry of pm.timeline) {
      out.push(
        `| ${cell(formatPostmortemTs(entry.at))} | ${cell(`${timelineKindIcon(entry.kind)} ${entry.event}`)} | ${cell(entry.by ?? ' ')} | ${cell(entry.ref ?? ' ')} |`,
      );
    }
    out.push('');
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
