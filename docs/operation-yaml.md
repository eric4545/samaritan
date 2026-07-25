# Writing an operation

A guide to the operation document. For the exhaustive field list see the generated [Operation YAML reference](/reference/operation-yaml).

## Basic Structure

```yaml
name: Deploy Web Application
version: 1.0.0
description: Deploys web application with database migrations
author: sre-team@company.com
category: deployment
emergency: false

# Environment configurations
environments:
  - name: staging
    description: Staging environment
    variables:
      REPLICAS: 2
      DB_HOST: staging-db.company.com
    approval_required: false

  - name: production
    description: Production environment
    variables:
      REPLICAS: 5
      DB_HOST: prod-db.company.com
    approval_required: true
    validation_required: true

# Operation steps
steps:
  # Preflight checks
  - name: Check Git Status
    type: manual
    phase: preflight
    instruction: |
      Check for uncommitted changes:
      ```bash
      git status --porcelain
      ```
      Ensure output is empty before proceeding.

  - name: Verify Database Connection
    type: manual
    phase: preflight
    instruction: |
      Verify database connectivity:
      ```bash
      pg_isready -h ${DB_HOST}
      ```
      Confirm connection is ready.

  # Main operation steps
  - name: Database Migration
    type: manual
    instruction: |
      Run database migrations:
      ```bash
      npm run migrate
      ```
      Verify migration completes successfully (timeout: 300s)
      Capture screenshot and save migration logs.
    evidence:
      required: true
      types: [screenshot, log]  # Types are documentation only (v1.0)

  - name: Deploy Application
    type: manual
    instruction: |
      Deploy application to Kubernetes:
      ```bash
      kubectl apply -f k8s/
      ```

      Verify deployment:
      ```bash
      kubectl get pods -l app=webapp | grep Running
      ```
    evidence:
      required: true
      types: [screenshot]

  - name: Health Check
    type: manual
    instruction: |
      1. Open application dashboard: https://dashboard.company.com
      2. Verify all services show green status
      3. Test critical user flows
    evidence:
      required: true
      types: [screenshot]

  - name: Production Approval
    type: approval
    description: Require manager approval for production
    instruction: |
      Request approval from manager@company.com before proceeding.
      Document approval in evidence.
```

> **Note:** Steps with `phase: preflight` are recommended for pre-execution validation checks.

### Operation Overview Metadata

Add flexible overview/metadata fields to operations for release coordination and compliance tracking. The `overview` field accepts any custom key-value pairs that render as a 2-column table in generated manuals:

```yaml
name: Production Release - Q1 2025
version: 2.5.0
description: Major production release with new features

# Flexible overview section - add any fields your team needs
overview:
  Release Date: "2025-01-15"
  Release Manager: "Jane Smith"
  Release Notes: "https://confluence.example.com/releases/v2.5.0"
  Release Ticket: "JIRA-1234"
  EPIC Tickets: "EPIC-567, EPIC-890"
  Manual Status: "APPROVED"
  War Room (Rehearsal): "https://zoom.us/j/rehearsal-room"
  War Room (Production): "https://zoom.us/j/production-room"
  Rollback Window: "4 hours"
  Compliance Review: "Completed - 2025-01-10"

environments:
  - name: production
    variables:
      REPLICAS: 10
    approval_required: true

steps:
  - name: Deploy Application
    type: manual
    instruction: |
      Deploy the application following release procedures
```

**Generated Manual Output:**

The overview section renders as a clean table in both Markdown and Confluence formats:

```markdown
## Overview

| Item | Specification |
| ---- | ------------- |
| Release Date | 2025-01-15 |
| Release Manager | Jane Smith |
| Release Notes | https://confluence.example.com/releases/v2.5.0 |
| Release Ticket | JIRA-1234 |
| EPIC Tickets | EPIC-567, EPIC-890 |
| Manual Status | APPROVED |
| War Room (Rehearsal) | https://zoom.us/j/rehearsal-room |
| War Room (Production) | https://zoom.us/j/production-room |
| Rollback Window | 4 hours |
| Compliance Review | Completed - 2025-01-10 |
```

