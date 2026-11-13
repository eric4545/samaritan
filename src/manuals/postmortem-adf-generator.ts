import { existsSync, readFileSync } from 'node:fs';
import {
  bulletList,
  codeBlock,
  doc,
  em,
  hardBreak,
  heading,
  listItem,
  paragraph,
  strong,
  table,
  tableCell,
  tableHeader,
  tableRow,
  text,
} from '@atlaskit/adf-utils/builders';
import type { Postmortem, SupportingInfo } from '../models/postmortem';
import {
  DEFAULT_POSTMORTEM_TIMEZONE,
  detectionRows,
  eventLines,
  formatPostmortemTs,
  formatTimelineTime,
  impactRows,
  incidentDuration,
  type PostmortemRenderOptions,
  resolvePath,
  severityIcon,
  timelineKindIcon,
  timelineView,
} from './postmortem-shared';

/** `**key**: value` paragraph. */
function kv(key: string, value: string): any {
  return paragraph(strong(text(`${key}: `)), text(value));
}

/** Bullet list from plain strings. */
function bullets(items: string[]): any {
  return bulletList(...items.map((i) => listItem([paragraph(text(i))])));
}

/**
 * A table cell's paragraph. ADF rejects an empty text node, so an absent
 * value is an empty paragraph.
 */
function textCell(value?: string): any {
  return tableCell()(value ? paragraph(text(value)) : paragraph());
}

/**
 * A timeline event as one paragraph: each YAML line separated by a hard
 * break, `**bold**` as a strong mark, prefixed by the kind badge.
 */
function eventParagraph(kind: string | undefined, event: string): any {
  const nodes: any[] = [text(`${timelineKindIcon(kind)} `)];
  eventLines(event).forEach((segs, i) => {
    if (i > 0) nodes.push(hardBreak());
    for (const seg of segs)
      nodes.push(seg.bold ? strong(text(seg.text)) : text(seg.text));
  });
  return paragraph(...nodes);
}

function h2(t: string): any {
  return heading({ level: 2 })(text(t));
}

/**
 * Render a postmortem as an Atlassian Document Format (ADF) document object —
 * the format Confluence Cloud consumes.
 */
