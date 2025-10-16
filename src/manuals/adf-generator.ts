import { PanelType } from '@atlaskit/adf-schema';
import {
  bulletList,
  code,
  codeBlock,
  doc,
  em,
  heading,
  listItem,
  panel,
  paragraph,
  strong,
  table,
  tableCell,
  tableHeader,
  tableRow,
  text,
} from '@atlaskit/adf-utils/builders';
import type { GenerationMetadata } from '../lib/git-metadata';
import type { Environment, Operation, Step } from '../models/operation';

/**
 * Convert Operation to Atlassian Document Format (ADF)
 */
export function generateADF(
  operation: Operation,
  metadata?: GenerationMetadata,
  targetEnvironment?: string,
  resolveVariables?: boolean,
): object {
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

  const filteredOperation = {
    ...operation,
    environments,
  };

  // Build ADF content nodes
  const content = [];

  // Title
  content.push(
    heading({ level: 1 })(text(`${operation.name} (v${operation.version})`)),
  );

  // Description
  if (operation.description) {
    content.push(paragraph(em(text(operation.description))));
  }

  // Overview section (if present)
  if (operation.overview && Object.keys(operation.overview).length > 0) {
    content.push(heading({ level: 2 })(text('Overview')));
    content.push(createOverviewTable(operation.overview));
  }

  // Metadata panel if available
  if (metadata) {
    content.push(createMetadataPanel(metadata));
  }

  // Dependencies
  if (operation.needs && operation.needs.length > 0) {
    content.push(heading({ level: 2 })(text('Dependencies')));
    content.push(
      paragraph(
        text(
          'This operation depends on the following operations being completed first:',
        ),
      ),
    );
    const depItems = operation.needs.map((dep) =>
      listItem([paragraph(strong(text(dep)))]),
    );
    content.push(bulletList(...depItems));
  }

  // Marketplace operation usage
  if (operation.uses) {
    content.push(heading({ level: 2 })(text('Based On')));
    content.push(
      paragraph(text('This operation extends: '), strong(text(operation.uses))),
    );
    if (operation.with && Object.keys(operation.with).length > 0) {
      content.push(paragraph(text('With parameters:')));
      const paramItems = Object.entries(operation.with).map(([key, value]) =>
        listItem([paragraph(text(`${key}: ${JSON.stringify(value)}`))]),
      );
      content.push(bulletList(...paramItems));
    }
  }

  // Environments overview
  if (environments.length > 0) {
    content.push(heading({ level: 2 })(text('Environments Overview')));
    content.push(createEnvironmentsTable(environments));
  }

  // Steps grouped by phase
  if (filteredOperation.steps && filteredOperation.steps.length > 0) {
    const phases: { [key: string]: Step[] } = {
      preflight: [],
      flight: [],
      postflight: [],
    };

    filteredOperation.steps.forEach((step) => {
      const phase = step.phase || 'flight';
      if (phases[phase]) {
        phases[phase].push(step);
      }
    });

    let globalStepNumber = 1;

    // Pre-flight phase
    if (phases.preflight.length > 0) {
      content.push(heading({ level: 2 })(text('🛫 Pre-Flight Phase')));
      content.push(
        createStepsTable(
          phases.preflight,
          environments,
          globalStepNumber,
          resolveVariables,
          'preflight',
        ),
      );
      globalStepNumber += phases.preflight.length;
    }

    // Flight phase
    if (phases.flight.length > 0) {
      content.push(
        heading({ level: 2 })(text('✈️ Flight Phase (Main Operations)')),
      );
      content.push(
        createStepsTable(
          phases.flight,
          environments,
          globalStepNumber,
          resolveVariables,
          'flight',
        ),
      );
      globalStepNumber += phases.flight.length;
    }

    // Post-flight phase
    if (phases.postflight.length > 0) {
      content.push(heading({ level: 2 })(text('🛬 Post-Flight Phase')));
      content.push(
        createStepsTable(
          phases.postflight,
          environments,
          globalStepNumber,
          resolveVariables,
          'postflight',
        ),
      );
    }
  }

  // Rollback procedures
  const stepsWithRollback = operation.steps.filter((step) => step.rollback);
  if (stepsWithRollback.length > 0) {
    content.push(heading({ level: 2 })(text('🔄 Rollback Procedures')));
    content.push(
      paragraph(
        text('If deployment fails, execute the following rollback steps:'),
      ),
    );

    stepsWithRollback.forEach((step) => {
      if (!step.rollback) return;

      content.push(heading({ level: 3 })(text(`Rollback for: ${step.name}`)));

      if (step.rollback.command || step.rollback.instruction) {
        const rollbackRows = environments.map((env) => {
          const cellContent = [];

          // Get rollback options (defaults)
          const substituteVars =
            step.rollback?.options?.substitute_vars ?? true;
          const showCommandSeparately =
            step.rollback?.options?.show_command_separately ?? false;

          // Process rollback instruction (paragraph/text content)
          if (step.rollback?.instruction) {
            let displayInstruction = step.rollback.instruction;

            if (resolveVariables && substituteVars) {
              displayInstruction = substituteVariables(
                displayInstruction,
                env.variables || {},
                step.variables,
              );
            }

            cellContent.push(paragraph(text(displayInstruction)));
          }

          // Process rollback command (code block)
          if (step.rollback?.command) {
            let displayCommand = step.rollback.command;

            if (resolveVariables && substituteVars) {
              displayCommand = substituteVariables(
                displayCommand,
                env.variables || {},
                step.variables,
              );
            }

            if (showCommandSeparately && step.rollback.instruction) {
              cellContent.push(paragraph(strong(text('Command:'))));
            }

            cellContent.push(
              codeBlock({ language: 'bash' })(text(displayCommand)),
            );
          }

          // Fallback
          if (cellContent.length === 0) {
            cellContent.push(paragraph(text('-')));
          }

          return tableRow([
            tableCell()(paragraph(text(env.name))),
            tableCell()(...cellContent),
          ]);
        });

        content.push(
          table(
            tableRow([
              tableHeader()(paragraph(text('Environment'))),
              tableHeader()(paragraph(text('Rollback Action'))),
            ]),
            ...rollbackRows,
          ),
        );
      }
    });
  }

  return doc(...content);
}

