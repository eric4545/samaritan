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
      const vars = env.variables ? Object.keys(env.variables).map(key => `${key}: ${JSON.stringify(env.variables[key])}`).join(', ') : '';
      const targets = env.targets ? env.targets.join(', ') : '';
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

  // Operation Steps
  if (operation.steps && operation.steps.length > 0) {
    markdown += '## Operation Steps\n\n';
    operation.steps.forEach((step, index) => {
      const typeIcon = step.type === 'automatic' ? '⚙️' : 
                       step.type === 'manual' ? '👤' : '✋';
      markdown += `### Step ${index + 1}: ${step.name} ${typeIcon}\n`;
      if (step.description) {
        markdown += `${step.description}\n\n`;
      }

      // Check if this step has variables that differ across environments
      const hasVariables = step.command.includes('${');
      if (hasVariables && operation.environments && operation.environments.length > 1) {
        markdown += '**Commands by environment:**\n';
        operation.environments.forEach(env => {
          const substitutedCommand = substituteVariables(step.command, env.variables || {});
          markdown += `- **${env.name}**: \`${substitutedCommand}\`\n`;
        });
        markdown += '\n';
      } else {
        // Single command (no environment differences)
        const sampleEnv = operation.environments?.[0] || { variables: {} };
        const substitutedCommand = substituteVariables(step.command, sampleEnv.variables || {});
        markdown += `**Command:** \`${substitutedCommand}\`\n\n`;
      }
    });
  }

  return markdown;
}