# Core concepts

What SAMARITAN models, and the vocabulary the rest of these docs uses.

## Operations as code

An **operation** is a YAML document describing a procedure: an ordered list of steps,
the environments it can target, and the variables that differ between them. It lives in
Git alongside the system it operates on, so a procedure is reviewed, versioned and
diffed like any other code.

- **YAML-defined procedures** stored in Git with version control
- **Environment-specific variables** for preprod/production deployment
- **Manual operation procedures** with evidence tracking
- **Approval gates** for compliance workflows

## The three things SAMARITAN does

| | | |
| --- | --- | --- |
| **Generate** | Render an operation into a reviewable runbook — Markdown, Confluence markup or ADF, for every environment or one. | [Generating manuals](/generating-manuals) |
| **Validate** | Catch broken variables, malformed steps and drifted assertions before anyone runs anything, including shellcheck linting of commands. | [CLI reference](/reference/cli#validate) |
| **Run** | Walk an operator through the steps, capture verification output as evidence, and record what actually happened. | [Running an operation](/running) |

## Steps

A **step** is one unit of work. Its `type` decides how it is presented:

| Type | Meaning |
| ---- | ------- |
| `automatic` | Has a `command:` the operator runs (SAMARITAN shows it; it does not execute it unattended) |
| `manual` | Has an `instruction:` for a human to follow |
| `approval` | A gate requiring explicit sign-off before continuing |
| `conditional` | Runs only when its `if:` condition holds |

Steps can nest (`sub_steps`), repeat (`foreach`), vary by environment
(`when`/`variants`), depend on each other (`needs`) and carry their own recovery
(`rollback`). See [Writing an operation](/operation-yaml).

::: warning Execution modes are not unattended execution
A step's `type` is not a promise that SAMARITAN will run it for you. `automatic` mode
and `--auto-approve` mark steps complete **without executing them** — an operator is
always in the loop. Non-interactive execution is a
[roadmap](https://github.com/eric4545/samaritan/blob/main/ROADMAP.md) item.
:::

## Evidence and audit

Every step can declare what proof it needs, and a run records what was actually
captured:

- **Evidence tracking** — document required evidence for each step
- **Evidence results** — embed pre-captured evidence directly in generated manuals
- **Git metadata** — complete traceability with commit info
- **Structured documentation** — generate manuals with evidence requirements
- **Audit-ready formats** — Markdown and Confluence outputs

A run always writes a durable record (`events.jsonl` plus a Markdown report) beside the
operation. See [Evidence & reports](/evidence-and-reports).

::: tip
Automatic evidence collection (screenshots, log capture, video) is **not implemented**.
What ships today is embedding pre-captured evidence via `evidence.results`, and
capturing verification output during an interactive run.
:::
