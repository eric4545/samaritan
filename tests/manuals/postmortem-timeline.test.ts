import assert from 'node:assert';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { generatePostmortemADF } from '../../src/manuals/postmortem-adf-generator';
import { generatePostmortemConfluence } from '../../src/manuals/postmortem-confluence';
import { generatePostmortemMarkdown } from '../../src/manuals/postmortem-generator';
import {
  buildMermaidTimeline,
  chartEventLabel,
  escapeMermaidTimelineText,
  eventLines,
  formatPostmortemTs,
  formatTimelineTime,
  parseInstant,
  postmortemWarnings,
  sortTimeline,
  TIMELINE_CHART_LABEL_MAX,
  TIMELINE_CHART_MAX_ENTRIES,
  timelineChartTime,
  timelineLabel,
  timelineView,
} from '../../src/manuals/postmortem-shared';
import type { Postmortem, TimelineEntry } from '../../src/models/postmortem';
import { parsePostmortemFile } from '../../src/operations/postmortem-parser';

const LONG = join(__dirname, '../fixtures/postmortems/long-timeline.yaml');
const longPm = (): Postmortem => parsePostmortemFile(LONG);

const entry = (at: string, event = `at ${at}`): TimelineEntry => ({
  at,
  event,
});
const small = (timeline: TimelineEntry[]): Postmortem => ({
  title: 'T',
  summary: 'S',
  timeline,
});

describe('sortTimeline', () => {
  it('orders ISO-8601 entries by instant, across offsets', () => {
    const { entries, unsortedReason } = sortTimeline([
      entry('2026-01-01T16:20:00Z', 'closed'),
      entry('2026-01-01T17:30:00Z', 'later'),
      entry('2026-01-01T23:00:00+09:00', 'first'), // 14:00Z
    ]);
    assert.equal(unsortedReason, undefined);
    assert.deepEqual(
      entries.map((e) => e.event),
      ['first', 'closed', 'later'],
    );
  });

  it('orders bare HH:MM clock strings, including ranges', () => {
    const { entries } = sortTimeline([
      entry('18:05-18:10Z', 'range'),
      entry('16:20', 'closed'),
      entry('9:05', 'early'),
    ]);
    assert.deepEqual(
      entries.map((e) => e.event),
      ['early', 'closed', 'range'],
    );
  });

  it('keeps YAML order for equal times (stable)', () => {
    const { entries } = sortTimeline([
      entry('2026-01-01T14:00:00Z', 'a'),
      entry('2026-01-01T14:00:00Z', 'b'),
    ]);
    assert.deepEqual(
      entries.map((e) => e.event),
      ['a', 'b'],
    );
  });

  it('places clock times on the day of the ISO entries when mixed', () => {
    const { entries, unsortedReason } = sortTimeline([
      entry('2026-01-01T15:10:00Z', 'recovered'),
      entry('14:30-14:35Z', 'range'),
      entry('2026-01-01T14:00:00Z', 'start'),
      entry('14:12', 'bare clock, read in the display zone'),
    ]);
    assert.equal(unsortedReason, undefined);
    assert.deepEqual(
      entries.map((e) => e.event),
      ['start', 'bare clock, read in the display zone', 'range', 'recovered'],
    );
  });

  it('reads a bare clock time in the display zone, a zoned one in its own', () => {
    const timeline = [
      entry('2026-01-01T05:00:00Z', 'iso 14:00 Tokyo'),
      entry('13:00', 'bare = 13:00 Tokyo'),
      entry('04:30Z', 'zoned = 13:30 Tokyo'),
    ];
    const { entries } = sortTimeline(timeline, 'Asia/Tokyo');
    assert.deepEqual(
      entries.map((e) => e.event),
      ['bare = 13:00 Tokyo', 'zoned = 13:30 Tokyo', 'iso 14:00 Tokyo'],
    );
  });

  it('keeps YAML order when ISO entries span days and a clock time has no date', () => {
    const input = [
      entry('2026-01-01T15:00:00Z'),
      entry('2026-01-02T09:00:00Z'),
      entry('14:00'),
    ];
    const { entries, unsortedReason } = sortTimeline(input);
    assert.deepEqual(entries, input);
    assert.match(unsortedReason ?? '', /'14:00' has no date/);
  });

  it('keeps YAML order when clock-only times use different zones', () => {
    const input = [entry('15:00Z'), entry('14:00+09:00')];
    const { entries, unsortedReason } = sortTimeline(input);
    assert.deepEqual(entries, input);
    assert.match(unsortedReason ?? '', /different zones/);
  });

  it('reads a zone-less ISO date-time in the display zone', () => {
    const { entries } = sortTimeline(
      [
        entry('2026-01-01T14:00:00', 'local 14:00'),
        entry('2026-01-01T06:00:00Z', 'utc 06:00'),
      ],
      'Asia/Tokyo',
    );
    // 14:00 Tokyo = 05:00Z, before 06:00Z.
    assert.deepEqual(
      entries.map((e) => e.event),
      ['local 14:00', 'utc 06:00'],
    );
  });

  it('keeps YAML order and names the entry that has no time', () => {
    const input = [entry('2026-01-01T15:00:00Z'), entry('after lunch')];
    const { entries, unsortedReason } = sortTimeline(input);
    assert.deepEqual(entries, input);
    assert.match(unsortedReason ?? '', /'after lunch'/);
  });
});

