import {
  doc,
  heading,
  paragraph,
  text,
  table,
  tableRow,
  tableCell,
  tableHeader,
  codeBlock,
  panel,
  taskList,
  taskItem,
  strong,
  code,
  bulletList,
  listItem,
  em,
} from '@atlaskit/adf-utils/builders'
import { PanelType } from '@atlaskit/adf-schema'
import type { Operation, Environment, Step } from '../models/operation'
import type { GenerationMetadata } from '../lib/git-metadata'

/**
 * Convert Operation to Atlassian Document Format (ADF)
 */
export function generateADF(
  operation: Operation,
  metadata?: GenerationMetadata,
  targetEnvironment?: string,
  resolveVariables?: boolean
): object {
  // Filter environments if specified
  let environments = operation.environments
  if (targetEnvironment) {
    environments = operation.environments.filter(env => env.name === targetEnvironment)
    if (environments.length === 0) {
      throw new Error(
        `Environment '${targetEnvironment}' not found in operation. Available: ${operation.environments.map(e => e.name).join(', ')}`
      )
    }
  }

  const filteredOperation = {
    ...operation,
    environments,
  }

  // Build ADF content nodes
  const content = []

  // Title
  content.push(heading({ level: 1 })(text(`${operation.name} (v${operation.version})`)))

  // Description
  if (operation.description) {
    content.push(paragraph(em(text(operation.description))))
  }

  // Metadata panel if available
  if (metadata) {
    content.push(createMetadataPanel(metadata))
  }

  // Dependencies
  if (operation.needs && operation.needs.length > 0) {
    content.push(heading({ level: 2 })(text('Dependencies')))
    content.push(
      paragraph(text('This operation depends on the following operations being completed first:'))
    )
    const depItems = operation.needs.map(dep => listItem([paragraph(strong(text(dep)))]))
    content.push(bulletList(...depItems))
  }

  // Marketplace operation usage
  if (operation.uses) {
    content.push(heading({ level: 2 })(text('Based On')))
    content.push(paragraph(text('This operation extends: '), strong(text(operation.uses))))
    if (operation.with && Object.keys(operation.with).length > 0) {
      content.push(paragraph(text('With parameters:')))
      const paramItems = Object.entries(operation.with).map(([key, value]) =>
        listItem([paragraph(text(`${key}: ${JSON.stringify(value)}`))])
      )
      content.push(bulletList(...paramItems))
    }
  }

  // Environments overview
  if (environments.length > 0) {
    content.push(heading({ level: 2 })(text('Environments Overview')))
    content.push(createEnvironmentsTable(environments))
  }

  // Steps grouped by phase
  if (filteredOperation.steps && filteredOperation.steps.length > 0) {
    const phases: { [key: string]: Step[] } = {
      preflight: [],
      flight: [],
      postflight: [],
    }

    filteredOperation.steps.forEach(step => {
      const phase = step.phase || 'flight'
      if (phases[phase]) {
        phases[phase].push(step)
      }
    })

    let globalStepNumber = 1

    // Pre-flight phase
    if (phases.preflight.length > 0) {
      content.push(heading({ level: 2 })(text('🛫 Pre-Flight Phase')))
      content.push(
        createStepsTable(phases.preflight, environments, globalStepNumber, resolveVariables)
      )
      globalStepNumber += phases.preflight.length
    }

    // Flight phase
    if (phases.flight.length > 0) {
      content.push(heading({ level: 2 })(text('✈️ Flight Phase (Main Operations)')))
      content.push(
        createStepsTable(phases.flight, environments, globalStepNumber, resolveVariables)
      )
      globalStepNumber += phases.flight.length
    }

    // Post-flight phase
    if (phases.postflight.length > 0) {
      content.push(heading({ level: 2 })(text('🛬 Post-Flight Phase')))
      content.push(
        createStepsTable(phases.postflight, environments, globalStepNumber, resolveVariables)
      )
    }
  }

  // Rollback procedures
  const stepsWithRollback = operation.steps.filter(step => step.rollback)
  if (stepsWithRollback.length > 0) {
    content.push(heading({ level: 2 })(text('🔄 Rollback Procedures')))
    content.push(paragraph(text('If deployment fails, execute the following rollback steps:')))

    stepsWithRollback.forEach(step => {
      if (!step.rollback) return

      content.push(heading({ level: 3 })(text(`Rollback for: ${step.name}`)))

      if (step.rollback.command || step.rollback.instruction) {
        const rollbackRows = environments.map(env => {
          const rollbackCommand = step.rollback!.command || step.rollback!.instruction || ''
          let displayCommand = rollbackCommand

          if (resolveVariables && rollbackCommand) {
            displayCommand = substituteVariables(
              rollbackCommand,
              env.variables || {},
              step.variables
            )
          }

          return tableRow([
            tableCell()(paragraph(text(env.name))),
            tableCell()(codeBlock({ language: 'bash' })(text(displayCommand)))
          ])
        })

        content.push(
          table(
            tableRow([
              tableHeader()(paragraph(text('Environment'))),
              tableHeader()(paragraph(text('Rollback Action')))
            ]),
            ...rollbackRows
          )
        )
      }
    })
  }

  return doc(...content)
}

