import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Command } from 'commander';
import { stepRollbackAnchor } from '../../lib/anchor';
import { renderExpectParts } from '../../lib/assertions';
import { createGenerationMetadata } from '../../lib/git-metadata';
import { buildEffectiveRollback } from '../../lib/global-rollback';
import { indexToLetters } from '../../lib/letter-sequence';
import { groupByPhase } from '../../lib/phase-grouping';
import { hasRollbackContent } from '../../lib/rollback';
import {
  mergeStepVariant,
  shouldRenderStepForEnvironment,
  substituteExpectVars,
  substituteVariables,
} from '../../lib/step-resolution';
import { formatTimelineForDisplay } from '../../lib/timeline-format';
import { generateADFString } from '../../manuals/adf-generator';
import {
  generateManualWithMetadata,
  generateSingleEnvManual,
} from '../../manuals/generator';
import { generatePostmortemADFString } from '../../manuals/postmortem-adf-generator';
import { generatePostmortemConfluence } from '../../manuals/postmortem-confluence';
import { generatePostmortemMarkdown } from '../../manuals/postmortem-generator';
import type { Step } from '../../models/operation';
import { parseOperation } from '../../operations/parser';
import { parsePostmortemFile } from '../../operations/postmortem-parser';
import { parseRunManifest } from '../../operations/run-manifest-parser';

/**
 * Merge step variants for a specific environment with base step properties
 * Returns the merged step (base + variant overrides) for the given environment
 */
/**
 * Filter steps (and sub_steps recursively) that don't apply to any of the given environments.
 * Steps without a 'when' field are kept (they apply to all environments).
 */
function filterStepsForEnvironments(
  steps: any[],
  environmentNames: string[],
): any[] {
  return steps
    .filter((step: any) => {
      if (!step.when || step.when.length === 0) return true;
      return step.when.some((env: string) => environmentNames.includes(env));
    })
    .map((step: any) => {
      if (!step.sub_steps || step.sub_steps.length === 0) return step;
      return {
        ...step,
        sub_steps: filterStepsForEnvironments(step.sub_steps, environmentNames),
      };
    });
}

interface GenerateOptions {
  output?: string;
  format?: 'markdown' | 'confluence' | 'adf' | 'html' | 'pdf';
  env?: string;
  resolveVars?: boolean;
  template?: string;
  gantt?: boolean;
  run?: string;
  allEnvs?: boolean;
  outputDir?: string;
  prefix?: string;
}

// File extension per output format for --all-envs naming
const FORMAT_EXTENSIONS: Record<string, string> = {
  markdown: '.md',
  confluence: '.confluence',
  adf: '.json',
  html: '.html',
};

function getTargetEnvironment(options: GenerateOptions): string | undefined {
  return options.env;
}

/**
 * Render a single operation-level rollback step (and its nested sub_steps) for
 * the simple Markdown documentation output. `label` is the dotted number path
 * (e.g. "2", "2.1"). Rollback steps are structurally like normal steps, so
 * sub_steps recurse as `2.1`, `2.1.1`, …
 */
