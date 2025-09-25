import { Command } from 'commander';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { parseOperation } from '../../operations/parser';
import { generateManualWithMetadata } from '../../manuals/generator';
import { createGenerationMetadata } from '../../lib/git-metadata';

interface GenerateOptions {
  output?: string;
  format?: 'markdown' | 'confluence' | 'html' | 'pdf';
  env?: string;
  environment?: string; // Keep for backward compatibility
  resolveVars?: boolean;
  template?: string;
}

class DocumentationGenerator {
  async generateManual(operationFile: string, options: GenerateOptions): Promise<void> {
    const targetEnv = options.env || options.environment;
    const envSuffix = targetEnv ? ` (${targetEnv})` : '';
    console.log(`📄 Generating manual for: ${operationFile}${envSuffix}`);

    // Parse operation
    const operation = await parseOperation(operationFile);

    // Create generation metadata
    const metadata = await createGenerationMetadata(
      operationFile,
      operation.id,
      operation.version,
      targetEnv
    );

    // Generate manual with metadata and environment filtering
    const manual = generateManualWithMetadata(operation, metadata, targetEnv, options.resolveVars);

    // Determine output file with environment suffix if specified
    const operationName = basename(operationFile, '.yaml');
    const envFileSuffix = targetEnv ? `-${targetEnv}` : '';
    const outputFile = options.output || `manuals/${operationName}${envFileSuffix}-manual.md`;

    // Ensure output directory exists
    await mkdir(dirname(outputFile), { recursive: true });

    // Write manual
    await writeFile(outputFile, manual);
    console.log(`✅ Manual generated: ${outputFile}`);

    if (targetEnv) {
      console.log(`🎯 Filtered for environment: ${targetEnv}`);
    }
  }

  async generateDocs(operationFile: string, options: GenerateOptions): Promise<void> {
    console.log(`📚 Generating documentation for: ${operationFile}`);

    const operation = await parseOperation(operationFile);
    const operationName = basename(operationFile, '.yaml');
    
    switch (options.format) {
      case 'confluence':
        await this.generateConfluencePage(operation, operationName, options);
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
    const confluenceContent = this.createConfluenceContent(operation);
    const outputFile = options.output || `confluence/${operationName}.confluence`;
    
    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, confluenceContent);
    console.log(`✅ Confluence content generated: ${outputFile}`);
    console.log('💡 Upload this content to your Confluence space');
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

  private createConfluenceContent(operation: any): string {
    return `{panel:title=${operation.name} - Operation Documentation|borderStyle=solid|borderColor=#ccc|titleBGColor=#f7f7f7|bgColor=#fff}

h2. Overview
*Version:* ${operation.version}
*Description:* ${operation.description}
*Author:* ${operation.author || 'Not specified'}
*Environments:* ${operation.environments.map((e: any) => e.name).join(', ')}

{panel}

h2. Environments

${operation.environments.map((env: any) => `
h3. ${env.name}
*Description:* ${env.description}
*Approval Required:* ${env.approval_required ? 'Yes' : 'No'}

{panel:title=Variables|borderStyle=solid|borderColor=#ddd}
${Object.entries(env.variables || {}).map(([key, value]) => `* {{${key}}}: ${value}`).join('\n')}
{panel}
`).join('')}

h2. Execution Steps

${operation.steps.map((step: any, index: number) => `
h3. ${index + 1}. ${step.name}
*Type:* ${step.type}
${step.description ? `*Description:* ${step.description}` : ''}

${step.command ? `{panel:title=Command|borderStyle=solid}
{code:bash}${step.command}{code}
{panel}` : ''}

${step.instruction ? `{panel:title=Instructions|borderStyle=solid}
${step.instruction}
{panel}` : ''}
`).join('')}

{panel:title=Generated Information|borderStyle=solid|borderColor=#f0f0f0}
Generated on: ${new Date().toISOString()}
Generated by: SAMARITAN CLI
{panel}
`;
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
    let schedule = `# ${operation.name} - Execution Schedule

## Timeline Estimation

| Step | Name | Type | Duration | Dependencies |
|------|------|------|----------|--------------|
`;

    let totalDuration = 0;
    operation.steps.forEach((step: any, index: number) => {
      const duration = step.estimated_duration || (step.type === 'automatic' ? 60 : 300);
      const deps = step.needs ? step.needs.join(', ') : 'None';
      totalDuration += duration;
      
      schedule += `| ${index + 1} | ${step.name} | ${step.type} | ${Math.round(duration / 60)}min | ${deps} |\n`;
    });

    schedule += `\n**Total Estimated Duration**: ${Math.round(totalDuration / 60)} minutes\n\n`;

    schedule += `## Gantt Chart (Mermaid)

\`\`\`mermaid
gantt
    title ${operation.name} Execution Timeline
    dateFormat X
    axisFormat %M:%S
    
`;

    let currentTime = 0;
    operation.steps.forEach((step: any, index: number) => {
      const duration = step.estimated_duration || (step.type === 'automatic' ? 60 : 300);
      const startTime = currentTime;
      const endTime = currentTime + duration;
      
      schedule += `    ${step.name.replace(/[^a-zA-Z0-9]/g, '_')} :${startTime}, ${endTime}\n`;
      currentTime = endTime;
    });

    schedule += `\`\`\`

*Note: This is an estimated timeline. Actual execution times may vary.*
`;

    return schedule;
  }
}

// Generate command with subcommands
const generateCommand = new Command('generate')
  .description('Generate documentation and reports');

generateCommand
  .command('manual <operation>')
  .description('Generate operation manual')
  .option('-o, --output <file>', 'Output file path')
  .option('-e, --env <environment>', 'Generate for specific environment')
  .option('--resolve-vars', 'Resolve variables to actual values instead of showing placeholders')
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
  .option('-f, --format <format>', 'Output format (markdown, html, confluence, pdf)', 'markdown')
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