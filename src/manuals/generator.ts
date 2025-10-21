import fs from 'node:fs';
import path from 'node:path';
import {
  type GenerationMetadata,
  generateYamlFrontmatter,
} from '../lib/git-metadata';
import { indexToLetters } from '../lib/letter-sequence';
import type { Environment, Operation, Step } from '../models/operation';

function substituteVariables(
  command: string,
  envVariables: Record<string, any>,
  stepVariables?: Record<string, any>,
): string {
  // Merge variables with priority: step > env
  const mergedVariables = { ...envVariables, ...(stepVariables || {}) };

  // Perform variable substitution on ENTIRE content
  let result = command;
  for (const key in mergedVariables) {
    const regex = new RegExp(`\\$\\{${key}\\}`, 'g');
    result = result.replace(regex, mergedVariables[key]);
  }

  return result;
}

function formatTimelineForDisplay(timeline: any): string {
  if (typeof timeline === 'string') {
    return timeline;
  }

  // Structured format - convert to natural, readable format
  const parts: string[] = [];

  // Start time or dependency
  if (timeline.start) {
    parts.push(timeline.start);
  } else if (timeline.after) {
    parts.push(`(after ${timeline.after})`);
  }

  // Duration with "for" prefix if we have a start time
  if (timeline.duration) {
    if (timeline.start) {
      parts.push(`for ${timeline.duration}`);
    } else {
      parts.push(timeline.duration);
    }
  }

  return parts.join(' ');
}

function formatEvidenceInfo(
  evidence?: {
    required?: boolean;
    types?: string[];
    results?: Record<
      string,
      Array<{
        type: string;
        file?: string;
        content?: string;
        description?: string;
      }>
    >;
  },
  environmentName?: string,
  operationDir?: string,
): string {
  if (!evidence) return '';

  const types = evidence.types || [];
  const typesText = types.length > 0 ? `: ${types.join(', ')}` : '';
  const status = evidence.required ? 'Required' : 'Optional';

  let result = '';

  // Only show evidence metadata in step column (when environmentName is undefined)
  if (!environmentName) {
    result = `<br>📎 <em>Evidence ${status}${typesText}</em>`;

    // Add code block placeholder for command_output evidence type
    if (types.includes('command_output')) {
      result += '<br>```bash<br># Paste command output here<br>```';
    }
  }

  // Render evidence results for specific environment
  if (evidence.results && environmentName) {
    const envResults = evidence.results[environmentName];
    if (envResults && envResults.length > 0) {
      result += '<br><br>**Captured Evidence:**';

      for (const evidenceResult of envResults) {
        result += '<br>';

        // Add description if present
        if (evidenceResult.description) {
          result += `<br>**${evidenceResult.type}**: ${evidenceResult.description}`;
        } else {
          result += `<br>**${evidenceResult.type}**:`;
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
              const filePath = path.resolve(operationDir, evidenceResult.file);
              const fileContent = fs.readFileSync(filePath, 'utf-8');
              const language =
                evidenceResult.type === 'command_output' ? 'bash' : 'text';
              const escapedContent = fileContent
                .replace(/\|/g, '\\|')
                .replace(/\n/g, '<br>');
              result += `<br>\`\`\`${language}<br>${escapedContent}<br>\`\`\``;
            } catch (_error) {
              // Fallback to link if file can't be read
              result += `<br>[View ${evidenceResult.type}](${evidenceResult.file}) <em>(error reading file)</em>`;
            }
          }
          // For screenshots/photos, render as image
          else if (
            evidenceResult.type === 'screenshot' ||
            evidenceResult.type === 'photo'
          ) {
            result += `<br>![Evidence](${evidenceResult.file})`;
          }
          // For other file types, render as link
          else {
            result += `<br>[View ${evidenceResult.type}](${evidenceResult.file})`;
          }
        } else if (evidenceResult.content) {
          // Inline content - render in code block
          const language =
            evidenceResult.type === 'command_output' ? 'bash' : 'text';
          // Escape pipe characters and convert newlines
          const escapedContent = evidenceResult.content
            .replace(/\|/g, '\\|')
            .replace(/\n/g, '<br>');
          result += `<br>\`\`\`${language}<br>${escapedContent}<br>\`\`\``;
        }
      }
    }
  }

  return result;
}