function renderRollbackDocStep(step: any, label: string): string {
  const name = step.name ? `: ${step.name}` : '';
  let out = `
### ${label}. Rollback Step${name}
${step.command ? `**Command**: \`${step.command}\`` : ''}
${step.instruction ? `**Instructions**: ${step.instruction}` : ''}
`;
  step.sub_steps?.forEach((sub: any, subIndex: number) => {
    out += renderRollbackDocStep(sub, `${label}.${subIndex + 1}`);
  });
  return out;
}

class DocumentationGenerator {
  async generateManual(
    operationFile: string,
    options: GenerateOptions,
  ): Promise<void> {
    // --all-envs: emit one manual per environment defined in the operation
    if (options.allEnvs) {
      await this.generateAllEnvManuals(operationFile, options);
      return;
    }

    const operation = await parseOperation(operationFile);
    await this.renderManual(operation, operationFile, options);
  }

  /**
   * Render a postmortem / incident report document (Markdown, Confluence wiki,
   * or ADF). Writes to `--output` or prints to stdout.
   */
  async generatePostmortem(
    postmortemFile: string,
    options: GenerateOptions,
  ): Promise<void> {
    const format = options.format || 'markdown';
    const pm = parsePostmortemFile(postmortemFile);
    const postmortemDir = dirname(postmortemFile);

    let content: string;
    switch (format) {
      case 'confluence':
        content = generatePostmortemConfluence(pm, postmortemDir);
        break;
      case 'adf':
        content = generatePostmortemADFString(pm, postmortemDir);
        break;
      case 'markdown':
        content = generatePostmortemMarkdown(pm, postmortemDir);
        break;
      default:
        throw new Error(
          `Unsupported postmortem format '${format}'. Supported: markdown, confluence, adf`,
        );
    }

    if (options.output) {
      await mkdir(dirname(options.output), { recursive: true });
      await writeFile(options.output, content);
      console.log(
        `✅ Postmortem generated: ${options.output} (format: ${format})`,
      );
      if (format === 'confluence') {
        console.log('💡 Upload this content to your Confluence space');
      }
    } else {
      console.log(content);
    }
  }

  /**
   * Render a single manual from an already-parsed operation. Shared by the
   * single-file path and the per-environment --all-envs loop so the operation
   * is parsed only once per invocation.
   */
  private async renderManual(
    operation: any,
    operationFile: string,
    options: GenerateOptions,
  ): Promise<void> {
    const targetEnv = getTargetEnvironment(options);
    const envSuffix = targetEnv ? ` (${targetEnv})` : '';
    const format = options.format || 'markdown';
    console.log(
      `📄 Generating manual for: ${operationFile}${envSuffix} (format: ${format})`,
    );

    const operationName = basename(operationFile, '.yaml');
    const envFileSuffix = targetEnv ? `-${targetEnv}` : '';

    switch (format) {
      case 'confluence':
        await this.generateConfluenceManual(
          operation,
          operationName,
          envFileSuffix,
          options,
          operationFile,
        );
        break;
      case 'adf':
        await this.generateADFManual(
          operation,
          operationName,
          envFileSuffix,
          options,
          operationFile,
        );
        break;
      case 'html':
        await this.generateHtmlManual(
          operation,
          operationName,
          envFileSuffix,
          options,
          operationFile,
        );
        break;
      default:
        await this.generateMarkdownManual(
          operation,
          operationFile,
          operationName,
          envFileSuffix,
          options,
        );
        break;
    }

    if (targetEnv) {
      console.log(`🎯 Filtered for environment: ${targetEnv}`);
    }
  }

  /**
   * Generate one manual per environment defined in the operation.
   * Files are written as `<base>_<env>.<ext>` (base defaults to the operation
   * file name, overridable via --prefix) into the current directory (or
   * --output-dir). Parses the operation once and reuses the per-format
   * single-env rendering via renderManual with a computed output path per env.
   */
  private async generateAllEnvManuals(
    operationFile: string,
    options: GenerateOptions,
  ): Promise<void> {
    const operation = await parseOperation(operationFile);
    const environments = operation.environments || [];
    if (environments.length === 0) {
      throw new Error(
        `No environments defined in ${operationFile}; --all-envs needs at least one`,
      );
    }

    const format = options.format || 'markdown';
    const ext = FORMAT_EXTENSIONS[format];
    if (!ext) {
      throw new Error(
        `--all-envs does not support format '${format}'. Supported: ${Object.keys(
          FORMAT_EXTENSIONS,
        ).join(', ')}`,
      );
    }

    const base = options.prefix || basename(operationFile, '.yaml');
    const outputDir = options.outputDir || '.';

    console.log(
      `📄 Generating manuals for ${environments.length} environment(s): ${environments
        .map((e: any) => e.name)
        .join(', ')}`,
    );

    const written: string[] = [];
    for (const env of environments) {
      const outputFile = join(outputDir, `${base}_${env.name}${ext}`);
      await this.renderManual(operation, operationFile, {
        ...options,
        env: env.name,
        output: outputFile,
      });
      written.push(outputFile);
    }

    console.log(
      `✅ Generated ${written.length} manual(s):\n${written
        .map((f) => `   - ${f}`)
        .join('\n')}`,
    );
  }

  private async generateMarkdownManual(
    operation: any,
    operationFile: string,
    operationName: string,
    envFileSuffix: string,
    options: GenerateOptions,
  ): Promise<void> {
    const targetEnv = getTargetEnvironment(options);

    // Create generation metadata
    const metadata = await createGenerationMetadata(
      operationFile,
      operation.id,
      operation.version,
      targetEnv,
    );

    // Get operation directory for evidence file reading
    const operationDir = dirname(operationFile);

    // Load run manifest if provided
    const runManifest = options.run ? parseRunManifest(options.run) : undefined;
    if (runManifest) {
      console.log(
        `📋 Using run manifest: ${runManifest.id} (${runManifest.status})`,
      );
    }

    // When --env is specified, use the single-env heading-based format (issue #15)
    let manual: string;
    if (targetEnv) {
      manual = generateSingleEnvManual(
        operation,
        targetEnv,
        options.resolveVars,
        operationDir,
        runManifest,
      );
    } else {
      manual = generateManualWithMetadata(
        operation,
        metadata,
        targetEnv,
        options.resolveVars,
        options.gantt,
        operationDir,
        runManifest,
      );
    }

    // Determine output file
    const outputFile =
      options.output || `manuals/${operationName}${envFileSuffix}-manual.md`;

    // Ensure output directory exists
    await mkdir(dirname(outputFile), { recursive: true });

    // Write manual
    await writeFile(outputFile, manual);
    console.log(`✅ Manual generated: ${outputFile}`);
  }

  private async generateConfluenceManual(
    operation: any,
    operationName: string,
    envFileSuffix: string,
    options: GenerateOptions,
    operationFile: string,
  ): Promise<void> {
    const targetEnv = getTargetEnvironment(options);
    const operationDir = dirname(operationFile);
    const confluenceContent = this.createConfluenceContent(
      operation,
      options.resolveVars,
      options.gantt,
      targetEnv,
      operationDir,
    );
    const outputFile =
      options.output ||
      `manuals/${operationName}${envFileSuffix}-manual.confluence`;

    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, confluenceContent);
    console.log(`✅ Confluence manual generated: ${outputFile}`);
    console.log('💡 Upload this content to your Confluence space');
  }

  private async generateADFManual(
    operation: any,
    operationName: string,
    envFileSuffix: string,
    options: GenerateOptions,
    operationFile: string,
  ): Promise<void> {
    const targetEnv = getTargetEnvironment(options);
    const operationDir = dirname(operationFile);
    const metadata = await createGenerationMetadata(
      operationName,
      operation.id,
      operation.version,
      targetEnv,
    );

    const adfContent = generateADFString(
      operation,
      metadata,
      targetEnv,
      options.resolveVars,
      operationDir,
    );
    const outputFile =
      options.output || `manuals/${operationName}${envFileSuffix}-manual.json`;

    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, adfContent);
    console.log(`✅ ADF manual generated: ${outputFile}`);
    console.log(
      '💡 Import this JSON file into Confluence using the ADF importer',
    );
  }

  private async generateHtmlManual(
    operation: any,
    operationName: string,
    envFileSuffix: string,
    options: GenerateOptions,
    operationFile: string,
  ): Promise<void> {
    const targetEnv = getTargetEnvironment(options);
    const metadata = await createGenerationMetadata(
      operationName,
      operation.id,
      operation.version,
      targetEnv,
    );

    // Get operation directory for evidence file reading
    const operationDir = dirname(operationFile);

    const manual = generateManualWithMetadata(
      operation,
      metadata,
      targetEnv,
      options.resolveVars,
      options.gantt,
      operationDir,
    );
    const htmlManual = this.markdownToHtml(manual, operation.name);
    const outputFile =
      options.output || `manuals/${operationName}${envFileSuffix}-manual.html`;

    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, htmlManual);
    console.log(`✅ HTML manual generated: ${outputFile}`);
  }

  async generateDocs(
    operationFile: string,
    options: GenerateOptions,
  ): Promise<void> {
    console.log(`📚 Generating documentation for: ${operationFile}`);

    const operation = await parseOperation(operationFile);
    const operationName = basename(operationFile, '.yaml');

    switch (options.format) {
      case 'confluence':
        await this.generateConfluencePage(
          operation,
          operationName,
          options,
          operationFile,
        );
        break;
      case 'adf':
        await this.generateADFDocs(
          operation,
          operationName,
          options,
          operationFile,
        );
        break;
      case 'html':
        await this.generateHtmlDocs(operation, operationName, options);
        break;
      case 'pdf':
        console.log('❌ PDF generation not yet implemented');
        break;
      default:
        await this.generateMarkdownDocs(operation, operationName, options);
    }
  }

  private async generateMarkdownDocs(
    operation: any,
    operationName: string,
    options: GenerateOptions,
  ): Promise<void> {
    const docs = this.createMarkdownDocumentation(operation);
    const outputFile = options.output || `docs/${operationName}.md`;

    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, docs);
    console.log(`✅ Documentation generated: ${outputFile}`);
  }

  private async generateHtmlDocs(
    operation: any,
    operationName: string,
    options: GenerateOptions,
  ): Promise<void> {
    const markdownDocs = this.createMarkdownDocumentation(operation);
    const htmlDocs = this.markdownToHtml(markdownDocs, operation.name);
    const outputFile = options.output || `docs/${operationName}.html`;

    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, htmlDocs);
    console.log(`✅ HTML documentation generated: ${outputFile}`);
  }

  private async generateConfluencePage(
    operation: any,
    operationName: string,
    options: GenerateOptions,
    operationFile: string,
  ): Promise<void> {
    const targetEnv = getTargetEnvironment(options);
    const operationDir = dirname(operationFile);
    const confluenceContent = this.createConfluenceContent(
      operation,
      options.resolveVars,
      options.gantt,
      targetEnv,
      operationDir,
    );
    const outputFile =
      options.output || `confluence/${operationName}.confluence`;

    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, confluenceContent);
    console.log(`✅ Confluence content generated: ${outputFile}`);
    console.log('💡 Upload this content to your Confluence space');
  }

  private async generateADFDocs(
    operation: any,
    operationName: string,
    options: GenerateOptions,
    operationFile: string,
  ): Promise<void> {
    const targetEnv = getTargetEnvironment(options);
    const operationDir = dirname(operationFile);
    const metadata = await createGenerationMetadata(
      operationName,
      operation.id,
      operation.version,
      targetEnv,
    );

    const adfContent = generateADFString(
      operation,
      metadata,
      targetEnv,
      options.resolveVars,
      operationDir,
    );
    const envSuffix = targetEnv ? `-${targetEnv}` : '';
    const outputFile =
      options.output || `adf/${operationName}${envSuffix}.json`;

    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, adfContent);
    console.log(`✅ ADF (Atlassian Document Format) generated: ${outputFile}`);
    console.log(
      '💡 Import this JSON file into Confluence using the ADF importer',
    );
  }

  private createMarkdownDocumentation(operation: any): string {
    const envList = operation.environments
      .map((env: any) => env.name)
      .join(', ');
    const stepCount = operation.steps.length;

    return `# ${operation.name}

## Overview
**Version**: ${operation.version}
**Description**: ${operation.description}
**Author**: ${operation.author || 'Not specified'}
**Category**: ${operation.category || 'Not specified'}
**Environments**: ${envList}

## Summary
- **Steps**: ${stepCount}
- **Emergency Operation**: ${operation.emergency ? 'Yes' : 'No'}
- **Rollback Available**: ${operation.rollback ? 'Yes' : 'No'}

## Environments

${operation.environments
  .map(
    (env: any) => `
### ${env.name}
**Description**: ${env.description}
**Approval Required**: ${env.approval_required ? 'Yes' : 'No'}
**Validation Required**: ${env.validation_required ? 'Yes' : 'No'}

**Variables**:
${Object.entries(env.variables || {})
  .map(([key, value]) => `- \`${key}\`: ${value}`)
  .join('\n')}

${env.restrictions?.length ? `**Restrictions**: ${env.restrictions.join(', ')}` : ''}
`,
  )
  .join('')}

## Execution Steps

${operation.steps
  .map(
    (step: any, index: number) => `
### ${index + 1}. ${step.name}
**Type**: ${step.type}
${step.description ? `**Description**: ${step.description}` : ''}

${
  step.command
    ? `**Command**:
\`\`\`bash
${step.command}
\`\`\``
    : ''
}

${
  step.instruction
    ? `**Instructions**:
${step.instruction}`
    : ''
}

${step.timeout ? `**Timeout**: ${step.timeout}s` : ''}
${step.estimated_duration ? `**Estimated Duration**: ${step.estimated_duration}s` : ''}
${step.evidence?.required ? `**Evidence Required**: ${step.evidence.types?.join(', ') || 'Yes'}` : ''}
${step.continue_on_error ? `**Continue on Error**: Yes` : ''}

${(() => {
  const rbs = (step.rollback ?? []).filter(hasRollbackContent);
  if (rbs.length === 0) return '';
  return `**Rollback**:\n${rbs
    .map(
      (rb: any) =>
        `${rb.command ? `\`${rb.command}\`` : rb.instruction || 'See rollback instructions'}`,
    )
    .join('\n')}`;
})()}
`,
  )
  .join('')}

${
  operation.rollback
    ? `
## Rollback Plan

**Automatic**: ${operation.rollback.automatic ? 'Yes' : 'No'}

${
  operation.rollback.steps
    ?.map((step: any, index: number) =>
      renderRollbackDocStep(step, `${index + 1}`),
    )
    .join('') || ''
}

