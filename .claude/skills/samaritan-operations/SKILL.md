---
name: samaritan-operations
description: Author, validate, and generate runbooks with the SAMARITAN CLI (Operations-as-Code for SRE teams). Use when the user wants to write or edit a SAMARITAN operation YAML, generate a Markdown/Confluence manual from one, validate or lint an operation, run/resume an interactive operation, or asks how SAMARITAN works.
---

# SAMARITAN Operations

SAMARITAN turns YAML operation definitions into reviewable runbooks (Markdown &
Confluence) and drives them interactively. It is a documentation generator,
validator, and interactive runner — **not** a non-interactive execution engine.

## Quickstart

```bash
# Scaffold a new operation interactively
samaritan create operation

# Validate (add --lint for shellcheck, --strict to fail on warnings)
samaritan validate path/to/op.yaml --lint

# Generate a Markdown manual (omit --env for the multi-env table format)
samaritan generate manual path/to/op.yaml --env production --output manual.md

# Generate Confluence (ADF)
samaritan generate confluence path/to/op.yaml --output manual.json

# Drive it interactively (default mode = sidecar)
samaritan run path/to/op.yaml
samaritan resume <session-id>
samaritan sessions          # list resumable sessions
```

Run any command with `--help` for full flags. Locally, use
`npm start -- <command>` instead of the global `samaritan` binary.

## Authoring an operation (the golden path)

1. Start from `examples/deployment.yaml` — it is the canonical reference.
2. Every step is effectively **manual** in spec terms: `type: automatic` is parsed
   but does NOT auto-run commands outside the interactive `run` loop. Write
   `instruction:` / `command:` so a human can follow along.
3. Use `command:` for a short inline command, `script:` for an external `.sh`
   file embedded into the manual (mutually exclusive).
4. Attach `evidence.required` / `evidence.types` (documentation) and
   `evidence.results.<env>` (pre-captured output embedded into the manual).
5. Set `pic:` (Person In Charge) and `reviewer:` for sign-off checkboxes.
6. **Always** `samaritan validate <file> --lint` before generating.

A minimal skeleton:

```yaml
name: Deploy Web Server
version: 1.0.0
description: Rolling deploy of the web service
environments:
  - name: staging
  - name: production
steps:
  - name: Apply manifests
    type: manual
    pic: ops-team@example.com
    reviewer: sre-lead@example.com
    instruction: Apply the Kubernetes manifests.
    command: kubectl apply -f deployment.yaml
    expect:
      contains: configured
    evidence:
      required: true
      types: [command_output]
```

## Scope guardrails (read before adding "auto" anything)

SAMARITAN's roadmap matters. **Do not** assume execution features exist.
Implemented: parsing, manual/Confluence generation, JSON-schema validation,
shellcheck lint, interactive `run`/`resume`/`sessions`, `run --mock`, templates,
`foreach`/matrix, evidence embedding, **postmortem / incident report (RCA)
documents** (`generate postmortem`, `postmortem from-run`/`init`). NOT implemented:
non-interactive command execution, automatic evidence collection, QRH, external
integrations (Jira/Slack), AI assistant. When unsure, check `ROADMAP.md`.

## When to load the reference files

- Writing/extending operation YAML, or unsure which fields are valid →
  read `reference/operation-yaml.md`.
- A `validate`/`generate`/`run` command, flag, or error needs explaining →
  read `reference/cli.md`.
- Writing a postmortem / incident report (RCA) document →
  read `reference/postmortem-yaml.md`.

Keep the schema authoritative: `src/schemas/operation.schema.json` is the source
of truth, and `examples/*.yaml` are working, validated samples to copy from.
