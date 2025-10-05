import { Operation, Environment, Step } from '../models/operation';
import { GenerationMetadata, generateYamlFrontmatter } from '../lib/git-metadata';

function substituteVariables(command: string, variables: Record<string, any>): string {
  let substitutedCommand = command;
  for (const key in variables) {
    const regex = new RegExp(`\\$\\{${key}\\}`, 'g');
    substitutedCommand = substitutedCommand.replace(regex, variables[key]);
  }
  return substitutedCommand;
}

function generateStepRow(step: Step, stepNumber: number, environments: Environment[], resolveVariables: boolean = false, prefix: string = ''): string {
  let rows = '';

  const typeIcon = step.type === 'automatic' ? '⚙️' :
                   step.type === 'manual' ? '👤' :
                   step.type === 'conditional' ? '🔀' : '✋';

  const phaseIcon = step.phase === 'preflight' ? '🛫' :
                    step.phase === 'flight' ? '✈️' :
                    step.phase === 'postflight' ? '🛬' : '';

  // First column: Step name, phase, icon, and description
  let stepCell = `${prefix}Step ${stepNumber}: ${step.name} ${phaseIcon}${typeIcon}`;
  if (step.phase) {
    stepCell += `<br><em>Phase: ${step.phase}</em>`;
  }
  if (step.description && typeof step.description === 'string' && step.description.trim().length > 0) {
    stepCell += `<br>${step.description}`;
  }
  
  // Add dependency information
  if (step.needs && step.needs.length > 0) {
    stepCell += `<br>📋 <em>Depends on: ${step.needs.join(', ')}</em>`;
  }
  
  rows += `| ${stepCell} |`;
  
  // Subsequent columns: Commands for each environment
  environments.forEach(env => {
    const rawCommand = step.command || step.instruction || '';
    let displayCommand = rawCommand;

    // Resolve variables if flag is enabled
    if (resolveVariables && rawCommand) {
      displayCommand = substituteVariables(rawCommand, env.variables || {});
    }

    // Clean up command for table format - replace newlines with <br>, escape pipes and backticks
    const cleanCommand = displayCommand
      .trim()
      .replace(/\n/g, '<br>')
      .replace(/\|/g, '\\|') // Escape pipes to prevent table breakage
      .replace(/`/g, '\\`')
      .replace(/<br>$/, ''); // Remove trailing <br> tag

    if (cleanCommand) {
      rows += ` \`${cleanCommand}\` |`;
    } else if (step.sub_steps && step.sub_steps.length > 0) {
      // If step has sub_steps but no command, indicate to see substeps
      rows += ` _(see substeps below)_ |`;
    } else {
      rows += ` _(${step.type} step)_ |`;
    }
  });
  
  rows += '\n';
  
  // Add sub-steps if present
  if (step.sub_steps && step.sub_steps.length > 0) {
    step.sub_steps.forEach((subStep, subIndex) => {
      // Use letters for sub-steps: 1a, 1b, 1c, etc.
      const subStepLetter = String.fromCharCode(97 + subIndex); // 97 = 'a'
      const subStepPrefix = `${prefix}${stepNumber}${subStepLetter}`;
      rows += generateSubStepRow(subStep, subStepPrefix, environments, resolveVariables);
    });
  }
  
  return rows;
}

function generateSubStepRow(step: Step, stepId: string, environments: Environment[], resolveVariables: boolean = false): string {
  let rows = '';

  const typeIcon = step.type === 'automatic' ? '⚙️' :
                   step.type === 'manual' ? '👤' :
                   step.type === 'conditional' ? '🔀' : '✋';

  // Format as: Step 1a: Build Backend API ⚙️
  let stepCell = `Step ${stepId}: ${step.name} ${typeIcon}`;
  if (step.description && typeof step.description === 'string' && step.description.trim().length > 0) {
    stepCell += `<br>${step.description}`;
  }

  // Add dependency information
  if (step.needs && step.needs.length > 0) {
    stepCell += `<br>📋 <em>Depends on: ${step.needs.join(', ')}</em>`;
  }

  rows += `| ${stepCell} |`;

  // Subsequent columns: Commands for each environment
  environments.forEach(env => {
    const rawCommand = step.command || step.instruction || '';
    let displayCommand = rawCommand;

    // Resolve variables if flag is enabled
    if (resolveVariables && rawCommand) {
      displayCommand = substituteVariables(rawCommand, env.variables || {});
    }

    // Clean up command for table format - replace newlines with <br>, escape pipes and backticks
    const cleanCommand = displayCommand
      .trim()
      .replace(/\n/g, '<br>')
      .replace(/\|/g, '\\|') // Escape pipes to prevent table breakage
      .replace(/`/g, '\\`')
      .replace(/<br>$/, ''); // Remove trailing <br> tag

    if (cleanCommand) {
      rows += ` \`${cleanCommand}\` |`;
    } else if (step.sub_steps && step.sub_steps.length > 0) {
      // If step has sub_steps but no command, indicate to see substeps
      rows += ` _(see substeps below)_ |`;
    } else {
      rows += ` _(${step.type} step)_ |`;
    }
  });

  rows += '\n';
  return rows;
}

/**
 * Enhanced manual generation with metadata and environment filtering
 */
export function generateManualWithMetadata(
  operation: Operation,
  metadata?: GenerationMetadata,
  targetEnvironment?: string,
  resolveVariables?: boolean
): string {
  let markdown = '';

  // Add YAML frontmatter if metadata is provided
  if (metadata) {
    markdown += generateYamlFrontmatter(metadata);
  }

  // Filter environments if specified
  let environments = operation.environments;
  if (targetEnvironment) {
    environments = operation.environments.filter(env => env.name === targetEnvironment);
    if (environments.length === 0) {
      throw new Error(`Environment '${targetEnvironment}' not found in operation. Available: ${operation.environments.map(e => e.name).join(', ')}`);
    }
  }

  // Create filtered operation for generation
  const filteredOperation = {
    ...operation,
    environments
  };

  markdown += generateManualContent(filteredOperation, resolveVariables);
  return markdown;
}

/**
 * Legacy function for backward compatibility
 * Note: Maintains old behavior of resolving variables for backward compatibility
 */
export function generateManual(operation: Operation): string {
  return generateManualContent(operation, true);
}

/**
 * Core manual content generation (without frontmatter)
 */
function generateManualContent(operation: Operation, resolveVariables: boolean = false): string {
  let markdown = `# Manual for: ${operation.name} (v${operation.version})\n\n`;
  if (operation.description) {
    markdown += `_${operation.description}_\n\n`;
  }

  // Operation Dependencies
  if (operation.needs && operation.needs.length > 0) {
    markdown += '## Dependencies\n\n';
    markdown += 'This operation depends on the following operations being completed first:\n\n';
    operation.needs.forEach(dep => {
      markdown += `- **${dep}**\n`;
    });
    markdown += '\n';
  }

  // Marketplace Operation Usage
  if (operation.uses) {
    markdown += '## Based On\n\n';
    markdown += `This operation extends: **${operation.uses}**\n`;
    if (operation.with && Object.keys(operation.with).length > 0) {
      markdown += '\nWith parameters:\n';
      Object.entries(operation.with).forEach(([key, value]) => {
        markdown += `- ${key}: ${JSON.stringify(value)}\n`;
      });
    }
    markdown += '\n';
  }

  // Show imported step libraries
  if ((operation as any).imports && Array.isArray((operation as any).imports)) {
    markdown += '## Imported Step Libraries\n\n';
    markdown += 'This operation uses reusable steps from the following libraries:\n\n';
    (operation as any).imports.forEach((importPath: string) => {
      markdown += `- \`${importPath}\`\n`;
    });
    markdown += '\n';
  }

  // Environments Overview Table
  if (operation.environments && operation.environments.length > 0) {
    markdown += '## Environments Overview\n\n';
    markdown += '| Environment | Description | Variables | Targets | Approval Required |\n';
    markdown += '| ----------- | ----------- | --------- | ------- | ----------------- |\n';
    operation.environments.forEach(env => {
      // Format variables with line breaks for better readability
      const vars = env.variables ? Object.keys(env.variables)
        .map(key => `${key}: ${JSON.stringify(env.variables[key])}`)
        .join('<br>') : '';
      
      // Format targets with line breaks
      const targets = env.targets ? env.targets.join('<br>') : '';
      
      const approval = env.approval_required === true ? 'Yes' : 'No';
      markdown += `| ${env.name} | ${env.description || ''} | ${vars} | ${targets} | ${approval} |\n`;
    });
    markdown += '\n';
  }

  // Group steps by phase and generate sections
  if (operation.steps && operation.steps.length > 0) {
    // Group steps by phase
    const phases: { [key: string]: Step[] } = {
      preflight: [],
      flight: [],
      postflight: []
    };

    operation.steps.forEach(step => {
      const phase = step.phase || 'flight';
      if (phases[phase]) {
        phases[phase].push(step);
      }
    });

    // Generate section for each phase that has steps
    Object.entries(phases).forEach(([phaseName, phaseSteps]) => {
      if (phaseSteps.length === 0) return;

      // Phase section headers with flight metaphor
      const phaseHeaders = {
        preflight: '## 🛫 Pre-Flight Phase',
        flight: '## ✈️ Flight Phase (Main Operations)',
        postflight: '## 🛬 Post-Flight Phase'
      };

      markdown += `${phaseHeaders[phaseName as keyof typeof phaseHeaders]}\n\n`;

      // Build table header
      markdown += '| Step |';
      operation.environments.forEach(env => {
        markdown += ` ${env.name} |`;
      });
      markdown += '\n';

      // Build table separator
      markdown += '|------|';
      operation.environments.forEach(() => {
        markdown += '---------|';
      });
      markdown += '\n';

      // Build table rows for this phase
      phaseSteps.forEach((step, index) => {
        markdown += generateStepRow(step, index + 1, operation.environments, resolveVariables);
      });
      markdown += '\n';
    });
  }

  return markdown;
}