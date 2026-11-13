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

/** `YYYY-MM-DD` calendar date of an instant in `timezone`. */
function dateInZone(ms: number, timezone: string): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

/** Offset of `timezone` from UTC at instant `ms`, in milliseconds. */
function zoneOffsetMs(ms: number, timezone: string): number {
  const p = zonedParts(new Date(ms), timezone);
  const month =
    [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ].indexOf(p.month) + 1;
  const asUtc = Date.UTC(
    Number(p.year),
    month - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - (ms - (((ms % 1000) + 1000) % 1000));
}

/**
 * The instant at which the wall clock in `timezone` reads the given UTC-style
 * field value (`wallAsUtc` = Date.UTC of the wall-clock fields).
 */
function wallTimeToInstant(wallAsUtc: number, timezone: string): number {
  const first = wallAsUtc - zoneOffsetMs(wallAsUtc, timezone);
  const offset = zoneOffsetMs(first, timezone);
  return wallAsUtc - offset;
}

/**
 * ISO-8601 date, optionally with a time and a zone. Groups: 1-3 date,
 * 4-6 time, 7 fraction, 8 zone.
 */
const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/** True when `ts` starts like an ISO-8601 date (`YYYY-MM-DD…`). */
export function isIsoTimestamp(ts: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(ts);
}

/**
 * True for an ISO-8601 date-time with no `Z` / offset. Such a value is read
 * in the display time zone (`--timezone`, default UTC); a date-time read
 * with `new Date()` would instead depend on the renderer's machine.
 */
export function isZonelessDateTime(ts: string): boolean {
  const m = ISO_RE.exec(ts);
  return Boolean(m?.[4] && !m[8]);
}

/**
 * Parse an ISO-8601 timestamp to epoch ms. A value with a zone is exact; a
 * bare date or zone-less date-time is read as wall time in `timezone`.
 * Returns `undefined` for free-form strings (`16:20`) and impossible dates.
 */
export function parseInstant(
  ts: string,
  timezone: string = DEFAULT_POSTMORTEM_TIMEZONE,
): number | undefined {
  const m = ISO_RE.exec(ts.trim());
  if (!m) return undefined;
  const [y, mo, d, h = '0', mi = '0', sec = '0'] = m.slice(1, 7);
  const fraction = m[7] ? Math.round(Number(m[7]) * 1000) : 0;
  const wall = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(sec),
    fraction,
  );
  const check = new Date(wall);
  if (
    check.getUTCFullYear() !== Number(y) ||
    check.getUTCMonth() !== Number(mo) - 1 ||
    check.getUTCDate() !== Number(d) ||
    Number(h) > 23 ||
    Number(mi) > 59 ||
    Number(sec) > 59
  )
    return undefined;
  const zone = m[8];
  if (!zone) return wallTimeToInstant(wall, timezone);
  if (/^z$/i.test(zone)) return wall;
  const zm = /^([+-])(\d{2}):?(\d{2})?$/.exec(zone);
  if (!zm) return undefined;
  const offsetMin = Number(zm[2]) * 60 + Number(zm[3] ?? 0);
  if (offsetMin > 14 * 60) return undefined;
  return wall - (zm[1] === '-' ? -1 : 1) * offsetMin * 60000;
}

/**
 * Format an ISO-8601 (or free-form) timestamp for display, e.g.
 * `Wed, 01 Jul 2026 14:32:00 UTC`. The instant is shown in `timezone` and
 * labelled with its name. Free-form strings pass through.
 */
export function formatPostmortemTs(
  ts: string,
  timezone: string = DEFAULT_POSTMORTEM_TIMEZONE,
): string {
  const ms = parseInstant(ts, timezone);
  if (ms === undefined) return ts; // free-form clock string
  const p = zonedParts(new Date(ms), timezone);
  return `${p.weekday}, ${p.day} ${p.month} ${p.year} ${p.hour}:${p.minute}:${p.second} ${timezone}`;
}

/** Short `HH:MM` label for a timeline point (falls back to the raw value). */
export function timelineLabel(
  ts: string,
  timezone: string = DEFAULT_POSTMORTEM_TIMEZONE,
): string {
  const ms = parseInstant(ts, timezone);
  if (ms === undefined) return ts;
  const p = zonedParts(new Date(ms), timezone);
  return `${p.hour}:${p.minute}`;
}