/**
 * Create metadata info panel
 */
function createMetadataPanel(metadata: GenerationMetadata): any {
  const panelContent = [];

  panelContent.push(paragraph(strong(text('Generation Information'))));

  if (metadata.operation_id) {
    panelContent.push(
      paragraph(text(`Operation ID: ${metadata.operation_id}`)),
    );
  }

  if (metadata.operation_version) {
    panelContent.push(
      paragraph(text(`Version: ${metadata.operation_version}`)),
    );
  }

  if (metadata.target_environment) {
    panelContent.push(
      paragraph(text(`Target Environment: ${metadata.target_environment}`)),
    );
  }

  if (metadata.git_sha) {
    panelContent.push(
      paragraph(text(`Git Commit: `), code(text(metadata.git_sha))),
    );
  }

  if (metadata.git_branch) {
    panelContent.push(paragraph(text(`Git Branch: ${metadata.git_branch}`)));
  }

  if (metadata.generated_at) {
    panelContent.push(
      paragraph(text(`Generated At: ${metadata.generated_at}`)),
    );
  }

  if (metadata.source_file) {
    panelContent.push(
      paragraph(text(`Source File: `), code(text(metadata.source_file))),
    );
  }

  return panel({ panelType: PanelType.INFO })(...panelContent);
}

/**
 * Create overview table with flexible metadata fields
 */
function createOverviewTable(overview: Record<string, any>): any {
  const headerRow = tableRow([
    tableHeader()(paragraph(text('Item'))),
    tableHeader()(paragraph(text('Specification'))),
  ]);

  const dataRows = Object.entries(overview).map(([key, value]) => {
    // Format value based on type
    let formattedValue: string;

    if (Array.isArray(value)) {
      // Array values: join with line breaks
      formattedValue = value.join(', ');
    } else if (typeof value === 'object' && value !== null) {
      // Object values: convert to JSON
      formattedValue = JSON.stringify(value);
    } else {
      // Primitive values: convert to string
      formattedValue = String(value);
    }

    return tableRow([
      tableCell()(paragraph(text(key))),
      tableCell()(paragraph(text(formattedValue))),
    ]);
  });

  return table(headerRow, ...dataRows);
}

