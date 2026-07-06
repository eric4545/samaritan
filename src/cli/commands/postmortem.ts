import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Command } from 'commander';
import { dump } from 'js-yaml';
import { postmortemFromRun } from '../../lib/postmortem-from-run';

/** Write a file, creating any missing parent directories first. */
function writeFileEnsuringDir(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
}

// In CommonJS, __dirname is available globally. The blank authoring template
// ships as a file under templates/ (same convention as `create operation`,
// see project.ts loadTemplate) rather than being inlined here.
function loadInitTemplate(): string {
  return readFileSync(
    join(__dirname, '../../../templates/postmortem.yaml'),
    'utf-8',
  );
}

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
        writeFileEnsuringDir(options.output, yaml);
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
    try {
      const template = loadInitTemplate();
      if (options.output) {
        writeFileEnsuringDir(options.output, template);
        console.log(`✅ Postmortem template written: ${options.output}`);
      } else {
        console.log(template);
      }
    } catch (error: any) {
      console.error(`❌ Failed to write postmortem template: ${error.message}`);
      process.exit(1);
    }
  });

export { postmortemCommand };
