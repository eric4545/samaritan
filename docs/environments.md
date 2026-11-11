# Environments & variables

Declaring environments, sharing them between operations, and resolving variables at generation time.

## DRY Environment Manifests (Recommended)

Eliminate environment duplication across operations by using reusable environment manifests:

```yaml
# environments/k8s-cluster.yaml - Reusable environment definitions
# (resolved relative to the operation file; see examples/environments/)
apiVersion: samaritan/v1
kind: EnvironmentManifest
metadata:
  name: k8s-cluster
  description: Standard Kubernetes cluster environments
  version: 1.0.0

environments:
  - name: staging
    description: Staging environment for testing
    variables:
      NAMESPACE: staging
      REPLICAS: 2
      DB_HOST: staging-db.example.com
      DOMAIN: staging.example.com
    approval_required: false

  - name: production
    description: Production environment
    variables:
      NAMESPACE: prod
      REPLICAS: 5
      DB_HOST: prod-db.example.com
      DOMAIN: example.com
    approval_required: true
```

```yaml
# operation.yaml - Inherit from environment manifests with overrides
name: Deploy Web Application
version: 1.0.0
description: Deploy using reusable environments

# Inherit from environment manifests with operation-specific overrides
environments:
  - name: staging
    from: k8s-cluster  # Inherit base configuration
    variables:         # Override/add variables
      IMAGE_TAG: latest
      DEBUG_ENABLED: true

  - name: production
    from: k8s-cluster  # Inherit base configuration
    variables:         # Override/add variables
      IMAGE_TAG: v${VERSION}
      DEBUG_ENABLED: false

steps:
  - name: Deploy Application
    type: manual
    instruction: |
      Deploy application to Kubernetes:
      ```bash
      kubectl apply -f k8s/ --namespace ${NAMESPACE}
      ```
      Timeout: 300s (5 minutes)
    evidence:
      required: true
      types: [screenshot]
```

### Wholesale import with `uses:`

When several operations share the **same** environments (e.g. `a.yaml` and `b.yaml`
with identical `staging`/`production` blocks), import the whole set in one line with a
`uses:` entry — no need to re-list each environment by name:

```yaml
# environments/shared-app-envs.yaml — define the shared envs once.
# A plain `{ environments: [...] }` file OR a `kind: EnvironmentManifest`
# file are both accepted.
environments:
  - name: staging
    variables: { ENDPOINT: https://staging.api.example.com, DB_HOST: staging-db, NAMESPACE: staging }
  - name: production
    approval_required: true
    variables: { ENDPOINT: https://api.example.com, DB_HOST: prod-db, NAMESPACE: production }
```

```yaml
# a.yaml / b.yaml — reuse them with a single line
environments:
  - uses: ./environments/shared-app-envs.yaml   # expands to ALL envs in that file
  - name: production                            # OPTIONAL: override just one
    variables:
      DB_HOST: prod-db-replica                  # merged on top of the imported production
```

- `uses:` entries expand **inline, in array order** (same model as step-level `uses:`).
- A later inline (or imported) entry sharing a `name` **merges its `variables`** over the
  earlier one; booleans like `approval_required` are preserved unless re-stated.
- Precedence (lowest → highest): `common_variables` → imported env vars → inline override
  vars → `step.variables` (at generation time).
- The path is resolved relative to the operation file.

See `examples/reuse-envs-a.yaml`, `examples/reuse-envs-b.yaml`, and
`examples/environments/shared-app-envs.yaml`.

## Variables that reference other variables

A variable's value may use `${OTHER}`. The chain is followed to the end, however many hops, in any layer and whatever order the variables were declared in:

| Where the reference is | Example |
|---|---|
| `common_variables` → environment | `SITE_URL: https://${NAMESPACE}.example.com` |
| group → environment | `CACHE_HOST: cache.${NAMESPACE}.example.com` |
| environment → group | `RELEASE: ${APP}-${NAMESPACE}` |
| `step.variables` → any of the above | `TARGET: ${RELEASE}/${TRACK}` |
| `uses:` `with:` → caller variables, or another `with:` value | `PROBE_HOST: ${APP_HOST}`, `PROBE_ALIAS: ${PROBE_NICK}` |
| a reusable file's own `common_variables` | `PROBE_PORT: ${PROBE_PORT_BASE}1` |
| `foreach` values → `common_variables` | `values: ["${PRIMARY_ZONE}"]` |

Every place that shows a value resolves it the same way: `generate manual --resolve-vars` in every format (with `--env`, the step and rollback names and the environments table too), `diff`, and `run` (the command shown, pasted with `p`, the `expect` checked with `v`, rollback with `r`/`g`, and `resume`).

- A reference to a name that is not a variable stays as written, for the shell: `LOG_DIR: ${HOME}/logs` pastes `${HOME}/logs`.
- A cycle (`A: ${B}` and `B: ${A}`) is not an error; the repeating reference stays as written.
- `validate` warns when a chain ends at a name that no layer defines, for example a typo (`cache.${NAMESPCE}.example.com`). Pass a value that only exists at run time with `run --var`.
- A multi-environment manual (no `--env`) has one name cell for all environment columns, so a name whose value differs per environment keeps its placeholder there. The commands in each environment column are resolved.

See `tests/fixtures/operations/features/variable-chains.yaml` for every layer in one file, and `examples/deployment-with-groups.yaml` for a group variable built from an environment variable.

**Which DRY mechanism when:** `common_variables:` for values shared across *all* envs in one
file; `uses:` to reuse a *whole* environment set across files; per-env `from:` to inherit a
single named environment from a manifest with overrides; native YAML anchors (`<<: *base`)
for same-file env-to-env reuse. For several near-identical runbooks that each span every
environment, see [Groups](./groups.md).