/**
 * Create environments overview table
 */
function createEnvironmentsTable(environments: Environment[]): any {
  const headerRow = tableRow([
    tableHeader()(paragraph(text('Environment'))),
    tableHeader()(paragraph(text('Description'))),
    tableHeader()(paragraph(text('Variables'))),
    tableHeader()(paragraph(text('Targets'))),
    tableHeader()(paragraph(text('Approval Required'))),
  ]);

  const dataRows = environments.map((env) => {
    // Format variables
    const varsContent = env.variables
      ? Object.entries(env.variables).map(([key, value]) =>
          paragraph(text(`${key}: ${JSON.stringify(value)}`)),
        )
      : [paragraph(text('-'))];

    // Format targets
    const targetsContent = env.targets
      ? env.targets.map((target) => paragraph(text(target)))
      : [paragraph(text('-'))];

    const approval = env.approval_required === true ? 'Yes' : 'No';

    return tableRow([
      tableCell()(paragraph(text(env.name))),
      tableCell()(paragraph(text(env.description || ''))),
      tableCell()(...varsContent),
      tableCell()(...targetsContent),
      tableCell()(paragraph(text(approval))),
    ]);
  });

  return table(headerRow, ...dataRows);
}

/**
 * Create steps table for a phase
 */
function createStepsTable(
  steps: Step[],
  environments: Environment[],
  startNumber: number,
  resolveVariables?: boolean,
  currentPhase?: string,
): any {
  // Build header row
  const headerCells = [tableHeader()(paragraph(text('Step')))];
  environments.forEach((env) => {
    headerCells.push(tableHeader()(paragraph(text(env.name))));
  });

  const headerRow = tableRow(headerCells);
  const dataRows: any[] = [];

  steps.forEach((step, index) => {
    const stepNumber = startNumber + index;

    // Build step description cell
    const stepCellContent = [];

    // Step name with icons
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

    stepCellContent.push(
      paragraph(
        strong(
          text(`Step ${stepNumber}: ${step.name} ${phaseIcon}${typeIcon}`),
        ),
      ),
    );

    // Add phase only if it differs from the current section phase
    if (step.phase && step.phase !== currentPhase) {
      stepCellContent.push(paragraph(em(text(`Phase: ${step.phase}`))));
    }

    // Description
    if (
      step.description &&
      typeof step.description === 'string' &&
      step.description.trim().length > 0
    ) {
      stepCellContent.push(paragraph(text(step.description)));
    }

    // Dependencies
    if (step.needs && step.needs.length > 0) {
      stepCellContent.push(
        paragraph(text(`📋 Depends on: ${step.needs.join(', ')}`)),
      );
    }

    // Ticket references
    if (step.ticket) {
      const tickets = Array.isArray(step.ticket) ? step.ticket : [step.ticket];
      stepCellContent.push(
        paragraph(text(`🎫 Tickets: ${tickets.join(', ')}`)),
      );
    }

    // PIC
    if (step.pic) {
      stepCellContent.push(paragraph(text(`👤 PIC: ${step.pic}`)));
    }

    // Timeline
    if (step.timeline) {
      stepCellContent.push(paragraph(text(`⏱️ Timeline: ${step.timeline}`)));
    }

    // Conditional expression
    if (step.if) {
      stepCellContent.push(paragraph(text(`🔀 Condition: ${step.if}`)));
    }

    // Evidence requirements
    const evidenceInfo = formatEvidenceInfo(step.evidence);
    if (evidenceInfo) {
      // Handle both single node and array of nodes
      if (Array.isArray(evidenceInfo)) {
        stepCellContent.push(...evidenceInfo);
      } else {
        stepCellContent.push(evidenceInfo);
      }
    }

    // Build command cells for each environment
    const cells = [tableCell()(...stepCellContent)];

    environments.forEach((env) => {
      const cellContent = [];

      // Get step-level options (defaults)
      const substituteVars = step.options?.substitute_vars ?? true;
      const showCommandSeparately =
        step.options?.show_command_separately ?? false;

      // Process instruction (paragraph/text content)
      if (step.instruction) {
        let displayInstruction = step.instruction;

        if (resolveVariables && substituteVars) {
          displayInstruction = substituteVariables(
            displayInstruction,
            env.variables || {},
            step.variables,
          );
        }

        cellContent.push(paragraph(text(displayInstruction)));
      }

      // Process command (code block)
      if (step.command) {
        let displayCommand = step.command;

        if (resolveVariables && substituteVars) {
          displayCommand = substituteVariables(
            displayCommand,
            env.variables || {},
            step.variables,
          );
        }

        if (showCommandSeparately && step.instruction) {
          cellContent.push(paragraph(strong(text('Command:'))));
        }

        cellContent.push(codeBlock({ language: 'bash' })(text(displayCommand)));
      }

      // Fallback for steps with neither
      if (cellContent.length === 0) {
        if (step.sub_steps && step.sub_steps.length > 0) {
          cellContent.push(paragraph(em(text('(see substeps below)'))));
        } else {
          cellContent.push(paragraph(em(text(`(${step.type} step)`))));
        }
      }

      cells.push(tableCell()(...cellContent));
    });

    dataRows.push(tableRow(cells));

    // Add sub-steps if present (recursive)
    if (step.sub_steps && step.sub_steps.length > 0) {
      addSubStepRows(
        step.sub_steps,
        environments,
        `${stepNumber}`,
        1,
        resolveVariables,
        dataRows,
      );
    }
  });

  return table(headerRow, ...dataRows);
}

