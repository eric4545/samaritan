# Rollback

Authoring recovery next to the step it undoes, and running one consolidated rollback when things go wrong.

## Rollback

Define rollback commands as an ordered list per step. SAMARITAN runs them when the operator presses `[r]` or verify fails:

```yaml
steps:
  - name: Deploy
    session: execution
    command: kubectl apply -f deployment.yaml
    rollback:
      - command: kubectl rollout undo deployment/web
        session: execution
      - command: kubectl delete pod -l app=web --force
        session: execution
```

A step-level rollback step is structurally **just like a normal step**: it may also carry an optional `name`, nested `sub_steps` for a multi-part rollback, and even `foreach`/`matrix` (see [below](#loop-a-rollback-step-with-foreachmatrix)) — all of which render recursively in every manual format. Both entries above render (not just the first):

```yaml
    rollback:
      - name: Roll back deployment
        instruction: Undo the deployment in order.
        sub_steps:
          - command: kubectl rollout undo deployment/web
          - instruction: Confirm the previous version is serving traffic.
            expect:
              contains: rolled back
```

After rolling back step N, SAMARITAN offers to walk back previous steps too.

If no `rollback:` is defined, the operator is prompted to intervene manually.

### Operation-level rollback

You can also declare a single **top-level** `rollback:` block that describes the rollback procedure for the whole operation (distinct from the per-step `rollback` above). It supports `automatic`, `conditions`, and an ordered list of `steps`. A rollback step is structurally **just like a normal step**: a full step body (`command`/`script`/`instruction`/`expect`/`pic`/`reviewer`/`evidence`) plus an optional `name` and nested `sub_steps` for multi-part rollbacks:

```yaml
steps:
  - name: Deploy
    command: kubectl apply -f deployment.yaml

# Global rollback plan for the whole operation
rollback:
  automatic: false
  conditions:
    - health_check_failure
    - error_rate_spike
  steps:
    - command: kubectl rollout undo deployment/web
      expect:
        contains: rolled back
    # A multi-part rollback step broken into ordered sub-steps
    - name: Decommission canary
      sub_steps:
        - command: kubectl scale deployment/web-canary --replicas=0
        - instruction: Confirm no canary pods remain.
          expect:
            no_line_contains: web-canary
```

This renders as a **🔄 Rollback Plan** section in every generated manual — Markdown (multi-env table and single-env headings), Confluence ADF/JSON, and Confluence wiki markup — showing the `automatic` flag, `conditions`, and each rollback step per environment. Nested `sub_steps` render recursively as **Rollback Step N**, **N.M**, **N.M.K**, … (see `examples/rollback-with-substeps.yaml`).

### Loop a rollback step with `foreach`/`matrix`

Because a rollback step **is** a normal step, it supports the same [`foreach`/`matrix`](#foreach-loops) expansion. One rollback definition expands at parse time into one rollback step per combination — for both the operation-level plan and per-step `rollback:`:

```yaml
rollback:
  steps:
    - name: Restart web
      foreach:
        matrix:
          REGION: [us-east-1, eu-west-1]
          TIER: [web, api]
      command: kubectl rollout restart deployment/web -n ${REGION}-${TIER}
```

This yields four rollback steps (`Restart web (us-east-1, web)`, …), each rendered in every format. A step may also carry **multiple** rollback entries (authored or foreach-expanded); all of them render. See `examples/rollback-with-foreach.yaml`.

### Compose a rollback from a reusable file with `uses:`/`with:`

Because a rollback step **is** a normal step, it also supports [`uses:`/`with:`](#step-composition-uses) file composition. A rollback entry that references a file with `uses:` is expanded at parse time into that file's steps (with every `${VAR}` filled from `with:`), producing a flat list of rollback steps. This works for **both** the operation-level `rollback.steps[]` plan and per-step `Step.rollback[]`, so you can keep one canonical "restore service" procedure in a shared file and reuse it as the rollback for many operations:

```yaml
steps:
  - name: Deploy web service
    command: kubectl apply -f web.yaml
    rollback:
      - uses: ./templates/rollback-restore.yaml   # expands into the file's steps
        with:
          SERVICE: web

rollback:
  automatic: false
  steps:
    - name: Announce rollback
      instruction: Post in #incidents that a rollback is starting.
    - uses: ./templates/rollback-restore.yaml     # plain + imported steps coexist
      with:
        SERVICE: api
```

The same required-variable rule as normal-step `uses:` applies: every `${VAR}` in the imported file must be supplied via `with:` (or a template default). A `uses:`-imported rollback step can itself contain `foreach`/`matrix`, which expands after import. See `examples/rollback-with-uses.yaml` (and `examples/templates/rollback-restore.yaml`).

### Group per-step rollbacks into the global rollback (`aggregate_step_rollbacks`)

Set `aggregate_step_rollbacks: true` on the operation-level `rollback:` to **group every step's own `rollback` into the global plan**. After the explicit `steps:` above, SAMARITAN appends each step's rollback in **reverse step order** (most-recently-completed step first), each labelled with the step it undoes (`↩ Rollback for "Deploy app"`). This lets you author each undo next to the step it reverses *and* still see — or run — one consolidated recovery:

```yaml
rollback:
  automatic: false
  aggregate_step_rollbacks: true   # group step.rollback[] into this plan (reverse order)
  steps:
    - name: Page the on-call SRE
      instruction: Notify the on-call engineer before rolling back.
```

**In the generated manuals, this flag also *centralizes* the per-step rollbacks so the main step flow stays readable.** Without it, each step's rollback is repeated up to three times — inline after the step, in a **Rollback Procedures** section, and folded into the **Rollback Plan**. With it on:

- the inline block after each step collapses to a compact **jump-link** — `↩ **Rollback:** [Rollback for "<step>" ↓](#rollback-for-<step>)` — pointing at that step's folded entry in the bottom **Rollback Plan**. The label names the step (not a numeric position) so the link text and its target heading share one searchable phrase;
- the folded entry in the Rollback Plan is the **jump target**: a renderer-safe **heading slug** in Markdown (`### Rollback for "<step>"`, so the link jumps in sanitized previews like GitHub — a hand-authored `<a id>` would be rewritten to `user-content-…` and never resolve), a `{anchor}` macro in Confluence wiki, an anchor-macro node in ADF;
- the now-redundant **Rollback Procedures** section is dropped, so the full rollback content lives in exactly one place.

The full recovery therefore reads top-to-bottom as one Rollback Plan, and each step links down to its own entry. Applies to every output format (Markdown multi-/single-env, Confluence wiki, ADF). With the flag off, rendering is unchanged.

During `samaritan run`, every step prompt offers **`[g]` global rollback**: it previews the consolidated recovery (explicit plan steps + the **completed** steps' rollbacks, reversed), asks for confirmation, runs it (sending via tmux when a session is attached, otherwise listing the commands to run manually), then aborts the operation — a full rollback ends forward progress, and the session is resumable. See `examples/global-rollback-aggregated.yaml`.