describe('Mermaid timeline text', () => {
  it('writes colons as entity codes instead of hyphens', () => {
    assert.equal(escapeMermaidTimelineText('16:20'), '16#58;20');
    assert.equal(
      escapeMermaidTimelineText('18:05-18:10Z'),
      '18#58;05-18#58;10Z',
    );
    assert.equal(escapeMermaidTimelineText('a # b; c'), 'a #35; b#59; c');
  });

  it('keeps a short single-line event as is, without ** markers', () => {
    assert.equal(chartEventLabel('**Closed:** all good'), 'Closed: all good');
  });

  it('cuts a multi-line event to its first line plus (see table)', () => {
    assert.equal(
      chartEventLabel('First fact.\nSecond fact.'),
      'First fact. (see table)',
    );
  });

  it('cuts a long event at a word boundary plus (see table)', () => {
    const long = `${'word '.repeat(40)}end`;
    const label = chartEventLabel(long);
    assert.ok(label.endsWith('… (see table)'), label);
    assert.ok(
      label.length <= TIMELINE_CHART_LABEL_MAX + '… (see table)'.length,
      label,
    );
  });

  it('is omitted when there are more entries than the chart can show', () => {
    const many = Array.from(
      { length: TIMELINE_CHART_MAX_ENTRIES + 1 },
      (_, i) => entry(`2026-01-01T14:${String(i).padStart(2, '0')}:00Z`),
    );
    assert.equal(buildMermaidTimeline(small(many), many), undefined);
    const enough = many.slice(0, TIMELINE_CHART_MAX_ENTRIES);
    assert.ok(buildMermaidTimeline(small(enough), enough));
  });

  it('labels the title with a non-UTC time zone', () => {
    const t = [entry('2026-01-01T14:00:00Z')];
    const chart = buildMermaidTimeline(small(t), t, 'Asia/Tokyo') ?? '';
    assert.ok(chart.includes('title T (Asia/Tokyo)'), chart);
    assert.ok(chart.includes('23#58;00 : '), chart);
  });
});

describe('timestamp display', () => {
  it('renders UTC exactly like Date#toUTCString', () => {
    const ts = '2026-07-01T14:32:00Z';
    assert.equal(
      formatPostmortemTs(ts),
      new Date(ts).toUTCString().replace(' GMT', ' UTC'),
    );
  });

  it('converts to the requested time zone and names it', () => {
    assert.equal(
      formatPostmortemTs('2026-07-01T14:32:00Z', 'Asia/Tokyo'),
      'Wed, 01 Jul 2026 23:32:00 Asia/Tokyo',
    );
    assert.equal(timelineLabel('2026-07-01T14:32:00Z', 'Asia/Tokyo'), '23:32');
  });

  it('passes free-form clock strings through unchanged', () => {
    assert.equal(
      formatPostmortemTs('18:05-18:10Z', 'Asia/Tokyo'),
      '18:05-18:10Z',
    );
  });
});

