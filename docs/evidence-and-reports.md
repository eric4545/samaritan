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
- **Descriptions**: Displayed above the evidence content

When `command_output` evidence is required (or optional) but no results have been
captured yet, every format (Markdown, single-env Markdown, Confluence markup, and ADF)
renders a `# Paste command output here` code block so the operator knows where to record
the output. Other evidence types (e.g. `screenshot`, `log`) show only the evidence
metadata, with no placeholder body.

**Evidence Result Schema:**
```yaml
evidence:
  required: true              # Optional: whether evidence is required
  types: [screenshot, log]    # Optional: expected evidence types
  results:                    # Optional: pre-captured evidence, keyed by environment name
    staging:                  # Environment name (must match an environment defined in the operation)
      - type: screenshot      # Required: evidence type
        file: ./path/to/file  # Either 'file' OR 'content' required
        description: Description text  # Optional
      - type: command_output
        content: |            # Inline content (alternative to 'file')
          Command output here
        description: Description text  # Optional
    production:
      - type: screenshot
        file: ./evidence/prod/dashboard.png
        description: Production dashboard
```

**Supported Evidence Types:**
- `screenshot` - UI screenshots (renders as image if file path provided)
- `photo` - Photos (renders as image if file path provided)
- `log` - Log files or log content
- `command_output` - Shell command output
- `video` - Video recordings
- `document` - PDF or document files
- `config` - Configuration file snapshots
- `custom` - Custom evidence types

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

When several operators each ran their own slice of one operation with
`run --pic`, merge their partial runs into a single consolidated report — each
step attributed to the operator who actually ran it (see [Multi-operator focus mode](#multi-operator-focus-mode-run---pic)):

```bash
samaritan report merge <alice-session-id> <bob-session-id> --output merged-report.md
```
