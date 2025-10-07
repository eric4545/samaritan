import { Command } from 'commander';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { parseOperation } from '../../operations/parser';
import { generateManualWithMetadata } from '../../manuals/generator';
import { createGenerationMetadata } from '../../lib/git-metadata';
import { generateADFString } from '../../manuals/adf-generator';

interface GenerateOptions {
  output?: string;
  format?: 'markdown' | 'confluence' | 'adf' | 'html' | 'pdf';
  env?: string;
  environment?: string; // Keep for backward compatibility
  resolveVars?: boolean;
  template?: string;
  gantt?: boolean;
}

class DocumentationGenerator {
  async generateManual(operationFile: string, options: GenerateOptions): Promise<void> {
    const targetEnv = options.env || options.environment;
    const envSuffix = targetEnv ? ` (${targetEnv})` : '';
    const format = options.format || 'markdown';
    console.log(`📄 Generating manual for: ${operationFile}${envSuffix} (format: ${format})`);

    // Parse operation
    const operation = await parseOperation(operationFile);
    const operationName = basename(operationFile, '.yaml');
    const envFileSuffix = targetEnv ? `-${targetEnv}` : '';

    switch (format) {
      case 'confluence':
        await this.generateConfluenceManual(operation, operationName, envFileSuffix, options);
        break;
      case 'adf':
        await this.generateADFManual(operation, operationName, envFileSuffix, options);
        break;
      case 'html':
        await this.generateHtmlManual(operation, operationName, envFileSuffix, options);
        break;
      case 'markdown':
      default:
        await this.generateMarkdownManual(operation, operationFile, operationName, envFileSuffix, options);
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
    options: GenerateOptions
  ): Promise<void> {
    const targetEnv = options.env || options.environment;

    // Create generation metadata
    const metadata = await createGenerationMetadata(
      operationFile,
      operation.id,
      operation.version,
      targetEnv
    );

    // Generate manual with metadata and environment filtering
    const manual = generateManualWithMetadata(operation, metadata, targetEnv, options.resolveVars, options.gantt);

    // Determine output file
    const outputFile = options.output || `manuals/${operationName}${envFileSuffix}-manual.md`;

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
    options: GenerateOptions
  ): Promise<void> {
    const confluenceContent = this.createConfluenceContent(operation, options.resolveVars);
    const outputFile = options.output || `manuals/${operationName}${envFileSuffix}-manual.confluence`;

    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, confluenceContent);
    console.log(`✅ Confluence manual generated: ${outputFile}`);
    console.log('💡 Upload this content to your Confluence space');
  }

