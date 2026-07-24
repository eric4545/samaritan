---
layout: home

hero:
  name: SAMARITAN
  text: Operations as Code
  tagline: Turn YAML operation definitions into reviewable runbooks, then drive them step by step with a complete audit trail.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: CLI reference
      link: /reference/cli
    - theme: alt
      text: View on GitHub
      link: https://github.com/eric4545/samaritan

features:
  - title: Runbooks from one source
    details: Define an operation once in YAML and generate Markdown or Confluence manuals for every environment, so the document a reviewer approves is the one an operator follows.
  - title: Validation before execution
    details: Catch broken variables, malformed steps and drifted assertions with validate — including shellcheck linting of step commands and regex linting of expect rules.
  - title: Interactive execution with evidence
    details: Drive an operation step by step in sidecar mode, capture verification output as evidence, and get a durable JSONL run record plus a Markdown report.
  - title: Rollback that is planned, not improvised
    details: Author rollback next to the step it undoes, then run one consolidated recovery — ordered by step dependencies — from any prompt.
---

## What SAMARITAN is

SAMARITAN is a **documentation generator, validator, and interactive runner** for
operational procedures. You describe an operation once in YAML; SAMARITAN renders it
into reviewable runbooks, checks it for errors, and walks an operator through it while
recording what actually happened.

## What it is not

It is **not a non-interactive execution engine.** SAMARITAN never runs your commands
unattended. Even in `automatic` mode, or with `--auto-approve`, steps are marked
complete rather than executed — an operator is always in the loop. Automatic command
execution, automatic evidence collection and external integrations (Jira, Confluence
API, Slack) are tracked in
[ROADMAP.md](https://github.com/eric4545/samaritan/blob/main/ROADMAP.md), not shipped.

Being explicit about this matters: these documents are used during incidents, and a
runbook that overstates what the tool does is worse than no runbook.