${operation.rollback.conditions?.length ? `**Conditions**: ${operation.rollback.conditions.join(', ')}` : ''}
`
    : ''
}

## Notes
- Generated on: ${new Date().toISOString()}
- Source file: ${operation.metadata?.source || 'Unknown'}
- Git hash: ${operation.metadata?.git_hash || 'Unknown'}

---
*This documentation was automatically generated by SAMARITAN*
`;
  }

  private markdownToHtml(markdown: string, title: string): string {
    // Simple markdown to HTML conversion (basic implementation)
    const html = markdown
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/\n\n/g, '</p><p>')
      .replace(
        /```bash\n([\s\S]*?)```/g,
        '<pre><code class="bash">$1</code></pre>',
      )
      .replace(/```\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

    return `<!DOCTYPE html>
<html>
<head>
    <title>${title} - SAMARITAN Documentation</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        h1 { color: #2c3e50; border-bottom: 2px solid #3498db; }
        h2 { color: #34495e; border-bottom: 1px solid #bdc3c7; }
        h3 { color: #7f8c8d; }
        code { background: #f8f9fa; padding: 2px 4px; border-radius: 3px; }
        pre { background: #f8f9fa; padding: 15px; border-radius: 5px; overflow-x: auto; }
        .bash { color: #d63384; }
    </style>
</head>
<body>
    <p>${html}</p>
</body>
</html>`;
  }

  private createConfluenceContent(
    operation: any,
    resolveVars: boolean = false,
    includeGantt: boolean = false,
    targetEnvironment?: string,
    operationDir?: string,
  ): string {
    return generateConfluenceContent(
      operation,
      resolveVars,
      includeGantt,
      targetEnvironment,
      operationDir,
    );
  }

  async generateSchedule(
    operationFile: string,
    options: GenerateOptions,
  ): Promise<void> {
    console.log(`📅 Generating schedule for: ${operationFile}`);

    const operation = await parseOperation(operationFile);
    const schedule = this.createGanttSchedule(operation);
    const outputFile =
      options.output ||
      `schedules/${basename(operationFile, '.yaml')}-schedule.md`;

    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, schedule);
    console.log(`✅ Schedule generated: ${outputFile}`);
  }

  private createGanttSchedule(operation: any): string {
    // Collect all steps with timeline information (including substeps)
    const stepsWithTimeline = collectAllStepsWithTimelineForConfluence(
      operation.steps,
    );

    if (stepsWithTimeline.length === 0) {
      return `# Schedule for: ${operation.name}\n\nNo steps with timeline information found.\n\nTo add timeline data, add a \`timeline\` field to your steps:\n\`\`\`yaml\nsteps:\n  - name: My Step\n    timeline:\n      start: 2025-10-21 09:00\n      duration: 30m\n\`\`\`\n`;
    }

    let markdown = `# Schedule for: ${operation.name}\n\n`;

    // Add summary info
    const totalSteps = stepsWithTimeline.length;
    markdown += `**Total Steps with Timeline**: ${totalSteps}\n\n`;

    // Generate table header
    markdown += '| Step Name | Phase | Start Time | Duration | PIC |\n';
    markdown += '|-----------|-------|------------|----------|-----|\n';

    // Track calculated times for dependency resolution
    const stepTimes: Record<string, { start: string; end: string }> = {};

    // Helper to parse duration to minutes
    const parseDuration = (duration: string): number => {
      const match = duration.match(/^(\d+)(m|h|d|w)$/);
      if (!match) return 0;
      const value = Number.parseInt(match[1], 10);
      const unit = match[2];
      switch (unit) {
        case 'm':
          return value;
        case 'h':
          return value * 60;
        case 'd':
          return value * 60 * 24;
        case 'w':
          return value * 60 * 24 * 7;
        default:
          return 0;
      }
    };

    // Helper to add minutes to a time string
    const addMinutes = (timeStr: string, minutes: number): string => {
      try {
        const date = new Date(timeStr);
        date.setMinutes(date.getMinutes() + minutes);
        return date.toISOString().slice(0, 16).replace('T', ' ');
      } catch {
        return timeStr;
      }
    };

    // Process each step
    stepsWithTimeline.forEach((step: any) => {
      const timeline = step.timeline;
      const phase = step.phase || 'flight';
      const pic = step.pic || '-';

      let startTime = '-';
      let duration = '-';

      if (typeof timeline === 'string') {
        // Legacy string format - try to extract info
        startTime = timeline;
        duration = '-';
      } else if (typeof timeline === 'object') {
        // Structured format
        if (timeline.start) {
          startTime = timeline.start;
        } else if (timeline.after && stepTimes[timeline.after]) {
          // Calculate based on dependency
          startTime = stepTimes[timeline.after].end;
        }

        if (timeline.duration) {
          duration = timeline.duration;

          // Calculate end time if we have both start and duration
          if (startTime !== '-') {
            const durationMinutes = parseDuration(timeline.duration);
            const endTime = addMinutes(startTime, durationMinutes);
            stepTimes[step.name] = { start: startTime, end: endTime };
          }
        }
      }

      // Add row to table
      markdown += `| ${step.name} | ${phase} | ${startTime} | ${duration} | ${pic} |\n`;
    });

    markdown += '\n';

    // Add footer with generation time
    markdown += `\n---\n\n*Generated: ${new Date().toISOString()}*\n`;

    return markdown;
  }
}

/**
 * Recursively collect all steps with timeline information, including nested sub-steps
 */
function collectAllStepsWithTimelineForConfluence(steps: any[]): any[] {
  const result: any[] = [];

  function traverse(step: any) {
    if (step.timeline) {
      result.push(step);
    }
    if (step.sub_steps && step.sub_steps.length > 0) {
      step.sub_steps.forEach(traverse);
    }
  }

  steps.forEach(traverse);
  return result;
}

// Export as standalone function for testing
export function generateConfluenceContent(
  operation: any,
  resolveVars: boolean = false,
  includeGantt: boolean = false,
  targetEnvironment?: string,
  operationDir?: string,
): string {
  // Filter environments if specified
  let environments = operation.environments;
  if (targetEnvironment) {
    environments = operation.environments.filter(
      (env: any) => env.name === targetEnvironment,
    );
    if (environments.length === 0) {
      throw new Error(
        `Environment '${targetEnvironment}' not found in operation. Available: ${operation.environments.map((e: any) => e.name).join(', ')}`,
      );
    }
  }

  // Create filtered operation for generation
  // Filter steps whose 'when' condition doesn't match any active environment
  const environmentNames = environments.map((e: any) => e.name);
  const filteredOperation = {
    ...operation,
    environments,
    steps: filterStepsForEnvironments(operation.steps, environmentNames),
  };

  // When aggregate_step_rollbacks is on, per-step rollbacks are centralized in
  // the Rollback Plan (with {anchor} jump targets) and inline rollbacks collapse
  // to jump-links into it.
  const aggregateRollbacks =
    operation.rollback?.aggregate_step_rollbacks === true;

  // Use Confluence emoticons instead of Unicode emojis for better compatibility
  const phaseIcons = {
    preflight: '(/)',
    flight: '(!)',
    postflight: '(on)',
  };

  const typeIcons: Record<string, string> = {
    automatic: '(*)',
    manual: '(i)',
    approval: '(x)',
    conditional: '(?)',
  };

  // Emoji replacement map for inline usage
  const emojiMap: Record<string, string> = {
    '👤': '(i)', // PIC (person)
    '⏱️': '(time)', // Timeline (doesn't exist, use text)
    '📋': '(-)', // Depends on (checklist)
    '🎫': '(flag)', // Tickets
    '🔀': '(?)', // Condition
  };

  // Helper to replace Unicode emojis with Confluence emoticons
  const _replaceEmojis = (text: string): string => {
    let result = text;
    for (const [emoji, emoticon] of Object.entries(emojiMap)) {
      result = result.replace(new RegExp(emoji, 'g'), emoticon);
    }
    return result;
  };

  // Helper to convert markdown links to Confluence format
  const convertLinksToConfluence = (text: string): string => {
    // Convert markdown links [text](url) to Confluence format [text|url]
    return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '[$1|$2]');
  };

  // Helper to escape Confluence macro syntax in text (for variables like ${VAR})
  const escapeConfluenceMacros = (text: string | undefined): string => {
    if (!text) return '';
    // First convert markdown links to Confluence format
    const result = convertLinksToConfluence(text);
    // Then escape { and } to prevent Confluence from interpreting ${VAR} as macros
    return result.replace(/\{/g, '\\{').replace(/\}/g, '\\}');
  };

  // Resolve ${VAR} placeholders (e.g. in foreach-expanded step names) against
  // common variables + the step's own variables when --resolve-vars is set.
  // MUST run BEFORE escapeConfluenceMacros, which escapes { and } and would
  // otherwise prevent ${VAR} patterns from matching.
  const resolveStepName = (
    name: string,
    stepVariables?: Record<string, any>,
  ): string =>
    resolveVars
      ? substituteVariables(
          name,
          operation.common_variables ?? {},
          stepVariables,
        )
      : name;

  // Helper to format evidence area
  const formatEvidenceArea = (
    evidence: any,
    environmentName?: string,
    operationDir?: string,
  ): string => {
    if (!evidence) return '';

    const types = evidence.types || [];
    const typesText = types.length > 0 ? ` - ${types.join(', ')}` : '';
    const status = evidence.required ? 'Required' : 'Optional';

    // Don't show evidence in step column - it goes in environment columns
    if (!environmentName) {
      return '';
    }

    // Render evidence for specific environment (with expand block)
    let content = `\n{expand:title=📎 Evidence (${status}${typesText})}`;

    // Check if we have captured evidence results for this environment
    const envResults = evidence.results?.[environmentName];
    if (envResults && envResults.length > 0) {
      // Render captured evidence results directly (no "Captured Evidence:" label)
      for (const evidenceResult of envResults) {
        content += '\n';

        // Add description if present
        if (evidenceResult.description) {
          content += `\n*${evidenceResult.type}:* ${evidenceResult.description}`;
        } else {
          content += `\n*${evidenceResult.type}:*`;
        }

        // Render based on storage type
        if (evidenceResult.file) {
          // For text-based evidence (command_output, log), read and embed file content
          if (
            (evidenceResult.type === 'command_output' ||
              evidenceResult.type === 'log') &&
            operationDir
          ) {
            try {
              const fs = require('node:fs');
              const path = require('node:path');
              const filePath = path.resolve(operationDir, evidenceResult.file);
              const fileContent = fs.readFileSync(filePath, 'utf-8');
              const language =
                evidenceResult.type === 'command_output' ? 'bash' : 'text';
              content += `\n{code:${language}}\n${fileContent}\n{code}`;
            } catch (_error) {
              // Fallback to link if file can't be read
              content += `\n[View ${evidenceResult.type}|${evidenceResult.file}] _(error reading file)_`;
            }
          }
          // For screenshots/photos, show as attached file reference
          else if (
            evidenceResult.type === 'screenshot' ||
            evidenceResult.type === 'photo'
          ) {
            content += `\n!${evidenceResult.file}!`;
          }
          // For other file types, render as link
          else {
            content += `\n[View ${evidenceResult.type}|${evidenceResult.file}]`;
          }
        } else if (evidenceResult.content) {
          // Inline content - render in code block
          const language =
            evidenceResult.type === 'command_output' ? 'bash' : 'text';
          content += `\n{code:${language}}\n${evidenceResult.content}\n{code}`;
        }
      }
    } else {
      // No results - show a command_output capture prompt
      if (types.includes('command_output')) {
        content += '\n{code:bash}\n# Paste command output here\n{code}';
      }
    }

    content += '\n{expand}';
    return content;
  };

  // Helper to format multi-line text for Confluence table cells
  const formatForTableCell = (
    text: string,
    _useCodeBlock: boolean = true,
  ): string => {
    const hasMultipleLines = text.includes('\n');

    if (!hasMultipleLines) {
      return text;
    }

    // Check if content contains list patterns (numbered or bulleted)
    const hasNumberedList = /\n\d+\.\s/.test(text);
    const hasBulletList = /\n[-*]\s/.test(text);

    if (hasNumberedList || hasBulletList) {
      // Convert markdown list syntax to Confluence wiki markup
      return text
        .replace(/\n(\d+)\.\s/g, '\n# ') // Convert "1. " to "# "
        .replace(/\n[-*]\s/g, '\n* '); // Convert "- " or "* " to "* "
    }

    // In Confluence table cells, use actual newlines (not \\ escape sequences)
    return text;
  };

  // Helper to add smart line breaks for long commands
  const addSmartLineBreaks = (
    command: string,
    maxLength: number = 100,
  ): string => {
    if (command.length <= maxLength) {
      return command;
    }

    // Break at logical points: pipes, operators, common flags
    // In Confluence table cells, use actual newlines (not \\ escape sequences)
    const result = command
      .replace(/ \| /g, ' |\n  ') // Break before pipes
      .replace(/ && /g, ' &&\n  ') // Break before &&
      .replace(/ \|\| /g, ' ||\n  ') // Break before ||
      .replace(/ --context /g, '\n  --context ') // Break before --context
      .replace(/ --namespace /g, '\n  --namespace ') // Break before --namespace
      .replace(/ -n /g, '\n  -n ') // Break before -n flag
      .replace(/ -f /g, '\n  -f ') // Break before -f flag
      .replace(/ -o /g, '\n  -o '); // Break before -o flag

    return result;
  };

  // Build header panel
  let content = `{panel:title=${filteredOperation.name} - Operation Documentation|borderStyle=solid|borderColor=#0052CC|titleBGColor=#DEEBFF|bgColor=#fff}

h2. Overview
*Version:* ${filteredOperation.version}
*Description:* ${filteredOperation.description}
*Author:* ${filteredOperation.author || 'Not specified'}
${filteredOperation.category ? `*Category:* ${filteredOperation.category}` : ''}
*Environments:* ${filteredOperation.environments.map((e: any) => e.name).join(', ')}
${filteredOperation.emergency ? '*Emergency Operation:* {status:colour=Red|title=YES}' : ''}

{panel}

{toc}

`;

  // Add Gantt chart if requested and steps have timeline data
  if (includeGantt) {
    const stepsWithTimeline = collectAllStepsWithTimelineForConfluence(
      filteredOperation.steps,
    );

    if (stepsWithTimeline.length === 0) {
      console.warn(
        '⚠️  --gantt flag provided but no timeline data found in steps. Gantt chart will not be generated.',
      );
    } else {
      content += `h2. Timeline Schedule

{markdown} \`\`\`mermaid
gantt
    title ${filteredOperation.name} Timeline
    dateFormat YYYY-MM-DD HH:mm
    axisFormat %m-%d %H:%M

`;
      // Note: Opening {markdown} tag must be on same line as ```mermaid for Confluence rendering

      // Group steps by phase (block-aware: `uses:` blocks stay contiguous)
      const ganttPhases = groupByPhase<Step>(stepsWithTimeline, (step) => step);

      // Generate sections for each phase
      // Note: Emojis removed from section names as Mermaid doesn't render them correctly in Confluence
      const ganttPhaseNames = {
        preflight: 'Pre-Flight Phase',
        flight: 'Flight Phase',
        postflight: 'Post-Flight Phase',
      };

      let previousStepName: string | null = null;

      Object.entries(ganttPhases).forEach(([phaseName, phaseSteps]) => {
        if (phaseSteps.length === 0) return;

        content += `    section ${ganttPhaseNames[phaseName as keyof typeof ganttPhaseNames]}\n`;

        phaseSteps.forEach((step: any) => {
          const taskName = step.name.replace(/:/g, ''); // Remove colons as they break Mermaid syntax
          const pic = step.pic ? ` (${step.pic})` : '';

          // Convert timeline to Mermaid syntax
          let timelineSyntax = '';
          if (step.timeline) {
            if (typeof step.timeline === 'string') {
              // Legacy string format - use as-is
              timelineSyntax = step.timeline;
            } else {
              // Structured format - convert to Mermaid syntax
              const parts: string[] = [];

              // Add status if specified
              if (step.timeline.status) {
                parts.push(step.timeline.status);
              }

              // Determine start point
              if (step.timeline.start) {
                // Absolute start time
                parts.push(step.timeline.start);
              } else if (step.timeline.after) {
                // Explicit dependency
                parts.push(`after ${step.timeline.after.replace(/:/g, '')}`);
              } else if (previousStepName) {
                // Auto-dependency on previous step
                parts.push(`after ${previousStepName}`);
              }

              // Add duration
              if (step.timeline.duration) {
                parts.push(step.timeline.duration);
              }

              timelineSyntax = parts.join(', ');
            }
          }

          content += `    ${taskName}${pic} :${timelineSyntax}\n`;

          // Track previous step name for auto-dependency
          previousStepName = taskName;
        });
        content += '\n';
      });

      // Note: Closing ``` and {markdown} must be on separate lines for Confluence rendering
      content += `\`\`\`
{markdown}

`;
    }
  }

  // Dependencies section
  if (filteredOperation.needs && filteredOperation.needs.length > 0) {
    content += `h2. Dependencies

{info}This operation depends on the following operations being completed first:{info}

${filteredOperation.needs.map((dep: string) => `* *${dep}*`).join('\n')}

`;
  }

  // Environments table
  content += `h2. Environments

|| Environment || Description || Approval Required || Validation Required || Targets || Variables ||
${filteredOperation.environments
  .map((env: any) => {
    const varCount = Object.keys(env.variables || {}).length;
    const varsText = Object.entries(env.variables || {})
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join('\n');
    const varsCell =
      varCount > 0
        ? `{expand:title=Show ${varCount} variables}${varsText}{expand}`
        : '-';
    return `| ${env.name} | ${env.description || '-'} | ${env.approval_required ? '{status:colour=Yellow|title=YES}' : 'No'} | ${env.validation_required ? 'Yes' : 'No'} | ${env.targets?.join(', ') || '-'} | ${varsCell} |`;
  })
  .join('\n')}

`;

  // Group steps by phase, preserving original indices for consistent step
  // numbers (block-aware: `uses:` blocks stay contiguous so a reused block's
  // preflight checks render next to the block, not hoisted to the top)
  const stepEntries = operation.steps
    .map((step: any, i: number) => ({ step, stepNumber: i + 1 }))
    .filter(
      ({ step }: { step: any }) =>
        !step.when ||
        step.when.length === 0 ||
        step.when.some((e: string) => environmentNames.includes(e)),
    );
  const phases = groupByPhase(
    stepEntries,
    (entry: { step: Step; stepNumber: number }) => entry.step,
  );

  // Generate steps by phase with multi-column table
  Object.entries(phases).forEach(([phaseName, phaseSteps]) => {
    if (phaseSteps.length === 0) return;

    const phaseHeaders: Record<string, string> = {
      preflight: 'Pre-Flight Phase',
      flight: 'Flight Phase (Main Operations)',
      postflight: 'Post-Flight Phase',
    };

    const phaseIcon = phaseIcons[phaseName as keyof typeof phaseIcons] || '';

    content += `h2. ${phaseIcon} ${phaseHeaders[phaseName]}

`;

    // Only build initial table header if first step is not a section heading
    const firstStepIsSection =
      phaseSteps.length > 0 && phaseSteps[0].step.section_heading;
    let tableOpen = false;

    if (!firstStepIsSection) {
      // Build table header with environment columns
      content += `|| Step ||`;
      filteredOperation.environments.forEach((env: any) => {
        content += ` ${env.name} ||`;
      });
      content += '\n';
      tableOpen = true;
    }

    // Build table rows for each step
    phaseSteps.forEach(
      ({ step, stepNumber }: { step: any; stepNumber: number }) => {
        // Handle section heading
        if (step.section_heading) {
          // Close current table if one is open
          if (tableOpen) {
            content += '\n';
            tableOpen = false;
          }

          // Add section heading
          content += `h3. ${escapeConfluenceMacros(resolveStepName(step.name, step.variables))}\n\n`;
          if (step.description) {
            content += `${escapeConfluenceMacros(resolveStepName(step.description, step.variables))}\n\n`;
          }

          // Reopen table
          content += `|| Step ||`;
          filteredOperation.environments.forEach((env: any) => {
            content += ` ${env.name} ||`;
          });
          content += '\n';
          tableOpen = true;
        } else if (!tableOpen) {
          // Open table for regular steps if not already open (e.g., after rollback closed it)
          content += `|| Step ||`;
          filteredOperation.environments.forEach((env: any) => {
            content += ` ${env.name} ||`;
          });
          content += '\n';
          tableOpen = true;
        }

        const typeIcon = typeIcons[step.type] || '';
        const phaseIconForStep =
          step.phase && step.phase !== phaseName
            ? phaseIcons[step.phase as keyof typeof phaseIcons] || ''
            : '';

        // Build step info cell (escape braces to prevent macro interpretation)
        let stepInfo = `${phaseIconForStep}${typeIcon} Step ${stepNumber}: ${escapeConfluenceMacros(resolveStepName(step.name, step.variables))}`;
        if (step.description)
          stepInfo += `\n${escapeConfluenceMacros(resolveStepName(step.description, step.variables))}`;
        if (step.pic)
          stepInfo += `\n(i) PIC: [~${escapeConfluenceMacros(step.pic)}]`;
        if (step.reviewer)
          stepInfo += `\n(/) Reviewer: [~${escapeConfluenceMacros(step.reviewer)}]`;
        if (step.timeline)
          stepInfo += `\n(time) Timeline: ${escapeConfluenceMacros(formatTimelineForDisplay(step.timeline))}`;
        if (step.needs && step.needs.length > 0)
          stepInfo += `\n(-) Depends on: ${escapeConfluenceMacros(step.needs.join(', '))}`;
        if (step.ticket)
          stepInfo += `\n(flag) Tickets: ${escapeConfluenceMacros(Array.isArray(step.ticket) ? step.ticket.join(', ') : step.ticket)}`;
        if (step.if)
          stepInfo += `\n(?) Condition: ${escapeConfluenceMacros(step.if)}`;

        // Add evidence metadata (not environment-specific) to step column
        if (step.evidence) {
          stepInfo += formatEvidenceArea(step.evidence);
        }

        // Build all command cells for each environment
        const commandCells: string[] = [];
        filteredOperation.environments.forEach((env: any) => {
          // Check if step should be rendered for this environment
          if (!shouldRenderStepForEnvironment(step, env.name)) {
            commandCells.push('—');
            return;
          }

          let cellContent = '';

          // Get step-level options (defaults)
          const substituteVars = step.options?.substitute_vars ?? true;
          const showCommandSeparately =
            step.options?.show_command_separately ?? false;

          // Process instruction (always render as markdown)
          if (step.instruction) {
            let displayInstruction = step.instruction;

            // Apply variable substitution if enabled
            if (resolveVars && substituteVars) {
              displayInstruction = substituteVariables(
                displayInstruction,
                env.variables || {},
                step.variables,
              );
            }

            const trimmed = displayInstruction.replace(/\s+$/, '');
            cellContent += `*Instructions:*\n{markdown}\n${trimmed}\n{markdown}`;
          }

          // Process command (always render as code block)
          if (step.command) {
            let displayCommand = step.command;

            // Apply variable substitution if enabled
            if (resolveVars && substituteVars) {
              displayCommand = substituteVariables(
                displayCommand,
                env.variables || {},
                step.variables,
              );
            }

            const trimmedCommand = displayCommand.replace(/\n+$/, '');

            // Show command separately or inline
            if (showCommandSeparately && step.instruction) {
              // Show command in separate labeled section
              cellContent += `\n*Command:*\n{code:bash}\n${trimmedCommand}\n{code}`;
            } else if (!step.instruction) {
              // No instruction, just show command
              cellContent += `{code:bash}\n${trimmedCommand}\n{code}`;
            } else {
              // Both present, inline mode: show command after instruction
              cellContent += `\n{code:bash}\n${trimmedCommand}\n{code}`;
            }
          }

          // Process script (external shell script file)
          if (step.script) {
            const sep = cellContent ? '\n' : '';
            cellContent += `${sep}*Script:* \`${step.script}\``;
            if (operationDir) {
              try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const fs = require('node:fs');
                const nodePath = require('node:path');
                const scriptPath = nodePath.resolve(operationDir, step.script);
                const scriptContent = fs
                  .readFileSync(scriptPath, 'utf-8')
                  .trimEnd();
                cellContent += `\n{code:bash}\n${scriptContent}\n{code}`;
              } catch {
                cellContent += ' _(file not found)_';
              }
            }
          }

          // Add expect assertions
          if (step.expect != null) {
            const resolvedExpect =
              resolveVars && substituteVars
                ? substituteExpectVars(
                    step.expect,
                    env.variables || {},
                    step.variables,
                  )
                : step.expect;
            const parts = renderExpectParts(resolvedExpect);
            if (parts.length > 0) {
              const sep = cellContent ? '\n' : '';
              cellContent += `${sep}*Expected:*`;
              for (const p of parts) cellContent += `\n* [ ] _${p}_`;
            }
          }

          // Fallback for steps with neither
          if (!cellContent) {
            if (step.sub_steps && step.sub_steps.length > 0) {
              cellContent = '_(see substeps below)_';
            } else {
              cellContent = `_(${step.type} step)_`;
            }
          }

          // Add sign-off checkboxes if PIC or Reviewer is set (interactive checkboxes)
          if (step.pic || step.reviewer) {
            cellContent += '\nSign-off:';
            if (step.pic) {
              cellContent += '\n* [ ] PIC';
            }
            if (step.reviewer) {
              cellContent += '\n* [ ] Reviewer';
            }
          }

          // Add evidence area with environment-specific results
          if (step.evidence) {
            cellContent += formatEvidenceArea(
              step.evidence,
              env.name,
              operationDir,
            );
          }

          commandCells.push(cellContent);
        });

        // Construct complete row with all cells
        content += `| ${stepInfo} | ${commandCells.join(' | ')} |\n`;

        // Add sub-steps in table format (recursive)
        if (step.sub_steps && step.sub_steps.length > 0) {
          content += addConfluenceSubStepRows(
            step.sub_steps,
            filteredOperation.environments,
            `${stepNumber}`,
            1,
            resolveVars,
            typeIcons,
            escapeConfluenceMacros,
            substituteVariables,
            formatForTableCell,
            addSmartLineBreaks,
            formatEvidenceArea,
            formatTimelineForDisplay,
            operationDir,
            operation.common_variables ?? {},
            aggregateRollbacks,
          );
        }

        // Render rollback for step AFTER all content (inline rendering).
        // For parent steps with sub_steps, this renders after sub-steps; for
        // regular steps, after the step row. Renders EVERY entry (foreach-
        // expanded or hand-authored siblings), not just [0].
        const stepRollbacks = (step.rollback ?? []).filter(hasRollbackContent);
        if (aggregateRollbacks && stepRollbacks.length > 0) {
          // Collapse the inline block to a single jump-link into the bottom
          // Rollback Plan (the {anchor} target lives there).
          content += `\n(<) *Rollback:* [Rollback for Step ${stepNumber} |#${stepRollbackAnchor(step)}]\n\n`;
          tableOpen = false;
          return;
        }
        stepRollbacks.forEach((rb: any, rbIndex: number) => {
          // Disambiguate multiple entries in the heading via the rollback
          // step's own (foreach-suffixed) name; single-entry output unchanged.
          const rbHeadingName =
            stepRollbacks.length > 1
              ? `${resolveStepName(step.name, step.variables)} — ${rb.name ? resolveStepName(rb.name, { ...step.variables, ...rb.variables }) : `Rollback ${rbIndex + 1}`}`
              : resolveStepName(step.name, step.variables);
          content += renderInlineRollback(
            rb,
            `${stepNumber}`,
            rbHeadingName,
            3, // h3 for parent steps
            filteredOperation.environments,
            resolveVars,
            step.variables,
            escapeConfluenceMacros,
            substituteVariables,
            formatEvidenceArea,
            operationDir,
          );
          // Rollback closes the table, so mark it as closed
          tableOpen = false;
        });
      },
    );

    content += '\n';
  });

  // Global rollback section if available. aggregate_step_rollbacks groups the
  // per-step rollbacks (reverse step order) in after the explicit plan steps.
  const globalRollbackSteps = buildEffectiveRollback(
    filteredOperation.rollback,
    filteredOperation.steps,
  );
  if (filteredOperation.rollback && globalRollbackSteps.length > 0) {
    content += `h2. (<) Rollback Procedures

{warning}If deployment fails, execute the following rollback steps:{warning}

h3. Rollback Plan

*Automatic*: ${filteredOperation.rollback.automatic ? 'Yes' : 'No'}
${filteredOperation.rollback.conditions?.length ? `*Conditions*: ${filteredOperation.rollback.conditions.join(', ')}\n` : ''}

|| Step || ${filteredOperation.environments.map((e: any) => `${e.name} ||`).join(' ')}
`;

    const buildRollbackCells = (rollbackStep: any): string[] => {
      const rollbackCells: string[] = [];

      filteredOperation.environments.forEach((env: any) => {
        let cellContent = '';

        // Get rollback options (defaults)
        const substituteVars = rollbackStep.options?.substitute_vars ?? true;
        const showCommandSeparately =
          rollbackStep.options?.show_command_separately ?? false;

        // Process rollback instruction (always markdown)
        if (rollbackStep.instruction) {
          let displayInstruction = rollbackStep.instruction;

          if (resolveVars && substituteVars) {
            displayInstruction = substituteVariables(
              displayInstruction,
              env.variables || {},
              {},
            );
          }

          const trimmed = displayInstruction.replace(/\s+$/, '');
          cellContent += `*Instructions:*\n{markdown}\n${trimmed}\n{markdown}`;
        }

        // Process rollback command (always code block)
        if (rollbackStep.command) {
          let displayCommand = rollbackStep.command;

          if (resolveVars && substituteVars) {
            displayCommand = substituteVariables(
              displayCommand,
              env.variables || {},
              {},
            );
          }

          const trimmedCommand = displayCommand.replace(/\n+$/, '');

          if (showCommandSeparately && rollbackStep.instruction) {
            cellContent += `\n*Command:*\n{code:bash}\n${trimmedCommand}\n{code}`;
          } else if (!rollbackStep.instruction) {
            cellContent += `{code:bash}\n${trimmedCommand}\n{code}`;
          } else {
            cellContent += `\n{code:bash}\n${trimmedCommand}\n{code}`;
          }
        }

        // Process rollback script
        if (rollbackStep.script) {
          const sep = cellContent ? '\n' : '';
          cellContent += `${sep}*Script:* \`${rollbackStep.script}\``;
          if (operationDir) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const fs = require('node:fs');
              const nodePath = require('node:path');
              const scriptPath = nodePath.resolve(
                operationDir,
                rollbackStep.script,
              );
              const scriptContent = fs
                .readFileSync(scriptPath, 'utf-8')
                .trimEnd();
              cellContent += `\n{code:bash}\n${scriptContent}\n{code}`;
            } catch {
              cellContent += ' _(file not found)_';
            }
          }
        }

        // Add rollback expect assertions
        if (rollbackStep.expect != null) {
          const resolvedExpect =
            resolveVars && substituteVars
              ? substituteExpectVars(
                  rollbackStep.expect,
                  env.variables || {},
                  {},
                )
              : rollbackStep.expect;
          const parts = renderExpectParts(resolvedExpect);
          if (parts.length > 0) {
            const sep = cellContent ? '\n' : '';
            cellContent += `${sep}*Expected:*`;
            for (const p of parts) cellContent += `\n* [ ] _${p}_`;
          }
        }

        // Process rollback pic/reviewer sign-off
        if (rollbackStep.pic || rollbackStep.reviewer) {
          const sep = cellContent ? '\n' : '';
          cellContent += `${sep}*Sign-off:*`;
          if (rollbackStep.pic)
            cellContent += `\n- [ ] PIC (${rollbackStep.pic})`;
          if (rollbackStep.reviewer)
            cellContent += `\n- [ ] Reviewer (${rollbackStep.reviewer})`;
        }

        // Fallback
        if (!cellContent) {
          cellContent = '-';
        }

        // Add evidence area with environment-specific results for global rollback step
        if (rollbackStep.evidence) {
          cellContent += formatEvidenceArea(
            rollbackStep.evidence,
            env.name,
            operationDir,
          );
        }

        rollbackCells.push(cellContent);
      });

      return rollbackCells;
    };

    // Emit a table row per rollback step and recurse into its sub_steps so
    // nested rollback structure renders as Rollback Step N, N.M, N.M.K, …
    const emittedAnchors = new Set<string>();
    const emitRollbackRow = (rollbackStep: any, label: string): void => {
      const namedLabel = rollbackStep.name
        ? `${label}: ${rollbackStep.name}`
        : label;
      // Prepend the {anchor} macro once per source step so inline jump-links
      // resolve to this folded entry.
      let anchor = '';
      if (
        rollbackStep.sourceAnchor &&
        !emittedAnchors.has(rollbackStep.sourceAnchor)
      ) {
        emittedAnchors.add(rollbackStep.sourceAnchor);
        anchor = `{anchor:${rollbackStep.sourceAnchor}}`;
      }
      content += `| ${anchor}${namedLabel} | ${buildRollbackCells(rollbackStep).join(' | ')} |\n`;
      rollbackStep.sub_steps?.forEach((sub: any, subIndex: number) => {
        emitRollbackRow(sub, `${label}.${subIndex + 1}`);
      });
    };

    globalRollbackSteps.forEach((rollbackStep: any, index: number) => {
      emitRollbackRow(rollbackStep, `Rollback Step ${index + 1}`);
    });

    content += '\n';
  }

  // Footer with generation info
  content += `
----

{panel:title=Generated Information|borderStyle=solid|borderColor=#f0f0f0|bgColor=#FAFBFC}
*Generated on:* ${new Date().toISOString()}
*Generated by:* SAMARITAN CLI
{panel}
`;

  return content;
}

