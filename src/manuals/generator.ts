import { Operation, Environment, Step } from '../models/operation';

function substituteVariables(command: string, variables: Record<string, any>): string {
  let substitutedCommand = command;
  for (const key in variables) {
    const regex = new RegExp(`\\$\\{${key}\\}`, 'g');
    substitutedCommand = substitutedCommand.replace(regex, variables[key]);
  }
  return substitutedCommand;
}

function generateStepRow(step: Step, stepNumber: number, environments: Environment[], prefix: string = ''): string {
  let rows = '';
  
  const typeIcon = step.type === 'automatic' ? '⚙️' : 
                   step.type === 'manual' ? '👤' : 
                   step.type === 'conditional' ? '🔀' : '✋';
  
  // First column: Step name, icon, and description
  let stepCell = `${prefix}Step ${stepNumber}: ${step.name} ${typeIcon}`;
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
    const substitutedCommand = substituteVariables(step.command || step.instruction || '', env.variables || {});
    // Clean up command for table format - replace newlines with <br> and escape backticks
    const cleanCommand = substitutedCommand
      .replace(/\n/g, '<br>')
      .replace(/`/g, '\\`')
      .trim();
    
    if (cleanCommand) {
      rows += ` \`${cleanCommand}\` |`;
    } else {
      rows += ` _(${step.type} step)_ |`;
    }
  });
  
  rows += '\n';
  
  // Add sub-steps if present
  if (step.sub_steps && step.sub_steps.length > 0) {
    step.sub_steps.forEach((subStep, subIndex) => {
      rows += generateStepRow(subStep, subIndex + 1, environments, `${prefix}${stepNumber}.`);
    });
  }
  
  return rows;
}

export function generateManual(operation: Operation): string {
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

  // Pre-flight Checklist
  if (operation.preflight && operation.preflight.length > 0) {
    markdown += '## Pre-flight Checklist\n\n';
    operation.preflight.forEach(check => {
      markdown += `- **${check.name}:** ${check.description || ''}\n`;
      markdown += `  \`\`\`bash\n`;
      markdown += `  ${check.command}\n`;
      markdown += `  \`\`\`\n\n`;
    });
  }

  // Operation Steps Table
  if (operation.steps && operation.steps.length > 0) {
    markdown += '## Operation Steps\n\n';
    
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
    
    // Build table rows
    operation.steps.forEach((step, index) => {
      markdown += generateStepRow(step, index + 1, operation.environments);
    });
    markdown += '\n';
  }

  return markdown;
}