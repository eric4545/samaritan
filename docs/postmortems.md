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

Key sections (all except `title`/`summary` optional): `impact` (scope, services, and MTTD/MTTR — **auto-derived** from the incident timestamps when omitted, or set explicitly to override), `detection`, `timeline` (rendered as a Mermaid `timeline` diagram + table; each entry may carry an `image`), `root_cause` (trigger, contributing factors, 5-whys), `resolution`, `action_items` (owner/ticket/type/status/due), `lessons_learned` (went well / went wrong / got lucky), and `supporting_information` (images, links, embedded logs). Linkage fields `operation`, `manual`, `run`, `qrh`, and `tickets` cross-reference the runbook, its generated manual, the run record, related QRH procedures, and tickets. See `examples/postmortems/checkout-outage.yaml`.

To keep a postmortem updated, edit the YAML and re-run `generate postmortem` — it's a living, PR-reviewable document as code.