  private async generateADFManual(
    operation: any,
    operationName: string,
    envFileSuffix: string,
    options: GenerateOptions
  ): Promise<void> {
    const targetEnv = options.env || options.environment;
    const metadata = await createGenerationMetadata(
      operationName,
      operation.id,
      operation.version,
      targetEnv
    );

    const adfContent = generateADFString(operation, metadata, targetEnv, options.resolveVars);
    const outputFile = options.output || `manuals/${operationName}${envFileSuffix}-manual.json`;

    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, adfContent);
    console.log(`✅ ADF manual generated: ${outputFile}`);
    console.log('💡 Import this JSON file into Confluence using the ADF importer');
  }

  private async generateHtmlManual(
    operation: any,
    operationName: string,
    envFileSuffix: string,
    options: GenerateOptions
  ): Promise<void> {
    const targetEnv = options.env || options.environment;
    const metadata = await createGenerationMetadata(
      operationName,
      operation.id,
      operation.version,
      targetEnv
    );

    const manual = generateManualWithMetadata(operation, metadata, targetEnv, options.resolveVars, options.gantt);
    const htmlManual = this.markdownToHtml(manual, operation.name);
    const outputFile = options.output || `manuals/${operationName}${envFileSuffix}-manual.html`;

    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, htmlManual);
    console.log(`✅ HTML manual generated: ${outputFile}`);
  }

  async generateDocs(operationFile: string, options: GenerateOptions): Promise<void> {
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

  private async generateMarkdownDocs(operation: any, operationName: string, options: GenerateOptions): Promise<void> {
    const docs = this.createMarkdownDocumentation(operation);
    const outputFile = options.output || `docs/${operationName}.md`;
    
    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, docs);
    console.log(`✅ Documentation generated: ${outputFile}`);
  }

  private async generateHtmlDocs(operation: any, operationName: string, options: GenerateOptions): Promise<void> {
    const markdownDocs = this.createMarkdownDocumentation(operation);
    const htmlDocs = this.markdownToHtml(markdownDocs, operation.name);
    const outputFile = options.output || `docs/${operationName}.html`;
    
    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, htmlDocs);
    console.log(`✅ HTML documentation generated: ${outputFile}`);
  }

  private async generateConfluencePage(operation: any, operationName: string, options: GenerateOptions): Promise<void> {
    const confluenceContent = this.createConfluenceContent(operation, options.resolveVars);
    const outputFile = options.output || `confluence/${operationName}.confluence`;

    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, confluenceContent);
    console.log(`✅ Confluence content generated: ${outputFile}`);
    console.log('💡 Upload this content to your Confluence space');
  }

  private async generateADFDocs(operation: any, operationName: string, options: GenerateOptions): Promise<void> {
    const targetEnv = options.env || options.environment;
    const metadata = await createGenerationMetadata(
      operationName,
      operation.id,
      operation.version,
      targetEnv
    );

    const adfContent = generateADFString(operation, metadata, targetEnv, options.resolveVars);
    const envSuffix = targetEnv ? `-${targetEnv}` : '';
    const outputFile = options.output || `adf/${operationName}${envSuffix}.json`;

    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, adfContent);
    console.log(`✅ ADF (Atlassian Document Format) generated: ${outputFile}`);
    console.log('💡 Import this JSON file into Confluence using the ADF importer');
  }

  private createMarkdownDocumentation(operation: any): string {
    const envList = operation.environments.map((env: any) => env.name).join(', ');
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

${operation.environments.map((env: any) => `
### ${env.name}
**Description**: ${env.description}
**Approval Required**: ${env.approval_required ? 'Yes' : 'No'}
**Validation Required**: ${env.validation_required ? 'Yes' : 'No'}

**Variables**:
${Object.entries(env.variables || {}).map(([key, value]) => `- \`${key}\`: ${value}`).join('\n')}

${env.restrictions?.length ? `**Restrictions**: ${env.restrictions.join(', ')}` : ''}
`).join('')}

## Preflight Checks

${operation.preflight?.map((check: any, index: number) => `
### ${index + 1}. ${check.name}
**Type**: ${check.type}
**Description**: ${check.description}
${check.command ? `**Command**: \`${check.command}\`` : ''}
${check.condition ? `**Expected**: ${check.condition}` : ''}
${check.timeout ? `**Timeout**: ${check.timeout}s` : ''}
`).join('') || 'No preflight checks defined.'}

## Execution Steps

${operation.steps.map((step: any, index: number) => `
### ${index + 1}. ${step.name}
**Type**: ${step.type}
${step.description ? `**Description**: ${step.description}` : ''}

${step.command ? `**Command**:
\`\`\`bash
${step.command}
\`\`\`` : ''}

${step.instruction ? `**Instructions**:
${step.instruction}` : ''}

${step.timeout ? `**Timeout**: ${step.timeout}s` : ''}
${step.estimated_duration ? `**Estimated Duration**: ${step.estimated_duration}s` : ''}
${step.evidence_required ? `**Evidence Required**: ${step.evidence_types?.join(', ') || 'Yes'}` : ''}
${step.continue_on_error ? `**Continue on Error**: Yes` : ''}

${step.rollback ? `**Rollback**:
${step.rollback.command ? `\`${step.rollback.command}\`` : step.rollback.instruction || 'See rollback instructions'}` : ''}
`).join('')}

${operation.rollback ? `
## Rollback Plan

**Automatic**: ${operation.rollback.automatic ? 'Yes' : 'No'}

${operation.rollback.steps?.map((step: any, index: number) => `
### ${index + 1}. Rollback Step
${step.command ? `**Command**: \`${step.command}\`` : ''}
${step.instruction ? `**Instructions**: ${step.instruction}` : ''}
`).join('') || ''}

${operation.rollback.conditions?.length ? `**Conditions**: ${operation.rollback.conditions.join(', ')}` : ''}
` : ''}

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
    let html = markdown
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\`(.+?)\`/g, '<code>$1</code>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/```bash\n([\s\S]*?)```/g, '<pre><code class="bash">$1</code></pre>')
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

  private createConfluenceContent(operation: any, resolveVars: boolean = false): string {
    return generateConfluenceContent(operation, resolveVars);
  }

  async generateSchedule(operationFile: string, options: GenerateOptions): Promise<void> {
    console.log(`📅 Generating schedule for: ${operationFile}`);

    const operation = parseOperation(operationFile);
    const schedule = this.createGanttSchedule(operation);
    const outputFile = options.output || `schedules/${basename(operationFile, '.yaml')}-schedule.md`;

    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, schedule);
    console.log(`✅ Schedule generated: ${outputFile}`);
  }

  private createGanttSchedule(operation: any): string {
    // Gantt chart generation logic...
    return `# Schedule for: ${operation.name}\n\nTODO: Implement Gantt chart generation`;
  }
}