export function generatePostmortemADF(
  pm: Postmortem,
  postmortemDir?: string,
  options: PostmortemRenderOptions = {},
): object {
  const tz = options.timezone ?? DEFAULT_POSTMORTEM_TIMEZONE;
  const content: any[] = [];

  // --- Header ---
  const sev = severityIcon(pm.severity);
  content.push(
    heading({ level: 1 })(text(`${sev ? `${sev} ` : ''}${pm.title}`)),
  );
  const badges = [pm.id, pm.severity, pm.status && `status: ${pm.status}`]
    .filter(Boolean)
    .join(' | ');
  if (badges) content.push(paragraph(em(text(badges))));

  // --- Metadata / linkage ---
  if (pm.occurred_at)
    content.push(kv('Occurred', formatPostmortemTs(pm.occurred_at, tz)));
  if (pm.resolved_at)
    content.push(kv('Resolved', formatPostmortemTs(pm.resolved_at, tz)));
  const duration = incidentDuration(pm, tz);
  if (duration) content.push(kv('Duration', duration));
  if (pm.authors?.length) content.push(kv('Authors', pm.authors.join(', ')));
  if (pm.reviewers?.length)
    content.push(kv('Reviewers', pm.reviewers.join(', ')));
  if (pm.operation) content.push(kv('Operation', pm.operation));
  if (pm.manual) content.push(kv('Manual', pm.manual));
  if (pm.run) content.push(kv('Run record', pm.run));
  if (pm.qrh?.length) content.push(kv('QRH', pm.qrh.join(', ')));
  if (pm.tickets?.length) content.push(kv('Tickets', pm.tickets.join(', ')));

  // --- Summary ---
  content.push(h2('Summary'));
  content.push(paragraph(text(pm.summary.trim())));

  // --- Impact ---
  const impactItems = impactRows(pm, tz).map((r) => `${r.label}: ${r.value}`);
  if (impactItems.length) {
    content.push(h2('Impact'));
    content.push(bullets(impactItems));
  }

  // --- Detection ---
  if (pm.detection) {
    content.push(h2('Detection'));
    const items = detectionRows(pm.detection, tz).map(
      (r) => `${r.label}: ${r.value}`,
    );
    if (items.length) content.push(bullets(items));
  }

  // --- Timeline ---
  const timeline = timelineView(pm, tz);
  if (timeline) {
    content.push(h2('Timeline'));
    if (timeline.mermaid)
      content.push(codeBlock({ language: 'mermaid' })(text(timeline.mermaid)));
    const headers = ['Time', 'Event'];
    if (timeline.showWho) headers.push('Who');
    if (timeline.showRef) headers.push('Ref');
    const rows = [
      tableRow(headers.map((h) => tableHeader()(paragraph(text(h))))),
    ];
    for (const entry of timeline.entries) {
      const cells = [
        tableCell()(paragraph(text(formatTimelineTime(entry, tz)))),
        tableCell()(eventParagraph(entry.kind, entry.event)),
      ];
      if (timeline.showWho) cells.push(textCell(entry.by));
      if (timeline.showRef) cells.push(textCell(entry.ref));
      rows.push(tableRow(cells));
    }
    content.push(table(...rows));
    // Timeline-entry images (ADF can't embed external images without an
    // attachment id, so render the reference as a labelled paragraph — parity
    // with the supporting-info image handling below).
    for (const entry of timeline.entries) {
      if (entry.image) {
        const isUrl = /^https?:\/\//.test(entry.image);
        const target = isUrl
          ? entry.image
          : resolvePath(postmortemDir, entry.image);
        content.push(paragraph(strong(text(`${entry.event}: `)), text(target)));
      }
    }
  }

  // --- Root Cause Analysis ---
  if (pm.root_cause) {
    const rc = pm.root_cause;
    content.push(h2('Root Cause Analysis'));
    content.push(paragraph(text(rc.summary.trim())));
    if (rc.trigger) content.push(kv('Trigger', rc.trigger));
    if (rc.contributing_factors?.length) {
      content.push(paragraph(strong(text('Contributing factors'))));
      content.push(bullets(rc.contributing_factors));
    }
    if (rc.five_whys?.length) {
      content.push(paragraph(strong(text('5 Whys'))));
      content.push(bullets(rc.five_whys));
    }
  }

  // --- Resolution ---
  if (pm.resolution) {
    content.push(h2('Resolution'));
    content.push(paragraph(text(pm.resolution.trim())));
  }

  // --- Action Items ---
  if (pm.action_items?.length) {
    content.push(h2('Action Items'));
    const rows = [
      tableRow(
        ['Status', 'Action', 'Owner', 'Type', 'Ticket', 'Due'].map((c) =>
          tableHeader()(paragraph(text(c))),
        ),
      ),
    ];
    for (const item of pm.action_items) {
      rows.push(
        tableRow(
          [
            item.status ?? '',
            item.title,
            item.owner ?? '',
            item.type ?? '',
            item.ticket ?? '',
            item.due ?? '',
          ].map((c) => tableCell()(paragraph(text(c)))),
        ),
      );
    }
    content.push(table(...rows));
  }

  // --- Lessons Learned ---
  if (pm.lessons_learned) {
    const ll = pm.lessons_learned;
    content.push(h2('Lessons Learned'));
    if (ll.went_well?.length) {
      content.push(heading({ level: 3 })(text('What went well')));
      content.push(bullets(ll.went_well));
    }
    if (ll.went_wrong?.length) {
      content.push(heading({ level: 3 })(text('What went wrong')));
      content.push(bullets(ll.went_wrong));
    }
    if (ll.got_lucky?.length) {
      content.push(heading({ level: 3 })(text('Where we got lucky')));
      content.push(bullets(ll.got_lucky));
    }
  }

  // --- Supporting Information ---
  if (pm.supporting_information?.length) {
    content.push(h2('Supporting Information'));
    for (const info of pm.supporting_information) {
      content.push(...renderSupporting(info, postmortemDir));
    }
  }

  return doc(...content);
}

function renderSupporting(
  info: SupportingInfo,
  pmDir: string | undefined,
): any[] {
  const desc = info.description ?? info.type;

  if (info.file && (info.type === 'log' || info.type === 'file')) {
    const resolved = resolvePath(pmDir, info.file);
    const nodes: any[] = [paragraph(strong(text(desc)))];
    if (existsSync(resolved)) {
      try {
        const c = readFileSync(resolved, 'utf-8').trimEnd();
        nodes.push(codeBlock({})(text(c)));
      } catch {
        nodes.push(paragraph(em(text(`Could not read ${info.file}`))));
      }
    } else {
      nodes.push(paragraph(text(resolved)));
    }
    return nodes;
  }

  const target = info.url ?? info.file ?? '';
  return [paragraph(strong(text(`${desc}: `)), text(target))];
}

/** Serialize a postmortem ADF document to a JSON string. */
export function generatePostmortemADFString(
  pm: Postmortem,
  postmortemDir?: string,
  options: PostmortemRenderOptions = {},
): string {
  return JSON.stringify(
    generatePostmortemADF(pm, postmortemDir, options),
    null,
    2,
  );
}