/** Minutes as `1h 16m` / `4m`. */
function formatMinutes(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Human duration between two ISO timestamps, e.g. "1h 16m" / "4m". `undefined`
 * if either is missing/unparseable or the range is negative.
 */
export function formatDurationBetween(
  startTs?: string,
  endTs?: string,
  timezone: string = DEFAULT_POSTMORTEM_TIMEZONE,
): string | undefined {
  if (!startTs || !endTs) return undefined;
  const start = parseInstant(startTs, timezone);
  const end = parseInstant(endTs, timezone);
  if (start === undefined || end === undefined || end < start) return undefined;
  return formatMinutes(Math.round((end - start) / 60000));
}

/** Overall incident duration (occurred → resolved). */
export function incidentDuration(
  pm: Postmortem,
  timezone: string = DEFAULT_POSTMORTEM_TIMEZONE,
): string | undefined {
  return formatDurationBetween(pm.occurred_at, pm.resolved_at, timezone);
}

/**
 * The Time cell of a timeline entry. A range (`until`) on one calendar day
 * reads `Thu, 01 Jan 2026 14:30:00 – 14:35:00 UTC (5m)`; across days both
 * ends are written in full. Free-form values are joined with an en dash.
 */
export function formatTimelineTime(
  entry: TimelineEntry,
  timezone: string = DEFAULT_POSTMORTEM_TIMEZONE,
): string {
  if (!entry.until) return formatPostmortemTs(entry.at, timezone);
  const start = parseInstant(entry.at, timezone);
  const end = parseInstant(entry.until, timezone);
  if (start === undefined || end === undefined)
    return `${entry.at} – ${entry.until}`;
  const dur =
    end >= start
      ? ` (${formatMinutes(Math.round((end - start) / 60000))})`
      : '';
  if (dateInZone(start, timezone) === dateInZone(end, timezone)) {
    const s = zonedParts(new Date(start), timezone);
    const e = zonedParts(new Date(end), timezone);
    return `${s.weekday}, ${s.day} ${s.month} ${s.year} ${s.hour}:${s.minute}:${s.second} – ${e.hour}:${e.minute}:${e.second} ${timezone}${dur}`;
  }
  return `${formatPostmortemTs(entry.at, timezone)} – ${formatPostmortemTs(entry.until, timezone)}${dur}`;
}

/** Chart label of a timeline entry: `HH:MM`, or `HH:MM–HH:MM` for a range. */
export function timelineChartTime(
  entry: TimelineEntry,
  timezone: string = DEFAULT_POSTMORTEM_TIMEZONE,
): string {
  const start = timelineLabel(entry.at, timezone);
  return entry.until
    ? `${start}–${timelineLabel(entry.until, timezone)}`
    : start;
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

/** Where a clock time's zone comes from. */
type ClockZone = { offsetMin: number } | { timezone: string };

interface ClockTime {
  /** Seconds after midnight. */
  secs: number;
  /** Written zone (`Z`, `+09:00`), or `undefined` = display time zone. */
  offsetMin?: number;
}

const CLOCK = String.raw`(\d{1,2}):(\d{2})(?::(\d{2}))?`;
const CLOCK_ZONE = String.raw`(Z|UTC|[+-]\d{2}:?\d{2})`;
/** `18:05-18:10Z`: a dash between two times is a range, never an offset. */
const CLOCK_RANGE_RE = new RegExp(
  String.raw`^${CLOCK}\s*[-–]\s*${CLOCK}\s*${CLOCK_ZONE}?$`,
  'i',
);
const CLOCK_SINGLE_RE = new RegExp(
  String.raw`^${CLOCK}\s*${CLOCK_ZONE}?$`,
  'i',
);
/** Anything else that starts with a time, e.g. `16:20 (approx.)`. */
const CLOCK_PREFIX_RE = new RegExp(String.raw`^${CLOCK}\b`);

function zoneOffsetMin(zone: string | undefined): number | undefined {
  if (!zone) return undefined;
  if (/^(z|utc)$/i.test(zone)) return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(zone);
  if (!m) return undefined;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

function clockSecs(h: string, m: string, s?: string): number {
  return Number(h) * 3600 + Number(m) * 60 + (s ? Number(s) : 0);
}

/** Parse a bare clock string (`16:20`, `18:05-18:10Z`, `09:05+09:00`). */
export function parseClock(at: string): ClockTime | undefined {
  const v = at.trim();
  const range = CLOCK_RANGE_RE.exec(v);
  if (range)
    return {
      secs: clockSecs(range[1], range[2], range[3]),
      offsetMin: zoneOffsetMin(range[7]),
    };
  const single = CLOCK_SINGLE_RE.exec(v);
  if (single)
    return {
      secs: clockSecs(single[1], single[2], single[3]),
      offsetMin: zoneOffsetMin(single[4]),
    };
  const prefix = CLOCK_PREFIX_RE.exec(v);
  if (prefix) return { secs: clockSecs(prefix[1], prefix[2], prefix[3]) };
  return undefined;
}

function clockZone(clock: ClockTime, timezone: string): ClockZone {
  return clock.offsetMin === undefined
    ? { timezone }
    : { offsetMin: clock.offsetMin };
}

function dateIn(ms: number, zone: ClockZone): string {
  if ('timezone' in zone) return dateInZone(ms, zone.timezone);
  return new Date(ms + zone.offsetMin * 60000).toISOString().slice(0, 10);
}

/** The instant a clock time names on calendar date `date` in its zone. */
function clockOnDate(date: string, clock: ClockTime, zone: ClockZone): number {
  const [y, mo, d] = date.split('-').map(Number);
  const wall = Date.UTC(y, mo - 1, d) + clock.secs * 1000;
  if ('timezone' in zone) return wallTimeToInstant(wall, zone.timezone);
  return wall - zone.offsetMin * 60000;
}

export interface SortedTimeline {
  entries: TimelineEntry[];
  /**
   * Why the entries were left in YAML order, or `undefined` when they were
   * sorted.
   */
  unsortedReason?: string;
}

/**
 * Order timeline entries chronologically by `at` (stable: equal times keep
 * YAML order). Entries are often appended as they are remembered, so YAML
 * order is not time order.
 *
 * - ISO-8601 entries sort by instant (zone-less ones read in `timezone`).
 * - Bare clock times (`16:20`) sort by time of day.
 * - A mix is sorted by placing each clock time on the calendar day of the
 *   ISO entries, in the clock's own zone (`Z`, `+09:00`) or else `timezone`.
 *   That needs every ISO entry to fall on that one day; otherwise, or when an
 *   `at` is neither (`after lunch`), YAML order is kept and the reason given.
 */
export function sortTimeline(
  timeline: TimelineEntry[],
  timezone: string = DEFAULT_POSTMORTEM_TIMEZONE,
): SortedTimeline {
  const instants = timeline.map((e) =>
    isIsoTimestamp(e.at) ? parseInstant(e.at, timezone) : undefined,
  );
  const clocks = timeline.map((e, i) =>
    instants[i] === undefined && !isIsoTimestamp(e.at)
      ? parseClock(e.at)
      : undefined,
  );
  const unkeyed = timeline.filter(
    (_, i) => instants[i] === undefined && clocks[i] === undefined,
  );
  const keep = (reason: string): SortedTimeline => ({
    entries: [...timeline],
    unsortedReason: `timeline kept in YAML order: ${reason}`,
  });
  if (unkeyed.length > 0) {
    return keep(
      `${unkeyed.map((e) => `'${e.at}'`).join(', ')} is not an ISO-8601 timestamp or an HH:MM time`,
    );
  }

  const isoMs = instants.filter((ms): ms is number => ms !== undefined);
  const keys: number[] = [];
  if (isoMs.length === 0) {
    // Clock times only: same zone → compare times of day directly. A bare
    // time is in the display zone, which equals `Z` when that zone is UTC.
    const displayZone = timezone === 'UTC' ? 0 : 'display';
    const zones = new Set(clocks.map((c) => c?.offsetMin ?? displayZone));
    if (zones.size > 1)
      return keep('the HH:MM times are in different zones and have no date');
    for (const c of clocks) keys.push(c?.secs ?? 0);
  } else {
    for (let i = 0; i < timeline.length; i++) {
      const ms = instants[i];
      if (ms !== undefined) {
        keys.push(ms);
        continue;
      }
      const clock = clocks[i] as ClockTime;
      const zone = clockZone(clock, timezone);
      const days = new Set(isoMs.map((t) => dateIn(t, zone)));
      if (days.size > 1)
        return keep(
          `'${timeline[i].at}' has no date and the ISO-8601 entries span more than one day; give it a full timestamp`,
        );
      keys.push(clockOnDate([...days][0], clock, zone));
    }
  }

  const order = timeline.map((entry, i) => ({ entry, key: keys[i], i }));
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
    const label = escapeMermaidTimelineText(timelineChartTime(entry, timezone));
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
  const { entries } = sortTimeline(pm.timeline, timezone);
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
export function impactRows(
  pm: Postmortem,
  timezone: string = DEFAULT_POSTMORTEM_TIMEZONE,
): LabelledValue[] {
  const impact = pm.impact ?? {};
  const rows: LabelledValue[] = [];
  const mttd =
    impact.detected_after ??
    formatDurationBetween(pm.occurred_at, pm.detection?.detected_at, timezone);
  if (mttd) rows.push({ label: 'Time to detect (MTTD)', value: mttd });
  const mttr =
    impact.resolved_after ??
    formatDurationBetween(pm.occurred_at, pm.resolved_at, timezone);
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

/**
 * Non-fatal notes for the person rendering: zone-less date-times (read in
 * the display zone, so name it in the message) and a timeline that could not
 * be sorted. Printed by `generate postmortem` on stderr.
 */
export function postmortemWarnings(
  pm: Postmortem,
  timezone: string = DEFAULT_POSTMORTEM_TIMEZONE,
): string[] {
  const fields: Array<[string, string | undefined]> = [
    ['occurred_at', pm.occurred_at],
    ['resolved_at', pm.resolved_at],
    ['detection.detected_at', pm.detection?.detected_at],
  ];
  (pm.timeline ?? []).forEach((e, i) => {
    fields.push([`timeline[${i}].at`, e.at]);
    fields.push([`timeline[${i}].until`, e.until]);
  });
  const warnings = fields
    .filter(([, v]) => v !== undefined && isZonelessDateTime(v))
    .map(
      ([name, v]) =>
        `${name} '${v}' has no time zone; read as ${timezone}. Append Z or an offset such as +09:00 to pin it.`,
    );
  const reason = pm.timeline
    ? sortTimeline(pm.timeline, timezone).unsortedReason
    : undefined;
  if (reason) warnings.push(reason);
  return warnings;
}