// Export as standalone function for testing
export function generateConfluenceContent(operation: any, resolveVars: boolean = false): string {
    const phaseIcons = {
      preflight: '🛫',
      flight: '✈️',
      postflight: '🛬'
    };

    const typeIcons: Record<string, string> = {
      automatic: '⚙️',
      manual: '👤',
      approval: '✋',
      conditional: '🔀'
    };

    // Helper function to substitute variables (inline version)
    const substituteVariables = (command: string, envVariables: Record<string, any>, stepVariables?: Record<string, any>): string => {
      let substitutedCommand = command;
      const mergedVariables = { ...envVariables, ...(stepVariables || {}) };
      for (const key in mergedVariables) {
        const regex = new RegExp(`\\$\\{${key}\\}`, 'g');
        substitutedCommand = substitutedCommand.replace(regex, mergedVariables[key]);
      }
      return substitutedCommand;
    };

    // Helper to format multi-line text for Confluence table cells
    const formatForTableCell = (text: string, useCodeBlock: boolean = true): string => {
      const hasMultipleLines = text.includes('\n');

      if (hasMultipleLines && useCodeBlock) {
        // For multi-line commands, don't use code blocks - just plain text with line breaks
        // This allows \\ to work as line breaks in table cells
        return text.replace(/\n/g, '\\\\');
      } else if (hasMultipleLines && !useCodeBlock) {
        // For instructions/markdown, preserve line breaks
        return text.replace(/\n/g, '\\\\');
      } else {
        // Single line - no transformation needed
        return text;
      }
    };

    // Helper to add smart line breaks for long commands
    const addSmartLineBreaks = (command: string, maxLength: number = 100): string => {
      if (command.length <= maxLength) {
        return command;
      }

      // Break at logical points: pipes, operators, common flags
      let result = command
        .replace(/ \| /g, ' |\\\\  ')           // Break before pipes
        .replace(/ && /g, ' &&\\\\  ')          // Break before &&
        .replace(/ \|\| /g, ' ||\\\\  ')        // Break before ||
        .replace(/ --context /g, '\\\\  --context ')  // Break before --context
        .replace(/ --namespace /g, '\\\\  --namespace ')  // Break before --namespace
        .replace(/ -n /g, '\\\\  -n ')          // Break before -n flag
        .replace(/ -f /g, '\\\\  -f ')          // Break before -f flag
        .replace(/ -o /g, '\\\\  -o ');         // Break before -o flag

      return result;
    };

    // Build header panel
    let content = `{panel:title=${operation.name} - Operation Documentation|borderStyle=solid|borderColor=#0052CC|titleBGColor=#DEEBFF|bgColor=#fff}

h2. Overview
*Version:* ${operation.version}
*Description:* ${operation.description}
*Author:* ${operation.author || 'Not specified'}
${operation.category ? `*Category:* ${operation.category}` : ''}
*Environments:* ${operation.environments.map((e: any) => e.name).join(', ')}
${operation.emergency ? '*Emergency Operation:* {status:colour=Red|title=YES}' : ''}

{panel}

`;

    // Dependencies section
    if (operation.needs && operation.needs.length > 0) {
      content += `h2. Dependencies

{info}This operation depends on the following operations being completed first:{info}

${operation.needs.map((dep: string) => `* *${dep}*`).join('\n')}

`;
    }

    // Environments table
    content += `h2. Environments

|| Environment || Description || Approval Required || Validation Required || Targets ||
${operation.environments.map((env: any) => `| ${env.name} | ${env.description || '-'} | ${env.approval_required ? '{status:colour=Yellow|title=YES}' : 'No'} | ${env.validation_required ? 'Yes' : 'No'} | ${env.targets?.join(', ') || '-'} |`).join('\n')}

`;

    // Environment details with variables (collapsible)
    operation.environments.forEach((env: any) => {
      const varCount = Object.keys(env.variables || {}).length;
      content += `h3. ${env.name} - Variables

{expand:title=Show ${varCount} environment variables}
{code:language=bash}
${Object.entries(env.variables || {}).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n')}
{code}
{expand}

`;
    });

    // Group steps by phase
    const phases: { [key: string]: any[] } = {
      preflight: [],
      flight: [],
      postflight: []
    };

    operation.steps.forEach((step: any) => {
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
        postflight: 'Post-Flight Phase'
      };

      const phaseIcon = phaseIcons[phaseName as keyof typeof phaseIcons] || '';

      content += `h2. ${phaseIcon} ${phaseHeaders[phaseName]}

`;

      // Build table header with environment columns
      content += `|| Step ||`;
      operation.environments.forEach((env: any) => {
        content += ` ${env.name} ||`;
      });
      content += '\n';

      // Build table rows for each step
      phaseSteps.forEach((step: any) => {
        const typeIcon = typeIcons[step.type] || '';
        const phaseIconForStep = step.phase && step.phase !== phaseName ? phaseIcons[step.phase as keyof typeof phaseIcons] || '' : '';

        // Build step info cell
        let stepInfo = `${phaseIconForStep}${typeIcon} Step ${globalStepNumber}: ${step.name}`;
        if (step.description) stepInfo += `\\\\${step.description}`;
        if (step.pic) stepInfo += `\\\\👤 PIC: ${step.pic}`;
        if (step.timeline) stepInfo += `\\\\⏱️ Timeline: ${step.timeline}`;
        if (step.needs && step.needs.length > 0) stepInfo += `\\\\📋 Depends on: ${step.needs.join(', ')}`;
        if (step.ticket) stepInfo += `\\\\🎫 Tickets: ${Array.isArray(step.ticket) ? step.ticket.join(', ') : step.ticket}`;
        if (step.if) stepInfo += `\\\\🔀 Condition: ${step.if}`;

        content += `| ${stepInfo} |`;

        // Add command cells for each environment
        operation.environments.forEach((env: any) => {
          const rawCommand = step.command || step.instruction || '';
          let displayCommand = rawCommand;

          // Resolve variables if flag is enabled
          if (resolveVars && rawCommand) {
            displayCommand = substituteVariables(rawCommand, env.variables || {}, step.variables);
          }

          // Check if content is markdown
          const isMarkdown = step.instruction && (
            displayCommand.includes('\n#') ||
            displayCommand.includes('\n-') ||
            displayCommand.includes('\n*') ||
            displayCommand.includes('\n1.') ||
            displayCommand.includes('```') ||
            displayCommand.includes('**')
          );

          if (displayCommand) {
            if (isMarkdown) {
              // For markdown instructions, format with line breaks (no code block)
              content += ` ${formatForTableCell(displayCommand, false)} |`;
            } else {
              // Check if multi-line or long command
              const hasMultipleLines = displayCommand.includes('\n');

              if (hasMultipleLines) {
                // Multi-line: use plain text with \\ line breaks (NO code block)
                const formattedCommand = formatForTableCell(displayCommand, true);
                content += ` \`\`\`\\\\${formattedCommand}\`\`\` |`;
              } else {
                // Single-line: apply smart line breaking if needed, then wrap in code block
                const withBreaks = addSmartLineBreaks(displayCommand);
                if (withBreaks.includes('\\\\')) {
                  // Has line breaks after smart breaking - use plain text
                  content += ` \`\`\`\\\\${withBreaks}\`\`\` |`;
                } else {
                  // Short single line - use code block
                  content += ` {code:bash}${displayCommand}{code} |`;
                }
              }
            }
          } else if (step.sub_steps && step.sub_steps.length > 0) {
            content += ` _(see substeps below)_ |`;
          } else {
            content += ` _(${step.type} step)_ |`;
          }
        });

        content += '\n';

        // Add sub-steps in table format
        if (step.sub_steps && step.sub_steps.length > 0) {
          step.sub_steps.forEach((subStep: any, subIndex: number) => {
            const subStepLetter = String.fromCharCode(97 + subIndex);
            const subStepId = `${globalStepNumber}${subStepLetter}`;
            const subTypeIcon = typeIcons[subStep.type] || '';

            let subStepInfo = `${subTypeIcon} Step ${subStepId}: ${subStep.name}`;
            if (subStep.description) subStepInfo += `\\\\${subStep.description}`;
            if (subStep.pic) subStepInfo += `\\\\👤 PIC: ${subStep.pic}`;
            if (subStep.timeline) subStepInfo += `\\\\⏱️ Timeline: ${subStep.timeline}`;
            if (subStep.needs && subStep.needs.length > 0) subStepInfo += `\\\\📋 Depends on: ${subStep.needs.join(', ')}`;
            if (subStep.ticket) subStepInfo += `\\\\🎫 Tickets: ${Array.isArray(subStep.ticket) ? subStep.ticket.join(', ') : subStep.ticket}`;
            if (subStep.if) subStepInfo += `\\\\🔀 Condition: ${subStep.if}`;

            content += `| ${subStepInfo} |`;

            // Add command cells for sub-step
            operation.environments.forEach((env: any) => {
              const rawCommand = subStep.command || subStep.instruction || '';
              let displayCommand = rawCommand;

              if (resolveVars && rawCommand) {
                displayCommand = substituteVariables(rawCommand, env.variables || {}, subStep.variables);
              }

              if (displayCommand) {
                const hasMultipleLines = displayCommand.includes('\n');

                if (hasMultipleLines) {
                  // Multi-line: use plain text with \\ line breaks
                  const formattedCommand = formatForTableCell(displayCommand, true);
                  content += ` \`\`\`\\\\${formattedCommand}\`\`\` |`;
                } else {
                  // Single-line: apply smart breaking
                  const withBreaks = addSmartLineBreaks(displayCommand);
                  if (withBreaks.includes('\\\\')) {
                    content += ` \`\`\`\\\\${withBreaks}\`\`\` |`;
                  } else {
                    content += ` {code:bash}${displayCommand}{code} |`;
                  }
                }
              } else {
                content += ` _(${subStep.type} step)_ |`;
              }
            });

            content += '\n';
          });
        }

        globalStepNumber++;
      });

      content += '\n';
    });

    // Rollback section if available
    const stepsWithRollback = operation.steps.filter((step: any) => step.rollback);
    if (stepsWithRollback.length > 0) {
      content += `h2. 🔄 Rollback Procedures

{warning}If deployment fails, execute the following rollback steps in reverse order:{warning}

|| Step || ${operation.environments.map((e: any) => `${e.name} ||`).join(' ')}
`;

      stepsWithRollback.forEach((step: any) => {
        content += `| Rollback for: ${step.name} |`;

        operation.environments.forEach((env: any) => {
          const rollbackCommand = step.rollback!.command || step.rollback!.instruction || '';
          let displayCommand = rollbackCommand;

          if (resolveVars && rollbackCommand) {
            displayCommand = substituteVariables(rollbackCommand, env.variables || {}, step.variables);
          }

          if (displayCommand) {
            const hasMultipleLines = displayCommand.includes('\n');

            if (hasMultipleLines) {
              // Multi-line rollback command
              const formattedCommand = formatForTableCell(displayCommand, true);
              content += ` \`\`\`\\\\${formattedCommand}\`\`\` |`;
            } else {
              // Single-line rollback command
              const withBreaks = addSmartLineBreaks(displayCommand);
              if (withBreaks.includes('\\\\')) {
                content += ` \`\`\`\\\\${withBreaks}\`\`\` |`;
              } else {
                content += ` {code:bash}${displayCommand}{code} |`;
              }
            }
          } else {
            content += ` - |`;
          }
        });

        content += '\n';
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


// Generate command with subcommands
const generateCommand = new Command('generate')
  .description('Generate documentation and reports');

generateCommand
  .command('manual <operation>')
  .description('Generate operation manual')
  .option('-o, --output <file>', 'Output file path')
  .option('-f, --format <format>', 'Output format (markdown, html, confluence, adf)', 'markdown')
  .option('-e, --env <environment>', 'Generate for specific environment')
  .option('--resolve-vars', 'Resolve variables to actual values instead of showing placeholders')
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
  .option('-f, --format <format>', 'Output format (markdown, html, confluence, adf, pdf)', 'markdown')
  .option('-e, --env <environment>', 'Generate for specific environment')
  .option('--resolve-vars', 'Resolve variables to actual values instead of showing placeholders')
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