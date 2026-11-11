# Full-picture check: walk every consumer of the operation

A feature is not done when `generate manual` renders it. The parsed
`Operation` feeds the manuals, the run loop (sidecar is the default mode), the
session file, `events.jsonl`, `report.md`, `report merge`, `sessions` and
`resume`. Groups shipped with the manuals correct and the run artifacts
unaware of the group: two groups of one file wrote identical-looking reports,
`report merge` blended them by step index into one "complete" run, and
`sessions` could not tell them apart. Reading the code did not show it; a real
run did.

**Applies to any change that touches** the operation YAML or schema, the
parser's output (which steps exist, their order, names, variables), a CLI flag
that selects or filters (an environment, a group, a PIC, a step range), or a
`StepContent` field.

## The surface matrix

Before coding, write this table in the PR description with one line per row:
what the feature does there, or `n/a` plus the reason. An empty row is a
missing answer, not a "no".

| # | Consumer | Where | Ask |
|---|---|---|---|
| 1 | Parse + validate | `src/operations/parser.ts`, `src/validation/`, `validate.ts` | Typos rejected? Every projection validated? |
| 2 | Manuals | `src/manuals/`, `generate.ts` | Multi-env AND `--env`, Markdown AND ADF/Confluence. See `manuals.md`. |
| 3 | Other generators | `generate docs`, `generate schedule`, `diff`, `qrh`, postmortem from a run | Do they need the same selection flag? |
| 4 | Run loop, every mode | `run.ts` (sidecar, manual, automatic, hybrid, `--mock`) | Banner, step heading, `[p]`/`[y]`/`[v]`, evidence, `[r]`/`[g]` rollback, `--pic` focus. |
| 5 | Session + resume | `src/models/session.ts`, `session-manager.ts`, `resume`, `sessions` | Is whatever shapes the step list stored on the session and re-applied? Is it shown in the listing? |
| 6 | Events | `logger.emit` in `run.ts`, `src/lib/session-log.ts` | Does `session_start` (or the step event) record it? The report is built ONLY from events. |
| 7 | Report | `src/lib/report-generator.ts` | Can a reader of `report.md` alone tell which runbook, environment and group ran? Old logs without the field still render. |
| 8 | Report merge | `src/lib/report-merge.ts` | Steps merge by INDEX. Anything that changes the step list must be in `assertSameRunbook`. |
| 9 | Docs, skill, rules, example, CHANGELOG | `docs/`, `.claude/skills/`, `.claude/rules/`, `examples/` | Does every sentence describe behaviour you saw, not behaviour you intended? |

Rows 4 to 8 are the ones that get skipped. The report has no access to the
`Operation` object: anything it must show has to be in an event.

## Prove it with a real run, not a parse

1. Run the feature's example in **sidecar** mode in real tmux (`--attach` to a
   second pane) to the end, and once more with an abort then `resume`.
2. Read the produced `report.md` and the first line of `events.jsonl`.
3. If the feature adds a way to select or filter steps, run two different
   selections of the same file and try `report merge` on them, and look at
   `sessions`.
4. Paste the before/after into the PR. A `run` test that only pipes `q` and
   checks the banner does not count as covering the run.

A test for rows 5 to 8 ships in the same commit (CLAUDE.md rule 1):
`tests/cli/groups.test.ts` ("run / resume") is the pattern: run, then assert
on `report.md`, `events.jsonl`, `sessions` and `report merge`.

## Known gaps (do not assume these work)

- A step filtered out by `when:` still counts in the report's
  `Steps completed: N/M` total.