/**
 * Render inline rollback section for a step in Confluence format (DRY helper)
 */
function renderInlineRollback(
  rollback: any,
  stepId: string,
  stepName: string,
  parentHeadingLevel: number,
  environments: any[],
  resolveVars: boolean,
  stepVariables: any,
  escapeConfluenceMacros: (text: string) => string,
  substituteVariables: (
    command: string,
    envVars: Record<string, any>,
    stepVars?: Record<string, any>,
  ) => string,
  formatEvidenceArea: (
    evidence: any,
    environmentName?: string,
    operationDir?: string,
  ) => string,
  operationDir?: string,
): string {
  let content = '';

  // Close current table
  content += '\n';

  // Add rollback heading - one level deeper than parent (capped at h6)
  const rollbackHeadingLevel = Math.min(parentHeadingLevel + 1, 6);
  content += `h${rollbackHeadingLevel}. (<) Rollback for Step ${stepId}: ${escapeConfluenceMacros(stepName)}\n\n`;

  // Render rollback table with environment columns (consistent with regular steps)
  content += '|| Step ||';
  environments.forEach((env: any) => {
    content += ` ${env.name} ||`;
  });
  content += '\n';

  // Build one rollback step's cell content for an env, recursing into nested
  // sub_steps (rendered inline within the same cell). `bare` skips the fallback
  // dash so empty sub-steps are omitted.
  const buildCell = (rb: any, env: any, bare = false): string => {
    let cellContent = '';

    const substituteVars = rb?.options?.substitute_vars ?? true;
    const showCommandSeparately = rb?.options?.show_command_separately ?? false;

    if (rb?.instruction) {
      let displayInstruction = rb.instruction;
      if (resolveVars && substituteVars) {
        displayInstruction = substituteVariables(
          displayInstruction,
          env.variables || {},
          stepVariables,
        );
      }
      const trimmed = displayInstruction.replace(/\s+$/, '');
      cellContent += `*Instructions:*\n{markdown}\n${trimmed}\n{markdown}`;
    }

    if (rb?.command) {
      let displayCommand = rb.command;
      if (resolveVars && substituteVars) {
        displayCommand = substituteVariables(
          displayCommand,
          env.variables || {},
          stepVariables,
        );
      }
      const trimmedCommand = displayCommand.replace(/\n+$/, '');

      if (showCommandSeparately && rb.instruction) {
        cellContent += `\n*Command:*\n{code:bash}\n${trimmedCommand}\n{code}`;
      } else if (!rb.instruction) {
        cellContent += `{code:bash}\n${trimmedCommand}\n{code}`;
      } else {
        cellContent += `\n{code:bash}\n${trimmedCommand}\n{code}`;
      }
    }

    if (rb?.script) {
      const sep = cellContent ? '\n' : '';
      cellContent += `${sep}*Script:* \`${rb.script}\``;
      if (operationDir) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const fs = require('node:fs');
          const nodePath = require('node:path');
          const scriptPath = nodePath.resolve(operationDir, rb.script);
          const scriptContent = fs.readFileSync(scriptPath, 'utf-8').trimEnd();
          cellContent += `\n{code:bash}\n${scriptContent}\n{code}`;
        } catch {
          cellContent += ' _(file not found)_';
        }
      }
    }

    if (rb?.expect != null) {
      const resolvedExpect =
        resolveVars && (rb.options?.substitute_vars ?? true)
          ? substituteExpectVars(rb.expect, env.variables || {}, stepVariables)
          : rb.expect;
      const parts = renderExpectParts(resolvedExpect);
      if (parts.length > 0) {
        const sep = cellContent ? '\n' : '';
        cellContent += `${sep}*Expected:*`;
        for (const p of parts) cellContent += `\n* [ ] _${p}_`;
      }
    }

    if (rb?.pic || rb?.reviewer) {
      const sep = cellContent ? '\n' : '';
      cellContent += `${sep}*Sign-off:*`;
      if (rb.pic) cellContent += `\n- [ ] PIC (${rb.pic})`;
      if (rb.reviewer) cellContent += `\n- [ ] Reviewer (${rb.reviewer})`;
    }

    if (rb?.evidence) {
      cellContent += formatEvidenceArea(rb.evidence, env.name, operationDir);
    }

    // Nested rollback sub-steps render inline within the same cell
    rb?.sub_steps?.forEach((sub: any, i: number) => {
      const subContent = buildCell(sub, env, true);
      if (subContent) {
        const sep = cellContent ? '\n' : '';
        const subName = sub.name ? `: ${sub.name}` : '';
        cellContent += `${sep}*↳ ${i + 1}${subName}*\n${subContent}`;
      }
    });

    if (!bare && !cellContent) {
      cellContent = '-';
    }

    return cellContent;
  };

  // Build rollback row
  const rollbackCells: string[] = [];
  environments.forEach((env: any) => {
    rollbackCells.push(buildCell(rollback, env));
  });

  // Write single rollback row
  content += `| Rollback for: ${escapeConfluenceMacros(stepName)} | ${rollbackCells.join(' | ')} |\n`;

  content += '\n';

  // Don't reopen table here - let the next step/substep handle opening a new table if needed
  // This prevents empty table headers before section headings

  return content;
}