**Key Features:**
- **Flexible Fields**: Add any metadata fields your team needs - no hardcoded structure
- **No Field Limits**: Include as many or as few fields as required
- **Multiple Formats**: Renders consistently in Markdown, HTML, and Confluence/ADF
- **Clean Layout**: Positioned at the top of the manual, right after the description
- **Value Types Supported**:
  - Strings: Rendered as-is
  - Numbers: Converted to strings
  - Arrays: Joined with commas in ADF, line breaks in Markdown
  - Objects: JSON stringified

**Common Use Cases:**
- Release coordination (dates, managers, war rooms)
- Compliance tracking (approval status, review dates)
- Reference links (release notes, tickets, EPICs, runbooks)
- Timeline planning (rollback windows, estimated duration)
- Team coordination (PICs, contact channels)

See `examples/deployment-with-overview.yaml` for a complete example with realistic release metadata.

## Built-in run-time variables

SAMARITAN provides built-in variables that resolve **late** — at run time (in the
interactive loop, re-evaluated each step), or at generation time with
`--resolve-vars`. They never need to be declared, and a user-defined variable of
the same name always wins (built-ins are the lowest-priority defaults).

| Variable | Value | Notes |
|---|---|---|
| `${RUN_START_DATE}` | `YYYY-MM-DD` | Fixed at run/session start; **resume-safe** (from the original `started_at`) |
| `${RUN_START_TIME}` | `HH:MM:SS` | Fixed at run/session start |
| `${CURRENT_DATE}` | `YYYY-MM-DD` | Re-evaluated per step |
| `${CURRENT_TIME}` | `HH:MM:SS` | Re-evaluated per step |
| `${CURRENT_DATETIME}` | `YYYY-MM-DD HH:MM:SS` | Re-evaluated per step |
| `${ELAPSED_TIME}` | e.g. `1h 16m` | Humanized time since run start — your live **time-to-recover** |

At **generation time** (`--resolve-vars`), `CURRENT_*`/`RUN_START_*` resolve to the
generation clock; `${ELAPSED_TIME}` is a run-only value and is left literal in the
manual. `validate` warns if you define a variable that shadows a built-in name.
See `examples/builtin-variables.yaml`.

**Benefits:**
- **Audit Trail**: Know exactly which code version generated each manual
- **Environment Focus**: Production manuals show only production procedures
- **Ready-to-Execute**: Use `--resolve-vars` for copy-paste commands during emergencies
- **Change Tracking**: Generated timestamp and git status for compliance
- **File Organization**: Environment-specific files get appropriate suffixes (`deployment-production-manual.md`)

## Person In Charge & Reviewer

Aviation-inspired fields that identify who executes and who monitors each step. Generated manuals include sign-off checkboxes for both when these fields are set.

```yaml
steps:
  - name: Deploy Application
    type: manual
    pic: ops-team@example.com       # Person In Charge — executes this step
    reviewer: sre-lead@example.com  # Reviewer/buddy — monitors and signs off
    instruction: |
      Deploy the application to Kubernetes:
      ```bash
      kubectl apply -f deployment.yaml
      ```
```