/**
 * Recursively add sub-step rows to the table
 * @param subSteps - Array of sub-steps to render
 * @param environments - Environments for command columns
 * @param stepPrefix - Current step numbering prefix (e.g., "1" or "1a")
 * @param depth - Current nesting depth (1 = first level, 2 = second level, etc.)
 * @param resolveVariables - Whether to resolve variables
 * @param dataRows - Array to append rows to
 */
function addSubStepRows(
  subSteps: Step[],
  environments: Environment[],
  stepPrefix: string,
  depth: number,
  resolveVariables: boolean | undefined,
  dataRows: any[],
): void {
  subSteps.forEach((subStep, subIndex) => {
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

    const subStepCellContent = [];
    const subTypeIcon =
      subStep.type === 'automatic'
        ? '⚙️'
        : subStep.type === 'manual'
          ? '👤'
          : subStep.type === 'conditional'
            ? '🔀'
            : '✋';

    subStepCellContent.push(
      paragraph(
        strong(text(`Step ${subStepId}: ${subStep.name} ${subTypeIcon}`)),
      ),
    );

    if (
      subStep.description &&
      typeof subStep.description === 'string' &&
      subStep.description.trim().length > 0
    ) {
      subStepCellContent.push(paragraph(text(subStep.description)));
    }

    if (subStep.needs && subStep.needs.length > 0) {
      subStepCellContent.push(
        paragraph(text(`📋 Depends on: ${subStep.needs.join(', ')}`)),
      );
    }

    if (subStep.ticket) {
      const tickets = Array.isArray(subStep.ticket)
        ? subStep.ticket
        : [subStep.ticket];
      subStepCellContent.push(
        paragraph(text(`🎫 Tickets: ${tickets.join(', ')}`)),
      );
    }

    if (subStep.pic) {
      subStepCellContent.push(paragraph(text(`👤 PIC: ${subStep.pic}`)));
    }

    if (subStep.timeline) {
      subStepCellContent.push(
        paragraph(text(`⏱️ Timeline: ${subStep.timeline}`)),
      );
    }

    if (subStep.if) {
      subStepCellContent.push(paragraph(text(`🔀 Condition: ${subStep.if}`)));
    }

    // Evidence requirements for sub-steps
    const subEvidenceInfo = formatEvidenceInfo(subStep.evidence);
    if (subEvidenceInfo) {
      // Handle both single node and array of nodes
      if (Array.isArray(subEvidenceInfo)) {
        subStepCellContent.push(...subEvidenceInfo);
      } else {
        subStepCellContent.push(subEvidenceInfo);
      }
    }

    const subCells = [tableCell()(...subStepCellContent)];

    environments.forEach((env) => {
      const cellContent = [];

      // Get sub-step options (defaults)
      const substituteVars = subStep.options?.substitute_vars ?? true;
      const showCommandSeparately =
        subStep.options?.show_command_separately ?? false;

      // Process instruction (paragraph/text content)
      if (subStep.instruction) {
        let displayInstruction = subStep.instruction;

        if (resolveVariables && substituteVars) {
          displayInstruction = substituteVariables(
            displayInstruction,
            env.variables || {},
            subStep.variables,
          );
        }

        cellContent.push(paragraph(text(displayInstruction)));
      }

      // Process command (code block)
      if (subStep.command) {
        let displayCommand = subStep.command;

        if (resolveVariables && substituteVars) {
          displayCommand = substituteVariables(
            displayCommand,
            env.variables || {},
            subStep.variables,
          );
        }

        if (showCommandSeparately && subStep.instruction) {
          cellContent.push(paragraph(strong(text('Command:'))));
        }

        cellContent.push(codeBlock({ language: 'bash' })(text(displayCommand)));
      }

      // Fallback for sub-steps with neither
      if (cellContent.length === 0) {
        if (subStep.sub_steps && subStep.sub_steps.length > 0) {
          cellContent.push(paragraph(em(text('(see substeps below)'))));
        } else {
          cellContent.push(paragraph(em(text(`(${subStep.type} step)`))));
        }
      }

      subCells.push(tableCell()(...cellContent));
    });

    dataRows.push(tableRow(subCells));

    // Recursively add nested sub-steps
    if (subStep.sub_steps && subStep.sub_steps.length > 0) {
      addSubStepRows(
        subStep.sub_steps,
        environments,
        subStepId,
        depth + 1,
        resolveVariables,
        dataRows,
      );
    }
  });
}

