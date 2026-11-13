# Postmortems

Authoring and rendering incident reports (RCA), including seeding one from a captured run.

## Postmortem / incident report (RCA)

A **postmortem** is the backward-looking counterpart to an operation runbook — a standalone, blameless incident record you author as YAML and render to Markdown, Confluence, or ADF. It follows the [Google SRE](https://sre.google/sre-book/postmortem-culture/), Atlassian, and PagerDuty model: **one document** whose sections include the root-cause analysis (RCA), impact, a timeline, action items, and lessons learned. A lightweight "incident report" is the same schema with the deeper sections omitted — only `title` and `summary` are required.

```bash
# Render an authored postmortem (Markdown by default)
samaritan generate postmortem examples/postmortems/checkout-outage.yaml -o postmortem.md

# Confluence wiki markup (Mermaid timeline wrapped in the {markdown} macro) or ADF JSON
samaritan generate postmortem examples/postmortems/checkout-outage.yaml -f confluence -o postmortem.confluence
samaritan generate postmortem examples/postmortems/checkout-outage.yaml -f adf -o postmortem.json

# Start from a blank template
samaritan postmortem init -o incident.yaml
```

**Seed from a run record** — because `samaritan run` captures a timestamped run record (`operation → run → postmortem`), you can auto-fill the timeline, participants, incident window, and operation/run back-references from a real incident-response run, then complete the narrative:

```bash
# From a saved session id (see `samaritan sessions --all`) or a direct events.jsonl path
samaritan postmortem from-run <session-id> -o incident.yaml
samaritan postmortem from-run .samaritan-runs/f3a9b2/events.jsonl -o incident.yaml
# Fill in the TODO fields, then render:
samaritan generate postmortem incident.yaml -o incident.md
```

Key sections (all except `title`/`summary` optional): `impact` (scope, services, and MTTD/MTTR — **auto-derived** from the incident timestamps when omitted, or set explicitly to override), `detection`, `timeline` (sorted by time and rendered as a table, plus a Mermaid `timeline` chart for up to 8 entries; see [Timeline](#timeline)), `root_cause` (trigger, contributing factors, 5-whys), `resolution`, `action_items` (owner/ticket/type/status/due), `lessons_learned` (went well / went wrong / got lucky), and `supporting_information` (images, links, embedded logs). Linkage fields `operation`, `manual`, `run`, `qrh`, and `tickets` cross-reference the runbook, its generated manual, the run record, related QRH procedures, and tickets. See `examples/postmortems/checkout-outage.yaml`.

## Timeline

Each `timeline` entry is `{ at, event, kind?, by?, ref?, image? }`. When the
document is rendered:

| Behaviour | Detail |
| --- | --- |
| **Time order** | Entries are sorted by `at`, so you can append an event you remember later at the end of the list. Equal times keep their YAML order. |
| **Time zones** | An ISO-8601 date-time must carry a zone: `2026-01-01T14:00:00Z` or `2026-01-01T23:00:00+09:00`. One without a zone is rejected, because it would be read as the local time of whoever renders it. |
| **Free-form times** | `at` may also be a bare clock string such as `16:20` or `18:05-18:10Z`; it is shown as written. Sorting needs every entry to be one kind: all ISO-8601, or all `HH:MM`. A mix keeps the YAML order and prints a warning. |
| **Chart** | Up to 8 entries are also drawn as a Mermaid `timeline`. A long (over 80 characters) or multi-line event is cut to its first line there and marked `(see table)`. With more than 8 entries the chart is left out: the table is the timeline. |
| **Table** | Every entry, in full. The `Who` and `Ref` columns appear only if some entry sets `by` or `ref`. |
| **Several facts in one entry** | Write the event as a `\|` block with one fact per line; each line renders on its own line. `**Lead-in:**` renders bold. |

```yaml
timeline:
  - at: 2026-01-01T14:12:00Z
    event: |
      **Triage:** on-call compared the web-server and api-gateway dashboards.
      Cache hit rate had dropped from 94% to 41%.
    kind: action
    by: alice
```

Render every timestamp (header, detection, timeline) in one zone with
`--timezone`; the default is `UTC`:

```bash
samaritan generate postmortem examples/postmortems/cache-latency.yaml --timezone Asia/Tokyo
```

See `examples/postmortems/cache-latency.yaml` for a timeline long enough to
drop the chart.

To keep a postmortem updated, edit the YAML and re-run `generate postmortem` — it's a living, PR-reviewable document as code.
