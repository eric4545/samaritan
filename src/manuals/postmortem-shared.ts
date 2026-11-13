import { isAbsolute, join } from 'node:path';
import type {
  Detection,
  Postmortem,
  TimelineEntry,
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

/** Default display time zone for postmortem timestamps. */
export const DEFAULT_POSTMORTEM_TIMEZONE = 'UTC';

/** Render-time options shared by the three postmortem renderers. */
export interface PostmortemRenderOptions {
  /**
   * IANA time zone (e.g. `UTC`, `Asia/Tokyo`) every parseable timestamp is
   * rendered in. Free-form clock strings are shown as written.
   */
  timezone?: string;
}

/**
 * Throw a readable error when `timezone` is not an IANA zone the runtime
 * knows. Called by the CLI before rendering so a typo fails fast.
 */
export function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new Error(
      `Unknown time zone '${timezone}'. Use an IANA name such as UTC, Europe/London or Asia/Tokyo.`,
    );
  }
}

interface ZonedParts {
  weekday: string;
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
  second: string;
}

function zonedParts(d: Date, timezone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return {
    weekday: get('weekday'),
    day: get('day'),
    month: get('month'),
    year: get('year'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/**
 * Format an ISO-8601 (or free-form) timestamp for display, e.g.
 * `Wed, 01 Jul 2026 14:32:00 UTC`. With `timezone` the instant is shown in
 * that zone and labelled with its name. Free-form strings pass through.
 */
export function formatPostmortemTs(
  ts: string,
  timezone: string = DEFAULT_POSTMORTEM_TIMEZONE,
): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts; // free-form clock string
  const p = zonedParts(d, timezone);
  return `${p.weekday}, ${p.day} ${p.month} ${p.year} ${p.hour}:${p.minute}:${p.second} ${timezone}`;
}

/** Short `HH:MM` label for a timeline point (falls back to the raw value). */
export function timelineLabel(
  ts: string,
  timezone: string = DEFAULT_POSTMORTEM_TIMEZONE,
): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const p = zonedParts(d, timezone);
  return `${p.hour}:${p.minute}`;
}

/**
 * Human duration between two ISO timestamps, e.g. "1h 16m" / "4m". `undefined`
 * if either is missing/unparseable or the range is negative.
 */
export function formatDurationBetween(
  startTs?: string,
  endTs?: string,
): string | undefined {
  if (!startTs || !endTs) return undefined;
  const start = new Date(startTs).getTime();
  const end = new Date(endTs).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return undefined;
  const totalMin = Math.round((end - start) / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Overall incident duration (occurred → resolved). */
export function incidentDuration(pm: Postmortem): string | undefined {
  return formatDurationBetween(pm.occurred_at, pm.resolved_at);
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
 * Above this many entries the Mermaid chart is dropped: its fixed-width
 * columns are unreadable, and the table already carries every entry.
 */
export const TIMELINE_CHART_MAX_ENTRIES = 8;

/**
 * Longest event label (characters) shown in the Mermaid chart. A longer or
 * multi-line event is cut to its first line / this length and marked
 * `(see table)`, because the table holds the full text.
 */
export const TIMELINE_CHART_LABEL_MAX = 80;

/** A run of event text, bold or not (from `**…**` in the YAML). */
export interface EventSegment {
  text: string;
  bold: boolean;
}

/**
 * Split a timeline `event` into display lines, one per non-blank line of the
 * YAML value, each parsed into plain and `**bold**` segments. A `|` block
 * scalar with one fact per line therefore renders one fact per line in every
 * format, and a `**Lead-in:**` renders bold.
 */
export function eventLines(event: string): EventSegment[][] {
  return event
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseBold);
}

function parseBold(line: string): EventSegment[] {
  const segments: EventSegment[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (let m = re.exec(line); m !== null; m = re.exec(line)) {
    if (m.index > last)
      segments.push({ text: line.slice(last, m.index), bold: false });
    segments.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < line.length)
    segments.push({ text: line.slice(last), bold: false });
  return segments;
}

/** Event text with `**` markers removed and lines joined by a space. */
export function eventPlainText(event: string): string {
  return eventLines(event)
    .map((segs) => segs.map((s) => s.text).join(''))
    .join(' ');
}

type SortKey = { kind: 'instant' | 'clock'; value: number };

/** `HH:MM` (optionally `:SS`, a range, or a zone suffix) at the start. */
const CLOCK_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\b/;

function sortKey(at: string): SortKey | undefined {
  if (/^\d{4}-\d{2}-\d{2}/.test(at)) {
    const ms = Date.parse(at);
    return Number.isNaN(ms) ? undefined : { kind: 'instant', value: ms };
  }
  const m = CLOCK_RE.exec(at);
  if (!m) return undefined;
  const value =
    Number(m[1]) * 3600 + Number(m[2]) * 60 + (m[3] ? Number(m[3]) : 0);
  return { kind: 'clock', value };
}

export interface SortedTimeline {
  entries: TimelineEntry[];
  /**
   * Why the entries were left in YAML order, or `undefined` when they were
   * sorted. Sorting needs every `at` to be comparable: all ISO-8601
   * timestamps, or all `HH:MM` clock strings.
   */
  unsortedReason?: string;
}

/**
 * Order timeline entries chronologically. Entries are often appended as they
 * are remembered, so YAML order is not time order. The sort is stable: equal
 * times keep their YAML order.
 */
export function sortTimeline(timeline: TimelineEntry[]): SortedTimeline {
  const keys = timeline.map((e) => sortKey(e.at));
  const unkeyed = timeline.filter((_, i) => keys[i] === undefined);
  if (unkeyed.length > 0) {
    return {
      entries: [...timeline],
      unsortedReason: `timeline kept in YAML order: ${unkeyed
        .map((e) => `'${e.at}'`)
        .join(', ')} is not an ISO-8601 timestamp or an HH:MM time`,
    };
  }
  const kinds = new Set(keys.map((k) => k?.kind));
  if (kinds.size > 1) {
    return {
      entries: [...timeline],
      unsortedReason:
        'timeline kept in YAML order: it mixes full ISO-8601 timestamps with bare HH:MM times, which cannot be compared',
    };
  }
  const order = timeline.map((entry, i) => ({
    entry,
    key: keys[i]?.value ?? 0,
    i,
  }));
  order.sort((a, b) => a.key - b.key || a.i - b.i);
  return { entries: order.map((o) => o.entry) };
}

/** Mermaid entity escapes; a bare `:` splits the period from the event. */
const MERMAID_ENTITIES: Record<string, string> = {
  ':': '#58;',
  '#': '#35;',
  ';': '#59;',
};

/**
 * Make text safe for one Mermaid `timeline` line. `:` separates the period
 * from its events, so it (and the `#`/`;` that form entity codes) is written
 * as an entity code, which Mermaid renders as the original character. A
 * time like `16:20` therefore still reads `16:20` in the chart.
 */
export function escapeMermaidTimelineText(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[:#;]/g, (c) => MERMAID_ENTITIES[c]);
}

/** First line of the event, cut to the label limit, `(see table)` if cut. */
export function chartEventLabel(event: string): string {
  const lines = eventLines(event).map((segs) =>
    segs.map((s) => s.text).join(''),
  );
  const first = lines[0] ?? '';
  if (lines.length <= 1 && first.length <= TIMELINE_CHART_LABEL_MAX)
    return first;
  let short = first;
  if (short.length > TIMELINE_CHART_LABEL_MAX) {
    const cut = short.slice(0, TIMELINE_CHART_LABEL_MAX);
    const space = cut.lastIndexOf(' ');
    short = `${(space > TIMELINE_CHART_LABEL_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
  }
  return `${short} (see table)`;
}

/**
 * Build the body of a Mermaid `timeline` diagram (WITHOUT the surrounding code
 * fence / macro) from already-sorted entries. Consumers wrap it: Markdown in a
 * ```mermaid block, Confluence in a {markdown} macro, ADF in a code node.
 * Returns `undefined` when there is nothing to chart or more than
 * `TIMELINE_CHART_MAX_ENTRIES` entries (the table then stands alone).
 */
export function buildMermaidTimeline(
  pm: Postmortem,
  entries: TimelineEntry[] = pm.timeline ?? [],
  timezone: string = DEFAULT_POSTMORTEM_TIMEZONE,
): string | undefined {
  if (entries.length === 0 || entries.length > TIMELINE_CHART_MAX_ENTRIES)
    return undefined;
  const title =
    timezone === DEFAULT_POSTMORTEM_TIMEZONE
      ? pm.title
      : `${pm.title} (${timezone})`;
  const lines: string[] = ['timeline'];
  lines.push(`    title ${escapeMermaidTimelineText(title)}`);
  for (const entry of entries) {
    const label = escapeMermaidTimelineText(timelineLabel(entry.at, timezone));
    const event = escapeMermaidTimelineText(chartEventLabel(entry.event));
    lines.push(`    ${label} : ${event}`);
  }
  return lines.join('\n');
}

/** Everything a renderer needs to draw the Timeline section. */
export interface TimelineView {
  entries: TimelineEntry[];
  mermaid?: string;
  /** Show the Who column (at least one entry has `by`). */
  showWho: boolean;
  /** Show the Ref column (at least one entry has `ref`). */
  showRef: boolean;
}

/**
 * The Timeline section shared by Markdown, Confluence and ADF: entries in
 * time order, the chart (or none), and which optional columns have data.
 */
export function timelineView(
  pm: Postmortem,
  timezone: string = DEFAULT_POSTMORTEM_TIMEZONE,
): TimelineView | undefined {
  if (!pm.timeline?.length) return undefined;
  const { entries } = sortTimeline(pm.timeline);
  return {
    entries,
    mermaid: buildMermaidTimeline(pm, entries, timezone),
    showWho: entries.some((e) => Boolean(e.by)),
    showRef: entries.some((e) => Boolean(e.ref)),
  };
}

/**
 * Impact fields as ordered label/value rows (MTTD, MTTR, scope, services,
 * customers, notes). Shared by all renderers so the field selection, order, and
 * labels live in one place; each format styles the returned pairs itself.
 *
 * MTTD/MTTR are DERIVED from the incident timestamps when not authored
 * explicitly: MTTD = occurred → detected, MTTR = occurred → resolved. An explicit
 * `impact.detected_after`/`resolved_after` always wins as an override.
 */
export function impactRows(pm: Postmortem): LabelledValue[] {
  const impact = pm.impact ?? {};
  const rows: LabelledValue[] = [];
  const mttd =
    impact.detected_after ??
    formatDurationBetween(pm.occurred_at, pm.detection?.detected_at);
  if (mttd) rows.push({ label: 'Time to detect (MTTD)', value: mttd });
  const mttr =
    impact.resolved_after ??
    formatDurationBetween(pm.occurred_at, pm.resolved_at);
  if (mttr) rows.push({ label: 'Time to resolve (MTTR)', value: mttr });
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
export function detectionRows(
  detection: Detection,
  timezone: string = DEFAULT_POSTMORTEM_TIMEZONE,
): LabelledValue[] {
  const rows: LabelledValue[] = [];
  if (detection.method) rows.push({ label: 'Method', value: detection.method });
  if (detection.source) rows.push({ label: 'Source', value: detection.source });
  if (detection.detected_at)
    rows.push({
      label: 'Detected at',
      value: formatPostmortemTs(detection.detected_at, timezone),
    });
  return rows;
}
