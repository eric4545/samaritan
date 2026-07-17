import fs from 'node:fs';
import path from 'node:path';
import { PanelType } from '@atlaskit/adf-schema';
import {
  bulletList,
  code,
  codeBlock,
  doc,
  em,
  extension,
  heading,
  link,
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
import { stepRollbackAnchor } from '../lib/anchor';
import { renderExpectParts } from '../lib/assertions';
import type { GenerationMetadata } from '../lib/git-metadata';
import {
  buildEffectiveRollback,
  type EffectiveRollbackStep,
} from '../lib/global-rollback';
import { indexToLetters } from '../lib/letter-sequence';
import { groupByPhase } from '../lib/phase-grouping';
import { hasRollbackContent } from '../lib/rollback';
import {
  mergeStepVariant,
  resolveDisplayText,
  shouldRenderStepForEnvironment,
  substituteExpectVars,
  substituteVariables,
} from '../lib/step-resolution';
import { formatTimelineForDisplay } from '../lib/timeline-format';
import type {
  Environment,
  Operation,
  RollbackStep,
  Step,
} from '../models/operation';

/**
 * Label for one entry in a MULTI-entry step-level rollback (foreach-expanded or
 * hand-authored siblings). Uses the rollback step's own name (already carries the
 * foreach suffix), resolving any remaining `${VAR}`; falls back to `Rollback N`.
 * Only emitted for multi-entry rollbacks so single-entry output is unchanged.
 */
function rollbackEntryLabel(
  rb: RollbackStep,
  index: number,
  commonVariables: Record<string, any>,
  stepVariables: Record<string, any> | undefined,
  resolveVariables: boolean | undefined,
): string {
  if (!rb.name) return `Rollback ${index + 1}`;
  return resolveVariables
    ? substituteVariables(rb.name, commonVariables, {
        ...stepVariables,
        ...rb.variables,
      })
    : rb.name;
}

/**
 * Confluence anchor macro node — the jump target a folded rollback entry
 * advertises so the inline rollback jump-links resolve to it. ADF has no native
 * heading anchors, so aggregate mode relies on this macro (extensionKey
 * `anchor`). Emitted once per source step in the Rollback Plan.
 */
function rollbackAnchorNode(name: string): any {
  return extension({
    extensionType: 'com.atlassian.confluence.macro.core',
    extensionKey: 'anchor',
    parameters: { macroParams: { '': { value: name } } },
  });
}

/**
 * A one-cell jump-link paragraph replacing an inline rollback in aggregate mode:
 * points at the step's folded entry in the bottom Rollback Plan.
 */
function rollbackJumpParagraph(anchorId: string, label: string): any {
  return paragraph(
    text('↩ '),
    strong(text('Rollback: ')),
    link({ href: `#${anchorId}` })(text(`${label} ↓`)),
  );
}

/**
 * Build the ADF nodes for one rollback step's cell, shared by step-level,
 * sub-step, and operation-level rollback rendering. When `includeSubsteps` is
 * set, nested sub_steps render inline within the same cell (step-level/sub-step
 * tables); the operation-level plan passes `false` because it emits sub_steps as
 * their own rows instead. `bare` omits the fallback "-" so empty sub-steps are
 * skipped during recursion.
 */
function buildRollbackCellNodes(
  rb: RollbackStep,
  env: Environment,
  resolveVariables: boolean | undefined,
  operationDir: string | undefined,
  stepVariables: Record<string, any> | undefined,
  includeSubsteps: boolean,
  bare = false,
): any[] {
  const cellContent: any[] = [];
  const substituteVars = rb.options?.substitute_vars ?? true;
  const showCommandSeparately = rb.options?.show_command_separately ?? false;

  if (rb.instruction) {
    let displayInstruction = rb.instruction;
    if (resolveVariables && substituteVars) {
      displayInstruction = substituteVariables(
        displayInstruction,
        env.variables || {},
        stepVariables,
      );
    }
    cellContent.push(paragraph(strong(text('Instructions:'))));
    cellContent.push(paragraph(text(displayInstruction)));
  }

  if (rb.command) {
    let displayCommand = rb.command;
    if (resolveVariables && substituteVars) {
      displayCommand = substituteVariables(
        displayCommand,
        env.variables || {},
        stepVariables,
      );
    }
    if (showCommandSeparately && rb.instruction) {
      cellContent.push(paragraph(strong(text('Command:'))));
    }
    cellContent.push(codeBlock({ language: 'bash' })(text(displayCommand)));
  }

  if (rb.script) {
    cellContent.push(paragraph(strong(text('Script:')), text(` ${rb.script}`)));
    if (operationDir) {
      try {
        const scriptPath = path.resolve(operationDir, rb.script);
        const scriptContent = fs.readFileSync(scriptPath, 'utf-8').trimEnd();
        cellContent.push(codeBlock({ language: 'bash' })(text(scriptContent)));
      } catch {
        cellContent.push(
          paragraph(em(text(`Script file not found: ${rb.script}`))),
        );
      }
    }
  }

  if (rb.expect != null) {
    const resolvedExpect =
      resolveVariables && substituteVars
        ? substituteExpectVars(rb.expect, env.variables || {}, stepVariables)
        : rb.expect;
    const parts = renderExpectParts(resolvedExpect);
    if (parts.length > 0) {
      cellContent.push(paragraph(strong(text('Expected:'))));
      for (const p of parts) {
        cellContent.push(paragraph(em(text(`- [ ] ${p}`))));
      }
    }
  }

  if (rb.pic || rb.reviewer) {
    cellContent.push(paragraph(strong(text('Sign-off:'))));
    if (rb.pic) cellContent.push(paragraph(text(`- [ ] PIC (${rb.pic})`)));
    if (rb.reviewer)
      cellContent.push(paragraph(text(`- [ ] Reviewer (${rb.reviewer})`)));
  }

  if (rb.timeout != null) {
    cellContent.push(paragraph(text(`⏱ Timeout: ${rb.timeout}s`)));
  }
  if (rb.session) {
    cellContent.push(paragraph(text(`🖥 Session: ${rb.session}`)));
  }

  // Environment-specific evidence results (parity with the markdown/Confluence
  // rollback renderers, which already embed rb.evidence).
  if (rb.evidence) {
    const evidenceInfo = formatEvidenceInfo(
      rb.evidence,
      env.name,
      operationDir,
    );
    if (evidenceInfo) {
      if (Array.isArray(evidenceInfo)) {
        cellContent.push(...evidenceInfo);
      } else {
        cellContent.push(evidenceInfo);
      }
    }
  }

  if (includeSubsteps) {
    rb.sub_steps?.forEach((sub, i) => {
      const subNodes = buildRollbackCellNodes(
        sub,
        env,
        resolveVariables,
        operationDir,
        stepVariables,
        true,
        true,
      );
      if (subNodes.length > 0) {
        const subName = sub.name ? `: ${sub.name}` : '';
        cellContent.push(paragraph(strong(text(`↳ ${i + 1}${subName}`))));
        cellContent.push(...subNodes);
      }
    });
  }

  if (!bare && cellContent.length === 0) {
    cellContent.push(paragraph(text('-')));
  }
  return cellContent;
}

/**
 * Merge step variants for a specific environment with base step properties
 * Returns the merged step (base + variant overrides) for the given environment
 */
/**
 * Convert Operation to Atlassian Document Format (ADF)
 */
export function generateADF(
  operation: Operation,
  metadata?: GenerationMetadata,
  targetEnvironment?: string,
  resolveVariables?: boolean,
  operationDir?: string,
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

  const environmentNames = environments.map((e) => e.name);

  // When aggregate_step_rollbacks is on, per-step rollbacks are centralized in
  // the Rollback Plan (jump-link targets); the duplicate Rollback Procedures
  // section is dropped and inline sub-step rollbacks collapse to jump-links.
  const aggregateRollbacks =
    operation.rollback?.aggregate_step_rollbacks === true;

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
  if (operation.template) {
    content.push(heading({ level: 2 })(text('Based On')));
    content.push(
      paragraph(
        text('This operation extends: '),
        strong(text(operation.template)),
      ),
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

  // Steps grouped by phase, preserving original indices for consistent step numbers
  if (operation.steps && operation.steps.length > 0) {
    // Build step entries with original 1-based numbers, filtering by active environments
    const stepEntries = operation.steps
      .map((step, i) => ({ step, stepNumber: i + 1 }))
      .filter(
        ({ step }) =>
          !step.when ||
          step.when.length === 0 ||
          step.when.some((e) => environmentNames.includes(e)),
      );

    // Block-aware grouping: `uses:` blocks stay contiguous so a reused block's
    // preflight checks render next to the block, not hoisted to the top.
    const phases = groupByPhase(stepEntries, (entry) => entry.step);

    // Pre-flight phase
    if (phases.preflight.length > 0) {
      content.push(heading({ level: 2 })(text('🛫 Pre-Flight Phase')));
      content.push(
        createStepsTable(
          phases.preflight,
          environments,
          resolveVariables,
          'preflight',
          operationDir,
          operation.common_variables ?? {},
          aggregateRollbacks,
        ),
      );
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
          resolveVariables,
          'flight',
          operationDir,
          operation.common_variables ?? {},
          aggregateRollbacks,
        ),
      );
    }

    // Post-flight phase
    if (phases.postflight.length > 0) {
      content.push(heading({ level: 2 })(text('🛬 Post-Flight Phase')));
      content.push(
        createStepsTable(
          phases.postflight,
          environments,
          resolveVariables,
          'postflight',
          operationDir,
          operation.common_variables ?? {},
          aggregateRollbacks,
        ),
      );
    }
  }

  // Rollback procedures. Skipped in aggregate mode — the per-step content is
  // centralized in the Rollback Plan below (jump-link targets).
  const stepsWithRollback = operation.steps.filter(
    (step) => step.rollback && step.rollback.length > 0,
  );
  if (!aggregateRollbacks && stepsWithRollback.length > 0) {
    content.push(heading({ level: 2 })(text('🔄 Rollback Procedures')));
    content.push(
      paragraph(
        text('If deployment fails, execute the following rollback steps:'),
      ),
    );

    stepsWithRollback.forEach((step) => {
      const rollbacks = (step.rollback ?? []).filter(hasRollbackContent);
      if (rollbacks.length === 0) return;

      content.push(heading({ level: 3 })(text(`Rollback for: ${step.name}`)));

      rollbacks.forEach((rb, rbIndex) => {
        if (rollbacks.length > 1) {
          content.push(
            paragraph(
              strong(
                text(
                  rollbackEntryLabel(
                    rb,
                    rbIndex,
                    operation.common_variables ?? {},
                    step.variables,
                    resolveVariables,
                  ),
                ),
              ),
            ),
          );
        }
        const rollbackRows = environments.map((env) =>
          tableRow([
            tableCell()(paragraph(text(env.name))),
            tableCell()(
              ...buildRollbackCellNodes(
                rb,
                env,
                resolveVariables,
                operationDir,
                step.variables,
                true,
              ),
            ),
          ]),
        );

        content.push(
          table(
            tableRow([
              tableHeader()(paragraph(text('Environment'))),
              tableHeader()(paragraph(text('Rollback Action'))),
            ]),
            ...rollbackRows,
          ),
        );
      });
    });
  }

  // Operation-level (global) rollback plan
  const globalRollbackSteps = buildEffectiveRollback(
    operation.rollback,
    operation.steps,
  );
  if (operation.rollback && globalRollbackSteps.length > 0) {
    content.push(heading({ level: 2 })(text('🔄 Rollback Plan')));
    content.push(
      paragraph(
        text('If the operation fails, execute the following rollback steps:'),
      ),
    );
    content.push(
      paragraph(
        strong(text('Automatic: ')),
        text(operation.rollback.automatic ? 'Yes' : 'No'),
      ),
    );
    if (
      operation.rollback.conditions &&
      operation.rollback.conditions.length > 0
    ) {
      content.push(
        paragraph(
          strong(text('Conditions: ')),
          text(operation.rollback.conditions.join(', ')),
        ),
      );
    }

    // Flatten each rollback step (and its nested sub_steps) into table rows so
    // nested rollback structure renders as Rollback Step N, N.M, N.M.K, … The
    // operation-level plan emits sub_steps as their own rows, so the shared cell
    // builder is called with includeSubsteps=false here.
    const globalRollbackRows: ReturnType<typeof tableRow>[] = [];
    const emittedAnchors = new Set<string>();
    const pushRollbackRows = (
      rb: EffectiveRollbackStep,
      label: string,
    ): void => {
      const namedLabel = rb.name ? `${label}: ${rb.name}` : label;
      // Prepend the Confluence anchor macro once per source step so the inline
      // jump-links resolve to this folded entry.
      const labelNodes: any[] = [paragraph(text(namedLabel))];
      if (rb.sourceAnchor && !emittedAnchors.has(rb.sourceAnchor)) {
        emittedAnchors.add(rb.sourceAnchor);
        labelNodes.unshift(rollbackAnchorNode(rb.sourceAnchor));
      }
      globalRollbackRows.push(
        tableRow([
          tableCell()(...labelNodes),
          ...environments.map((env) =>
            tableCell()(
              ...buildRollbackCellNodes(
                rb,
                env,
                resolveVariables,
                operationDir,
                {},
                false,
              ),
            ),
          ),
        ]),
      );
      rb.sub_steps?.forEach((sub, subIndex) => {
        pushRollbackRows(sub, `${label}.${subIndex + 1}`);
      });
    };
    globalRollbackSteps.forEach((rb, index) => {
      pushRollbackRows(rb, `Rollback Step ${index + 1}`);
    });

    content.push(
      table(
        tableRow([
          tableHeader()(paragraph(text('Step'))),
          ...environments.map((env) =>
            tableHeader()(paragraph(text(env.name))),
          ),
        ]),
        ...globalRollbackRows,
      ),
    );
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
  steps: Array<{ step: Step; stepNumber: number }>,
  environments: Environment[],
  resolveVariables?: boolean,
  currentPhase?: string,
  operationDir?: string,
  commonVariables?: Record<string, any>,
  linkRollbacks = false,
): any {
  // Build header row
  const headerCells = [tableHeader()(paragraph(text('Step')))];
  environments.forEach((env) => {
    headerCells.push(tableHeader()(paragraph(text(env.name))));
  });

  const headerRow = tableRow(headerCells);
  const dataRows: any[] = [];

  steps.forEach(({ step, stepNumber }) => {
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

    // The name cell is shared across all env columns, so only common variables +
    // step variables are resolved here — env-specific placeholders intentionally
    // stay literal in this cell (they resolve per-environment in the row cells).
    const displayStepName = resolveDisplayText(
      step.name,
      resolveVariables,
      commonVariables,
      step.variables,
    );

    stepCellContent.push(
      paragraph(
        strong(
          text(
            `Step ${stepNumber}: ${displayStepName} ${phaseIcon}${typeIcon}`,
          ),
        ),
      ),
    );

    // Add phase only if it differs from the current section phase
    if (step.phase && step.phase !== currentPhase) {
      stepCellContent.push(paragraph(em(text(`Phase: ${step.phase}`))));
    }

    // Description (resolve like the name cell: common + step vars only).
    if (
      step.description &&
      typeof step.description === 'string' &&
      step.description.trim().length > 0
    ) {
      stepCellContent.push(
        paragraph(
          text(
            resolveDisplayText(
              step.description,
              resolveVariables,
              commonVariables,
              step.variables,
            ),
          ),
        ),
      );
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

    // Reviewer
    if (step.reviewer) {
      stepCellContent.push(paragraph(text(`👥 Reviewer: ${step.reviewer}`)));
    }

    // Timeline
    if (step.timeline) {
      stepCellContent.push(
        paragraph(
          text(`⏱️ Timeline: ${formatTimelineForDisplay(step.timeline)}`),
        ),
      );
    }

    // Timeout
    if (step.timeout != null) {
      stepCellContent.push(paragraph(text(`⏱ Timeout: ${step.timeout}s`)));
    }

    // Execution session
    if (step.session) {
      stepCellContent.push(paragraph(text(`🖥 Session: ${step.session}`)));
    }

    // Conditional expression
    if (step.if) {
      stepCellContent.push(paragraph(text(`🔀 Condition: ${step.if}`)));
    }

    // Evidence requirements (metadata only, no env-specific results here)
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
      // Check if step should be rendered for this environment
      if (!shouldRenderStepForEnvironment(step, env.name)) {
        cells.push(tableCell()(paragraph(text('—'))));
        return;
      }

      // Merge variant for this environment (if exists)
      const effectiveStep = mergeStepVariant(step, env.name);

      const cellContent = [];

      // Get step-level options (defaults) from effective step
      const substituteVars = effectiveStep.options?.substitute_vars ?? true;
      const showCommandSeparately =
        effectiveStep.options?.show_command_separately ?? false;

      // Process instruction (paragraph/text content)
      if (effectiveStep.instruction) {
        let displayInstruction = effectiveStep.instruction;

        if (resolveVariables && substituteVars) {
          displayInstruction = substituteVariables(
            displayInstruction,
            env.variables || {},
            effectiveStep.variables,
          );
        }

        cellContent.push(paragraph(strong(text('Instructions:'))));
        cellContent.push(paragraph(text(displayInstruction)));
      }

      // Process command (code block)
      if (effectiveStep.command) {
        let displayCommand = effectiveStep.command;

        if (resolveVariables && substituteVars) {
          displayCommand = substituteVariables(
            displayCommand,
            env.variables || {},
            effectiveStep.variables,
          );
        }

        if (showCommandSeparately && effectiveStep.instruction) {
          cellContent.push(paragraph(strong(text('Command:'))));
        }

        cellContent.push(codeBlock({ language: 'bash' })(text(displayCommand)));
      }

      // Process script (external shell script file)
      if (effectiveStep.script) {
        cellContent.push(
          paragraph(strong(text('Script:')), text(` ${effectiveStep.script}`)),
        );
        if (operationDir) {
          try {
            const scriptPath = path.resolve(operationDir, effectiveStep.script);
            const scriptContent = fs
              .readFileSync(scriptPath, 'utf-8')
              .trimEnd();
            cellContent.push(
              codeBlock({ language: 'bash' })(text(scriptContent)),
            );
          } catch {
            cellContent.push(
              paragraph(
                em(text(`Script file not found: ${effectiveStep.script}`)),
              ),
            );
          }
        }
      }

      // Add expect assertions
      if (effectiveStep.expect != null) {
        const resolvedExpect =
          resolveVariables && substituteVars
            ? substituteExpectVars(
                effectiveStep.expect,
                env.variables || {},
                effectiveStep.variables,
              )
            : effectiveStep.expect;
        const parts = renderExpectParts(resolvedExpect);
        if (parts.length > 0) {
          cellContent.push(paragraph(strong(text('Expected:'))));
          for (const p of parts) {
            cellContent.push(paragraph(em(text(`- [ ] ${p}`))));
          }
        }
      }

      // Fallback for steps with neither
      if (cellContent.length === 0) {
        if (effectiveStep.sub_steps && effectiveStep.sub_steps.length > 0) {
          cellContent.push(paragraph(em(text('(see substeps below)'))));
        } else {
          cellContent.push(paragraph(em(text(`(${effectiveStep.type} step)`))));
        }
      }

      // Add sign-off checkboxes if PIC or Reviewer is set (per environment)
      // Use effectiveStep to respect variant overrides for PIC and reviewer
      if (effectiveStep.pic || effectiveStep.reviewer) {
        cellContent.push(paragraph(strong(text('Sign-off:'))));
        if (effectiveStep.pic) {
          cellContent.push(paragraph(text('- [ ] PIC')));
        }
        if (effectiveStep.reviewer) {
          cellContent.push(paragraph(text('- [ ] Reviewer')));
        }
      }

      // Add environment-specific evidence results
      // Use effectiveStep to respect variant overrides for evidence
      const envEvidenceInfo = formatEvidenceInfo(
        effectiveStep.evidence,
        env.name,
        operationDir,
      );
      if (envEvidenceInfo) {
        if (Array.isArray(envEvidenceInfo)) {
          cellContent.push(...envEvidenceInfo);
        } else {
          cellContent.push(envEvidenceInfo);
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
        operationDir,
        commonVariables,
        linkRollbacks,
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
  operationDir?: string,
  commonVariables?: Record<string, any>,
  linkRollbacks = false,
): void {
  // First loop: render all sub-step rows
  subSteps.forEach((subStep, subIndex) => {
    // Determine numbering based on depth
    // Odd depths (1, 3, 5): use letters (a, b, c)
    // Even depths (2, 4, 6): use numbers (1, 2, 3)
    let subStepId: string;
    if (depth % 2 === 1) {
      // Odd depth: use letters (supports unlimited with aa, ab, etc.)
      const letter = indexToLetters(subIndex);
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

    // The name cell is shared across all env columns, so only common variables +
    // step variables are resolved here — env-specific placeholders intentionally
    // stay literal in this cell (they resolve per-environment in the row cells).
    const displaySubStepName = resolveDisplayText(
      subStep.name,
      resolveVariables,
      commonVariables,
      subStep.variables,
    );

    subStepCellContent.push(
      paragraph(
        strong(text(`Step ${subStepId}: ${displaySubStepName} ${subTypeIcon}`)),
      ),
    );

    if (
      subStep.description &&
      typeof subStep.description === 'string' &&
      subStep.description.trim().length > 0
    ) {
      // Resolve like the name cell: common + step vars only.
      subStepCellContent.push(
        paragraph(
          text(
            resolveDisplayText(
              subStep.description,
              resolveVariables,
              commonVariables,
              subStep.variables,
            ),
          ),
        ),
      );
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

    if (subStep.reviewer) {
      subStepCellContent.push(
        paragraph(text(`👥 Reviewer: ${subStep.reviewer}`)),
      );
    }

    // Sign-off checkboxes
    if (subStep.pic || subStep.reviewer) {
      const signOffText = ['Sign-off:'];
      if (subStep.pic) signOffText.push(' ☐ PIC');
      if (subStep.reviewer) signOffText.push(' ☐ Reviewer');
      subStepCellContent.push(paragraph(em(text(signOffText.join('')))));
    }

    if (subStep.timeline) {
      subStepCellContent.push(
        paragraph(
          text(`⏱️ Timeline: ${formatTimelineForDisplay(subStep.timeline)}`),
        ),
      );
    }

    if (subStep.timeout != null) {
      subStepCellContent.push(
        paragraph(text(`⏱ Timeout: ${subStep.timeout}s`)),
      );
    }

    if (subStep.session) {
      subStepCellContent.push(paragraph(text(`🖥 Session: ${subStep.session}`)));
    }

    if (subStep.if) {
      subStepCellContent.push(paragraph(text(`🔀 Condition: ${subStep.if}`)));
    }

    // Evidence requirements for sub-steps (metadata only)
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
      // Check if substep should be rendered for this environment
      if (!shouldRenderStepForEnvironment(subStep, env.name)) {
        subCells.push(tableCell()(paragraph(text('—'))));
        return;
      }

      // Merge variant for this environment (if exists)
      const effectiveSubStep = mergeStepVariant(subStep, env.name);

      const cellContent = [];

      // Get sub-step options (defaults) from effective substep
      const substituteVars = effectiveSubStep.options?.substitute_vars ?? true;
      const showCommandSeparately =
        effectiveSubStep.options?.show_command_separately ?? false;

      // Process instruction (paragraph/text content)
      if (effectiveSubStep.instruction) {
        let displayInstruction = effectiveSubStep.instruction;

        if (resolveVariables && substituteVars) {
          displayInstruction = substituteVariables(
            displayInstruction,
            env.variables || {},
            effectiveSubStep.variables,
          );
        }

        cellContent.push(paragraph(strong(text('Instructions:'))));
        cellContent.push(paragraph(text(displayInstruction)));
      }

      // Process command (code block)
      if (effectiveSubStep.command) {
        let displayCommand = effectiveSubStep.command;

        if (resolveVariables && substituteVars) {
          displayCommand = substituteVariables(
            displayCommand,
            env.variables || {},
            effectiveSubStep.variables,
          );
        }

        if (showCommandSeparately && effectiveSubStep.instruction) {
          cellContent.push(paragraph(strong(text('Command:'))));
        }

        cellContent.push(codeBlock({ language: 'bash' })(text(displayCommand)));
      }

      // Process script (external shell script file)
      if (effectiveSubStep.script) {
        cellContent.push(
          paragraph(
            strong(text('Script:')),
            text(` ${effectiveSubStep.script}`),
          ),
        );
        if (operationDir) {
          try {
            const scriptPath = path.resolve(
              operationDir,
              effectiveSubStep.script,
            );
            const scriptContent = fs
              .readFileSync(scriptPath, 'utf-8')
              .trimEnd();
            cellContent.push(
              codeBlock({ language: 'bash' })(text(scriptContent)),
            );
          } catch {
            cellContent.push(
              paragraph(
                em(text(`Script file not found: ${effectiveSubStep.script}`)),
              ),
            );
          }
        }
      }

      // Add expect assertions
      if (effectiveSubStep.expect != null) {
        const resolvedExpect =
          resolveVariables && substituteVars
            ? substituteExpectVars(
                effectiveSubStep.expect,
                env.variables || {},
                effectiveSubStep.variables,
              )
            : effectiveSubStep.expect;
        const parts = renderExpectParts(resolvedExpect);
        if (parts.length > 0) {
          cellContent.push(paragraph(strong(text('Expected:'))));
          for (const p of parts) {
            cellContent.push(paragraph(em(text(`- [ ] ${p}`))));
          }
        }
      }

      // Fallback for sub-steps with neither
      if (cellContent.length === 0) {
        if (
          effectiveSubStep.sub_steps &&
          effectiveSubStep.sub_steps.length > 0
        ) {
          cellContent.push(paragraph(em(text('(see substeps below)'))));
        } else {
          cellContent.push(
            paragraph(em(text(`(${effectiveSubStep.type} step)`))),
          );
        }
      }

      // Add environment-specific evidence results
      // Use effectiveSubStep to respect variant overrides for evidence
      const envEvidenceInfo = formatEvidenceInfo(
        effectiveSubStep.evidence,
        env.name,
        operationDir,
      );
      if (envEvidenceInfo) {
        if (Array.isArray(envEvidenceInfo)) {
          cellContent.push(...envEvidenceInfo);
        } else {
          cellContent.push(envEvidenceInfo);
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
        operationDir,
        commonVariables,
        linkRollbacks,
      );
    }
  });

  // Second loop: render all rollback rows (every entry, not just [0])
  subSteps.forEach((subStep, subIndex) => {
    const rollbacks = (subStep.rollback ?? []).filter(hasRollbackContent);
    if (rollbacks.length === 0) return;

    // Determine numbering based on depth
    let subStepId: string;
    if (depth % 2 === 1) {
      const letter = indexToLetters(subIndex);
      subStepId = `${stepPrefix}${letter}`;
    } else {
      subStepId = `${stepPrefix}${subIndex + 1}`;
    }

    // Aggregate mode: collapse the inline sub-step rollback to a single
    // jump-link row pointing at its folded entry in the bottom Rollback Plan.
    if (linkRollbacks) {
      dataRows.push(
        tableRow([
          tableCell()(
            rollbackJumpParagraph(
              stepRollbackAnchor(subStep),
              `Rollback for Step ${subStepId}`,
            ),
          ),
          ...environments.map(() => tableCell()(paragraph(text('—')))),
        ]),
      );
      return;
    }

    rollbacks.forEach((rb, rbIndex) => {
      const baseLabel = `🔄 Rollback for Step ${subStepId}: ${subStep.name}`;
      const rollbackLabel =
        rollbacks.length > 1
          ? `${baseLabel} — ${rollbackEntryLabel(rb, rbIndex, commonVariables ?? {}, subStep.variables, resolveVariables)}`
          : baseLabel;
      const rollbackCells = [
        tableCell()(paragraph(strong(text(rollbackLabel)))),
        ...environments.map((env) =>
          tableCell()(
            ...buildRollbackCellNodes(
              rb,
              env,
              resolveVariables,
              operationDir,
              subStep.variables,
              true,
            ),
          ),
        ),
      ];

      dataRows.push(tableRow(rollbackCells));
    });
  });
}

/**
 * Format evidence requirements as ADF paragraph
 */
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
): any {
  if (!evidence) return null;

  const types = evidence.types || [];
  const typesText = types.length > 0 ? `: ${types.join(', ')}` : '';
  const status = evidence.required ? 'Required' : 'Optional';

  const nodes: any[] = [];

  // Only show evidence metadata in step column (when environmentName is undefined)
  if (!environmentName) {
    nodes.push(paragraph(em(text(`📎 Evidence ${status}${typesText}`))));
  }

  // Render evidence results for a specific environment, or an operator capture
  // prompt when none have been recorded yet (parity with the other renderers).
  if (environmentName) {
    const envResults = evidence.results?.[environmentName];
    if (envResults && envResults.length > 0) {
      nodes.push(paragraph(strong(text('Captured Evidence:'))));

      for (const evidenceResult of envResults) {
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
          // For text-based evidence (command_output, log), read and embed file
          // content; for images/other types show the path (true media embedding
          // requires a Confluence upload).
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
              nodes.push(codeBlock({ language })(text(fileContent.trimEnd())));
            } catch (_error) {
              nodes.push(
                paragraph(
                  text(`File: ${evidenceResult.file} (error reading file)`),
                ),
              );
            }
          } else {
            nodes.push(paragraph(text(`File: ${evidenceResult.file}`)));
          }
        } else if (evidenceResult.content) {
          // Inline content - render in code block
          const language =
            evidenceResult.type === 'command_output' ? 'bash' : 'text';
          nodes.push(codeBlock({ language })(text(evidenceResult.content)));
        }
      }
    } else if (types.includes('command_output')) {
      nodes.push(
        codeBlock({ language: 'bash' })(text('# Paste command output here')),
      );
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
  operationDir?: string,
): string {
  const adf = generateADF(
    operation,
    metadata,
    targetEnvironment,
    resolveVariables,
    operationDir,
  );
  return JSON.stringify(adf, null, 2);
}