/**
 * Create metadata info panel
 */
function createMetadataPanel(metadata: GenerationMetadata): any {
  const panelContent = []

  panelContent.push(paragraph(strong(text('Generation Information'))))

  if (metadata.operation_id) {
    panelContent.push(paragraph(text(`Operation ID: ${metadata.operation_id}`)))
  }

  if (metadata.operation_version) {
    panelContent.push(paragraph(text(`Version: ${metadata.operation_version}`)))
  }

  if (metadata.target_environment) {
    panelContent.push(paragraph(text(`Target Environment: ${metadata.target_environment}`)))
  }

  if (metadata.git_sha) {
    panelContent.push(paragraph(text(`Git Commit: `), code(text(metadata.git_sha))))
  }

  if (metadata.git_branch) {
    panelContent.push(paragraph(text(`Git Branch: ${metadata.git_branch}`)))
  }

  if (metadata.generated_at) {
    panelContent.push(paragraph(text(`Generated At: ${metadata.generated_at}`)))
  }

  if (metadata.source_file) {
    panelContent.push(paragraph(text(`Source File: `), code(text(metadata.source_file))))
  }

  return panel({ panelType: PanelType.INFO })(...panelContent)
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
    tableHeader()(paragraph(text('Approval Required')))
  ])

  const dataRows = environments.map(env => {
    // Format variables
    const varsContent = env.variables
      ? Object.entries(env.variables).map(([key, value]) =>
          paragraph(text(`${key}: ${JSON.stringify(value)}`))
        )
      : [paragraph(text('-'))]

    // Format targets
    const targetsContent = env.targets
      ? env.targets.map(target => paragraph(text(target)))
      : [paragraph(text('-'))]

    const approval = env.approval_required === true ? 'Yes' : 'No'

    return tableRow([
      tableCell()(paragraph(text(env.name))),
      tableCell()(paragraph(text(env.description || ''))),
      tableCell()(...varsContent),
      tableCell()(...targetsContent),
      tableCell()(paragraph(text(approval)))
    ])
  })

  return table(headerRow, ...dataRows)
}

/**
 * Create steps table for a phase
 */
