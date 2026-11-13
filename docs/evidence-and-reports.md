# Evidence & reports

How evidence is declared on a step, embedded in a manual, captured during a run, and turned into a report afterwards.

## Evidence & Audit
- **Evidence tracking** - Document required evidence for each step
- **Evidence results** - Embed pre-captured evidence directly in generated manuals
- **Git metadata** - Complete traceability with commit info
- **Structured documentation** - Generate manuals with evidence requirements
- **Audit-ready formats** - Markdown and Confluence outputs

> **Note**: Automatic evidence collection (screenshots, log capture, video recording) is planned for v2.0. See [ROADMAP.md](https://github.com/eric4545/samaritan/blob/main/ROADMAP.md) for details. Current v1.0 supports embedding pre-captured evidence via the `evidence.results` field.

### Evidence Results (Pre-captured Evidence)

You can embed pre-captured evidence directly into generated manuals using the `evidence.results` field. This is useful for:
- **Pre-approved procedures**: Include evidence from rehearsal/staging runs
- **Template manuals**: Show expected outcomes with screenshots
- **Post-execution documentation**: Update manuals with actual results
- **Audit compliance**: Maintain complete evidence trail in version control

**Example with file references:**
```yaml
steps:
  - name: Deploy Application
    type: manual
    instruction: |
      Deploy application to Kubernetes:
      ```bash
      kubectl apply -f deployment.yaml -n ${NAMESPACE}
      ```
    evidence:
      required: true
      types: [screenshot, command_output]
      results:
        staging:
          - type: screenshot
            file: ./evidence/staging-dashboard.png
            description: Kubernetes dashboard showing 3 pods running
          - type: command_output
            file: ./evidence/staging-deploy.log
            description: Deployment output from kubectl
        production:
          - type: screenshot
            file: ./evidence/prod-dashboard.png
            description: Kubernetes dashboard showing 5 pods running
          - type: command_output
            file: ./evidence/prod-deploy.log
            description: Deployment output from kubectl
```

**Example with inline content:**
```yaml
steps:
  - name: Verify Database Connection
    type: manual
    instruction: Check database connectivity
    evidence:
      required: true
      types: [command_output, log]
      results:
        staging:
          - type: command_output
            content: |
              deployment.apps/web-server created
              service/web-server created
              NAME         READY   STATUS    RESTARTS   AGE
              pod/web-0    1/1     Running   0          10s
              pod/web-1    1/1     Running   0          10s
            description: Successful staging deployment output
          - type: log
            content: |
              [2025-10-16 10:30:00] INFO: Application started
              [2025-10-16 10:30:05] INFO: Database connection established
              [2025-10-16 10:30:10] INFO: Ready to accept connections
            description: Application startup logs
        production:
          - type: command_output
            content: |
              deployment.apps/web-server created
              service/web-server created
              NAME         READY   STATUS    RESTARTS   AGE
              pod/web-0    1/1     Running   0          10s
              pod/web-1    1/1     Running   0          10s
              pod/web-2    1/1     Running   0          10s
            description: Production deployment output
```

**Generated Manual Rendering:**

Evidence results are automatically rendered in generated manuals:
- **Screenshots/Photos** (file): Rendered as embedded images
- **Other files**: Rendered as download links
- **`command_output`/`log` files**: File content is read and embedded as a code block (all formats, including Confluence ADF)
- **Inline content**: Rendered as code blocks (bash for command_output, text for others)
- **`link`**: Rendered as a link (Markdown autolink, Confluence wiki link, ADF link mark)
- **Descriptions**: Displayed above the evidence content

When `command_output` evidence is required (or optional) but no results have been
captured yet, every format (Markdown, single-env Markdown, Confluence markup, and ADF)
renders a `# Paste command output here` code block so the operator knows where to record
the output. Other evidence types (e.g. `screenshot`, `log`) show only the evidence
metadata, with no placeholder body.

**The three `evidence` fields:**

| Field | What it does | What it does not do |
|---|---|---|
| `required` | `samaritan run` refuses to complete the step until one item is recorded with `[e]` | It does not check the kind: any item counts |
| `types` | Tells the operator what to record. Shown in manuals and, during a run, in the step header and the `[e]` prompt | It is a hint, not a filter. A run that records another kind says so and carries on |
| `results` | Evidence you already have, written into the YAML by hand and embedded in generated manuals, keyed by environment name | A run never writes to it. What an operator records during a run goes to that run's `report.md` |

No other key is accepted under `evidence`: a misspelling such as `require:` or `type:` is a validation error (it used to pass and silently switch the gate off).

```yaml
evidence:
  required: true
  types: [screenshot, link]
  results:
    staging:                  # must be the name of one of the operation's environments
      - type: screenshot      # required
        file: ./path/to/file  # 'file' OR 'content', not both
        description: Description text  # optional
      - type: link
        content: https://ci.example.com/job/web-server-deploy/42/console
        description: CI build
      - type: command_output
        content: |
          Command output here
```

**Evidence types:**

| Type | Use it for | `results` rendering |
|---|---|---|
| `screenshot`, `photo` | An image file | Embedded image (`file`) |
| `video` | A recording | Link to the file |
| `file` | Any other attachment | Link to the file |
| `command_output` | Shell output | Code block; a `file` is read and embedded |
| `log` | Log lines | Code block; a `file` is read and embedded |
| `text` | A note or anything pasted | Code block |
| `link` | A URL: a chat message, a CI build, a dashboard. The URL goes in `content` | A link, in every format |

`samaritan validate` warns when a `results` key is not one of the operation's environments (those results are never rendered), when a `file` does not exist, when a `link` does not hold a URL, and when a `screenshot`/`photo`/`video` is given inline `content` instead of a `file`.

See `tests/fixtures/operations/features/evidence-with-results.yaml` for a complete example.

### Environment-Specific Evidence in Shared Steps

When defining shared steps that will be included via `uses:`, define evidence types in the step file as documentation. Each operation that includes the file adds its own `evidence.results` with environment-specific captured evidence:

```yaml
# ./common/health-checks.yaml
- name: Check AFD Health
  type: manual
  instruction: |
    Check AFD health status:
    ```bash
    curl https://${AFD_ENDPOINT}/health
    ```
  evidence:
    required: true
    types: [command_output, screenshot]
```

```yaml
# main-operation.yaml
steps:
  - uses: ./common/health-checks.yaml
    with:
      AFD_ENDPOINT: ${AFD_ENDPOINT}

  # Steps from the file expand inline; add evidence.results
  # directly on individual steps or via variants for per-env evidence
```

See `tests/fixtures/operations/features/evidence-with-results.yaml` for a complete example.

## JSONL audit trail

Every action appends a line to the run's black box at `<operation-dir>/.samaritan-runs/<id>/events.jsonl` (the exact path is printed as `📝 Audit log:` at the start of the run):

```jsonl
{"ts":"2026-04-18T10:00:00Z","type":"session_start","op":"deployment.yaml","session_id":"f3a9b2"}
{"ts":"2026-04-18T10:00:01Z","type":"session_open","name":"execution","host":"prod-bastion","pane":"samaritan-f3a9b2:0.1"}
{"ts":"2026-04-18T10:00:05Z","type":"step_start","step":0,"name":"Deploy","pic":"ops@example.com"}
{"ts":"2026-04-18T10:00:06Z","type":"command_sent","session":"execution","command":"kubectl apply -f deployment.yaml"}
{"ts":"2026-04-18T10:00:20Z","type":"pane_captured","session":"execution","output":"deployment.apps/web created"}
{"ts":"2026-04-18T10:00:22Z","type":"assert_result","step":0,"pass":true,"actual":"successfully rolled out","type":"contains"}
{"ts":"2026-04-18T10:00:30Z","type":"step_complete","step":0}
{"ts":"2026-04-18T10:02:00Z","type":"session_end","status":"completed"}
```

Query with `jq`:

```bash
# All commands sent during the session
cat .samaritan-runs/f3a9b2/events.jsonl | jq 'select(.type=="command_sent")'

# Assertion failures only
cat .samaritan-runs/f3a9b2/events.jsonl | jq 'select(.type=="assert_result" and .pass==false)'
```

## Evidence report

Generate a human-readable Markdown report from any JSONL log. Two ways to get one:

```bash
# A report.md is ALWAYS written beside the operation; --report adds an extra copy
samaritan run deployment.yaml --env production --report ./reports

# Generate after the fact from an existing JSONL log
samaritan report .samaritan-runs/f3a9b2/events.jsonl

# Save to a specific file
samaritan report /tmp/samaritan-f3a9b2.jsonl --output evidence-report.md
```

The report includes a summary (steps, duration, PIC/reviewer), per-step command + output, verification sign-offs, and a dedicated rollback events section. Attach it directly to a change ticket.

**Evidence recorded during the run** is listed under its step:

| Recorded with `[e]` | In the report |
|---|---|
| Pane output, typed or pasted text | Fenced code block |
| A URL | `**Evidence**: link — <description>` and the link itself |
| A screenshot or photo | `![<description>](evidence/<file>)`; the file is in `evidence/` beside `report.md` |
| Any other file | `[<file name>](evidence/<file>)` |

Share the whole run directory (`.samaritan-runs/<session-id>/`) and the images open. A report written to another place links to the same files with a relative path.

**Verification shows the final state.** Each step renders its *last* verify attempt (the full checklist plus the output it was checked against), with an attempt count when it was re-verified. A failure the operator accepted with `o` reads as overridden, with who, when and the reason. It is also flagged in the step heading and listed in the summary:

```markdown
## Step 1: two lines ⚠️ (verification overridden)

**Verification**: ⚠️ OVERRIDDEN (2 attempts, 2 failed — last shown)
- ⚠️ Overridden by alice at Thu, 22 Oct 2026 18:14:46 UTC — reason: prompt line counted
- ❌ (line_count) — expected: `2`, actual: `3`
```

The summary starts with the run's `Operation`, `Environment` and, for an operation with [groups](./groups.md), `Group`, so a report can be told apart from another run of the same file.

The report is plain UTF-8 Markdown: terminal escapes are stripped and any remaining control byte (NUL, SI, a stray ESC, …) is removed, so Slack, GitHub and `file` treat it as text.

When several operators each ran their own slice of one operation with
`run --pic`, merge their partial runs into a single consolidated report — each
step attributed to the operator who actually ran it (see [Multi-operator focus mode](#multi-operator-focus-mode-run---pic)):

```bash
samaritan report merge <alice-session-id> <bob-session-id> --output merged-report.md
```

The sessions must be runs of the same operation file, environment and [group](./groups.md). Steps are merged by position, so sessions of two groups or two environments are refused.
