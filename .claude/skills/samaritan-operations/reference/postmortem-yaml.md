# Postmortem / Incident Report (RCA) YAML

A postmortem is a **separate document type** from operations — a backward-looking,
blameless incident record (Google SRE / Atlassian / PagerDuty aligned). It is NOT
embedded in an operation; it *references* the operation and run it came from
(`operation → run → postmortem`).

- **Schema (source of truth)**: `src/schemas/postmortem.schema.json`
- **Model**: `src/models/postmortem.ts`
- **Example**: `examples/postmortems/checkout-outage.yaml`
- **Render**: `samaritan generate postmortem <file> [-f markdown|confluence|adf]`
- **Seed from a run**: `samaritan postmortem from-run <session-id|events.jsonl>`
- **Blank template**: `samaritan postmortem init`

One document type covers both a full postmortem and a lightweight "incident
report" — only `title` and `summary` are required; every other section is optional.

## Fields

| Field | Type | Notes |
|---|---|---|
| `title` | string | **required** |
| `summary` | string | **required** — one paragraph of what happened |
| `id` | string | incident id, e.g. `INC-2026-0042` |
| `severity` | enum | `SEV1`\|`SEV2`\|`SEV3`\|`SEV4` |
| `status` | enum | `draft`\|`in-review`\|`final` |
| `occurred_at` / `resolved_at` | string | ISO-8601; drive the computed duration |
| `authors` / `reviewers` | string[] | |
| `operation` | string | path to the runbook that was executed (linkage) |
| `manual` | string | URL of that operation's generated manual |
| `run` | string | path to the run record (`events.jsonl`) it was seeded from |
| `qrh` | string[] | related QRH ids (rendered as `qrh show <id>` hints) |
| `tickets` | string[] | related tickets |
| `impact` | object | `scope`, `services[]`, `customers_affected`, `notes`, plus `detected_after` (MTTD) / `resolved_after` (MTTR) — auto-derived from `occurred_at`→`detected_at` / `occurred_at`→`resolved_at` when omitted; set explicitly to override |
| `detection` | object | `method` (`alert`\|`customer`\|`monitoring`\|`manual`), `source`, `detected_at` |
| `timeline` | array | `{ at, until?, event, kind?, by?, ref?, image? }`; `until` = end of a range (same form as `at`, not before it); `kind` = `cause`\|`detection`\|`action`\|`recovery`\|`note`. Rendered sorted by `at` as a table (Who/Ref columns only when used) plus a Mermaid `timeline` chart when there are at most 8 entries (long/multi-line events cut to their first line + `(see table)`). Each line of a multi-line `event` renders on its own line; `**bold**` renders bold |
| `root_cause` | object | `summary` (required within), `trigger`, `contributing_factors[]`, `five_whys[]` |
| `resolution` | string | |
| `action_items` | array | `{ title, owner?, ticket?, type?, status?, due? }`; `type` = `prevent`\|`mitigate`\|`detect`\|`process`; `status` = `open`\|`in-progress`\|`done` |
| `lessons_learned` | object | `went_well[]`, `went_wrong[]`, `got_lucky[]` |
| `supporting_information` | array | `{ type, file?\|url?, description? }`; `type` = `image`\|`link`\|`log`\|`file`. File paths are relative to the postmortem file and embedded (logs as code blocks, images as `![]()`) |

## Notes

- Timestamps may be unquoted ISO-8601; the parser keeps them as strings (uses
  js-yaml `JSON_SCHEMA`), so bare dates like `2026-07-15` stay `2026-07-15`.
- An ISO-8601 date-time (`occurred_at`, `resolved_at`, `detection.detected_at`,
  `timeline[].at` / `until`) should carry a zone (`Z` or `+09:00`). Without
  one it is read in the `--timezone` zone (default UTC) and `generate
  postmortem` warns. An impossible date is a parse error.
- `timeline[].at` may instead be a free-form clock string (`16:20`, `18:05Z`,
  `18:05-18:10Z`), shown as written. Mixed with ISO entries it sorts on their
  calendar day (in its own zone, else `--timezone`); if those span more than
  one day, or an `at` is not a time, YAML order is kept with a warning.
- The three renderers are self-contained (`src/manuals/postmortem-generator.ts`
  Markdown, `postmortem-adf-generator.ts` ADF, `postmortem-confluence.ts` wiki).
  The Confluence Mermaid timeline is wrapped in the `{markdown}` macro, matching
  the operation Gantt.
- Keep a postmortem updated by editing the YAML and re-running `generate
  postmortem` — it's a living, PR-reviewable document as code.
