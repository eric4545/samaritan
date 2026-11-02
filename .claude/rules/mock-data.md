---
paths:
  - "**"
---

# Mock data only: never copy real operational data

Operators paste real material into sessions: terminal output, `report.md`,
`events.jsonl`, run notes, incident write-ups. Use it to **understand** the
bug. Never use it as **content**. Everything that leaves the session uses
fictional, generic mock data: files, code comments, test strings, fixtures,
examples, docs, CHANGELOG, commit messages, branch names, PR titles/bodies and
GitHub comments.

This applies even when a value "looks harmless". A product name, a region and
a ticket key together identify a team, a customer and a stack.

## What to replace, and with what

| Real data from the pasted material | Mock replacement |
|---|---|
| Product, app, service or stack names | `web-server`, `api-gateway`, `example-app` |
| Environment names / IDs, resource names with dates or hashes | `staging`, `production`, `web-staging` |
| Ticket / change / incident keys (`ABC-1234`) | `OPS-0000`, or plain words: "a real run", "operator feedback" |
| Cloud account IDs, ARNs, regions taken from the report | `123456789012`, `us-east-1` |
| Hostnames, CNAMEs, domains, URLs | `example.com`, `example.org` (RFC 2606) |
| IP addresses | `192.0.2.x`, `198.51.100.x` (RFC 5737) |
| Buckets, object keys, ETags, checksums | `example-bucket`, `deploy/template.yaml`, `"0123abcd"` |
| People, usernames, emails, on-call names | `alice`, `bob`, `ops@example.com` |
| Dates / timestamps that pin a real run | `2026-01-01T00:00:00Z` |
| tmux session / window names built from tickets | `work`, `ops`, `sam-e2e` |
| The specific managed service, runtime or vendor CLI the report used | A generic equivalent already used in `examples/` (`kubectl`, `curl`, `echo`) |
| Verbatim output lines (status JSON, error text) | A synthetic line with the same **shape** (same keys, same failure), new values |

Keep the **shape** of the failure (keys, structure, how a check failed). Drop
every **value** that came from the real system.

## Workflow

1. **Repro files built from pasted material live in the scratchpad or
   `/tmp/`**, never in the repo. A fixture or example derived from them is
   rewritten from scratch with mock names before it is added.
2. **Commit and PR text describes the problem, not the run.** Write "from
   operator feedback on a sidecar run", not the ticket key, date or product.
3. **Scan before every commit and push.** Grep the staged diff AND the commit
   message for the distinctive tokens of the pasted material (product names,
   ticket prefixes, regions, hostnames). Type the tokens into the shell
   command only, never into a file:

   ```bash
   { git diff --cached; git log -1 --format=%B; } | grep -n -i -E 'token1|token2|TICKET-'
   ```

   Also grep the whole working tree (`--exclude-dir=node_modules
   --exclude-dir=.git`). Any hit blocks the commit.
4. **Found a leak after pushing?** Replace it in the tree, then tell the user
   that the pushed history still holds it. Rewriting history needs the
   user's explicit OK.
5. **Don't write the leaked value into this rule, a test or a "do not use"
   list.** That would be a leak too.

Chat replies to the user may quote their own material. Nothing written to
the repo or to GitHub may.