/**
 * Recursively add sub-step rows to Confluence Wiki Markup content
 * @param subSteps - Array of sub-steps to render
 * @param environments - Environments for command columns
 * @param stepPrefix - Current step numbering prefix (e.g., "1" or "1a")
 * @param depth - Current nesting depth (1 = first level, 2 = second level, etc.)
 * @param resolveVars - Whether to resolve variables
 * @param typeIcons - Map of step types to Confluence emoticons
 * @param escapeConfluenceMacros - Helper function to escape macros
 * @param substituteVariables - Helper function to substitute variables
 * @param formatForTableCell - Helper function to format table cells
 * @param addSmartLineBreaks - Helper function to add line breaks
 * @param formatEvidenceArea - Helper function to format evidence areas
 * @param formatTimelineForDisplay - Helper function to format timeline display
 * @param operationDir - Operation directory for reading evidence files
 * @param commonVariables - Operation-level common_variables for resolving step names
 * @returns Confluence Wiki Markup string for sub-steps
 */
function addConfluenceSubStepRows(
  subSteps: any[],
  environments: any[],
  stepPrefix: string,
  depth: number,
  resolveVars: boolean,
  typeIcons: Record<string, string>,
  escapeConfluenceMacros: (text: string) => string,
  substituteVariables: (
    command: string,
    envVariables: Record<string, any>,
    stepVariables?: Record<string, any>,
  ) => string,
  formatForTableCell: (text: string, useCodeBlock?: boolean) => string,
  addSmartLineBreaks: (command: string, maxLength?: number) => string,
  formatEvidenceArea: (
    evidence: any,
    environmentName?: string,
    operationDir?: string,
  ) => string,
  formatTimelineForDisplay: (timeline: any) => string,
  operationDir?: string,
  commonVariables?: Record<string, any>,
  linkRollbacks = false,
): string {
  // Resolve ${VAR} placeholders in sub-step names against common variables +
  // the sub-step's own variables when --resolve-vars is set. MUST run BEFORE
  // escapeConfluenceMacros, which escapes { and } and would otherwise prevent
  // ${VAR} patterns from matching.
  const resolveSubStepName = (
    name: string,
    stepVariables?: Record<string, any>,
  ): string =>
    resolveVars
      ? substituteVariables(name, commonVariables ?? {}, stepVariables)
      : name;
  let content = '';

  subSteps.forEach((subStep: any, subIndex: number) => {
    // Determine numbering based on depth
    // Odd depths (1, 3, 5): use letters (a, b, c)
    // Even depths (2, 4, 6): use numbers (1, 2, 3)
    let subStepId: string;
    if (depth % 2 === 1) {
      // Odd depth: use letters (supports unlimited with aa, ab, etc.)
      const letter = indexToLetters(subIndex);
      subStepId = `${stepPrefix}${letter}`;
    } else {
      // Even depth: use numbers
      subStepId = `${stepPrefix}${subIndex + 1}`;
    }

    const subTypeIcon = typeIcons[subStep.type] || '';

    // Handle section heading for sub-steps
    if (subStep.section_heading) {
      // Close current table
      content += '\n';

      // Add section heading with appropriate level based on depth
      // h4 for depth 1, h5 for depth 2-3, h6 for depth 4+
      // Formula: h4 + ceil((depth-1)/2), capped at h6
      const headingLevel = Math.min(4 + Math.ceil((depth - 1) / 2), 6);
      const headingPrefix = `h${headingLevel}.`;
      content += `${headingPrefix} ${escapeConfluenceMacros(resolveSubStepName(subStep.name, subStep.variables))}\n\n`;
      if (subStep.description) {
        content += `${escapeConfluenceMacros(resolveSubStepName(subStep.description, subStep.variables))}\n\n`;
      }

      // Reopen table
      content += `|| Step ||`;
      environments.forEach((env: any) => {
        content += ` ${env.name} ||`;
      });
      content += '\n';
    }

    let subStepInfo = `${subTypeIcon} Step ${subStepId}: ${escapeConfluenceMacros(resolveSubStepName(subStep.name, subStep.variables))}`;
    if (subStep.description)
      subStepInfo += `\n${escapeConfluenceMacros(resolveSubStepName(subStep.description, subStep.variables))}`;
    if (subStep.pic)
      subStepInfo += `\n(i) PIC: [~${escapeConfluenceMacros(subStep.pic)}]`;
    if (subStep.reviewer)
      subStepInfo += `\n(/) Reviewer: [~${escapeConfluenceMacros(subStep.reviewer)}]`;
    if (subStep.timeline)
      subStepInfo += `\n(time) Timeline: ${escapeConfluenceMacros(formatTimelineForDisplay(subStep.timeline))}`;
    if (subStep.needs && subStep.needs.length > 0)
      subStepInfo += `\n(-) Depends on: ${escapeConfluenceMacros(subStep.needs.join(', '))}`;
    if (subStep.ticket)
      subStepInfo += `\n(flag) Tickets: ${escapeConfluenceMacros(Array.isArray(subStep.ticket) ? subStep.ticket.join(', ') : subStep.ticket)}`;
    if (subStep.if)
      subStepInfo += `\n(?) Condition: ${escapeConfluenceMacros(subStep.if)}`;

    // Add evidence metadata (not environment-specific) to step column
    if (subStep.evidence) {
      subStepInfo += formatEvidenceArea(subStep.evidence);
    }

    // Build all command cells for sub-step
    const subCommandCells: string[] = [];
    environments.forEach((env: any) => {
      // Check if substep should be rendered for this environment
      if (!shouldRenderStepForEnvironment(subStep, env.name)) {
        subCommandCells.push('—');
        return;
      }

      // Merge variant for this environment (if exists)
      const effectiveSubStep = mergeStepVariant(subStep, env.name);

      let cellContent = '';

      // Get sub-step options (defaults) from effective substep
      const substituteVars = effectiveSubStep.options?.substitute_vars ?? true;
      const showCommandSeparately =
        effectiveSubStep.options?.show_command_separately ?? false;

      // Process instruction (always render as markdown)
      if (effectiveSubStep.instruction) {
        let displayInstruction = effectiveSubStep.instruction;

        if (resolveVars && substituteVars) {
          displayInstruction = substituteVariables(
            displayInstruction,
            env.variables || {},
            effectiveSubStep.variables,
          );
        }

        const trimmed = displayInstruction.replace(/\s+$/, '');
        cellContent += `*Instructions:*\n{markdown}\n${trimmed}\n{markdown}`;
      }

      // Process command (always render as code block)
      if (effectiveSubStep.command) {
        let displayCommand = effectiveSubStep.command;

        if (resolveVars && substituteVars) {
          displayCommand = substituteVariables(
            displayCommand,
            env.variables || {},
            effectiveSubStep.variables,
          );
        }

        const trimmedCommand = displayCommand.replace(/\n+$/, '');

        if (showCommandSeparately && effectiveSubStep.instruction) {
          cellContent += `\n*Command:*\n{code:bash}\n${trimmedCommand}\n{code}`;
        } else if (!effectiveSubStep.instruction) {
          cellContent += `{code:bash}\n${trimmedCommand}\n{code}`;
        } else {
          cellContent += `\n{code:bash}\n${trimmedCommand}\n{code}`;
        }
      }

      // Process script (external shell script file)
      if (effectiveSubStep.script) {
        const sep = cellContent ? '\n' : '';
        cellContent += `${sep}*Script:* \`${effectiveSubStep.script}\``;
        if (operationDir) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const fs = require('node:fs');
            const nodePath = require('node:path');
            const scriptPath = nodePath.resolve(
              operationDir,
              effectiveSubStep.script,
            );
            const scriptContent = fs
              .readFileSync(scriptPath, 'utf-8')
              .trimEnd();
            cellContent += `\n{code:bash}\n${scriptContent}\n{code}`;
          } catch {
            cellContent += ' _(file not found)_';
          }
        }
      }

      // Add expect assertions
      if (effectiveSubStep.expect != null) {
        const resolvedExpect =
          resolveVars && substituteVars
            ? substituteExpectVars(
                effectiveSubStep.expect,
                env.variables || {},
                effectiveSubStep.variables,
              )
            : effectiveSubStep.expect;
        const parts = renderExpectParts(resolvedExpect);
        if (parts.length > 0) {
          const sep = cellContent ? '\n' : '';
          cellContent += `${sep}*Expected:*`;
          for (const p of parts) cellContent += `\n* [ ] _${p}_`;
        }
      }

      // Fallback for sub-steps with neither
      if (!cellContent) {
        if (subStep.sub_steps && subStep.sub_steps.length > 0) {
          cellContent = '_(see substeps below)_';
        } else {
          cellContent = `_(${subStep.type} step)_`;
        }
      }

      // Add sign-off checkboxes if PIC or Reviewer is set (interactive checkboxes)
      if (subStep.pic || subStep.reviewer) {
        cellContent += '\nSign-off:';
        if (subStep.pic) {
          cellContent += '\n* [ ] PIC';
        }
        if (subStep.reviewer) {
          cellContent += '\n* [ ] Reviewer';
        }
      }

      // Add evidence area with environment-specific results
      if (subStep.evidence) {
        cellContent += formatEvidenceArea(
          subStep.evidence,
          env.name,
          operationDir,
        );
      }

      subCommandCells.push(cellContent);
    });

    // Construct complete row with all cells
    content += `| ${subStepInfo} | ${subCommandCells.join(' | ')} |\n`;

    // Recursively add nested sub-steps
    if (subStep.sub_steps && subStep.sub_steps.length > 0) {
      content += addConfluenceSubStepRows(
        subStep.sub_steps,
        environments,
        subStepId,
        depth + 1,
        resolveVars,
        typeIcons,
        escapeConfluenceMacros,
        substituteVariables,
        formatForTableCell,
        addSmartLineBreaks,
        formatEvidenceArea,
        formatTimelineForDisplay,
        operationDir,
        commonVariables,
        linkRollbacks,
      );

      // Render rollback for sub-step AFTER all nested sub-steps (inline
      // rendering). Renders EVERY entry, not just [0].
      const subRollbacks = (subStep.rollback ?? []).filter(hasRollbackContent);
      if (linkRollbacks && subRollbacks.length > 0) {
        // Collapse the inline block to a jump-link into the bottom Rollback Plan.
        content += `\n(<) *Rollback:* [Rollback for Step ${subStepId} |#${stepRollbackAnchor(subStep)}]\n\n`;
        return;
      }
      subRollbacks.forEach((subRb: any, subRbIndex: number) => {
        // Calculate parent heading level (same formula as section heading)
        const parentHeadingLevel = Math.min(4 + Math.ceil((depth - 1) / 2), 6);
        const subRbHeadingName =
          subRollbacks.length > 1
            ? `${resolveSubStepName(subStep.name, subStep.variables)} — ${subRb.name ? resolveSubStepName(subRb.name, { ...subStep.variables, ...subRb.variables }) : `Rollback ${subRbIndex + 1}`}`
            : resolveSubStepName(subStep.name, subStep.variables);
        content += renderInlineRollback(
          subRb,
          subStepId,
          subRbHeadingName,
          parentHeadingLevel,
          environments,
          resolveVars,
          subStep.variables,
          escapeConfluenceMacros,
          substituteVariables,
          formatEvidenceArea,
          operationDir,
        );
      });
    }
  });

  return content;
}