/**
 * Recursively collect all steps with timeline information, including nested sub-steps
 */
function collectAllStepsWithTimeline(steps: Step[]): Step[] {
  const result: Step[] = [];

  function traverse(step: Step) {
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

function generateGanttChart(operation: Operation): string {
  // Filter steps that have timeline information (including sub-steps)
  const stepsWithTimeline = collectAllStepsWithTimeline(operation.steps);

  if (stepsWithTimeline.length === 0) {
    return '';
  }

  let gantt = '```mermaid\n';
  gantt += 'gantt\n';
  gantt += `    title ${operation.name} Timeline\n`;
  gantt += '    dateFormat YYYY-MM-DD HH:mm\n';
  gantt += '    axisFormat %m-%d %H:%M\n\n';

  // Group steps by phase
  const phases: { [key: string]: Step[] } = {
    preflight: [],
    flight: [],
    postflight: [],
  };

  stepsWithTimeline.forEach((step) => {
    const phase = step.phase || 'flight';
    if (phases[phase]) {
      phases[phase].push(step);
    }
  });

  // Generate sections for each phase
  // Note: Emojis removed from section names as Mermaid doesn't render them correctly
  const phaseNames = {
    preflight: 'Pre-Flight Phase',
    flight: 'Flight Phase',
    postflight: 'Post-Flight Phase',
  };

  // Track previous step name across all phases for auto-dependency
  let previousStepName: string | null = null;

  Object.entries(phases).forEach(([phaseName, phaseSteps]) => {
    if (phaseSteps.length === 0) return;

    gantt += `    section ${phaseNames[phaseName as keyof typeof phaseNames]}\n`;

    phaseSteps.forEach((step, _index) => {
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

      // Format: Task name :status, start, duration or end
      gantt += `    ${taskName}${pic} :${timelineSyntax}\n`;

      // Track previous step name for auto-dependency
      previousStepName = taskName;
    });
    gantt += '\n';
  });

  gantt += '```\n\n';
  return gantt;
}

function generateStepRow(
  step: Step,
  stepNumber: number,
  environments: Environment[],
  resolveVariables: boolean = false,
  prefix: string = '',
  currentPhase?: string,
  operationDir?: string,
): string {
  let rows = '';

  const typeIcon =
    step.type === 'automatic'
      ? '⚙️'
      : step.type === 'manual'
        ? '👤'
        : step.type === 'conditional'
          ? '🔀'
          : '✋';

  const phaseIcon =
    step.phase === 'preflight'
      ? '🛫'
      : step.phase === 'flight'
        ? '✈️'
        : step.phase === 'postflight'
          ? '🛬'
          : '';

  // First column: Step name, phase, icon, and description
  // Add checkbox for tracking completion
  let stepCell = `[ ] ${prefix}Step ${stepNumber}: ${step.name} ${phaseIcon}${typeIcon}`;
  // Only show phase if it differs from the current section phase
  if (step.phase && step.phase !== currentPhase) {
    stepCell += `<br><em>Phase: ${step.phase}</em>`;
  }
  if (
    step.description &&
    typeof step.description === 'string' &&
    step.description.trim().length > 0
  ) {
    stepCell += `<br>${step.description}`;
  }

  // Add dependency information
  if (step.needs && step.needs.length > 0) {
    stepCell += `<br>📋 <em>Depends on: ${step.needs.join(', ')}</em>`;
  }

  // Add ticket references
  if (step.ticket) {
    const tickets = Array.isArray(step.ticket) ? step.ticket : [step.ticket];
    stepCell += `<br>🎫 <em>Tickets: ${tickets.join(', ')}</em>`;
  }

  // Add PIC (Person In Charge)
  if (step.pic) {
    stepCell += `<br>👤 <em>PIC: ${step.pic}</em>`;
  }

  // Add Reviewer (monitoring/buddy)
  if (step.reviewer) {
    stepCell += `<br>👥 <em>Reviewer: ${step.reviewer}</em>`;
  }

  // Add timeline
  if (step.timeline) {
    stepCell += `<br>⏱️ <em>Timeline: ${formatTimelineForDisplay(step.timeline)}</em>`;
  }

  // Add conditional expression if present
  if (step.if) {
    stepCell += `<br>🔀 <em>Condition: ${step.if}</em>`;
  }

  // Add evidence requirements if present (metadata only, no env-specific results here)
  stepCell += formatEvidenceInfo(step.evidence);

  rows += `| ${stepCell} |`;

  // Subsequent columns: Commands for each environment
  environments.forEach((env) => {
    let cellContent = '';

    // Get step-level options (defaults)
    const substituteVars = step.options?.substitute_vars ?? true;
    const showCommandSeparately =
      step.options?.show_command_separately ?? false;

    // Process instruction (markdown content)
    if (step.instruction) {
      let displayInstruction = step.instruction;

      if (resolveVariables && substituteVars) {
        displayInstruction = substituteVariables(
          displayInstruction,
          env.variables || {},
          step.variables,
        );
      }

      // Preserve markdown formatting and escape only pipes
      const cleanInstruction = displayInstruction
        .trim()
        .replace(/\|/g, '\\|') // Escape pipes to prevent table breakage
        .replace(/\n/g, '<br>');
      cellContent += cleanInstruction;
    }

    // Process command (code content)
    if (step.command) {
      let displayCommand = step.command;

      if (resolveVariables && substituteVars) {
        displayCommand = substituteVariables(
          displayCommand,
          env.variables || {},
          step.variables,
        );
      }

      // Wrap in backticks and escape special characters
      const cleanCommand = displayCommand
        .trim()
        .replace(/\n/g, '<br>')
        .replace(/\|/g, '\\|') // Escape pipes to prevent table breakage
        .replace(/`/g, '\\`')
        .replace(/<br>$/, ''); // Remove trailing <br> tag

      if (showCommandSeparately && step.instruction) {
        // Show command separately with label
        cellContent += `<br><br>**Command:**<br>\`${cleanCommand}\``;
      } else if (!step.instruction) {
        // No instruction, just show command
        cellContent += `\`${cleanCommand}\``;
      } else {
        // Both present, inline mode
        cellContent += `<br><br>\`${cleanCommand}\``;
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

    // Add sign-off checkboxes if PIC or Reviewer is set (per environment)
    if (step.pic || step.reviewer) {
      cellContent += '<br><br>**Sign-off:**';
      if (step.pic) {
        cellContent += '<br>- [ ] PIC';
      }
      if (step.reviewer) {
        cellContent += '<br>- [ ] Reviewer';
      }
    }

    // Add environment-specific evidence results
    cellContent += formatEvidenceInfo(step.evidence, env.name, operationDir);

    rows += ` ${cellContent} |`;
  });

  rows += '\n';

  // Add sub-steps if present with section_heading support
  if (step.sub_steps && step.sub_steps.length > 0) {
    step.sub_steps.forEach((subStep, subIndex) => {
      // Use letters for sub-steps: 1a, 1b, 1c, etc. (supports unlimited with aa, ab, etc.)
      const subStepLetter = indexToLetters(subIndex);
      const subStepPrefix = `${prefix}${stepNumber}${subStepLetter}`;

      // Handle section headings for sub-steps
      if (subStep.section_heading) {
        // Close current table
        rows += '\n';

        // Add section heading
        rows += `#### ${subStep.name}\n\n`;
        if (subStep.description) {
          rows += `${subStep.description}\n\n`;
        }

        // Add PIC and timeline if present in section heading
        if (subStep.pic || subStep.timeline) {
          const metadata = [];
          if (subStep.pic) metadata.push(`👤 PIC: ${subStep.pic}`);
          if (subStep.timeline)
            metadata.push(`⏱️ Timeline: ${subStep.timeline}`);
          rows += `_${metadata.join(' • ')}_\n\n`;
        }

        // Reopen table with headers
        rows += '| Step |';
        environments.forEach((env) => {
          rows += ` ${env.name} |`;
        });
        rows += '\n';
        rows += '|------|';
        environments.forEach(() => {
          rows += '---------|';
        });
        rows += '\n';
      }

      rows += generateSubStepRow(
        subStep,
        subStepPrefix,
        environments,
        resolveVariables,
        1,
        operationDir,
      );
    });
  }

  return rows;
}

function generateSubStepRow(
  step: Step,
  stepId: string,
  environments: Environment[],
  resolveVariables: boolean = false,
  depth: number = 1,
  operationDir?: string,
): string {
  let rows = '';

  const typeIcon =
    step.type === 'automatic'
      ? '⚙️'
      : step.type === 'manual'
        ? '👤'
        : step.type === 'conditional'
          ? '🔀'
          : '✋';

  // Add indentation for deeper nesting levels using nbsp or spaces
  const indent = '&nbsp;&nbsp;'.repeat(depth - 1);

  // Format as: Step 1a: Build Backend API ⚙️
  // Add checkbox for tracking completion
  let stepCell = `[ ] ${indent}Step ${stepId}: ${step.name} ${typeIcon}`;
  if (
    step.description &&
    typeof step.description === 'string' &&
    step.description.trim().length > 0
  ) {
    stepCell += `<br>${step.description}`;
  }

  // Add dependency information
  if (step.needs && step.needs.length > 0) {
    stepCell += `<br>📋 <em>Depends on: ${step.needs.join(', ')}</em>`;
  }

  // Add ticket references
  if (step.ticket) {
    const tickets = Array.isArray(step.ticket) ? step.ticket : [step.ticket];
    stepCell += `<br>🎫 <em>Tickets: ${tickets.join(', ')}</em>`;
  }

  // Add PIC (Person In Charge)
  if (step.pic) {
    stepCell += `<br>👤 <em>PIC: ${step.pic}</em>`;
  }

  // Add Reviewer (monitoring/buddy)
  if (step.reviewer) {
    stepCell += `<br>👥 <em>Reviewer: ${step.reviewer}</em>`;
  }

  // Add timeline
  if (step.timeline) {
    stepCell += `<br>⏱️ <em>Timeline: ${formatTimelineForDisplay(step.timeline)}</em>`;
  }

  // Add conditional expression if present (for sub-steps)
  if (step.if) {
    stepCell += `<br>🔀 <em>Condition: ${step.if}</em>`;
  }

  // Add evidence requirements if present (metadata only)
  stepCell += formatEvidenceInfo(step.evidence);

  rows += `| ${stepCell} |`;

  // Subsequent columns: Commands for each environment
  environments.forEach((env) => {
    let cellContent = '';

    // Get sub-step options (defaults)
    const substituteVars = step.options?.substitute_vars ?? true;
    const showCommandSeparately =
      step.options?.show_command_separately ?? false;

    // Process instruction (markdown content)
    if (step.instruction) {
      let displayInstruction = step.instruction;

      if (resolveVariables && substituteVars) {
        displayInstruction = substituteVariables(
          displayInstruction,
          env.variables || {},
          step.variables,
        );
      }

      // Preserve markdown formatting and escape only pipes
      const cleanInstruction = displayInstruction
        .trim()
        .replace(/\|/g, '\\|') // Escape pipes to prevent table breakage
        .replace(/\n/g, '<br>');
      cellContent += cleanInstruction;
    }

    // Process command (code content)
    if (step.command) {
      let displayCommand = step.command;

      if (resolveVariables && substituteVars) {
        displayCommand = substituteVariables(
          displayCommand,
          env.variables || {},
          step.variables,
        );
      }

      // Wrap in backticks and escape special characters
      const cleanCommand = displayCommand
        .trim()
        .replace(/\n/g, '<br>')
        .replace(/\|/g, '\\|') // Escape pipes to prevent table breakage
        .replace(/`/g, '\\`')
        .replace(/<br>$/, ''); // Remove trailing <br> tag

      if (showCommandSeparately && step.instruction) {
        // Show command separately with label
        cellContent += `<br><br>**Command:**<br>\`${cleanCommand}\``;
      } else if (!step.instruction) {
        // No instruction, just show command
        cellContent += `\`${cleanCommand}\``;
      } else {
        // Both present, inline mode
        cellContent += `<br><br>\`${cleanCommand}\``;
      }
    }

    // Fallback for sub-steps with neither
    if (!cellContent) {
      if (step.sub_steps && step.sub_steps.length > 0) {
        cellContent = '_(see substeps below)_';
      } else {
        cellContent = `_(${step.type} step)_`;
      }
    }

    // Add environment-specific evidence results
    cellContent += formatEvidenceInfo(step.evidence, env.name, operationDir);

    // Add sign-off checkboxes if PIC or Reviewer is set (per environment)
    if (step.pic || step.reviewer) {
      cellContent += '<br><br>**Sign-off:**';
      if (step.pic) {
        cellContent += '<br>- [ ] PIC';
      }
      if (step.reviewer) {
        cellContent += '<br>- [ ] Reviewer';
      }
    }

    rows += ` ${cellContent} |`;
  });

  rows += '\n';

  // Handle nested sub-steps recursively (e.g., 1a1, 1a2, 1a1a, etc.)
  if (step.sub_steps && step.sub_steps.length > 0) {
    step.sub_steps.forEach((nestedSubStep, nestedIndex) => {
      // For nested sub-steps, determine numbering based on depth
      // depth 1: 1a -> depth 2: 1a1, 1a2 -> depth 3: 1a1a, 1a1b
      let nestedStepId: string;
      if (depth % 2 === 1) {
        // Odd depth: use numbers (1a1, 1a2, 1a3)
        nestedStepId = `${stepId}${nestedIndex + 1}`;
      } else {
        // Even depth: use letters (1a1a, 1a1b, 1a1c) - supports unlimited with aa, ab, etc.
        const letter = indexToLetters(nestedIndex);
        nestedStepId = `${stepId}${letter}`;
      }

      // Handle section headings for nested sub-steps
      if (nestedSubStep.section_heading) {
        // Close current table
        rows += '\n';

        // Add section heading with appropriate level (h5 for double-nested)
        const headingLevel = '#'.repeat(Math.min(4 + depth, 6)); // Max h6
        rows += `${headingLevel} ${nestedSubStep.name}\n\n`;
        if (nestedSubStep.description) {
          rows += `${nestedSubStep.description}\n\n`;
        }

        // Add PIC and timeline if present
        if (nestedSubStep.pic || nestedSubStep.timeline) {
          const metadata = [];
          if (nestedSubStep.pic) metadata.push(`👤 PIC: ${nestedSubStep.pic}`);
          if (nestedSubStep.timeline)
            metadata.push(
              `⏱️ Timeline: ${formatTimelineForDisplay(nestedSubStep.timeline)}`,
            );
          rows += `_${metadata.join(' • ')}_\n\n`;
        }

        // Reopen table with headers
        rows += '| Step |';
        environments.forEach((env) => {
          rows += ` ${env.name} |`;
        });
        rows += '\n';
        rows += '|------|';
        environments.forEach(() => {
          rows += '---------|';
        });
        rows += '\n';
      }

      rows += generateSubStepRow(
        nestedSubStep,
        nestedStepId,
        environments,
        resolveVariables,
        depth + 1,
        operationDir,
      );
    });
  }

  return rows;
}

/**
 * Enhanced manual generation with metadata and environment filtering
 */
export function generateManualWithMetadata(
  operation: Operation,
  metadata?: GenerationMetadata,
  targetEnvironment?: string,
  resolveVariables?: boolean,
  includeGantt?: boolean,
  operationDir?: string,
): string {
  let markdown = '';

  // Add YAML frontmatter if metadata is provided
  if (metadata) {
    markdown += generateYamlFrontmatter(metadata);
  }

  // Add Gantt chart if requested and steps have timeline data
  if (includeGantt) {
    const ganttChart = generateGanttChart(operation);
    if (ganttChart === '') {
      console.warn(
        '⚠️  --gantt flag provided but no timeline data found in steps. Gantt chart will not be generated.',
      );
    } else {
      markdown += ganttChart;
    }
  }

  // Filter environments if specified
  let environments = operation.environments;
  if (targetEnvironment) {
    environments = operation.environments.filter(
      (env) => env.name === targetEnvironment,
    );
    if (environments.length === 0) {
      throw new Error(
        `Environment '${targetEnvironment}' not found in operation. Available: ${operation.environments.map((e) => e.name).join(', ')}`,
      );
    }
  }

  // Create filtered operation for generation
  const filteredOperation = {
    ...operation,
    environments,
  };

  markdown += generateManualContent(
    filteredOperation,
    resolveVariables,
    operationDir,
  );
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
 * Generate overview section table
 */
function generateOverviewSection(overview: Record<string, any>): string {
  let markdown = '## Overview\n\n';
  markdown += '| Item | Specification |\n';
  markdown += '| ---- | ------------- |\n';

  Object.entries(overview).forEach(([key, value]) => {
    // Format value based on type
    let formattedValue: string;

    if (Array.isArray(value)) {
      // Array values: join with line breaks
      formattedValue = value.join('<br>');
    } else if (typeof value === 'object' && value !== null) {
      // Object values: convert to JSON
      formattedValue = JSON.stringify(value);
    } else {
      // Primitive values: convert to string
      formattedValue = String(value);
    }

    // Escape pipes in value to prevent table breakage
    formattedValue = formattedValue.replace(/\|/g, '\\|');

    markdown += `| ${key} | ${formattedValue} |\n`;
  });

  markdown += '\n';
  return markdown;
}

/**
 * Core manual content generation (without frontmatter)
 */
function generateManualContent(
  operation: Operation,
  resolveVariables: boolean = false,
  operationDir?: string,
): string {
  let markdown = `# Manual for: ${operation.name} (v${operation.version})\n\n`;
  if (operation.description) {
    markdown += `_${operation.description}_\n\n`;
  }

  // Overview section (if present)
  if (operation.overview && Object.keys(operation.overview).length > 0) {
    markdown += generateOverviewSection(operation.overview);
  }

  // Operation Dependencies
  if (operation.needs && operation.needs.length > 0) {
    markdown += '## Dependencies\n\n';
    markdown +=
      'This operation depends on the following operations being completed first:\n\n';
    operation.needs.forEach((dep) => {
      markdown += `- **${dep}**\n`;
    });
    markdown += '\n';
  }

  // Marketplace Operation Usage
  if (operation.template) {
    markdown += '## Based On\n\n';
    markdown += `This operation extends: **${operation.template}**\n`;
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
    markdown +=
      'This operation uses reusable steps from the following libraries:\n\n';
    (operation as any).imports.forEach((importPath: string) => {
      markdown += `- \`${importPath}\`\n`;
    });
    markdown += '\n';
  }

  // Environments Overview Table
  if (operation.environments && operation.environments.length > 0) {
    markdown += '## Environments Overview\n\n';
    markdown +=
      '| Environment | Description | Variables | Targets | Approval Required |\n';
    markdown +=
      '| ----------- | ----------- | --------- | ------- | ----------------- |\n';
    operation.environments.forEach((env) => {
      // Format variables with line breaks for better readability
      const vars = env.variables
        ? Object.keys(env.variables)
            .map((key) => `${key}: ${JSON.stringify(env.variables[key])}`)
            .join('<br>')
        : '';

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
      postflight: [],
    };

    operation.steps.forEach((step) => {
      const phase = step.phase || 'flight';
      if (phases[phase]) {
        phases[phase].push(step);
      }
    });

    // Generate section for each phase that has steps
    let globalStepNumber = 1; // Continuous numbering across all phases

    Object.entries(phases).forEach(([phaseName, phaseSteps]) => {
      if (phaseSteps.length === 0) return;

      // Phase section headers with flight metaphor
      const phaseHeaders = {
        preflight: '## 🛫 Pre-Flight Phase',
        flight: '## ✈️ Flight Phase (Main Operations)',
        postflight: '## 🛬 Post-Flight Phase',
      };

      markdown += `${phaseHeaders[phaseName as keyof typeof phaseHeaders]}\n\n`;

      // Only build initial table header if first step is not a section heading
      const firstStepIsSection =
        phaseSteps.length > 0 && phaseSteps[0].section_heading;
      let tableOpen = false;

      if (!firstStepIsSection) {
        // Build table header
        markdown += '| Step |';
        operation.environments.forEach((env) => {
          markdown += ` ${env.name} |`;
        });
        markdown += '\n';

        // Build table separator
        markdown += '|------|';
        operation.environments.forEach(() => {
          markdown += '---------|';
        });
        markdown += '\n';
        tableOpen = true;
      }

      // Build table rows for this phase with continuous numbering
      // Handle section headings by closing/reopening tables
      phaseSteps.forEach((step, _index) => {
        if (step.section_heading) {
          // Close current table if one is open
          if (tableOpen) {
            markdown += '\n';
            tableOpen = false;
          }

          // Add section heading
          markdown += `### ${step.name}\n\n`;
          if (step.description) {
            markdown += `${step.description}\n\n`;
          }

          // Add PIC and timeline if present in section heading
          if (step.pic || step.timeline) {
            const metadata = [];
            if (step.pic) metadata.push(`👤 PIC: ${step.pic}`);
            if (step.timeline)
              metadata.push(
                `⏱️ Timeline: ${formatTimelineForDisplay(step.timeline)}`,
              );
            markdown += `_${metadata.join(' • ')}_\n\n`;
          }

          // Reopen table
          markdown += '| Step |';
          operation.environments.forEach((env) => {
            markdown += ` ${env.name} |`;
          });
          markdown += '\n';
          markdown += '|------|';
          operation.environments.forEach(() => {
            markdown += '---------|';
          });
          markdown += '\n';
          tableOpen = true;
        }

        markdown += generateStepRow(
          step,
          globalStepNumber,
          operation.environments,
          resolveVariables,
          '',
          phaseName,
          operationDir,
        );

        // Inline rollback rendering - render immediately after step if present
        if (
          step.rollback &&
          (step.rollback.command || step.rollback.instruction)
        ) {
          // Close current table
          markdown += '\n';

          // Add rollback heading
          markdown += `### 🔄 Rollback for Step ${globalStepNumber}: ${step.name}\n\n`;

          // Render rollback table
          markdown += '| Environment | Rollback Action |\n';
          markdown += '|-------------|----------------|\n';

          operation.environments.forEach((env) => {
            let cellContent = '';

            // Get rollback options (defaults)
            const substituteVars =
              step.rollback?.options?.substitute_vars ?? true;
            const showCommandSeparately =
              step.rollback?.options?.show_command_separately ?? false;

            // Process rollback instruction (markdown content)
            if (step.rollback?.instruction) {
              let displayInstruction = step.rollback.instruction;

              if (resolveVariables && substituteVars) {
                displayInstruction = substituteVariables(
                  displayInstruction,
                  env.variables || {},
                  step.variables,
                );
              }

              // Preserve markdown formatting and escape only pipes
              const cleanInstruction = displayInstruction
                .trim()
                .replace(/\|/g, '\\|')
                .replace(/\n/g, '<br>');
              cellContent += cleanInstruction;
            }

            // Process rollback command (code content)
            if (step.rollback?.command) {
              let displayCommand = step.rollback.command;

              if (resolveVariables && substituteVars) {
                displayCommand = substituteVariables(
                  displayCommand,
                  env.variables || {},
                  step.variables,
                );
              }

              // Wrap in backticks and escape special characters
              const cleanCommand = displayCommand
                .trim()
                .replace(/\n/g, '<br>')
                .replace(/\|/g, '\\|')
                .replace(/`/g, '\\`')
                .replace(/<br>$/, '');

              if (showCommandSeparately && step.rollback.instruction) {
                cellContent += `<br><br>**Command:**<br>\`${cleanCommand}\``;
              } else if (!step.rollback.instruction) {
                cellContent += `\`${cleanCommand}\``;
              } else {
                cellContent += `<br><br>\`${cleanCommand}\``;
              }
            }

            // Fallback
            if (!cellContent) {
              cellContent = '-';
            }

            markdown += `| ${env.name} | ${cellContent} |\n`;
          });

          markdown += '\n';

          // Reopen table with headers
          markdown += '| Step |';
          operation.environments.forEach((env) => {
            markdown += ` ${env.name} |`;
          });
          markdown += '\n';
          markdown += '|------|';
          operation.environments.forEach(() => {
            markdown += '---------|';
          });
          markdown += '\n';
        }

        globalStepNumber++; // Increment for next step
      });

      if (tableOpen) {
        markdown += '\n';
      }
    });
  }

  // Add rollback section if any steps have rollback defined
  const stepsWithRollback = operation.steps.filter((step) => step.rollback);
  if (stepsWithRollback.length > 0) {
    markdown += '## 🔄 Rollback Procedures\n\n';
    markdown +=
      'If deployment fails, execute the following rollback steps:\n\n';

    stepsWithRollback.forEach((step, _index) => {
      if (!step.rollback) return;

      markdown += `### Rollback for: ${step.name}\n\n`;

      if (step.rollback.command || step.rollback.instruction) {
        markdown += '| Environment | Rollback Action |\n';
        markdown += '|-------------|----------------|\n';

        operation.environments.forEach((env) => {
          let cellContent = '';

          // Get rollback options (defaults)
          const substituteVars =
            step.rollback?.options?.substitute_vars ?? true;
          const showCommandSeparately =
            step.rollback?.options?.show_command_separately ?? false;

          // Process rollback instruction (markdown content)
          if (step.rollback?.instruction) {
            let displayInstruction = step.rollback.instruction;

            if (resolveVariables && substituteVars) {
              displayInstruction = substituteVariables(
                displayInstruction,
                env.variables || {},
                step.variables,
              );
            }

            // Preserve markdown formatting and escape only pipes
            const cleanInstruction = displayInstruction
              .trim()
              .replace(/\|/g, '\\|')
              .replace(/\n/g, '<br>');
            cellContent += cleanInstruction;
          }

          // Process rollback command (code content)
          if (step.rollback?.command) {
            let displayCommand = step.rollback.command;

            if (resolveVariables && substituteVars) {
              displayCommand = substituteVariables(
                displayCommand,
                env.variables || {},
                step.variables,
              );
            }

            // Wrap in backticks and escape special characters
            const cleanCommand = displayCommand
              .trim()
              .replace(/\n/g, '<br>')
              .replace(/\|/g, '\\|')
              .replace(/`/g, '\\`')
              .replace(/<br>$/, '');

            if (showCommandSeparately && step.rollback.instruction) {
              cellContent += `<br><br>**Command:**<br>\`${cleanCommand}\``;
            } else if (!step.rollback.instruction) {
              cellContent += `\`${cleanCommand}\``;
            } else {
              cellContent += `<br><br>\`${cleanCommand}\``;
            }
          }

          // Fallback
          if (!cellContent) {
            cellContent = '-';
          }

          markdown += `| ${env.name} | ${cellContent} |\n`;
        });

        markdown += '\n';
      }
    });
  }

  return markdown;
}
