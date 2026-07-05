import { existsSync, readFileSync } from 'node:fs';
import {
  bulletList,
  codeBlock,
  doc,
  em,
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
  buildMermaidTimeline,
  detectionRows,
  formatPostmortemTs,
  impactRows,
  incidentDuration,
  resolvePath,
  severityIcon,
  timelineKindIcon,
} from './postmortem-shared';

/** `**key**: value` paragraph. */
function kv(key: string, value: string): any {
  return paragraph(strong(text(`${key}: `)), text(value));
}

/** Bullet list from plain strings. */
function bullets(items: string[]): any {
  return bulletList(...items.map((i) => listItem([paragraph(text(i))])));
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
): object {
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
    content.push(kv('Occurred', formatPostmortemTs(pm.occurred_at)));
  if (pm.resolved_at)
    content.push(kv('Resolved', formatPostmortemTs(pm.resolved_at)));
  const duration = incidentDuration(pm);
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
  if (pm.impact) {
    content.push(h2('Impact'));
    const items = impactRows(pm.impact).map((r) => `${r.label}: ${r.value}`);
    if (items.length) content.push(bullets(items));
  }

  // --- Detection ---
  if (pm.detection) {
    content.push(h2('Detection'));
    const items = detectionRows(pm.detection).map(
      (r) => `${r.label}: ${r.value}`,
    );
    if (items.length) content.push(bullets(items));
  }

  // --- Timeline ---
  if (pm.timeline?.length) {
    content.push(h2('Timeline'));
    const mermaid = buildMermaidTimeline(pm);
    if (mermaid)
      content.push(codeBlock({ language: 'mermaid' })(text(mermaid)));
    const rows = [
      tableRow([
        tableHeader()(paragraph(text('Time'))),
        tableHeader()(paragraph(text('Event'))),
        tableHeader()(paragraph(text('Who'))),
        tableHeader()(paragraph(text('Ref'))),
      ]),
    ];
    for (const entry of pm.timeline) {
      rows.push(
        tableRow([
          tableCell()(paragraph(text(formatPostmortemTs(entry.at)))),
          tableCell()(
            paragraph(text(`${timelineKindIcon(entry.kind)} ${entry.event}`)),
          ),
          tableCell()(paragraph(text(entry.by ?? ''))),
          tableCell()(paragraph(text(entry.ref ?? ''))),
        ]),
      );
    }
    content.push(table(...rows));
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
): string {
  return JSON.stringify(generatePostmortemADF(pm, postmortemDir), null, 2);
}
