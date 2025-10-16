import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { Command } from 'commander';
import { createGenerationMetadata } from '../../lib/git-metadata';
import { generateADFString } from '../../manuals/adf-generator';
import { generateManualWithMetadata } from '../../manuals/generator';
import { parseOperation } from '../../operations/parser';

interface GenerateOptions {
  output?: string;
  format?: 'markdown' | 'confluence' | 'adf' | 'html' | 'pdf';
  env?: string; // Primary option: -e, --env
  environment?: string; // DEPRECATED: Legacy alias for backward compatibility
  resolveVars?: boolean;
  template?: string;
  gantt?: boolean;
}

// Helper to get target environment from options (handles both --env and legacy --environment)
function getTargetEnvironment(options: GenerateOptions): string | undefined {
  return options.env || options.environment;
}

class DocumentationGenerator {
  async generateManual(
    operationFile: string,
    options: GenerateOptions,
  ): Promise<void> {
    const targetEnv = getTargetEnvironment(options);
    const envSuffix = targetEnv ? ` (${targetEnv})` : '';
    const format = options.format || 'markdown';
    console.log(
      `📄 Generating manual for: ${operationFile}${envSuffix} (format: ${format})`,
    );

    // Parse operation
    const operation = await parseOperation(operationFile);
    const operationName = basename(operationFile, '.yaml');
    const envFileSuffix = targetEnv ? `-${targetEnv}` : '';

    switch (format) {
      case 'confluence':
        await this.generateConfluenceManual(
          operation,
          operationName,
          envFileSuffix,
          options,
        );
        break;
      case 'adf':
        await this.generateADFManual(
          operation,
          operationName,
          envFileSuffix,
          options,
        );
        break;
      case 'html':
        await this.generateHtmlManual(
          operation,
          operationName,
          envFileSuffix,
          options,
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

    // Generate manual with metadata and environment filtering
    const manual = generateManualWithMetadata(
      operation,
      metadata,
      targetEnv,
      options.resolveVars,
      options.gantt,
    );

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
  ): Promise<void> {
    const targetEnv = getTargetEnvironment(options);
    const confluenceContent = this.createConfluenceContent(
      operation,
      options.resolveVars,
      options.gantt,
      targetEnv,
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
  ): Promise<void> {
    const targetEnv = getTargetEnvironment(options);
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
  ): Promise<void> {
    const targetEnv = getTargetEnvironment(options);
    const metadata = await createGenerationMetadata(
      operationName,
      operation.id,
      operation.version,
      targetEnv,
    );

    const manual = generateManualWithMetadata(
      operation,
      metadata,
      targetEnv,
      options.resolveVars,
      options.gantt,
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
        await this.generateConfluencePage(operation, operationName, options);
        break;
      case 'adf':
        await this.generateADFDocs(operation, operationName, options);
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
  ): Promise<void> {
    const targetEnv = getTargetEnvironment(options);
    const confluenceContent = this.createConfluenceContent(
      operation,
      options.resolveVars,
      options.gantt,
      targetEnv,
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
  ): Promise<void> {
    const targetEnv = getTargetEnvironment(options);
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
    const preflightCount = operation.preflight?.length || 0;

    return `# ${operation.name}

## Overview
**Version**: ${operation.version}  
**Description**: ${operation.description}  
**Author**: ${operation.author || 'Not specified'}  
**Category**: ${operation.category || 'Not specified'}  
**Environments**: ${envList}

## Summary
- **Steps**: ${stepCount}
- **Preflight Checks**: ${preflightCount}
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

## Preflight Checks

${
  operation.preflight
    ?.map(
      (check: any, index: number) => `
### ${index + 1}. ${check.name}
**Type**: ${check.type}
**Description**: ${check.description}
${check.command ? `**Command**: \`${check.command}\`` : ''}
${check.condition ? `**Expected**: ${check.condition}` : ''}
${check.timeout ? `**Timeout**: ${check.timeout}s` : ''}
`,
    )
    .join('') || 'No preflight checks defined.'
}

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
${step.evidence_required ? `**Evidence Required**: ${step.evidence_types?.join(', ') || 'Yes'}` : ''}
${step.continue_on_error ? `**Continue on Error**: Yes` : ''}

${
  step.rollback
    ? `**Rollback**:
${step.rollback.command ? `\`${step.rollback.command}\`` : step.rollback.instruction || 'See rollback instructions'}`
    : ''
}
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
    ?.map(
      (step: any, index: number) => `
### ${index + 1}. Rollback Step
${step.command ? `**Command**: \`${step.command}\`` : ''}
${step.instruction ? `**Instructions**: ${step.instruction}` : ''}
`,
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
  ): string {
    return generateConfluenceContent(
      operation,
      resolveVars,
      includeGantt,
      targetEnvironment,
    );
  }

  async generateSchedule(
    operationFile: string,
    options: GenerateOptions,
  ): Promise<void> {
    console.log(`📅 Generating schedule for: ${operationFile}`);

    const operation = parseOperation(operationFile);
    const schedule = this.createGanttSchedule(operation);
    const outputFile =
      options.output ||
      `schedules/${basename(operationFile, '.yaml')}-schedule.md`;

    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, schedule);
    console.log(`✅ Schedule generated: ${outputFile}`);
  }

  private createGanttSchedule(operation: any): string {
    // Gantt chart generation logic...
    return `# Schedule for: ${operation.name}\n\nTODO: Implement Gantt chart generation`;
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
  const filteredOperation = {
    ...operation,
    environments,
  };

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

  // Helper function to substitute variables (inline version)
  const substituteVariables = (
    command: string,
    envVariables: Record<string, any>,
    stepVariables?: Record<string, any>,
  ): string => {
    // Merge variables with priority: step > env
    const mergedVariables = { ...envVariables, ...(stepVariables || {}) };

    // Perform variable substitution on ENTIRE content
    let result = command;
    for (const key in mergedVariables) {
      const regex = new RegExp(`\\$\\{${key}\\}`, 'g');
      result = result.replace(regex, mergedVariables[key]);
    }

    return result;
  };

  // Helper to escape Confluence macro syntax in text (for variables like ${VAR})
  const escapeConfluenceMacros = (text: string): string => {
    // First convert markdown links to Confluence format
    const result = convertLinksToConfluence(text);
    // Then escape { and } to prevent Confluence from interpreting ${VAR} as macros
    return result.replace(/\{/g, '\\{').replace(/\}/g, '\\}');
  };

  // Helper to format evidence area
  const formatEvidenceArea = (evidence: any): string => {
    if (!evidence) return '';

    const types = evidence.types || [];
    const typesText = types.length > 0 ? ` - ${types.join(', ')}` : '';
    const status = evidence.required ? 'Required' : 'Optional';

    // Add code block for command_output evidence type
    let content = 'Paste evidence here';
    if (types.includes('command_output')) {
      content = '{code:bash}\n# Paste command output here\n{code}';
    }

    return `\n{expand:title=📎 Evidence (${status}${typesText})}${content}{expand}`;
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

{markdown}
\`\`\`mermaid
gantt
    title ${filteredOperation.name} Timeline
    dateFormat YYYY-MM-DD HH:mm
    axisFormat %m-%d %H:%M

`;

      // Group steps by phase
      const ganttPhases: { [key: string]: any[] } = {
        preflight: [],
        flight: [],
        postflight: [],
      };

      stepsWithTimeline.forEach((step: any) => {
        const phase = step.phase || 'flight';
        if (ganttPhases[phase]) {
          ganttPhases[phase].push(step);
        }
      });

      // Generate sections for each phase
      const ganttPhaseNames = {
        preflight: '🛫 Pre-Flight Phase',
        flight: '✈️ Flight Phase',
        postflight: '🛬 Post-Flight Phase',
      };

      Object.entries(ganttPhases).forEach(([phaseName, phaseSteps]) => {
        if (phaseSteps.length === 0) return;

        content += `    section ${ganttPhaseNames[phaseName as keyof typeof ganttPhaseNames]}\n`;

        phaseSteps.forEach((step: any) => {
          const taskName = step.name.replace(/:/g, ''); // Remove colons as they break Mermaid syntax
          const pic = step.pic ? ` (${step.pic})` : '';
          const timeline = step.timeline || '';
          content += `    ${taskName}${pic} :${timeline}\n`;
        });
        content += '\n';
      });

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

  // Group steps by phase
  const phases: { [key: string]: any[] } = {
    preflight: [],
    flight: [],
    postflight: [],
  };

  filteredOperation.steps.forEach((step: any) => {
    const phase = step.phase || 'flight';
    if (phases[phase]) {
      phases[phase].push(step);
    }
  });

  let globalStepNumber = 1;

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
      phaseSteps.length > 0 && phaseSteps[0].section_heading;
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
    phaseSteps.forEach((step: any) => {
      // Handle section heading
      if (step.section_heading) {
        // Close current table if one is open
        if (tableOpen) {
          content += '\n';
          tableOpen = false;
        }

        // Add section heading
        content += `h3. ${escapeConfluenceMacros(step.name)}\n\n`;
        if (step.description) {
          content += `${escapeConfluenceMacros(step.description)}\n\n`;
        }

        // Add PIC and timeline if present in section heading
        if (step.pic || step.timeline) {
          const metadata = [];
          if (step.pic)
            metadata.push(`(i) PIC: ${escapeConfluenceMacros(step.pic)}`);
          if (step.timeline)
            metadata.push(
              `(time) Timeline: ${escapeConfluenceMacros(step.timeline)}`,
            );
          content += `_${metadata.join(' • ')}_\n\n`;
        }

        // Reopen table
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
      let stepInfo = `${phaseIconForStep}${typeIcon} Step ${globalStepNumber}: ${escapeConfluenceMacros(step.name)}`;
      if (step.description)
        stepInfo += `\n${escapeConfluenceMacros(step.description)}`;
      if (step.pic)
        stepInfo += `\n(i) PIC: ${escapeConfluenceMacros(step.pic)}`;
      if (step.timeline)
        stepInfo += `\n(time) Timeline: ${escapeConfluenceMacros(step.timeline)}`;
      if (step.needs && step.needs.length > 0)
        stepInfo += `\n(-) Depends on: ${escapeConfluenceMacros(step.needs.join(', '))}`;
      if (step.ticket)
        stepInfo += `\n(flag) Tickets: ${escapeConfluenceMacros(Array.isArray(step.ticket) ? step.ticket.join(', ') : step.ticket)}`;
      if (step.if)
        stepInfo += `\n(?) Condition: ${escapeConfluenceMacros(step.if)}`;

      // Build all command cells for each environment
      const commandCells: string[] = [];
      filteredOperation.environments.forEach((env: any) => {
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
          cellContent += `{markdown}\n${trimmed}\n{markdown}`;
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

        // Fallback for steps with neither
        if (!cellContent) {
          if (step.sub_steps && step.sub_steps.length > 0) {
            cellContent = '_(see substeps below)_';
          } else {
            cellContent = `_(${step.type} step)_`;
          }
        }

        // Add evidence area if required
        if (step.evidence) {
          cellContent += formatEvidenceArea(step.evidence);
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
          `${globalStepNumber}`,
          1,
          resolveVars,
          typeIcons,
          escapeConfluenceMacros,
          substituteVariables,
          formatForTableCell,
          addSmartLineBreaks,
          formatEvidenceArea,
        );
      }

      globalStepNumber++;
    });

    content += '\n';
  });

  // Rollback section if available
  const stepsWithRollback = filteredOperation.steps.filter(
    (step: any) => step.rollback,
  );
  if (stepsWithRollback.length > 0) {
    content += `h2. (<) Rollback Procedures

{warning}If deployment fails, execute the following rollback steps in reverse order:{warning}

|| Step || ${filteredOperation.environments.map((e: any) => `${e.name} ||`).join(' ')}
`;

    stepsWithRollback.forEach((step: any) => {
      // Build all rollback cells
      const rollbackCells: string[] = [];
      filteredOperation.environments.forEach((env: any) => {
        let cellContent = '';

        // Get rollback options (defaults)
        const substituteVars = step.rollback?.options?.substitute_vars ?? true;
        const showCommandSeparately =
          step.rollback?.options?.show_command_separately ?? false;

        // Process rollback instruction (always markdown)
        if (step.rollback?.instruction) {
          let displayInstruction = step.rollback.instruction;

          if (resolveVars && substituteVars) {
            displayInstruction = substituteVariables(
              displayInstruction,
              env.variables || {},
              step.variables,
            );
          }

          const trimmed = displayInstruction.replace(/\s+$/, '');
          cellContent += `{markdown}\n${trimmed}\n{markdown}`;
        }

        // Process rollback command (always code block)
        if (step.rollback?.command) {
          let displayCommand = step.rollback.command;

          if (resolveVars && substituteVars) {
            displayCommand = substituteVariables(
              displayCommand,
              env.variables || {},
              step.variables,
            );
          }

          const trimmedCommand = displayCommand.replace(/\n+$/, '');

          if (showCommandSeparately && step.rollback.instruction) {
            cellContent += `\n*Command:*\n{code:bash}\n${trimmedCommand}\n{code}`;
          } else if (!step.rollback.instruction) {
            cellContent += `{code:bash}\n${trimmedCommand}\n{code}`;
          } else {
            cellContent += `\n{code:bash}\n${trimmedCommand}\n{code}`;
          }
        }

        // Fallback
        if (!cellContent) {
          cellContent = '-';
        }

        // Add evidence area if required for rollback
        if (step.rollback?.evidence) {
          cellContent += formatEvidenceArea(step.rollback.evidence);
        }

        rollbackCells.push(cellContent);
      });

      // Construct complete row
      content += `| Rollback for: ${step.name} | ${rollbackCells.join(' | ')} |\n`;
    });

    content += '\n';
  }

  // Global rollback section if available
  if (
    filteredOperation.rollback?.steps &&
    filteredOperation.rollback.steps.length > 0
  ) {
    if (stepsWithRollback.length === 0) {
      // Only add header if not already added
      content += `h2. (<) Rollback Procedures

{warning}If deployment fails, execute the following rollback steps:{warning}

`;
    }

    content += `h3. Global Rollback Plan

*Automatic*: ${filteredOperation.rollback.automatic ? 'Yes' : 'No'}
${filteredOperation.rollback.conditions?.length ? `*Conditions*: ${filteredOperation.rollback.conditions.join(', ')}\n` : ''}

|| Step || ${filteredOperation.environments.map((e: any) => `${e.name} ||`).join(' ')}
`;

    filteredOperation.rollback.steps.forEach(
      (rollbackStep: any, index: number) => {
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
            cellContent += `{markdown}\n${trimmed}\n{markdown}`;
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

          // Fallback
          if (!cellContent) {
            cellContent = '-';
          }

          // Add evidence area if required for global rollback step
          if (rollbackStep.evidence) {
            cellContent += formatEvidenceArea(rollbackStep.evidence);
          }

          rollbackCells.push(cellContent);
        });

        content += `| Rollback Step ${index + 1} | ${rollbackCells.join(' | ')} |\n`;
      },
    );

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
  formatEvidenceArea: (evidence: any) => string,
): string {
  let content = '';

  subSteps.forEach((subStep: any, subIndex: number) => {
    // Determine numbering based on depth
    // Odd depths (1, 3, 5): use letters (a, b, c)
    // Even depths (2, 4, 6): use numbers (1, 2, 3)
    let subStepId: string;
    if (depth % 2 === 1) {
      // Odd depth: use letters
      const letter = String.fromCharCode(97 + subIndex); // 97 = 'a'
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
      content += `${headingPrefix} ${escapeConfluenceMacros(subStep.name)}\n\n`;
      if (subStep.description) {
        content += `${escapeConfluenceMacros(subStep.description)}\n\n`;
      }

      // Add PIC and timeline if present
      if (subStep.pic || subStep.timeline) {
        const metadata = [];
        if (subStep.pic)
          metadata.push(`(i) PIC: ${escapeConfluenceMacros(subStep.pic)}`);
        if (subStep.timeline)
          metadata.push(
            `(time) Timeline: ${escapeConfluenceMacros(subStep.timeline)}`,
          );
        content += `_${metadata.join(' • ')}_\n\n`;
      }

      // Reopen table
      content += `|| Step ||`;
      environments.forEach((env: any) => {
        content += ` ${env.name} ||`;
      });
      content += '\n';
    }

    let subStepInfo = `${subTypeIcon} Step ${subStepId}: ${escapeConfluenceMacros(subStep.name)}`;
    if (subStep.description)
      subStepInfo += `\n${escapeConfluenceMacros(subStep.description)}`;
    if (subStep.pic)
      subStepInfo += `\n(i) PIC: ${escapeConfluenceMacros(subStep.pic)}`;
    if (subStep.timeline)
      subStepInfo += `\n(time) Timeline: ${escapeConfluenceMacros(subStep.timeline)}`;
    if (subStep.needs && subStep.needs.length > 0)
      subStepInfo += `\n(-) Depends on: ${escapeConfluenceMacros(subStep.needs.join(', '))}`;
    if (subStep.ticket)
      subStepInfo += `\n(flag) Tickets: ${escapeConfluenceMacros(Array.isArray(subStep.ticket) ? subStep.ticket.join(', ') : subStep.ticket)}`;
    if (subStep.if)
      subStepInfo += `\n(?) Condition: ${escapeConfluenceMacros(subStep.if)}`;

    // Build all command cells for sub-step
    const subCommandCells: string[] = [];
    environments.forEach((env: any) => {
      let cellContent = '';

      // Get sub-step options (defaults)
      const substituteVars = subStep.options?.substitute_vars ?? true;
      const showCommandSeparately =
        subStep.options?.show_command_separately ?? false;

      // Process instruction (always render as markdown)
      if (subStep.instruction) {
        let displayInstruction = subStep.instruction;

        if (resolveVars && substituteVars) {
          displayInstruction = substituteVariables(
            displayInstruction,
            env.variables || {},
            subStep.variables,
          );
        }

        const trimmed = displayInstruction.replace(/\s+$/, '');
        cellContent += `{markdown}\n${trimmed}\n{markdown}`;
      }

      // Process command (always render as code block)
      if (subStep.command) {
        let displayCommand = subStep.command;

        if (resolveVars && substituteVars) {
          displayCommand = substituteVariables(
            displayCommand,
            env.variables || {},
            subStep.variables,
          );
        }

        const trimmedCommand = displayCommand.replace(/\n+$/, '');

        if (showCommandSeparately && subStep.instruction) {
          cellContent += `\n*Command:*\n{code:bash}\n${trimmedCommand}\n{code}`;
        } else if (!subStep.instruction) {
          cellContent += `{code:bash}\n${trimmedCommand}\n{code}`;
        } else {
          cellContent += `\n{code:bash}\n${trimmedCommand}\n{code}`;
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

      // Add evidence area if required
      if (subStep.evidence) {
        cellContent += formatEvidenceArea(subStep.evidence);
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
      );
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
    '--resolve-vars',
    'Resolve variables to actual values instead of showing placeholders',
  )
  .option('--gantt', 'Include Mermaid Gantt chart for timeline visualization')
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
