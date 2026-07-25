---
paths:
  - ".github/workflows/**"
---

# GitHub Actions: stay on supported runtimes

Two *different* Node versions are in play in every workflow. Confusing them is the
trap this rule exists to prevent.

| | What it is | How you control it |
|---|---|---|
| **Our Node** | The runtime our own `run:` steps use — `npm ci`, `npm test`, `npm run docs:build` | `actions/setup-node` `node-version` |
| **The action's Node** | The runtime GitHub uses to execute a third-party action's own JavaScript | `runs.using:` in **their** `action.yml` — you can only change it by bumping the action's major |

A `Node 20 is being deprecated` warning in the log is almost always the **second**
kind. Changing `node-version` will not silence it. Find the action whose `action.yml`
declares `runs.using: node20` and bump it.

## Rule 1 — our Node must be an LTS line

- **`DEFAULT_NODE_VERSION`** (used for lint, build, publish, deploy — anything whose
  output ships) must be the **Active LTS**.
- **The test matrix** must cover every **still-supported LTS** line, because
  `package.json` `engines.node` promises they work. It **may** additionally include
  **Current** as an early-warning signal — that is encouraged, not a violation.
- **`engines.node`** must never claim a line that is past **end-of-life**.

Check the real dates before changing a pin — do not go from memory:

```bash
curl -s https://raw.githubusercontent.com/nodejs/Release/main/schedule.json | jq
```

As of 2026-07: 20 is **EOL** (2026-04-30), 22 is **Maintenance LTS** (EOL 2027-04-30),
24 is **Active LTS**, 26 is **Current** and becomes LTS on 2026-10-28. So the current
`DEFAULT_NODE_VERSION: '24.x'` and matrix `[22.x, 24.x, 26.x]` are correct: both live
LTS lines plus Current.

Note 24 enters maintenance on **2026-10-20**, days before 26 becomes LTS — that is the
next time `DEFAULT_NODE_VERSION` should move.

## Rule 2 — third-party actions must not run on an EOL Node

Every `uses:` must resolve to a major whose `action.yml` declares a **supported**
`runs.using:` (today: `node24`, or `composite`/`docker`, which have no Node runtime of
their own).

Verify rather than guess — the runtime is not in the release notes:

```bash
# What runtime does a given major actually use?
curl -s https://raw.githubusercontent.com/actions/deploy-pages/v5/action.yml | grep -A2 '^runs:'

# Is there a newer major?
curl -s https://api.github.com/repos/actions/deploy-pages/releases/latest | jq -r .tag_name
```

Bumping a major can be breaking. Diff the `inputs:` of both `action.yml` files before
and after, and confirm every input the workflow passes still exists with the same
meaning.

### Verified state (2026-07-25)

| Action | Pin | `runs.using` |
|---|---|---|
| `actions/checkout` | v5 | `node24` |
| `actions/setup-node` | v5 | `node24` |
| `actions/upload-artifact` | v7 | `node24` |
| `actions/upload-pages-artifact` | v5 | `composite` |
| `actions/deploy-pages` | v5 | `node24` |
| `github/codeql-action/*` | v4 | `node24` |
| `oven-sh/setup-bun` | v2 | `node24` |

`deploy-pages@v4` and `codeql-action@v3` were the two on `node20`; both were bumped.

## Rule 3 — a red deploy is a signal, not noise

Do **not** paper over an infrastructure failure with `continue-on-error`. The Pages
deploy failing with `404 ... Ensure GitHub Pages has been enabled` means the repository
setting is missing (**Settings → Pages → Source: GitHub Actions**) — a real
misconfiguration that must stay visible until someone fixes it.
