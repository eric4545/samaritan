# SAMARITAN Operation YAML Reference

`src/schemas/operation.schema.json` is the source of truth. `examples/*.yaml` are
validated, copy-ready samples. Below is a field map; prefer copying an example
over writing from scratch.

## Top level

```yaml
name: string                 # required
version: string              # e.g. 1.0.0
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

A rollback step **IS a normal step** — the `rollbackStep` schema is kept at full
field parity with a normal step (enforced by `tests/schemas/rollback-parity.test.ts`),
so anything you can author on a step you can author on a rollback step: its
`StepContent` body plus `name`, nested `sub_steps` (a recursive list of rollback
steps, for multi-part rollbacks), **`foreach`/`matrix`**, and **`uses`/`with`**
file composition. A rollback step with `foreach` expands at parse time into one
rollback step per combination, and a rollback entry with `uses:` expands into the
imported file's steps (with `${VAR}`s filled from `with:`) — exactly like a normal
step — in every format and for **both** the operation-level plan
(`operation.rollback.steps[]`) and per-step rollback (`Step.rollback[]`). A step
may carry **multiple** rollback entries (authored siblings, foreach-expanded, or
imported via `uses:`); all of them render (not just the first). Nested sub-steps
render recursively — operation-level as **Rollback Step N**, **N.M**, …;
step-level inline under the step's **🔄 Rollback** section. The rollback step
schema is strict (`additionalProperties: false`), so a typo'd key fails validation
rather than being silently dropped. The ONLY excluded field is `rollback` itself
(no rollback-of-a-rollback; nest via `sub_steps`). Examples:
`examples/rollback-with-substeps.yaml`, `examples/rollback-with-foreach.yaml`,
`examples/rollback-with-uses.yaml`.

Set `rollback.aggregate_step_rollbacks: true` to **group** every step's own
`rollback` into the global plan: after the explicit `steps:`, each step's
rollback is appended in **reverse step order**, labelled `↩ Rollback for "<step>"`.
This drives both the rendered Rollback Plan ("see all rollbacks at once") and the
interactive `[g]` global-rollback jump (which uses only **completed** steps).
Opt-in (default false). Example: `examples/global-rollback-aggregated.yaml`.

With this flag on, the generated manuals also **centralize** per-step rollbacks:
each step's inline rollback collapses to a **jump-link** into its folded entry in
the Rollback Plan (which carries the anchor target), and the duplicate **Rollback
Procedures** section is dropped — so the rollback content lives in one place and
the step flow stays readable. Applies to all formats (Markdown, Confluence wiki,
ADF). With the flag off, rendering is unchanged.

## Step content fields (shared by steps AND rollback steps — `StepContent`)

`command`, `script`, `instruction`, `timeout`, `description`, `evidence`,
`options`, `session`, `pic`, `reviewer`, `expect`.

> Rule: never author execution/content fields outside this set on a step;
> they live on `StepContent` so steps and rollback steps both get them.

`timeout` (seconds) and `session` (tmux pane name) both render in all four
manual formats — for steps, sub-steps, and rollback steps — as `⏱ Timeout: Ns`
and `🖥 Session: <name>`.

## Step-only structural fields

`name`, `type`, `id`, `phase` (`preflight`/`flight`/`postflight`), `if`,
`foreach`, `sub_steps`, `when`, `variants`, `approval`, `needs`,
`template`/`with`, `variables`, `capture`, `retry`, `rollback`,
`section_heading`, `timeline`, `ticket`, `estimated_duration`, `env`.

> Rollback steps accept these too (full parity), except nested `rollback`
> (use `sub_steps` for multi-part rollbacks). In particular `foreach`/`matrix`
> AND `uses`/`with` file composition expand on rollback steps at parse time
> just like normal steps.

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

`evidence.required: true` is also **enforced live** in `samaritan run`: a step can't be
completed (or, for `type: approval`, approved) until at least one evidence item is
captured via `[e]` (a typed-text note counts), or the operator `[s]` skips it. See
"Evidence-required gate" in `reference/cli.md`. `types`/`results` above remain
documentation/embedding only — this enforcement is purely about whether *any*
evidence was captured, not which types.

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

The `retry` policy is also rendered in generated manuals (all formats) as an
extra Expected criterion, e.g. `retry up to 5× every 5s while "Pending"`.

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
All plain `${VAR}` in the template must be supplied in `with:` or the parser
errors. Shell parameter expansions (`${X:?}`, `${X:-default}`, `${X##*/}` —
any name that isn't a plain identifier) are NOT template variables: never
required in `with:`, always passed through to the shell untouched. See
`examples/uses-with-shell-guards.yaml`.

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
`--resolve-vars`. The loop value itself is a parse-time constant, so it is
baked into the expanded step's **content** (command/script/instruction/expect/
sub_steps) as well as its title — the manual shows the resolved value even
without `--resolve-vars`. Only env-specific `${VAR}`s stay deferred. See
`examples/foreach-variable-values.yaml`.

## Phase grouping is block-aware

Generators group by effective phase via `groupByPhase`. Steps expanded from one
`uses:`/template block stay contiguous (shared `usesGroup`) rather than being
hoisted by raw `phase`. See `examples/scoped-preflight.yaml`.

## Sessions (execution engine)

Top-level `sessions:` is a **map** of session name → config naming the tmux panes
steps run in. `host:` present ⇒ Samaritan auto-runs `ssh user@host`; empty `{}` ⇒
local pane.

```yaml
common_variables: { ticket: JIRA-1234 }
sessions:
  "${ticket}": { host: prod-bastion.example.com, user: deploy }  # → "JIRA-1234"
  "${ticket}-local": {}                                          # → "JIRA-1234-local" (local)
```

`${VAR}` in session names/keys AND in a step's `session:` reference is resolved
against **common variables** at parse time (same scope as `foreach`; unmatched
`${VAR}` stay literal), so a session can be derived from e.g. a ticket id. Quote
keys that start with `${`. Remote-vs-local is **config-driven, not name-driven**.
Example: `examples/sessions-with-vars.yaml`.

## Examples to copy from

- `examples/deployment.yaml` — canonical baseline
- `examples/sessions-with-vars.yaml` — `sessions:` map + `${VAR}` names
- `examples/deployment-with-scripts.yaml` — `script:` import
- `examples/deployment-with-templates.yaml` — templates
- `examples/multi-env-deployment.yaml` — environment matrix
- `examples/sidecar-deployment.yaml` — interactive `run` (sidecar)
- `examples/expect-retry.yaml` — retryable verification
- `examples/mock-run-expect.yaml` — `run --mock`
