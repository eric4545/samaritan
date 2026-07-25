# Lifecycle hooks

Attaching steps to a point in an operation without editing its step list, and
declaring what to do when a run goes wrong.

## Why hooks

An operation's `steps:` list is the procedure. But some work belongs *around*
that procedure rather than inside it — announce the change window, snapshot
state before the risky step, re-enable alerting afterwards — and some of it is
contributed by a shared library rather than the document itself.

`hooks:` lets you name an **anchor** and attach steps on one side of it:

```yaml
hooks:
  - before: deploy          # a step id, or a phase name
    steps:
      - name: Snapshot current replica count
        type: automatic
        command: kubectl get deployment app -o=jsonpath='{.spec.replicas}'
```

Hook steps are injected into the step list **when the file is parsed**, so from
that point on they are ordinary steps: they appear in every generated manual,
they are walked by `samaritan run`, and they carry the full step surface
(`command`, `expect`, `evidence`, `pic`, `sub_steps`, `uses:`, …).

## Anchors

An anchor is either a **step `id`** or a **phase** (`preflight`, `flight`,
`postflight`).

| Hook | Attaches to |
| ---- | ----------- |
| `before: <step-id>` | immediately before that step |
| `after: <step-id>` | immediately after that step |
| `before: <phase>` | before the **first** step of that phase |
| `after: <phase>` | after the **last** step of that phase |

`after: preflight` deliberately lands at the *end* of preflight rather than in
the middle of it, so a gate you attach there stays a gate as more preflight
checks are added.

An anchor that matches no step id and no phase is a **validation error** — a
hook that silently does nothing is worse than one that fails loudly.

### Ordering

Several hooks may share an anchor. They apply in **declaration order**:

```yaml
hooks:
  - before: deploy
    steps: [{ name: Snapshot replicas, type: automatic, command: '...' }]
  - before: deploy
    steps: [{ name: Drain traffic, type: automatic, command: '...' }]
```

produces `Snapshot replicas` → `Drain traffic` → `deploy`.

Every anchor resolves against the **original** step list, so two hooks that
target adjacent steps both land where you meant — a hook never attaches to
another hook's injected output.

## `on_failure`

`on_failure` steps are **not** injected into the flow. They run only when a run
aborts or a step fails:

```yaml
hooks:
  - on_failure: true
    steps:
      - name: Page the on-call engineer
        type: manual
        instruction: Escalate in ${SLACK_CHANNEL} and page the on-call engineer.
      - name: Capture pod diagnostics
        type: automatic
        command: kubectl describe pods -l app=app
        evidence:
          required: true
          types: [command_output]
```

They render as their own **On Failure** section in every manual format, and when
you abort a run the loop lists them (with `${VAR}` resolved) and offers to walk
them, recording each one in the audit log and the run report.

::: tip `on_failure` is not `rollback`
They answer different questions, and an operation can sensibly have both.

- **`rollback:`** compensates work that *succeeded* — undo the deploy, restore
  the snapshot. See [Rollback](/rollback).
- **`on_failure:`** reacts to work that *did not* — page someone, capture
  diagnostics for the postmortem, take the silence off.
:::

## Worked example

`examples/deployment-with-hooks.yaml` combines all of the above. Parsed, its
three authored steps become seven:

```
Announce the change window        ← before: preflight
Check cluster reachability          (authored)
Snapshot current replica count    ← before: deploy
Drain traffic from the old pods   ← before: deploy
Apply the deployment manifest       (authored)
Confirm pods are healthy            (authored)
Re-enable alerting                ← after: verify
```

with two further steps held aside under **On Failure**.

```bash
samaritan validate examples/deployment-with-hooks.yaml --strict
samaritan generate manual examples/deployment-with-hooks.yaml --env staging
samaritan run examples/deployment-with-hooks.yaml --env staging
```