The `pic` and `reviewer` fields can also be set per-environment using `variants` (see [Environment-Specific Steps](#environment-specific-steps-when-and-variants) above).

### Multi-operator focus mode (`run --pic`)

When one operation is split across several operators — e.g. Alice owns the app
tier, Bob owns the data tier — each operator can run `samaritan run` in **focus
mode** so they only walk their own steps:

```bash
# Alice runs only her steps; Bob's steps are auto-skipped (recorded as skipped)
samaritan run deploy.yaml --env prod --pic alice@example.com

# Bob does the same for his half (bare --pic defaults to $USER)
samaritan run deploy.yaml --env prod --pic bob@example.com
```

- **Steps assigned to a different `pic` are auto-skipped** and recorded as
  `⏭ (skipped)` in that operator's run report — the audit trail stays honest.
- **Steps with no `pic` are shared** and shown to every operator.
- The focused PIC becomes the run's operator, so each step in the report is
  attributed to whoever ran it.
- A central operator can run the whole thing by omitting `--pic` (everyone's
  steps), or keep the ownership labels without skipping via `--no-skip-others`.
- Focus is **not persisted** — re-supply `--pic` when you `resume`.

Each operator's run produces its own partial report. **Merge them** into one
consolidated report (each step attributed to the operator who executed it) with
`report merge`:

```bash
samaritan report merge <alice-session-id> <bob-session-id> -o merged-report.md
```

See `examples/multi-operator.yaml` for a complete runnable example.

## Timeout & Session metadata

`timeout` (seconds) and `session` (the tmux pane a step runs in) render in every
manual format — for steps, sub-steps, and rollback steps — as `⏱ Timeout: <N>s`
and `🖥 Session: <name>`:

```yaml
steps:
  - name: Deploy Application
    type: manual
    timeout: 300          # ⏱ Timeout: 300s in generated manuals
    session: execution    # 🖥 Session: execution in generated manuals
    command: kubectl apply -f deployment.yaml
```

## Step Dependencies (`needs`)

Model dependencies between steps, like GitHub Actions `jobs.<id>.needs`. A
`needs` entry references another step by its `id` or `name` (and, for a
`foreach`/`matrix` step, its original authored name — so it depends on every
expanded instance):

```yaml
steps:
  - name: Build image
    id: build
    command: docker build -t app .
  - name: Deploy
    id: deploy
    needs: [build]        # runs after Build
    command: kubectl apply -f app.yaml
  - name: Smoke test
    needs: [deploy]
    command: curl -f https://app/health
```

What `needs` drives:

- **`validate`**: unknown references warn (error under `--strict`); **cycles,
  self-references, and forward references** (a step needing a *later* step, which
  can never be satisfied at run time) are always errors.
- **Interactive `run`**: before a step whose dependencies aren't complete (e.g.
  after a `[j]` jump or `--from-step`), the run loop warns and offers to go back.
- **Rollback**: the global rollback plan (`[g]`) unwinds completed steps in
  **reverse-topological order** when `needs` are present, so a step is undone
  before the steps it depends on. Pressing `[r]` on a step with no rollback of
  its own offers the nearest upstream step's rollback (following the `needs`
  chain).

`needs` is honored on **top-level steps** (v1); on sub-steps it is reported and
ignored. See `examples/deployment-with-needs.yaml`.

## External Script Files (`script`)

Reference an external shell script file. The generator reads the file at manual-generation time and embeds the full script content as a `bash` code block — so the operator can review what will run before executing it.

```yaml
steps:
  - name: Deploy Application
    type: manual
    instruction: Review the deployment script below, then run it.
    script: ./scripts/deploy.sh   # Path relative to the operation YAML file
```

**Generated manual output:**
```
| **Deploy Application** | Run the deployment script to update the application.

**Script:** `./scripts/deploy.sh`
```bash
#!/bin/bash
set -e
kubectl apply -f k8s/deployment.yaml
kubectl rollout status deployment/web-server --timeout=300s
``` |
```

**`script` vs `command`:**
| | `command` | `script` |
|---|---|---|
| **Use for** | Short inline commands (`kubectl apply -f ...`) | Multi-step shell scripts in `.sh` files |
| **Value** | Inline string | Path to `.sh` file (relative to operation) |
| **In manual** | Inline code snippet | Full script content as bash code block |
| **DRY** | No (script lives in YAML) | Yes (one file, used by many operations) |

> **Mutual exclusivity**: A step cannot have both `command` and `script`. The schema validator will reject it.

**Example:** See `examples/deployment-with-scripts.yaml` and `examples/scripts/deploy.sh`.

## Conditional Execution

```yaml
steps:
  - name: Conditional Migration
    type: conditional
    if: ${{ env.MIGRATE_DB == 'true' }}
    command: npm run migrate

  - name: Rollback on Failure
    type: manual
    instruction: |
      If deployment fails, rollback:
      ```bash
      kubectl rollout undo deployment/webapp
      ```

      Check rollback status:
      ```bash
      kubectl rollout status deployment/webapp
      ```
```

## Sub-steps and Complex Workflows

