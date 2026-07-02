# SAMARITAN Operation YAML Reference

`src/schemas/operation.schema.json` is the source of truth. `examples/*.yaml` are
validated, copy-ready samples. Below is a field map; prefer copying an example
over writing from scratch.

## Top level

```yaml
name: string                 # required
version: string              # e.g. 1.0.0
extends: string | [string]   # inherit from one or more base operation files
description: string
environments:                # multi-env matrix
  - name: staging
  - name: production
common_variables: { ... }    # shared vars (priority: common_variables > variables > env_file)
variables: { ... }
steps: [ ... ]               # required
rollback:                    # operation-level rollback plan
  automatic: false
  conditions: [ ... ]
  aggregate_step_rollbacks: false  # opt-in: group step.rollback[] into this plan
  steps: [ ... ]             # each a full step body (shares StepContent base)
```

The top-level `rollback` is a **RollbackPlan object** (`automatic`, `conditions`,
`steps`) — not a bare array. It renders as a **🔄 Rollback Plan** section
in every manual format (Markdown multi-env + single-env, Confluence ADF, and
Confluence wiki). Per-step `rollback:` (under `Step-only structural fields`) is a
separate, bare array of rollback steps.

Rollback steps are structurally like normal steps: in addition to their
`StepContent` body each may carry an optional `name` and nested `sub_steps`
(a recursive list of rollback steps) for multi-part rollbacks. This applies to
**both** the operation-level plan (`operation.rollback.steps[]`) and per-step
rollback (`Step.rollback[]`). Nested sub-steps render recursively in every format
— operation-level as **Rollback Step N**, **N.M**, …; step-level inline under the
step's **🔄 Rollback** section. The operation-level rollback step schema is strict
(`additionalProperties: false`), so a typo'd key fails validation rather than
being silently dropped. Example: `examples/rollback-with-substeps.yaml`.

Set `rollback.aggregate_step_rollbacks: true` to **group** every step's own
`rollback` into the global plan: after the explicit `steps:`, each step's
rollback is appended in **reverse step order**, labelled `↩ Rollback for "<step>"`.
This drives both the rendered Rollback Plan ("see all rollbacks at once") and the
interactive `[g]` global-rollback jump (which uses only **completed** steps).
Opt-in (default false). Example: `examples/global-rollback-aggregated.yaml`.

## Operation inheritance (`extends:`)

A child operation can inherit everything (metadata, environments, variables,
steps, rollback) from one or more **base** operation files, then append its
own steps:

```yaml
name: Orders Service Deployment
version: 1.0.0
extends: ./base-deployment.yaml        # or a list: [./base-a.yaml, ./base-b.yaml]
steps:
  - name: Run Orders Smoke Test        # appended AFTER the inherited steps
    type: manual
    command: curl -f https://orders.${NAMESPACE}.example.com/health
```

**Merge semantics** (bases merge left→right, child always wins last):

| Field(s) | Rule |
|---|---|
| `name`, `version`, `description`, `author`, `category`, `emergency`, `overview`, `sessions`, `run`, `reporting`, `needs`, `with`, `matrix`, `env_file`, `metadata`, `uses`, `template`, `tags` | Last-defined layer wins (whole value replaced, `tags` included — not concatenated) |
| `variables`, `common_variables` | Spread-merged; later layer wins per key |
| `environments` | Concatenated in layer order; same-named environments across layers merge (vars spread, targets/restrictions appended) via the same `uses:` merge logic |
| `steps` | **Appended**: `base1.steps ++ base2.steps ++ … ++ child.steps` — no override-by-id, no positional insert |
| `rollback` | Whole-object last-wins (child's `rollback:` replaces the base's; inherited unchanged if the child omits it) |

**Relative paths in a base are rebased automatically.** A base's own
`script:`, `evidence.results[].file`, step `uses:`, `env_file`, and
`environments[].uses` are resolved relative to *that base file's own
directory* before merging, so a base can live anywhere and still work when
extended by a child in a different directory. Only non-root files (bases,
and bases-of-bases) are rebased this way — the file you actually run
`validate`/`generate` on keeps its paths exactly as authored.

**Known limitations:**
- `environments[].from` (manifest-name inheritance) is **not** rebased — it's
  a name, not a path. Use `environments: - uses: ./shared-envs.yaml` in the
  base instead (that path form IS rebased).
- `env_file` is a single-winner scalar — if both a base and the child set it,
  only the winning layer's `.env` variables load.
- A **diamond** (two bases sharing a common ancestor) is not an error —
  because steps append, the shared ancestor's steps are duplicated in the
  merged result. A true **cycle** (A extends B extends A) throws
  `Circular extends detected: <chain>`.
- Remote bases (`github:`/`https:`) are **not supported yet** — `extends:`
  only accepts local file paths. (Step-level `uses:` *inside* a base can
  still reference remote templates.)

Only the fully **merged** result is schema-validated — a base file doesn't
need to validate standalone (though it usually will, since it's a normal
operation file).

See `examples/extends-base-deployment.yaml` + `examples/extends-child-deployment.yaml`.

## Step content fields (shared by steps AND rollback steps — `StepContent`)