// Generate command with subcommands
const generateCommand = new Command('generate').description(
  'Generate documentation and reports',
);

generateCommand
  .command('manual <operation>')
  .description('Generate operation manual')
  .option('-o, --output <file>', 'Output file path')
  .option(
    '-f, --format <format>',
    'Output format (markdown, html, confluence, adf)',
    'markdown',
  )
  .option('-e, --env <environment>', 'Generate for specific environment')
  .option(
    '--all-envs',
    'Generate one manual per environment defined in the operation',
  )
  .option(
    '--output-dir <dir>',
    'Directory for --all-envs output (default: current directory)',
  )
  .option(
    '--prefix <name>',
    'Base filename for --all-envs output (default: operation file name); env name is appended as suffix',
  )
  .option(
    '--resolve-vars',
    'Resolve variables to actual values instead of showing placeholders',
  )
  .option('--gantt', 'Include Mermaid Gantt chart for timeline visualization')
  .option(
    '--run <manifest>',
    'Path to a run manifest YAML to overlay run-specific evidence',
  )
  .action(async (operation: string, options: GenerateOptions) => {
    try {
      const generator = new DocumentationGenerator();
      await generator.generateManual(operation, options);
    } catch (error: any) {
      console.error(`❌ Failed to generate manual: ${error.message}`);
      process.exit(1);
    }
  });

