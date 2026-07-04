import { writeFileSync } from 'node:fs';
import { Command } from 'commander';
import { dump } from 'js-yaml';
import { postmortemFromRun } from '../../lib/postmortem-from-run';

/** Blank authoring template emitted by `postmortem init`. */
const INIT_TEMPLATE = `# SAMARITAN Postmortem / Incident Report (RCA)
# Only 'title' and 'summary' are required. Render with:
#   samaritan generate postmortem <this-file> -o postmortem.md
#   samaritan generate postmortem <this-file> -f confluence -o postmortem.confluence

title: Incident title
id: INC-YYYY-NNNN
severity: SEV2            # SEV1 | SEV2 | SEV3 | SEV4
status: draft            # draft | in-review | final
occurred_at: 2026-01-01T00:00:00Z
resolved_at: 2026-01-01T00:00:00Z
authors: [you@example.com]

# Linkage (operation -> run -> postmortem)
operation: ./path/to/operation.yaml
# run: ./.samaritan-runs/<session-id>/events.jsonl

summary: |
  One paragraph: what happened.

impact:
  detected_after: 0m     # MTTD
  resolved_after: 0m     # MTTR
  scope: Who/what was affected

timeline:
  - at: 2026-01-01T00:00:00Z
    event: What happened
    kind: cause          # cause | detection | action | recovery | note

root_cause:
  summary: The underlying cause (blameless).
  contributing_factors: []

resolution: |
  How it was resolved.

action_items:
  - title: Follow-up action
    owner: you@example.com
    type: prevent        # prevent | mitigate | detect | process
    status: open         # open | in-progress | done

lessons_learned:
  went_well: []
  went_wrong: []
  got_lucky: []
`;

const postmortemCommand = new Command('postmortem').description(
  'Author postmortem / incident report (RCA) documents',
);

postmortemCommand
  .command('from-run <session-or-jsonl>')
  .description(
    'Seed a postmortem YAML from a captured run record (events.jsonl or session id)',
  )
  .option('-o, --output <file>', 'Output file path (default: stdout)')
  .action((sessionOrJsonl: string, options: { output?: string }) => {
    try {
      const pm = postmortemFromRun(sessionOrJsonl);
      const header =
        '# Seeded from a SAMARITAN run record. Timeline and participants are\n' +
        '# auto-filled; complete the TODO narrative fields before publishing.\n';
      const yaml = header + dump(pm, { skipInvalid: true, lineWidth: 100 });

      if (options.output) {
        writeFileSync(options.output, yaml, 'utf-8');
        console.log(`✅ Postmortem seeded: ${options.output}`);
        console.log(
          '💡 Fill in the TODO fields, then: samaritan generate postmortem ' +
            `${options.output}`,
        );
      } else {
        console.log(yaml);
      }
    } catch (error: any) {
      console.error(`❌ Failed to seed postmortem: ${error.message}`);
      process.exit(1);
    }
  });

postmortemCommand
  .command('init')
  .description('Write a blank postmortem authoring template')
  .option('-o, --output <file>', 'Output file path (default: stdout)')
  .action((options: { output?: string }) => {
    if (options.output) {
      writeFileSync(options.output, INIT_TEMPLATE, 'utf-8');
      console.log(`✅ Postmortem template written: ${options.output}`);
    } else {
      console.log(INIT_TEMPLATE);
    }
  });

export { postmortemCommand };
