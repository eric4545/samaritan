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
rollback: [ ... ]            # rollback steps (share StepContent base)
```

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

## Verification (`expect`)

```yaml
expect:
  contains: "Running"
  not_contains: "Error"
  any_line_contains: ["ready", "ok"]
  matches: "^pod/web-[0-9]+"               # regex
  retry:                                    # retryable assertion (automatic verify path)
    max: 5
    interval: 5s                            # 5s / 500ms / 2m / bare ms
    while: "Pending"                        # only retry transient-matching failures
```

## Templates (DRY reuse)

```yaml
steps:
  - template: ./templates/health-checks.yaml
    with:
      ENDPOINT: https://api.example.com
      TIMEOUT: 60          # type-preserving: stays a number
```
All `${VAR}` in the template must be supplied in `with:` or the parser errors.

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
- `examples/multi-env-deployment.yaml` — environment matrix
- `examples/sidecar-deployment.yaml` — interactive `run` (sidecar)
- `examples/expect-retry.yaml` — retryable verification
- `examples/mock-run-expect.yaml` — `run --mock`