Organize complex procedures into hierarchical sub-steps with automatic numbering (1a, 1b, 1a1, 1a2, etc.):

**Basic Sub-steps:**
```yaml
steps:
  - name: Complex Deployment
    type: manual
    instruction: Deploy all components
    sub_steps:
      - name: Wait for Pods          # Numbered as 1a
        type: manual
        instruction: |
          Wait for pods to be ready:
          ```bash
          kubectl wait --for=condition=ready pod -l app=webapp --timeout=120s
          ```

      - name: Verify Deployment      # Numbered as 1b
        type: manual
        instruction: Check application responds correctly
        evidence:
          required: true
          types: [screenshot]
```

**Nested Sub-steps (Multi-level):**

Sub-steps can be nested up to 4 levels deep for organizing complex multi-tier deployments:

```yaml
steps:
  - name: Full Stack Deployment
    type: manual
    instruction: Deploy complete application stack
    sub_steps:
      # First level: Infrastructure (1a, 1b)
      - name: Infrastructure Setup
        type: manual
        section_heading: true  # Renders as section heading in manuals
        description: Provision infrastructure components
        pic: Infrastructure Team
        sub_steps:
          # Second level: Network components (1a1, 1a2)
          - name: Setup Networking
            type: automatic
            command: terraform apply -target=module.networking
            sub_steps:
              # Third level: Network verification (1a1a, 1a1b)
              - name: Verify Network Configuration
                type: manual
                instruction: Verify VPC, subnets, and security groups
                evidence:
                  required: true
                  types: [screenshot]

              - name: Test Connectivity
                type: automatic
                command: ping -c 3 ${GATEWAY_IP}

      # Another first level section (1b)
      - name: Database Tier
        type: manual
        section_heading: true
        description: Deploy database systems
        pic: DBA Team
        sub_steps:
          - name: Deploy PostgreSQL
            type: automatic
            command: helm install postgres bitnami/postgresql
            sub_steps:
              - name: Initialize Schema
                type: automatic
                section_heading: true  # Nested section heading
                description: Create tables and indexes
                command: psql -f schema.sql
```

**Step Numbering Pattern:**
- Level 0 (top-level): `1, 2, 3`
- Level 1 (first sub-steps): `1a, 1b, 1c`
- Level 2 (nested sub-steps): `1a1, 1a2, 1a3`
- Level 3 (deeply nested): `1a1a, 1a1b, 1a1c`
- Level 4 (maximum depth): `1a1a1, 1a1a2, 1a1a3`

**Section Headings:**

Use `section_heading: true` to break up long operations into logical sections. Section headings:
- Render as headings (h3, h4, h5) in generated manuals
- Close and reopen procedure tables for visual clarity
- Support PIC (Person In Charge) and timeline metadata
- Can be used at any nesting level

See `examples/nested-deployment.yaml` for a complete multi-tier deployment example.

## Environment-Specific Steps (`when` and `variants`)

Use `when` to restrict a step to specific environments, and `variants` to override step fields per environment — without duplicating the whole step.

**`when` — show a step only in certain environments:**
```yaml
steps:
  - name: Enable production monitoring
    type: manual
    when: [production]           # This step only appears in the production manual
    instruction: Configure DataDog production alerts
    pic: ops-lead@example.com
```

**`variants` — environment-specific overrides:**
```yaml
steps:
  - name: Deploy application
    type: manual
    instruction: kubectl apply -f deployment.yaml   # default
    command: kubectl apply -f deployment.yaml
    variants:
      production:
        instruction: |
          Deploy to production with blue-green strategy
          ```bash
          kubectl apply -f deployment.yaml --replicas=10 --strategy=blue-green
          ```
        command: kubectl apply -f deployment.yaml --replicas=10 --strategy=blue-green
        timeout: 600
        pic: senior-sre@example.com
        reviewer: ops-manager@example.com
      staging:
        command: kubectl apply -f deployment-staging.yaml --replicas=2
```

