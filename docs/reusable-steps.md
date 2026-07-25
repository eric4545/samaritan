# Reusable steps

Compose operations from shared step files with `uses:` and `with:` instead of copying blocks between runbooks.

## Step Composition (`uses:`)

SAMARITAN supports inline step composition using the `uses:` directive — inspired by GitHub Actions. Point at a file, and all its steps expand inline at that position. No registration, no IDs to remember.

```yaml
steps:
  - uses: ./tasks/database-backup.yaml        # all steps from file expand here
  - uses: ./tasks/health-checks.yaml          # same file, with variables
    with:
      ENDPOINT: ${ENDPOINT}
      TIMEOUT: 60
  - uses: ./tasks/health-checks.yaml          # same file again, different vars
    with:
      TIMEOUT: 120
```

### File Sources

`uses:` accepts local paths, HTTPS URLs, or GitHub shorthands:

```yaml
steps:
  # Local file (relative to this operation)
  - uses: ./templates/health-checks.yaml
    with: { ENDPOINT: https://api.example.com }

  # HTTPS URL
  - uses: https://raw.githubusercontent.com/org/repo/main/templates/deploy.yaml
    with: { SERVICE: my-app }

  # GitHub shorthand  github:owner/repo//path@ref
  - uses: github:org/ops-templates//health-checks.yaml@v2.1.0
    with: { NAMESPACE: production }
```

### Writing Reusable Step Files

Step files can be a bare step array or a full operation file:

```yaml
# tasks/health-checks.yaml — bare step array
- name: Check API Health
  type: automatic
  command: curl -f ${ENDPOINT}/health
  timeout: ${TIMEOUT}

- name: Verify Database
  type: automatic
  command: kubectl exec ${SERVICE_NAME} -- nc -zv ${DB_HOST} 5432
```

```yaml
# tasks/k8s-deploy.yaml — full operation format (steps: field is extracted)
name: Kubernetes Deployment Steps
version: 1.0.0
common_variables:
  REPLICAS: 2          # default — overridable via with:
steps:
  - name: Apply Manifests
    type: automatic
    command: kubectl apply -f k8s/${SERVICE_NAME}.yaml -n ${NAMESPACE}
  - name: Wait for Rollout
    type: automatic
    command: kubectl rollout status deployment/${SERVICE_NAME} -n ${NAMESPACE}
```

### Complete Example

```yaml
name: Microservice Deployment
version: 2.0.0
environments:
  - name: staging
    variables:
      ENDPOINT: https://staging.api.com
      DB_HOST: staging-db
      SERVICE_NAME: my-service
      NAMESPACE: staging
  - name: production
    variables:
      ENDPOINT: https://api.example.com
      DB_HOST: prod-db
      SERVICE_NAME: my-service
      NAMESPACE: production

steps:
  # Pre-deployment health checks
  - uses: ./tasks/health-checks.yaml
    with:
      ENDPOINT: ${ENDPOINT}
      DB_HOST: ${DB_HOST}
      SERVICE_NAME: ${SERVICE_NAME}
      TIMEOUT: 60

  - name: Deploy Application
    type: manual
    instruction: Deploy the app

  # Post-deployment health checks (same file, stricter timeout)
  - uses: ./tasks/health-checks.yaml
    with:
      ENDPOINT: ${ENDPOINT}
      DB_HOST: ${DB_HOST}
      SERVICE_NAME: ${SERVICE_NAME}
      TIMEOUT: 120
```

**How it works:**
1. File is loaded (local, HTTPS, or GitHub)
2. Steps are extracted (from bare array or `steps:` field)
3. `${VAR}` placeholders are substituted with values from `with:`
4. Steps expand inline at the `uses:` position
5. Generated manuals show the fully expanded, substituted steps

**Variable substitution:**
- All plain `${VAR}` placeholders must be satisfied by `with:` or `common_variables` defaults
- Shell parameter expansions (`${POD:?}`, `${REGION:-us-east-1}`, `${PATH##*/}`, … — any name that isn't a plain identifier) are **not** template variables: they're never required in `with:` and pass through to the shell untouched, so fail-fast bash guards for shell-local variables keep working inside reused files
- Type-preserving: `timeout: ${TIMEOUT}` with `TIMEOUT: 60` → `timeout: 60` (number, not string)
- Omit `with:` entirely if the file has no `${VAR}` placeholders

### Block-scoped pre-flight

Generated manuals group steps into Pre-Flight / Flight / Post-Flight phases. A
reused file can carry its **own** `phase: preflight` checks (e.g. a migration
block that verifies the DB is reachable before migrating). Those checks stay
**local to the reused block** — they render right before that block's steps in
the Flight phase, not hoisted into the operation's top-level Pre-Flight section.
The operation's own top-level `phase: preflight` steps still group into the
global Pre-Flight section as usual. This is automatic; no extra configuration is
needed. (A reused block whose steps are *all* preflight does group into the
top-level Pre-Flight section, since it is purely a set of checks.)

See `examples/scoped-preflight.yaml` (+ `examples/templates/db-migration.yaml`).

**Example files:**
- `examples/templates/health-checks.yaml` — service health verification
- `examples/templates/kubernetes-deployment.yaml` — K8s deployment workflow
- `examples/templates/notifications.yaml` — team notification steps
- `examples/templates/db-migration.yaml` — migration block with local pre-flight
- `examples/templates/fail-fast-restart.yaml` — shell `${VAR:?}` guards inside a reused file

See `examples/deployment-with-templates.yaml` for a complete example, and
`examples/uses-with-shell-guards.yaml` for mixing template variables with
shell parameter-expansion guards.

## Reusable Step Files

```yaml
# operation.yaml
name: Complex Deployment
version: 2.0.0

steps:
  # Expand all database steps inline
  - uses: ./lib/database-steps.yaml

  - name: Custom Step
    type: manual
    instruction: |
      Execute custom logic:
      ```bash
      echo "Custom logic"
      ```

  # Expand all monitoring steps inline
  - uses: ./lib/monitoring-steps.yaml
```