describe('parseInstant', () => {
  it('is exact with a zone and reads a zone-less value in the given zone', () => {
    assert.equal(
      parseInstant('2026-01-01T14:00:00Z'),
      Date.UTC(2026, 0, 1, 14),
    );
    assert.equal(
      parseInstant('2026-01-01T23:00:00+09:00'),
      Date.UTC(2026, 0, 1, 14),
    );
    assert.equal(
      parseInstant('2026-01-01T23:00:00', 'Asia/Tokyo'),
      Date.UTC(2026, 0, 1, 14),
    );
    assert.equal(
      parseInstant('2026-07-01T10:00:00', 'Europe/London'),
      Date.UTC(2026, 6, 1, 9),
      'summer time offset applied',
    );
  });

  it('rejects impossible dates and free-form strings', () => {
    assert.equal(parseInstant('2026-13-45T14:00:00Z'), undefined);
    assert.equal(parseInstant('2026-02-30'), undefined);
    assert.equal(parseInstant('16:20'), undefined);
  });
});

describe('time ranges (until)', () => {
  const ranged = (until: string, at = '2026-01-01T14:30:00Z') => ({
    at,
    until,
    event: 'Cache warm-up',
  });

  it('writes a same-day range once, with its duration', () => {
    assert.equal(
      formatTimelineTime(ranged('2026-01-01T14:35:00Z')),
      'Thu, 01 Jan 2026 14:30:00 – 14:35:00 UTC (5m)',
    );
    assert.equal(
      timelineChartTime(ranged('2026-01-01T14:35:00Z')),
      '14:30–14:35',
    );
  });

  it('writes both ends in full across midnight', () => {
    assert.equal(
      formatTimelineTime(
        ranged('2026-01-02T00:10:00Z', '2026-01-01T23:50:00Z'),
      ),
      'Thu, 01 Jan 2026 23:50:00 UTC – Fri, 02 Jan 2026 00:10:00 UTC (20m)',
    );
  });

  it('joins clock-string ranges as written', () => {
    assert.equal(formatTimelineTime(ranged('14:35', '14:30')), '14:30 – 14:35');
  });

  it('renders the range in every format', () => {
    const pm = small([ranged('2026-01-01T14:35:00Z')]);
    const want = 'Thu, 01 Jan 2026 14:30:00 – 14:35:00 UTC (5m)';
    const md = generatePostmortemMarkdown(pm);
    assert.ok(md.includes(want));
    assert.ok(md.includes('14#58;30–14#58;35 : Cache warm-up'), md);
    assert.ok(generatePostmortemConfluence(pm).includes(want));
    assert.ok(JSON.stringify(generatePostmortemADF(pm)).includes(want));
  });
});

describe('postmortemWarnings', () => {
  it('names zone-less fields with the zone they are read in', () => {
    const pm: Postmortem = {
      title: 'T',
      summary: 'S',
      occurred_at: '2026-01-01T14:00:00',
      timeline: [
        {
          at: '2026-01-01T14:00:00Z',
          until: '2026-01-01T14:10:00',
          event: 'e',
        },
      ],
    };
    assert.deepEqual(
      postmortemWarnings(pm, 'Asia/Tokyo').map((w) => w.split(' has')[0]),
      [
        "occurred_at '2026-01-01T14:00:00'",
        "timeline[0].until '2026-01-01T14:10:00'",
      ],
    );
    assert.match(
      postmortemWarnings(pm, 'Asia/Tokyo')[0],
      /read as Asia\/Tokyo/,
    );
  });

  it('is empty for a clean document', () => {
    assert.deepEqual(postmortemWarnings(longPm()), []);
  });
});

describe('eventLines', () => {
  it('splits lines, drops blank ones and parses **bold** spans', () => {
    assert.deepEqual(eventLines('**Lead:** one\n\ntwo\n'), [
      [
        { text: 'Lead:', bold: true },
        { text: ' one', bold: false },
      ],
      [{ text: 'two', bold: false }],
    ]);
  });
});

describe('examples/postmortems/cache-latency.yaml', () => {
  it('sorts without a warning and renders the appended entry in place', () => {
    const pm = parsePostmortemFile(
      join(__dirname, '../../examples/postmortems/cache-latency.yaml'),
    );
    assert.equal(sortTimeline(pm.timeline ?? []).unsortedReason, undefined);
    const md = generatePostmortemMarkdown(pm);
    assert.ok(md.indexOf('Incident declared') < md.indexOf('**Triage:**'));
    assert.ok(!md.includes('```mermaid'), 'over the chart limit');
  });
});