`command`, `script`, `instruction`, `timeout`, `description`, `evidence`,
`options`, `session`, `pic`, `reviewer`, `expect`.

> Rule: never author execution/content fields outside this set on a step;
> they live on `StepContent` so steps and rollback steps both get them.

## Step-only structural fields

`name`, `type`, `id`, `phase` (`preflight`/`flight`/`postflight`), `if`,
`foreach`, `sub_steps`, `when`, `variants`, `approval`, `needs`,
`template`/`with`, `variables`, `capture`, `retry`, `rollback`,
`section_heading`, `timeline`, `ticket`, `estimated_duration`, `env`.

## command vs script

```yaml
- name: Inline
  command: kubectl get pods            # short, typed into a terminal

- name: External
  script: ./scripts/deploy.sh          # file content embedded as bash block
```
Mutually exclusive — a step cannot have both.

## Evidence

```yaml
evidence:
  required: true
  types: [screenshot, log, command_output]   # documentation only
  results:                                    # embedded into the manual, keyed by env
    staging:
      - type: command_output
        file: ./evidence/staging-deploy.log   # file content read + embedded
        description: Deploy output
    production:
      - type: command_output
        content: |                            # OR inline content (not both — oneOf)
          deployment.apps/web created
```

When `results` are absent for an environment, every manual format (Markdown, single-env
Markdown, Confluence markup, ADF) renders a `# Paste command output here` code block for
`command_output` evidence. Other evidence types show only the metadata, with no placeholder.

## Verification (`expect`)

```yaml
expect:
  contains: "Running"
  not_contains: "Error"
  any_line_contains: "ready"
  no_line_contains: "Error"
  matches: "^pod/web-[0-9]+"               # whole-output regex
  all_lines_match: "Running|Ready"         # every non-empty line matches regex
  any_line_matches: "^pod/web-[0-9]+"      # ≥1 line matches regex (sibling of any_line_contains)
  no_line_matches: "Error|FATAL"           # no line matches regex (sibling of no_line_contains)
  retry:                                    # retryable assertion (automatic verify path)
    max: 5
    interval: 5s                            # 5s / 500ms / 2m / bare ms
    while: "Pending"                        # only retry transient-matching failures
```

Regex fields (`matches`, `all_lines_match`, `any_line_matches`, `no_line_matches`)
use Node's default `new RegExp(pattern)` — case-sensitive, unanchored partial
match (anchor with `^...$` for full-line). `samaritan validate` regex-lints
these: uncompilable patterns are errors, ReDoS-prone ones are warnings
(errors under `--strict`).

## Templates (DRY reuse)

```yaml
steps:
  - template: ./templates/health-checks.yaml
    with:
      ENDPOINT: https://api.example.com
      TIMEOUT: 60          # type-preserving: stays a number
```
All `${VAR}` in the template must be supplied in `with:` or the parser errors.

## Environment reuse (DRY)

Pick the smallest mechanism that fits:

```yaml
environments:
  - uses: ./environments/shared-app-envs.yaml  # import ALL envs from a shared file
  - name: production                           # optional: override one by name
    variables: { DB_HOST: prod-db-replica }    # merged over the imported production
```

- **`common_variables:`** — values shared across *all* envs in one file.
- **`uses:`** (entry under `environments:`) — import a *whole* env set across files;
  expands inline in array order; later same-name entry merges its `variables`; booleans
  (e.g. `approval_required`) preserved unless re-stated. Accepts a plain
  `{ environments: [...] }` file or a `kind: EnvironmentManifest` file.
- **`from:`** (per-env) — inherit one named env from a manifest, with overrides.
- **YAML anchors** (`<<: *base`) — same-file env-to-env reuse, no SAMARITAN syntax.

Precedence (low → high): `common_variables` → imported/manifest env vars → inline override
vars → `step.variables`. Examples: `examples/reuse-envs-a.yaml`,
`examples/reuse-envs-b.yaml`, `examples/deployment-with-env-ref.yaml`.

## foreach / matrix

```yaml
- name: Notify ${TEAM}
  foreach:
    values: [team-a, team-b]   # or matrix: with include/exclude
  command: echo "ping ${item}"
```
`${VAR}` inside `foreach` resolves at parse time against
`common_variables` + `variables`; env-specific vars resolve later via
`--resolve-vars`. See `examples/foreach-variable-values.yaml`.

## Phase grouping is block-aware

Generators group by effective phase via `groupByPhase`. Steps expanded from one
`uses:`/template block stay contiguous (shared `usesGroup`) rather than being
hoisted by raw `phase`. See `examples/scoped-preflight.yaml`.

## Examples to copy from

- `examples/deployment.yaml` — canonical baseline
- `examples/deployment-with-scripts.yaml` — `script:` import
- `examples/deployment-with-templates.yaml` — templates
- `examples/extends-base-deployment.yaml` + `examples/extends-child-deployment.yaml` — operation inheritance (`extends:`)
- `examples/multi-env-deployment.yaml` — environment matrix
- `examples/sidecar-deployment.yaml` — interactive `run` (sidecar)
- `examples/expect-retry.yaml` — retryable verification
- `examples/mock-run-expect.yaml` — `run --mock`
