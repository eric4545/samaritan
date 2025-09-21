import { Operation, Environment, Step } from '../models/operation';

function substituteVariables(command: string, variables: Record<string, any>): string {
  let substitutedCommand = command;
  for (const key in variables) {
    const regex = new RegExp(`\\$\\{${key}\\}`, 'g');
    substitutedCommand = substitutedCommand.replace(regex, variables[key]);
  }
  return substitutedCommand;
}

export function generateManual(operation: Operation): string {
  let markdown = `# Manual for: ${operation.name} (v${operation.version})\n\n`;
  if (operation.description) {
    markdown += `_${operation.description}_\n\n`;
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
      const typeIcon = step.type === 'automatic' ? '⚙️' : 
                       step.type === 'manual' ? '👤' : '✋';
      
      // First column: Step name, icon, and description
      let stepCell = `Step ${index + 1}: ${step.name} ${typeIcon}`;
      if (step.description && typeof step.description === 'string' && step.description.trim().length > 0) {
        stepCell += `<br>${step.description}`;
      }
      
      markdown += `| ${stepCell} |`;
      
      // Subsequent columns: Commands for each environment
      operation.environments.forEach(env => {
        const substitutedCommand = substituteVariables(step.command || '', env.variables || {});
        markdown += ` \`${substitutedCommand}\` |`;
      });
      
      markdown += '\n';
    });
    markdown += '\n';
  }

  return markdown;
}