describe('timelineView', () => {
  it('sorts, drops the chart and shows only columns that have data', () => {
    const view = timelineView(longPm());
    assert.ok(view);
    assert.equal(view.entries[1].event, 'Incident declared');
    assert.equal(view.mermaid, undefined);
    assert.equal(view.showWho, true);
    assert.equal(view.showRef, false);
  });
});

describe('timeline rendering in every format', () => {
  it('Markdown: time order, no chart, no empty Ref column, one line per fact', () => {
    const md = generatePostmortemMarkdown(longPm());
    assert.ok(!md.includes('```mermaid'), 'chart dropped past the limit');
    assert.ok(md.includes('| Time | Event | Who |\n| --- | --- | --- |'));
    assert.ok(!md.includes('| Ref |'));
    assert.ok(
      md.indexOf('Incident declared') < md.indexOf('Latency alert fired'),
      'appended 14:02 entry sorts before 14:05',
    );
    assert.ok(
      md.includes(
        '🛠️ **Mitigation:** rolled back web-server.<br>Error rate dropped within two minutes. | alice |',
      ),
      'multi-line event stays in one table row',
    );
  });

  it('Markdown: omits Who and Ref when no entry uses them', () => {
    const md = generatePostmortemMarkdown(
      small([entry('2026-01-01T14:00:00Z')]),
    );
    assert.ok(md.includes('| Time | Event |\n| --- | --- |\n'));
    assert.ok(md.includes('```mermaid'), 'short timeline keeps the chart');
    assert.ok(md.includes('14#58;00 : '), 'colon escaped, not hyphenated');
  });

  it('Confluence: wiki line breaks, wiki bold, sorted, no Ref column', () => {
    const wiki = generatePostmortemConfluence(longPm());
    assert.ok(!wiki.includes('```mermaid'));
    assert.ok(wiki.includes('|| Time || Event || Who ||\n'));
    assert.ok(
      wiki.includes(
        '*Mitigation:* rolled back web-server. \\\\ Error rate dropped within two minutes. | alice |',
      ),
      wiki,
    );
    assert.ok(
      wiki.indexOf('Incident declared') < wiki.indexOf('Latency alert'),
    );
  });

  it('ADF: hard breaks, strong marks, sorted, no Ref column', () => {
    const adf = generatePostmortemADF(longPm()) as any;
    assert.ok(
      !adf.content.some((n: any) => n.type === 'codeBlock'),
      'chart dropped',
    );
    const table = adf.content.find((n: any) => n.type === 'table');
    const headers = table.content[0].content.map(
      (c: any) => c.content[0].content[0].text,
    );
    assert.deepEqual(headers, ['Time', 'Event', 'Who']);
    const eventOf = (row: any) =>
      row.content[1].content[0].content
        .filter((n: any) => n.type === 'text')
        .map((n: any) => n.text)
        .join('');
    assert.equal(eventOf(table.content[2]), '• Incident declared');
    const mitigation = table.content[4].content[1].content[0].content;
    assert.deepEqual(
      mitigation.map((n: any) => n.type),
      ['text', 'text', 'text', 'hardBreak', 'text'],
    );
    assert.deepEqual(mitigation[1].marks, [{ type: 'strong' }]);
    // A row without `by` has an empty paragraph, never an empty text node.
    assert.deepEqual(table.content[1].content[2].content[0], {
      type: 'paragraph',
      content: [],
    });
  });

  it('every format honours the time zone option', () => {
    const opts = { timezone: 'Asia/Tokyo' };
    const pm = longPm();
    const want = 'Thu, 01 Jan 2026 23:02:00 Asia/Tokyo';
    assert.ok(generatePostmortemMarkdown(pm, undefined, opts).includes(want));
    assert.ok(generatePostmortemConfluence(pm, undefined, opts).includes(want));
    assert.ok(
      JSON.stringify(generatePostmortemADF(pm, undefined, opts)).includes(want),
    );
  });
});