/**
 * Substitute variables in command string
 */
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

/**
 * Format evidence requirements as ADF paragraph
 */
function formatEvidenceInfo(evidence?: {
  required?: boolean;
  types?: string[];
  results?: Array<{
    type: string;
    file?: string;
    content?: string;
    description?: string;
  }>;
}): any {
  if (!evidence) return null;

  const types = evidence.types || [];
  const typesText = types.length > 0 ? `: ${types.join(', ')}` : '';
  const status = evidence.required ? 'Required' : 'Optional';

  const nodes: any[] = [paragraph(em(text(`📎 Evidence ${status}${typesText}`)))];

  // Render evidence results if present
  if (evidence.results && evidence.results.length > 0) {
    nodes.push(paragraph(strong(text('Captured Evidence:'))));

    for (const evidenceResult of evidence.results) {
      // Add description or type label
      if (evidenceResult.description) {
        nodes.push(
          paragraph(
            strong(text(`${evidenceResult.type}: `)),
            text(evidenceResult.description),
          ),
        );
      } else {
        nodes.push(paragraph(strong(text(`${evidenceResult.type}:`))));
      }

      // Render based on storage type
      if (evidenceResult.file) {
        // File reference - for Confluence, we can only show the path
        // Actual image embedding would require upload via Confluence API
        nodes.push(paragraph(text(`File: ${evidenceResult.file}`)));
      } else if (evidenceResult.content) {
        // Inline content - render in code block
        const language =
          evidenceResult.type === 'command_output' ? 'bash' : 'text';
        nodes.push(codeBlock({ language })(text(evidenceResult.content)));
      }
    }
  }

  // Return array of nodes if multiple, otherwise single node
  return nodes.length === 1 ? nodes[0] : nodes;
}

/**
 * Export ADF as JSON string
 */
export function generateADFString(
  operation: Operation,
  metadata?: GenerationMetadata,
  targetEnvironment?: string,
  resolveVariables?: boolean,
): string {
  const adf = generateADF(
    operation,
    metadata,
    targetEnvironment,
    resolveVariables,
  );
  return JSON.stringify(adf, null, 2);
}