**Combined `when` + `variants`:**
```yaml
steps:
  - name: Database migration
    type: manual
    when: [preprod, production]  # skip staging entirely
    instruction: Run migration
    command: npm run migrate
    variants:
      production:
        instruction: |
          Run migration with backup first
          ```bash
          npm run db:backup && npm run migrate --safe-mode
          ```
        reviewer: senior-dba@example.com
        timeout: 1800
```

Fields you can override in `variants`: `instruction`, `command`, `timeout`, `pic`, `reviewer`, `evidence`.

### They govern runs, not just manuals

`when` and `variants` apply identically when you `run` the operation. A step
gated `when: [staging]` is not presented during `run --env production`, and the
production run shows the production `variants` command — so the runbook you
review and the runbook you walk are the same document.

Step numbers stay tied to the **authored** position, so "Step 6" means the same
step in every environment even when earlier steps are filtered out. That is why
an environment's step labels can be sparse (`2`, `3`, `4`), and why
`run --from-step <n>` takes the label as printed in the manual rather than a
position in the filtered list.

A `needs` entry pointing at a step that this environment filters out does not
gate the run — an unresolvable dependency is not an unmet one.

See `tests/fixtures/operations/features/when-and-variants.yaml` for a complete example,
and `tests/fixtures/operations/features/when-variants-run.yaml` for the run-loop behaviour.

## Foreach Loops (Repeatable Steps)

Eliminate repetitive step definitions with `foreach` loops. Perfect for progressive rollouts, multi-service deployments, or any pattern where you repeat the same operation with different parameters.

### Single Variable Foreach

**Basic Example:**
```yaml
steps:
  - name: Deploy Service
    type: automatic
    description: Deploy microservice to cluster
    command: kubectl apply -f ${SERVICE}.yaml
    foreach:
      var: SERVICE
      values: [backend, frontend, worker]
```

This expands to 3 separate steps at parse time:
- Step 1: Deploy Service (backend) with `SERVICE=backend`
- Step 2: Deploy Service (frontend) with `SERVICE=frontend`
- Step 3: Deploy Service (worker) with `SERVICE=worker`

**Progressive Rollout Example:**

See `examples/progressive-rollout.yaml` for a complete example demonstrating progressive canary deployment:

```yaml
steps:
  - name: Deploy to ${TRAFFIC_PERCENT}% of traffic
    type: manual
    instruction: |
      **Canary Deployment: ${TRAFFIC_PERCENT}% Traffic**

      1. Update traffic split:
      ```bash
      kubectl set traffic ${APP_NAME} \
        --stable=v1 --canary=v2 \
        --split ${TRAFFIC_PERCENT}:$((100-${TRAFFIC_PERCENT}))
      ```

      2. Monitor metrics for 15 minutes:
         - Error rate should remain < 1%
         - P99 latency should remain < 500ms

      **Wait for metrics to stabilize before proceeding!**
    foreach:
      var: TRAFFIC_PERCENT
      values: [10, 25, 50, 100]
    evidence:
      required: true
      types: [screenshot, command_output]
```

This creates 4 deployment steps (10% → 25% → 50% → 100%).

### Matrix Expansion (Multiple Variables)

For operations that need multiple variables, use matrix expansion to create a cartesian product of all combinations:

**Basic Matrix Example:**
```yaml
steps:
  - name: Deploy ${TIER} to ${REGION}
    type: manual
    instruction: |
      Deploy ${TIER} service to ${REGION}:
      ```bash
      kubectl apply -f ${TIER}-service.yaml --context ${REGION}
      ```
    foreach:
      matrix:
        REGION: [us-east-1, us-west-2, eu-west-1]
        TIER: [web, api, worker]
    evidence:
      required: true
      types: [screenshot]
```

This creates **9 steps** (3 regions × 3 tiers):
- Deploy web to us-east-1
- Deploy api to us-east-1
- Deploy worker to us-east-1
- Deploy web to us-west-2
- ... (and so on for all combinations)

**Matrix with Include/Exclude Filters:**

Add or remove specific combinations from the matrix:

```yaml
steps:
  - name: Deploy ${SERVICE} to ${REGION}
    type: manual
    instruction: |
      Deploy ${SERVICE} to ${REGION} region
    foreach:
      matrix:
        REGION: [us-east-1, eu-west-1]
        TIER: [web, api]
      include:
        # Add specific combination not in matrix
        - REGION: ap-south-1
          TIER: web
      exclude:
        # Remove specific combination from matrix
        - REGION: eu-west-1
          TIER: api
```

This expands to 4 steps:
- us-east-1/web, us-east-1/api, eu-west-1/web (from matrix)
- ap-south-1/web (from include)
- eu-west-1/api is excluded

**Real-World Multi-Region Example:**

See `examples/multi-region-deployment.yaml` for a complete example deploying across 3 regions and 3 tiers (9 total deployments).

**Key Features:**
- **Automatic Expansion**: Parser expands loops at parse time into separate steps
- **Variable Injection**: Loop variables are added to `step.variables` for each iteration
- **Cartesian Product**: Matrix creates all possible combinations of variables
- **Include/Exclude**: Fine-tune which combinations are deployed
- **Full Integration**: Works with all step features (evidence, rollback, approval, etc.)
- **Clean Manuals**: Generated manuals show expanded steps with values in parentheses

### Variable References in Foreach Values

`foreach.values` (and `foreach.matrix`/`include`/`exclude`) entries can themselves be `${VAR}` references instead of literal values:

```yaml
common_variables:
  ONCALL_EMAIL: oncall@example.com

environments:
  - name: production
    variables:
      TEAM_EMAIL: prod-team@example.com

steps:
  - name: Notify Recipient
    command: notify-send --to ${RECIPIENT}
    foreach:
      var: RECIPIENT
      values:
        - '${ONCALL_EMAIL}'   # common_variables - resolved at parse time
        - '${TEAM_EMAIL}'     # environment-specific - resolved in generated output
        - '${UNKNOWN_VAR}'    # not defined anywhere - stays literal
```

Resolution happens in two layers:

1. **Parse time (`common_variables` only)**: Before the loop is expanded, `${VAR}` references in `foreach` are resolved against `common_variables` (merged with any `step.variables` already set, e.g. by an enclosing template). This affects the expanded step **titles**, the loop variable injected into `step.variables`, **and the step's command/script/instruction/expect content** for every format (Markdown, Confluence, ADF) — `${ONCALL_EMAIL}` becomes `Notify Recipient (oncall@example.com)` regardless of `--resolve-vars`. Because the loop value is a per-iteration constant, it is baked directly into the command too (e.g. `${SPEC_DIR}` → `build-check`), so you don't need `--resolve-vars` just to see the loop value in the generated command. Only combo values that themselves still hold a `${VAR}` reference (e.g. a matrix value pulled from an env var) stay deferred to generation time.
2. **Generation time (`--resolve-vars`)**: References to environment-specific variables (like `${TEAM_EMAIL}`) aren't known until an environment is selected, so they remain as placeholders after parsing. With `--resolve-vars`:
   - **Single-environment manuals** (`-e production`): the step title and command resolve using that environment's variables, e.g. `Notify Recipient (prod-team@example.com)`.
   - **Multi-environment tables**: the shared step name cell resolves using `common_variables` only (environment-specific values differ per column, so the name cell can't pick one); each environment's command cell resolves using that environment's variables.

References to variables that are undefined in both `common_variables` and the relevant environment (like `${UNKNOWN_VAR}`) are left as literal `${UNKNOWN_VAR}` text.

**Loop variables propagate into `sub_steps`**: when a step with `foreach` also has `sub_steps`, the loop combination (e.g. `TEST_RECIPIENT`) is injected into every nested sub-step's `variables` (at all nesting levels) and into sub-step `rollback` blocks, so `${TEST_RECIPIENT}` in sub-step `command`/`instruction`/`expect`/`rollback` content resolves the same way as in the parent step's title and command.

**Known limitations:**
- Foreach values that resolve to objects or arrays are not supported — the title suffix will show `[object Object]`.
- A `${VAR}` reference inside `foreach` that depends on a variable only available inside an imported `template:` (and not visible to the parent operation) will fail validation, since template variable substitution happens after the parent's foreach expansion.

See `examples/foreach-variable-values.yaml` for a complete example.