generateCommand
  .command('docs <operation>')
  .description('Generate comprehensive documentation')
  .option('-o, --output <file>', 'Output file path')
  .option(
    '-f, --format <format>',
    'Output format (markdown, html, confluence, adf, pdf)',
    'markdown',
  )
  .option('-e, --env <environment>', 'Generate for specific environment')
  .option(
    '--resolve-vars',
    'Resolve variables to actual values instead of showing placeholders',
  )
  .action(async (operation: string, options: GenerateOptions) => {
    try {
      const generator = new DocumentationGenerator();
      await generator.generateDocs(operation, options);
    } catch (error: any) {
      console.error(`❌ Failed to generate docs: ${error.message}`);
      process.exit(1);
    }
  });

generateCommand
  .command('postmortem <postmortem>')
  .description('Generate a postmortem / incident report (RCA) document')
  .option('-o, --output <file>', 'Output file path (default: stdout)')
  .option(
    '-f, --format <format>',
    'Output format (markdown, confluence, adf)',
    'markdown',
  )
  .action(async (postmortem: string, options: GenerateOptions) => {
    try {
      const generator = new DocumentationGenerator();
      await generator.generatePostmortem(postmortem, options);
    } catch (error: any) {
      console.error(`❌ Failed to generate postmortem: ${error.message}`);
      process.exit(1);
    }
  });

generateCommand
  .command('schedule <operation>')
  .description('Generate execution timeline and Gantt chart')
  .option('-o, --output <file>', 'Output file path')
  .action(async (operation: string, options: GenerateOptions) => {
    try {
      const generator = new DocumentationGenerator();
      await generator.generateSchedule(operation, options);
    } catch (error: any) {
      console.error(`❌ Failed to generate schedule: ${error.message}`);
      process.exit(1);
    }
  });

export { generateCommand };