function createStepsTable(
  steps: Step[],
  environments: Environment[],
  startNumber: number,
  resolveVariables?: boolean
): any {
  // Build header row
  const headerCells = [tableHeader()(paragraph(text('Step')))]
  environments.forEach(env => {
    headerCells.push(tableHeader()(paragraph(text(env.name))))
  })

  const headerRow = tableRow(headerCells)
  const dataRows: any[] = []

  steps.forEach((step, index) => {
    const stepNumber = startNumber + index

    // Build step description cell
    const stepCellContent = []

    // Step name with icons
    const typeIcon =
      step.type === 'automatic'
        ? '⚙️'
        : step.type === 'manual'
          ? '👤'
          : step.type === 'conditional'
            ? '🔀'
            : '✋'

    const phaseIcon =
      step.phase === 'preflight' ? '🛫' : step.phase === 'flight' ? '✈️' : step.phase === 'postflight' ? '🛬' : ''

    stepCellContent.push(
      paragraph(strong(text(`Step ${stepNumber}: ${step.name} ${phaseIcon}${typeIcon}`)))
    )

    // Add phase if present
    if (step.phase) {
      stepCellContent.push(paragraph(em(text(`Phase: ${step.phase}`))))
    }

    // Description
    if (step.description && typeof step.description === 'string' && step.description.trim().length > 0) {
      stepCellContent.push(paragraph(text(step.description)))
    }

    // Dependencies
    if (step.needs && step.needs.length > 0) {
      stepCellContent.push(paragraph(text(`📋 Depends on: ${step.needs.join(', ')}`)))
    }

    // Ticket references
    if (step.ticket) {
      const tickets = Array.isArray(step.ticket) ? step.ticket : [step.ticket]
      stepCellContent.push(paragraph(text(`🎫 Tickets: ${tickets.join(', ')}`)))
    }

    // PIC
    if (step.pic) {
      stepCellContent.push(paragraph(text(`👤 PIC: ${step.pic}`)))
    }

    // Timeline
    if (step.timeline) {
      stepCellContent.push(paragraph(text(`⏱️ Timeline: ${step.timeline}`)))
    }

    // Build command cells for each environment
    const cells = [tableCell()(...stepCellContent)]

    environments.forEach(env => {
      const rawCommand = step.command || step.instruction || ''
      let displayCommand = rawCommand

      if (resolveVariables && rawCommand) {
        displayCommand = substituteVariables(rawCommand, env.variables || {}, step.variables)
      }

      if (displayCommand) {
        cells.push(tableCell()(codeBlock({ language: 'bash' })(text(displayCommand))))
      } else if (step.sub_steps && step.sub_steps.length > 0) {
        cells.push(tableCell()(paragraph(em(text('(see substeps below)')))))
      } else {
        cells.push(tableCell()(paragraph(em(text(`(${step.type} step)`)))))
      }
    })

    dataRows.push(tableRow(cells))

    // Add sub-steps if present
    if (step.sub_steps && step.sub_steps.length > 0) {
      step.sub_steps.forEach((subStep, subIndex) => {
        const subStepLetter = String.fromCharCode(97 + subIndex)
        const subStepId = `${stepNumber}${subStepLetter}`

        const subStepCellContent = []
        const subTypeIcon =
          subStep.type === 'automatic'
            ? '⚙️'
            : subStep.type === 'manual'
              ? '👤'
              : subStep.type === 'conditional'
                ? '🔀'
                : '✋'

        subStepCellContent.push(
          paragraph(strong(text(`Step ${subStepId}: ${subStep.name} ${subTypeIcon}`)))
        )

        if (subStep.description && typeof subStep.description === 'string' && subStep.description.trim().length > 0) {
          subStepCellContent.push(paragraph(text(subStep.description)))
        }

        if (subStep.needs && subStep.needs.length > 0) {
          subStepCellContent.push(paragraph(text(`📋 Depends on: ${subStep.needs.join(', ')}`)))
        }

        if (subStep.ticket) {
          const tickets = Array.isArray(subStep.ticket) ? subStep.ticket : [subStep.ticket]
          subStepCellContent.push(paragraph(text(`🎫 Tickets: ${tickets.join(', ')}`)))
        }

        if (subStep.pic) {
          subStepCellContent.push(paragraph(text(`👤 PIC: ${subStep.pic}`)))
        }

        if (subStep.timeline) {
          subStepCellContent.push(paragraph(text(`⏱️ Timeline: ${subStep.timeline}`)))
        }

        const subCells = [tableCell()(...subStepCellContent)]

        environments.forEach(env => {
          const rawCommand = subStep.command || subStep.instruction || ''
          let displayCommand = rawCommand

          if (resolveVariables && rawCommand) {
            displayCommand = substituteVariables(rawCommand, env.variables || {}, subStep.variables)
          }

          if (displayCommand) {
            subCells.push(tableCell()(codeBlock({ language: 'bash' })(text(displayCommand))))
          } else if (subStep.sub_steps && subStep.sub_steps.length > 0) {
            subCells.push(tableCell()(paragraph(em(text('(see substeps below)')))))
          } else {
            subCells.push(tableCell()(paragraph(em(text(`(${subStep.type} step)`)))))
          }
        })

        dataRows.push(tableRow(subCells))
      })
    }
  })

  return table(headerRow, ...dataRows)
}

/**
 * Substitute variables in command string
 */
function substituteVariables(
  command: string,
  envVariables: Record<string, any>,
  stepVariables?: Record<string, any>
): string {
  let substitutedCommand = command

  // Merge variables with priority: step > env
  const mergedVariables = { ...envVariables, ...(stepVariables || {}) }

  for (const key in mergedVariables) {
    const regex = new RegExp(`\\$\\{${key}\\}`, 'g')
    substitutedCommand = substitutedCommand.replace(regex, mergedVariables[key])
  }
  return substitutedCommand
}

/**
 * Export ADF as JSON string
 */
export function generateADFString(
  operation: Operation,
  metadata?: GenerationMetadata,
  targetEnvironment?: string,
  resolveVariables?: boolean
): string {
  const adf = generateADF(operation, metadata, targetEnvironment, resolveVariables)
  return JSON.stringify(adf, null, 2)
}
