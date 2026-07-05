import { isAbsolute, join } from 'node:path';
import type {
  Detection,
  Postmortem,
  PostmortemImpact,
} from '../models/postmortem';

/** A labelled value pair, formatted per-renderer. */
export interface LabelledValue {
  label: string;
  value: string;
}

/** Resolve a postmortem-relative path against the document directory. */
export function resolvePath(pmDir: string | undefined, p: string): string {
  if (!pmDir || isAbsolute(p)) return p;
  return join(pmDir, p);
}

/** Format an ISO-8601 (or free-form) timestamp to a compact UTC display. */
export function formatPostmortemTs(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts; // free-form clock string
  return d.toUTCString().replace(' GMT', ' UTC');
}

/** Short `HH:MM` label for a timeline point (falls back to the raw value). */
export function timelineLabel(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Human duration between two timestamps, e.g. "1h 16m". `undefined` if unknown. */
export function incidentDuration(pm: Postmortem): string | undefined {
  if (!pm.occurred_at || !pm.resolved_at) return undefined;
  const start = new Date(pm.occurred_at).getTime();
  const end = new Date(pm.resolved_at).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return undefined;
  const totalMin = Math.round((end - start) / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Severity → emoji badge for headers. */
export function severityIcon(severity?: string): string {
  switch (severity) {
    case 'SEV1':
      return '🔴';
    case 'SEV2':
      return '🟠';
    case 'SEV3':
      return '🟡';
    case 'SEV4':
      return '🔵';
    default:
      return '';
  }
}

/** Timeline entry kind → emoji badge. */
export function timelineKindIcon(kind?: string): string {
  switch (kind) {
    case 'cause':
      return '💥';
    case 'detection':
      return '🔔';
    case 'action':
      return '🛠️';
    case 'recovery':
      return '✅';
    default:
      return '•';
  }
}

/**
 * Sanitize text for a single Mermaid `timeline` cell: Mermaid uses `:` as the
 * label/event separator and treats newlines/`#`/`;` specially, so collapse them.
 */
function sanitizeMermaidText(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/:/g, '-')
    .replace(/[#;]/g, ' ')
    .trim();
}

/**
 * Build the body of a Mermaid `timeline` diagram (WITHOUT the surrounding code
 * fence / macro). Consumers wrap it: Markdown in a ```mermaid block, Confluence
 * in a {markdown} macro, ADF in a code node. Returns `undefined` when there is
 * no timeline to render.
 */
export function buildMermaidTimeline(pm: Postmortem): string | undefined {
  if (!pm.timeline || pm.timeline.length === 0) return undefined;
  const lines: string[] = ['timeline'];
  lines.push(`    title ${sanitizeMermaidText(pm.title)}`);
  for (const entry of pm.timeline) {
    const label = sanitizeMermaidText(timelineLabel(entry.at));
    lines.push(`    ${label} : ${sanitizeMermaidText(entry.event)}`);
  }
  return lines.join('\n');
}

/**
 * Impact fields as ordered label/value rows (MTTD, MTTR, scope, services,
 * customers, notes). Shared by all renderers so the field selection, order, and
 * labels live in one place; each format styles the returned pairs itself.
 */
export function impactRows(impact: PostmortemImpact): LabelledValue[] {
  const rows: LabelledValue[] = [];
  if (impact.detected_after)
    rows.push({ label: 'Time to detect (MTTD)', value: impact.detected_after });
  if (impact.resolved_after)
    rows.push({
      label: 'Time to resolve (MTTR)',
      value: impact.resolved_after,
    });
  if (impact.scope) rows.push({ label: 'Scope', value: impact.scope });
  if (impact.services?.length)
    rows.push({ label: 'Services', value: impact.services.join(', ') });
  if (impact.customers_affected)
    rows.push({
      label: 'Customers affected',
      value: impact.customers_affected,
    });
  if (impact.notes) rows.push({ label: 'Notes', value: impact.notes });
  return rows;
}

/**
 * Detection fields as ordered label/value rows. `detected_at` is passed through
 * `formatPostmortemTs` so callers get display-ready values.
 */
export function detectionRows(detection: Detection): LabelledValue[] {
  const rows: LabelledValue[] = [];
  if (detection.method) rows.push({ label: 'Method', value: detection.method });
  if (detection.source) rows.push({ label: 'Source', value: detection.source });
  if (detection.detected_at)
    rows.push({
      label: 'Detected at',
      value: formatPostmortemTs(detection.detected_at),
    });
  return rows;
}
