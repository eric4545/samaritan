# Groups

Use `groups:` when several runbooks are almost the same and each of them also has its own environments. One file holds every step; each group gets its own manuals.

| Axis | Declared in | Selected with | Step filter |
|---|---|---|---|
| Environment | `environments:` | `--env <name>` | `when: [staging]` |
| Group | `groups:` | `--group <name>` | `groups: [web-server]` |

Without groups you would keep one file per runbook and share the common steps with `uses:` (see [Reusable steps](./reusable-steps.md)). Groups remove the per-runbook files.

## Declaring groups

```yaml
name: Service Deployment
version: 1.0.0

groups:
  - name: web-server
    variables:
      APP: web-server
      REPLICAS: 4
  - name: api-gateway
    variables:
      APP: api-gateway
      REPLICAS: 2
      CACHE_HOST: cache.example.com

environments:
  - name: staging
    variables: { NAMESPACE: staging }
  - name: production
    variables: { NAMESPACE: production }

steps:
  # No `groups:` = part of every group.
  - name: Check cluster access
    type: manual
    command: kubectl get nodes

  # Same step for every group; only the group variables differ.
  - name: Deploy ${APP}
    type: manual
    command: kubectl apply -f ${APP}.yaml -n ${NAMESPACE} --replicas=${REPLICAS}

  # Only one group has this step.
  - name: Purge the CDN
    type: manual
    groups: [web-server]
    command: curl -X POST https://cdn.example.com/purge/${APP}

  # On `uses:` the file is only loaded for the listed groups.
  - uses: ./common/cache-probe.yaml
    groups: [api-gateway]
    with:
      APP: ${APP}
      NAMESPACE: ${NAMESPACE}
      CACHE_HOST: ${CACHE_HOST}

  # `groups:` and `when:` combine: this group, these environments.
  - name: Announce the release
    type: manual
    groups: [web-server]
    when: [production]
    instruction: Post the release note in the status channel.
```

The complete file is `examples/deployment-with-groups.yaml`.

## Rules

- A step without `groups:` belongs to every group.
- `groups:` is accepted on steps, sub-steps, `uses:` entries, and rollback steps (step-level and operation-level, including their sub-steps).
- Every name in a step's `groups:` must be declared in the top-level `groups:`. A typo is an error, not a silently dropped step.
- Group names may contain letters, digits, `-` and `_`. They become directory names.
- A manual and the run banner for a group are titled `<operation name> (<group>)`.

### Variable precedence

Lowest to highest:

| Layer | Source |
|---|---|
| 1 | `env_file` |
| 2 | top-level `variables:` |
| 3 | `common_variables:` |
| 4 | the selected group's `variables:` |
| 5 | the environment's `variables:` |
| 6 | `step.variables` |

Group variables behave like `common_variables` for that group, so they are also available to `foreach` values.

## Commands

An operation with groups is several runbooks in one file, so every command that works on one runbook needs a group.

```bash
# Check the file and every group
samaritan validate deployment-with-groups.yaml

# Check one group only
samaritan validate deployment-with-groups.yaml --group web-server

# One group, all environments in one manual
samaritan generate manual deployment-with-groups.yaml --group web-server --output web-server.md

# One group, one environment
samaritan generate manual deployment-with-groups.yaml --group web-server --env staging

# Every group: manuals/web-server/deployment-with-groups.md, manuals/api-gateway/deployment-with-groups.md
samaritan generate manual deployment-with-groups.yaml --all-groups --output-dir manuals

# Every group and environment: manuals/<group>/deployment-with-groups_<env>.md
samaritan generate manual deployment-with-groups.yaml --all-groups --all-envs --output-dir manuals

# Compare two environments of one group
samaritan diff deployment-with-groups.yaml staging production --group web-server

# Run one group
samaritan run deployment-with-groups.yaml --group api-gateway --env staging
```

| Command | Without `--group` on an operation that has groups |
|---|---|
| `validate` | Validates every group. A finding shared by all groups is listed once; the rest are prefixed `[group <name>]`. |
| `generate manual`, `generate docs`, `generate schedule` | Error that lists the groups. Use `--group`, or `--all-groups` for manuals. |
| `diff`, `run` | Error that lists the groups. |
| `resume` | Not needed: the session remembers its group. |

## Runs and reports

A run belongs to one group, and its records say which one.

| Where | What you see |
|---|---|
| Run banner | `👥 Group: api-gateway` and the name `Service Deployment (api-gateway)` |
| `samaritan sessions` | `Env: staging  Group: api-gateway` |
| `report.md` summary | `- Operation: Service Deployment (api-gateway)`, `- Environment: staging`, `- Group: api-gateway` |
| `events.jsonl` | `session_start` has `operation`, `environment` and `group` |

`report merge` only merges sessions of the same group and environment. Each group has its own step list, so step 3 of one group is not step 3 of another; mixing them exits with an error that lists each session and its group.

`validate` checks each group on its own because some problems only appear once the other groups' steps are removed, such as a `needs` that points at a step the group does not have.

## Not supported

- Per-group overrides of a step's fields (the group equivalent of `variants:`). Use group variables, or two steps with `groups:`.
- A different `evidence.results` per group. Pre-captured results are keyed by environment only, so a step shared by two groups has one result per environment.
- A different environment list per group. Every group has every environment; use `when:` to leave a step out of one.
