import fs from 'node:fs';
import path from 'node:path';
import { renderExpectParts } from '../lib/assertions';
import {
  type GenerationMetadata,
  generateYamlFrontmatter,
} from '../lib/git-metadata';
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
import type {
  Environment,
  Operation,
  RollbackStep,
  Step,
} from '../models/operation';
import type { RunEvidenceItem, RunManifest } from '../models/run-manifest';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function evidenceLang(type: string): string {
  return type === 'command_output' ? 'bash' : 'text';
}

/**
 * Preserve authored single-newline line breaks in Markdown prose without
 * mangling block structure. Fenced code blocks (``` / ~~~) are left verbatim;
 * outside fences, a single newline between two non-blank lines becomes a
 * Markdown hard break ("  \n"). Blank lines (paragraph separators) and the
 * lines around code fences are left untouched, so lists/headings/code fences
 * keep rendering correctly.
 *
 * Without this, the single-env heading layout pushes raw multiline text and
 * Markdown collapses adjacent non-blank lines into one paragraph (e.g.
 * "aa\nbb\ncc" rendered as "aa bb cc").
 */
export function preserveLineBreaks(text: string): string {
  const isFence = (line: string | undefined): boolean =>
    line !== undefined && /^\s*(```|~~~)/.test(line);
  const lines = text.split('\n');
  let inFence = false;
  return lines
    .map((line, i) => {
      if (isFence(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      const next = lines[i + 1];
      const wantsBreak =
        line.trim() !== '' &&
        next !== undefined &&
        next.trim() !== '' &&
        !isFence(next) &&
        !/ {2,}$/.test(line);
      return wantsBreak ? `${line}  ` : line;
    })
    .join('\n');
}

function resolveStepKey(step: Step): string {
  return step.id ?? slugify(step.name);
}

/**
 * Merge run manifest evidence into the operation's steps and detect orphaned
 * evidence (run manifest entries that don't match any step).
 * Evidence file paths in the run manifest must already be absolute (resolved
 * by the parser) so generators can read them regardless of operationDir.
 */
function augmentOperationWithRunManifest(
  operation: Operation,
  runManifest: RunManifest,
): { operation: Operation; orphanedKeys: string[] } {
  const runSteps = runManifest.steps ?? {};
  const matchedKeys = new Set<string>();

  const augmentedSteps = operation.steps.map((step) => {
    const key = resolveStepKey(step);
    const runStep = runSteps[key];
    if (!runStep) return step;
    matchedKeys.add(key);
    return {
      ...step,
      evidence: {
        ...step.evidence,
        results: {
          ...(step.evidence?.results ?? {}),
          // Slot run evidence into the run's environment so formatEvidenceInfo picks it up
          [runManifest.environment]: runStep.evidence,
        },
      },
    };
  });

  const orphanedKeys = Object.keys(runSteps).filter((k) => !matchedKeys.has(k));
  return { operation: { ...operation, steps: augmentedSteps }, orphanedKeys };
}

function buildRunInfoBlock(runManifest: RunManifest): string {
  const parts: string[] = [`**Run**: ${runManifest.id}`];
  if (runManifest.operator) parts.push(`**Operator**: ${runManifest.operator}`);
  parts.push(`**Env**: ${runManifest.environment}`);
  parts.push(`**Status**: ${runManifest.status}`);
  const ts = runManifest.completed_at ?? runManifest.started_at;
  if (ts) {
    parts.push(`**Date**: ${ts.split('T')[0]}`);
  }
  return `> ${parts.join(' | ')}\n\n`;
}

function buildOrphanedEvidenceSection(
  orphanedKeys: string[],
  runManifest: RunManifest,
): string {
  if (orphanedKeys.length === 0) return '';
  const runSteps = runManifest.steps ?? {};
  let md = '\n---\n\n## Orphaned Evidence\n\n';
  md +=
    '_The following evidence from the run manifest did not match any step in the current operation._\n\n';
  for (const key of orphanedKeys) {
    const step = runSteps[key];
    md += `### ${key}\n\n`;
    for (const item of step.evidence) {
      md += renderEvidenceItemMarkdown(item);
    }
  }
  return md;
}

/**
 * Render a single evidence item as plain markdown (used in heading-based
 * single-env format and orphaned evidence sections).
 */
function renderEvidenceItemMarkdown(
  item: RunEvidenceItem,
  baseDir?: string,
): string {
  let md = '';
  const label = item.description
    ? `**${item.type}**: ${item.description}`
    : `**${item.type}**`;
  md += `${label}\n\n`;

  if (item.file) {
    if (item.type === 'screenshot' || item.type === 'photo') {
      md += `![Evidence](${item.file})\n\n`;
    } else if (item.type === 'command_output' || item.type === 'log') {
      const lang = evidenceLang(item.type);
      try {
        const resolved = baseDir ? path.resolve(baseDir, item.file) : item.file;
        const content = fs.readFileSync(resolved, 'utf-8');
        md += `\`\`\`${lang}\n${content.trimEnd()}\n\`\`\`\n\n`;
      } catch {
        md += `[View ${item.type}](${item.file})\n\n`;
      }
    } else {
      md += `[View ${item.type}](${item.file})\n\n`;
    }
  } else if (item.content) {
    md += `\`\`\`${evidenceLang(item.type)}\n${item.content.trimEnd()}\n\`\`\`\n\n`;
  }
  return md;
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

    // Add an operator capture prompt for command_output evidence: a code block
    // where the operator pastes the command output.
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
              const language = evidenceLang(evidenceResult.type);
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
          const language = evidenceLang(evidenceResult.type);
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

  // Group steps by phase (block-aware: `uses:` blocks stay contiguous)
  const phases = groupByPhase(stepsWithTimeline, (step) => step);

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

/**
 * Filter steps (and sub_steps recursively) that don't apply to any of the given environments.
 * Steps without a 'when' field are kept (they apply to all environments).
 */
function filterStepsForEnvironments(
  steps: Step[],
  environmentNames: string[],
): Step[] {
  return steps
    .filter((step) => {
      if (!step.when || step.when.length === 0) return true;
      return step.when.some((env) => environmentNames.includes(env));
    })
    .map((step) => {
      if (!step.sub_steps || step.sub_steps.length === 0) return step;
      return {
        ...step,
        sub_steps: filterStepsForEnvironments(step.sub_steps, environmentNames),
      };
    });
}

function renderTableInstruction(
  instruction: string | undefined,
  envVars: Record<string, any> | undefined,
  stepVars: Record<string, any> | undefined,
  resolveVariables: boolean,
  substituteVarsEnabled: boolean,
): string {
  if (!instruction) return '';
  const display =
    resolveVariables && substituteVarsEnabled
      ? substituteVariables(instruction, envVars || {}, stepVars)
      : instruction;
  return `**Instructions:**<br>${display.trim().replace(/\|/g, '\\|').replace(/\n/g, '<br>')}`;
}

/**
 * Render a single rollback step's content as a Markdown table cell (the `<br>`
 * inline style used by the multi-env tables). Shared by step-level and
 * operation-level (global) rollback rendering.
 */
function renderRollbackCellMarkdown(
  rb: RollbackStep,
  env: Environment,
  resolveVariables: boolean,
  operationDir?: string,
  stepVariables?: Record<string, any>,
  includeSubsteps = false,
): string {
  let cellContent = '';

  const substituteVars = rb.options?.substitute_vars ?? true;
  const showCommandSeparately = rb.options?.show_command_separately ?? false;

  cellContent += renderTableInstruction(
    rb.instruction,
    env.variables,
    stepVariables,
    resolveVariables,
    substituteVars,
  );

  // Process rollback command (code content)
  if (rb.command) {
    let displayCommand = rb.command;
    if (resolveVariables && substituteVars) {
      displayCommand = substituteVariables(
        displayCommand,
        env.variables || {},
        stepVariables,
      );
    }
    const cleanCommand = displayCommand
      .trim()
      .replace(/\n/g, '<br>')
      .replace(/\|/g, '\\|')
      .replace(/`/g, '\\`')
      .replace(/<br>$/, '');

    if (showCommandSeparately && rb.instruction) {
      cellContent += `<br><br>**Command:**<br>\`${cleanCommand}\``;
    } else if (!rb.instruction) {
      cellContent += `\`${cleanCommand}\``;
    } else {
      cellContent += `<br><br>\`${cleanCommand}\``;
    }
  }

  // Process rollback script (external shell script file)
  if (rb.script) {
    const sep = cellContent ? '<br><br>' : '';
    cellContent += `${sep}**Script:** \`${rb.script}\``;
    if (operationDir) {
      try {
        const scriptPath = path.resolve(operationDir, rb.script);
        const scriptContent = fs
          .readFileSync(scriptPath, 'utf-8')
          .trimEnd()
          .replace(/\|/g, '\\|')
          .replace(/\n/g, '<br>');
        cellContent += `<br>\`\`\`bash<br>${scriptContent}<br>\`\`\``;
      } catch {
        cellContent += ` <em>(file not found)</em>`;
      }
    }
  }

  // Add rollback expect
  if (rb.expect != null) {
    const resolvedExpect =
      resolveVariables && substituteVars
        ? substituteExpectVars(rb.expect, env.variables || {}, stepVariables)
        : rb.expect;
    const parts = renderExpectParts(resolvedExpect);
    if (parts.length > 0) {
      const sep = cellContent ? '<br>' : '';
      cellContent += `${sep}_Expected:_`;
      for (const p of parts) cellContent += `<br>- [ ] _${p}_`;
    }
  }

  // Rollback sign-off checkboxes
  if (rb.pic || rb.reviewer) {
    const sep = cellContent ? '<br><br>' : '';
    cellContent += `${sep}**Sign-off:**`;
    if (rb.pic) cellContent += `<br>- [ ] PIC (${rb.pic})`;
    if (rb.reviewer) cellContent += `<br>- [ ] Reviewer (${rb.reviewer})`;
  }

  // Environment-specific evidence results
  if (rb.evidence) {
    cellContent += formatEvidenceInfo(rb.evidence, env.name, operationDir);
  }

  // Nested rollback sub-steps render inline within the same cell (used by the
  // step-level rollback table, which is keyed by environment rather than by
  // step — the operation-level plan emits sub_steps as their own rows instead).
  if (includeSubsteps && rb.sub_steps && rb.sub_steps.length > 0) {
    rb.sub_steps.forEach((sub, i) => {
      const subContent = renderRollbackCellMarkdown(
        sub,
        env,
        resolveVariables,
        operationDir,
        stepVariables,
        true,
      );
      if (subContent && subContent !== '-') {
        const sep = cellContent ? '<br><br>' : '';
        const subName = sub.name ? `: ${sub.name}` : '';
        cellContent += `${sep}**↳ ${i + 1}${subName}**<br>${subContent}`;
      }
    });
  }

  // Fallback
  if (!cellContent) {
    cellContent = '-';
  }

  return cellContent;
}

/**
 * Tracks whether a multi-environment step table is currently "open" (its header
 * has been emitted and rows can be appended). Used to lazily open tables right
 * before a row is written instead of eagerly reopening after every rollback or
 * section heading — which previously left dangling empty `| Step | ... |`
 * headers in the output (notably after sub-step rollback tables).
 */
interface TableState {
  open: boolean;
}

/** Build the `| Step | env... |` table header + separator for the given envs. */
function renderStepTableHeader(environments: Environment[]): string {
  let header = '| Step |';
  for (const env of environments) {
    header += ` ${env.name} |`;
  }
  header += '\n|------|';
  for (const _ of environments) {
    header += '---------|';
  }
  header += '\n';
  return header;
}

/** Emit the step table header only if a table isn't already open (lazy open). */
function ensureStepTableOpen(
  state: TableState,
  environments: Environment[],
): string {
  if (state.open) return '';
  state.open = true;
  return renderStepTableHeader(environments);
}

/** Close an open step table with a trailing blank line; no-op if already closed. */
function closeStepTable(state: TableState): string {
  if (!state.open) return '';
  state.open = false;
  return '\n';
}

function generateStepRow(
  step: Step,
  stepNumber: number,
  environments: Environment[],
  resolveVariables: boolean = false,
  prefix: string = '',
  currentPhase?: string,
  operationDir?: string,
  commonVariables?: Record<string, any>,
  tableState: TableState = { open: true },
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
  // The name cell is shared across all env columns, so only common variables +
  // step variables are resolved here — env-specific placeholders intentionally
  // stay literal in this cell (they resolve per-environment in the row cells).
  const displayName = resolveDisplayText(
    step.name,
    resolveVariables,
    commonVariables,
    step.variables,
  );
  let stepCell = `[ ] ${prefix}Step ${stepNumber}: ${displayName} ${phaseIcon}${typeIcon}`;
  // Only show phase if it differs from the current section phase
  if (step.phase && step.phase !== currentPhase) {
    stepCell += `<br><em>Phase: ${step.phase}</em>`;
  }
  if (
    step.description &&
    typeof step.description === 'string' &&
    step.description.trim().length > 0
  ) {
    stepCell += `<br>${resolveDisplayText(step.description, resolveVariables, commonVariables, step.variables)}`;
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

  rows += ensureStepTableOpen(tableState, environments);
  rows += `| ${stepCell} |`;

  // Subsequent columns: Commands for each environment
  environments.forEach((env) => {
    // Check if step should be rendered for this environment
    if (!shouldRenderStepForEnvironment(step, env.name)) {
      rows += ' — |';
      return;
    }

    // Merge variant for this environment (if exists)
    const effectiveStep = mergeStepVariant(step, env.name);

    let cellContent = '';

    // Get step-level options (defaults) from effective step
    const substituteVars = effectiveStep.options?.substitute_vars ?? true;
    const showCommandSeparately =
      effectiveStep.options?.show_command_separately ?? false;

    cellContent += renderTableInstruction(
      effectiveStep.instruction,
      env.variables,
      effectiveStep.variables,
      resolveVariables,
      substituteVars,
    );

    // Process command (code content)
    if (effectiveStep.command) {
      let displayCommand = effectiveStep.command;

      if (resolveVariables && substituteVars) {
        displayCommand = substituteVariables(
          displayCommand,
          env.variables || {},
          effectiveStep.variables,
        );
      }

      // Wrap in backticks and escape special characters
      const cleanCommand = displayCommand
        .trim()
        .replace(/\n/g, '<br>')
        .replace(/\|/g, '\\|') // Escape pipes to prevent table breakage
        .replace(/`/g, '\\`')
        .replace(/<br>$/, ''); // Remove trailing <br> tag

      if (showCommandSeparately && effectiveStep.instruction) {
        // Show command separately with label
        cellContent += `<br><br>**Command:**<br>\`${cleanCommand}\``;
      } else if (!effectiveStep.instruction) {
        // No instruction, just show command
        cellContent += `\`${cleanCommand}\``;
      } else {
        // Both present, inline mode
        cellContent += `<br><br>\`${cleanCommand}\``;
      }
    }

    // Process script (external shell script file)
    if (effectiveStep.script) {
      const sep = cellContent ? '<br><br>' : '';
      cellContent += `${sep}**Script:** \`${effectiveStep.script}\``;
      if (operationDir) {
        try {
          const scriptPath = path.resolve(operationDir, effectiveStep.script);
          const scriptContent = fs
            .readFileSync(scriptPath, 'utf-8')
            .trimEnd()
            .replace(/\|/g, '\\|')
            .replace(/\n/g, '<br>');
          cellContent += `<br>\`\`\`bash<br>${scriptContent}<br>\`\`\``;
        } catch {
          cellContent += ` <em>(file not found)</em>`;
        }
      }
    }

    // Add expect
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
        const sep = cellContent ? '<br>' : '';
        cellContent += `${sep}_Expected:_`;
        for (const p of parts) cellContent += `<br>- [ ] _${p}_`;
      }
    }

    // Fallback for steps with neither
    if (!cellContent) {
      if (effectiveStep.sub_steps && effectiveStep.sub_steps.length > 0) {
        cellContent = '_(see substeps below)_';
      } else {
        cellContent = `_(${effectiveStep.type} step)_`;
      }
    }

    // Add sign-off checkboxes if PIC or Reviewer is set (per environment)
    // Use effectiveStep to respect variant overrides for PIC and reviewer
    if (effectiveStep.pic || effectiveStep.reviewer) {
      cellContent += '<br><br>**Sign-off:**';
      if (effectiveStep.pic) {
        cellContent += '<br>- [ ] PIC';
      }
      if (effectiveStep.reviewer) {
        cellContent += '<br>- [ ] Reviewer';
      }
    }

    // Add environment-specific evidence results
    // Use effectiveStep to respect variant overrides for evidence
    cellContent += formatEvidenceInfo(
      effectiveStep.evidence,
      env.name,
      operationDir,
    );

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
        // Close current table (the next row reopens lazily)
        rows += closeStepTable(tableState);

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
      }

      rows += generateSubStepRow(
        subStep,
        subStepPrefix,
        environments,
        resolveVariables,
        1,
        operationDir,
        commonVariables,
        tableState,
      );
    });

    // Render rollbacks for all sub-steps AFTER all sub-steps are rendered
    step.sub_steps.forEach((subStep, subIndex) => {
      const rb = subStep.rollback?.[0];
      if (hasRollbackContent(rb)) {
        const subStepLetter = indexToLetters(subIndex);
        const subStepPrefix = `${prefix}${stepNumber}${subStepLetter}`;

        // Close current table (the next step row reopens lazily)
        rows += closeStepTable(tableState);

        // Add rollback heading (h4 level for sub-step rollbacks)
        const subStepRollbackName = resolveVariables
          ? substituteVariables(
              subStep.name,
              commonVariables ?? {},
              subStep.variables,
            )
          : subStep.name;
        rows += `#### 🔄 Rollback for Step ${subStepPrefix}: ${subStepRollbackName}\n\n`;

        // Render rollback table (shared cell renderer; sub_steps inline)
        rows += '| Environment | Rollback Action |\n';
        rows += '|-------------|----------------|\n';

        environments.forEach((env) => {
          const cellContent = renderRollbackCellMarkdown(
            rb,
            env,
            resolveVariables,
            operationDir,
            subStep.variables,
            true,
          );
          rows += `| ${env.name} | ${cellContent} |\n`;
        });

        // Blank line after the rollback table; the next step row reopens the
        // step table lazily, so no dangling empty header is emitted here.
        rows += '\n';
      }
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
  commonVariables?: Record<string, any>,
  tableState: TableState = { open: true },
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
  // The name cell is shared across all env columns, so only common variables +
  // step variables are resolved here — env-specific placeholders intentionally
  // stay literal in this cell (they resolve per-environment in the row cells).
  const displaySubStepName = resolveDisplayText(
    step.name,
    resolveVariables,
    commonVariables,
    step.variables,
  );
  let stepCell = `[ ] ${indent}Step ${stepId}: ${displaySubStepName} ${typeIcon}`;
  if (
    step.description &&
    typeof step.description === 'string' &&
    step.description.trim().length > 0
  ) {
    stepCell += `<br>${resolveDisplayText(step.description, resolveVariables, commonVariables, step.variables)}`;
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

  rows += ensureStepTableOpen(tableState, environments);
  rows += `| ${stepCell} |`;

  // Subsequent columns: Commands for each environment
  environments.forEach((env) => {
    // Check if step should be rendered for this environment
    if (!shouldRenderStepForEnvironment(step, env.name)) {
      rows += ' — |';
      return;
    }

    // Merge variant for this environment (if exists)
    const effectiveStep = mergeStepVariant(step, env.name);

    let cellContent = '';

    // Get sub-step options (defaults) from effective step
    const substituteVars = effectiveStep.options?.substitute_vars ?? true;
    const showCommandSeparately =
      effectiveStep.options?.show_command_separately ?? false;

    cellContent += renderTableInstruction(
      effectiveStep.instruction,
      env.variables,
      effectiveStep.variables,
      resolveVariables,
      substituteVars,
    );

    // Process command (code content)
    if (effectiveStep.command) {
      let displayCommand = effectiveStep.command;

      if (resolveVariables && substituteVars) {
        displayCommand = substituteVariables(
          displayCommand,
          env.variables || {},
          effectiveStep.variables,
        );
      }

      // Wrap in backticks and escape special characters
      const cleanCommand = displayCommand
        .trim()
        .replace(/\n/g, '<br>')
        .replace(/\|/g, '\\|') // Escape pipes to prevent table breakage
        .replace(/`/g, '\\`')
        .replace(/<br>$/, ''); // Remove trailing <br> tag

      if (showCommandSeparately && effectiveStep.instruction) {
        // Show command separately with label
        cellContent += `<br><br>**Command:**<br>\`${cleanCommand}\``;
      } else if (!effectiveStep.instruction) {
        // No instruction, just show command
        cellContent += `\`${cleanCommand}\``;
      } else {
        // Both present, inline mode
        cellContent += `<br><br>\`${cleanCommand}\``;
      }
    }

    // Process script (external shell script file)
    if (effectiveStep.script) {
      const sep = cellContent ? '<br><br>' : '';
      cellContent += `${sep}**Script:** \`${effectiveStep.script}\``;
      if (operationDir) {
        try {
          const scriptPath = path.resolve(operationDir, effectiveStep.script);
          const scriptContent = fs
            .readFileSync(scriptPath, 'utf-8')
            .trimEnd()
            .replace(/\|/g, '\\|')
            .replace(/\n/g, '<br>');
          cellContent += `<br>\`\`\`bash<br>${scriptContent}<br>\`\`\``;
        } catch {
          cellContent += ` <em>(file not found)</em>`;
        }
      }
    }

    // Add expect
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
        const sep = cellContent ? '<br>' : '';
        cellContent += `${sep}_Expected:_`;
        for (const p of parts) cellContent += `<br>- [ ] _${p}_`;
      }
    }

    // Fallback for sub-steps with neither
    if (!cellContent) {
      if (effectiveStep.sub_steps && effectiveStep.sub_steps.length > 0) {
        cellContent = '_(see substeps below)_';
      } else {
        cellContent = `_(${effectiveStep.type} step)_`;
      }
    }

    // Add environment-specific evidence results
    // Use effectiveStep to respect variant overrides for evidence
    cellContent += formatEvidenceInfo(
      effectiveStep.evidence,
      env.name,
      operationDir,
    );

    // Add sign-off checkboxes if PIC or Reviewer is set (per environment)
    // Use effectiveStep to respect variant overrides for PIC and reviewer
    if (effectiveStep.pic || effectiveStep.reviewer) {
      cellContent += '<br><br>**Sign-off:**';
      if (effectiveStep.pic) {
        cellContent += '<br>- [ ] PIC';
      }
      if (effectiveStep.reviewer) {
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
        // Close current table (the next row reopens lazily)
        rows += closeStepTable(tableState);

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
      }

      rows += generateSubStepRow(
        nestedSubStep,
        nestedStepId,
        environments,
        resolveVariables,
        depth + 1,
        operationDir,
        commonVariables,
        tableState,
      );
    });

    // Render rollbacks for all nested sub-steps AFTER all nested sub-steps are rendered
    step.sub_steps.forEach((nestedSubStep, nestedIndex) => {
      const rb = nestedSubStep.rollback?.[0];
      if (hasRollbackContent(rb)) {
        let nestedStepId: string;
        if (depth % 2 === 1) {
          nestedStepId = `${stepId}${nestedIndex + 1}`;
        } else {
          const letter = indexToLetters(nestedIndex);
          nestedStepId = `${stepId}${letter}`;
        }

        // Close current table (the next step row reopens lazily)
        rows += closeStepTable(tableState);

        // Determine heading level based on depth
        const headingLevel = '#'.repeat(Math.min(3 + depth, 6));
        const nestedRollbackName = resolveVariables
          ? substituteVariables(
              nestedSubStep.name,
              commonVariables ?? {},
              nestedSubStep.variables,
            )
          : nestedSubStep.name;
        rows += `${headingLevel} 🔄 Rollback for Step ${nestedStepId}: ${nestedRollbackName}\n\n`;

        // Render rollback table (shared cell renderer; sub_steps inline)
        rows += '| Environment | Rollback Action |\n';
        rows += '|-------------|----------------|\n';

        environments.forEach((env) => {
          const cellContent = renderRollbackCellMarkdown(
            rb,
            env,
            resolveVariables,
            operationDir,
            nestedSubStep.variables,
            true,
          );
          rows += `| ${env.name} | ${cellContent} |\n`;
        });

        // Blank line after the rollback table; the next step row reopens the
        // step table lazily, so no dangling empty header is emitted here.
        rows += '\n';
      }
    });
  }

  return rows;
}

/**
 * Enhanced manual generation with metadata and environment filtering.
 * Pass runManifest to overlay run-specific evidence onto the generated manual.
 */
export function generateManualWithMetadata(
  operation: Operation,
  metadata?: GenerationMetadata,
  targetEnvironment?: string,
  resolveVariables?: boolean,
  includeGantt?: boolean,
  operationDir?: string,
  runManifest?: RunManifest,
): string {
  let markdown = '';

  // Add YAML frontmatter if metadata is provided
  if (metadata) {
    markdown += generateYamlFrontmatter(metadata);
  }

  // Run info block (before Gantt so it appears near the top)
  if (runManifest) {
    markdown += buildRunInfoBlock(runManifest);
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

  // Augment operation steps with run manifest evidence
  let workingOperation = operation;
  let orphanedKeys: string[] = [];
  if (runManifest) {
    const augmented = augmentOperationWithRunManifest(
      workingOperation,
      runManifest,
    );
    workingOperation = augmented.operation;
    orphanedKeys = augmented.orphanedKeys;
  }

  // Filter environments if specified
  let environments = workingOperation.environments;
  if (targetEnvironment) {
    environments = workingOperation.environments.filter(
      (env) => env.name === targetEnvironment,
    );
    if (environments.length === 0) {
      throw new Error(
        `Environment '${targetEnvironment}' not found in operation. Available: ${workingOperation.environments.map((e) => e.name).join(', ')}`,
      );
    }
  }

  // Create filtered operation for generation
  // Filter steps whose 'when' condition doesn't match any active environment
  const environmentNames = environments.map((e) => e.name);
  const filteredOperation = {
    ...workingOperation,
    environments,
    steps: filterStepsForEnvironments(workingOperation.steps, environmentNames),
  };

  markdown += generateManualContent(
    filteredOperation,
    resolveVariables,
    operationDir,
  );

  if (runManifest && orphanedKeys.length > 0) {
    markdown += buildOrphanedEvidenceSection(orphanedKeys, runManifest);
  }

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
    // Group steps by phase (block-aware: `uses:` blocks stay contiguous, so a
    // reused block's preflight checks render next to the block, not hoisted to
    // the global Pre-Flight section)
    const phases = groupByPhase(operation.steps, (step) => step);

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

      // Tables open lazily: the header is emitted right before the first row
      // that needs it (see ensureStepTableOpen) instead of eagerly, so section
      // headings and rollbacks never leave a dangling empty `| Step | ... |`.
      const tableState: TableState = { open: false };

      // Build table rows for this phase with continuous numbering
      // Handle section headings by closing tables (next row reopens lazily)
      phaseSteps.forEach((step, _index) => {
        if (step.section_heading) {
          // Close current table if one is open
          markdown += closeStepTable(tableState);

          // Add section heading
          const sectionHeadingName = resolveDisplayText(
            step.name,
            resolveVariables,
            operation.common_variables,
            step.variables,
          );
          markdown += `### ${sectionHeadingName}\n\n`;
          if (step.description) {
            markdown += `${resolveDisplayText(step.description, resolveVariables, operation.common_variables, step.variables)}\n\n`;
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
        }

        markdown += generateStepRow(
          step,
          globalStepNumber,
          operation.environments,
          resolveVariables,
          '',
          phaseName,
          operationDir,
          operation.common_variables ?? {},
          tableState,
        );

        // Inline rollback rendering - render immediately after step if present
        const rb = step.rollback?.[0];
        if (hasRollbackContent(rb)) {
          // Close current table (next step row reopens lazily)
          markdown += closeStepTable(tableState);

          // Add rollback heading
          const rollbackHeadingName = resolveVariables
            ? substituteVariables(
                step.name,
                operation.common_variables ?? {},
                step.variables,
              )
            : step.name;
          markdown += `### 🔄 Rollback for Step ${globalStepNumber}: ${rollbackHeadingName}\n\n`;

          // Render rollback table (shared cell renderer; sub_steps inline)
          markdown += '| Environment | Rollback Action |\n';
          markdown += '|-------------|----------------|\n';

          operation.environments.forEach((env) => {
            const cellContent = renderRollbackCellMarkdown(
              rb,
              env,
              resolveVariables,
              operationDir,
              step.variables,
              true,
            );
            markdown += `| ${env.name} | ${cellContent} |\n`;
          });

          // Blank line after the rollback table; the next step row reopens the
          // step table lazily, so no dangling empty header is emitted here.
          markdown += '\n';
        }

        globalStepNumber++; // Increment for next step
      });

      markdown += closeStepTable(tableState);
    });
  }

  // Add rollback section if any steps have rollback defined
  const stepsWithRollback = operation.steps.filter(
    (step) => step.rollback && step.rollback.length > 0,
  );
  if (stepsWithRollback.length > 0) {
    markdown += '## 🔄 Rollback Procedures\n\n';
    markdown +=
      'If deployment fails, execute the following rollback steps:\n\n';

    stepsWithRollback.forEach((step, _index) => {
      const rb = step.rollback?.[0];
      if (!rb) return;

      const rollbackSectionName = resolveVariables
        ? substituteVariables(
            step.name,
            operation.common_variables ?? {},
            step.variables,
          )
        : step.name;
      markdown += `### Rollback for: ${rollbackSectionName}\n\n`;

      if (hasRollbackContent(rb)) {
        markdown += '| Environment | Rollback Action |\n';
        markdown += '|-------------|----------------|\n';

        operation.environments.forEach((env) => {
          const cellContent = renderRollbackCellMarkdown(
            rb,
            env,
            resolveVariables,
            operationDir,
            step.variables,
            true,
          );
          markdown += `| ${env.name} | ${cellContent} |\n`;
        });

        markdown += '\n';
      }
    });
  }

  // Operation-level (global) rollback plan
  if (operation.rollback?.steps && operation.rollback.steps.length > 0) {
    markdown += '## 🔄 Rollback Plan\n\n';
    markdown +=
      'If the operation fails, execute the following rollback steps:\n\n';
    markdown += `**Automatic:** ${operation.rollback.automatic ? 'Yes' : 'No'}\n\n`;
    if (
      operation.rollback.conditions &&
      operation.rollback.conditions.length > 0
    ) {
      markdown += `**Conditions:** ${operation.rollback.conditions.join(', ')}\n\n`;
    }

    markdown += '| Step |';
    operation.environments.forEach((env) => {
      markdown += ` ${env.name} |`;
    });
    markdown += '\n|------|';
    operation.environments.forEach(() => {
      markdown += '---------|';
    });
    markdown += '\n';

    // Emit a table row for a rollback step (and recurse into its sub_steps as
    // Rollback Step N.M rows) so nested rollback structure isn't dropped.
    const emitRollbackRow = (rb: RollbackStep, label: string): void => {
      const namedLabel = rb.name ? `${label}: ${rb.name}` : label;
      markdown += `| ${namedLabel} |`;
      operation.environments.forEach((env) => {
        const cellContent = renderRollbackCellMarkdown(
          rb,
          env,
          resolveVariables,
          operationDir,
          {},
        );
        markdown += ` ${cellContent} |`;
      });
      markdown += '\n';
      rb.sub_steps?.forEach((sub, subIndex) => {
        emitRollbackRow(sub, `${label}.${subIndex + 1}`);
      });
    };

    operation.rollback.steps.forEach((rb, index) => {
      emitRollbackRow(rb, `Rollback Step ${index + 1}`);
    });

    markdown += '\n';
  }

  return markdown;
}

/**
 * Generate a single-environment heading-based Markdown manual (issue #15).
 * Unlike the table format (multi-env columns), this produces one clean Markdown
 * file per environment — optimised for reading *during* an operation.
 */
export function generateSingleEnvManual(
  operation: Operation,
  targetEnv: string,
  resolveVariables = false,
  operationDir?: string,
  runManifest?: RunManifest,
): string {
  // Augment steps with run manifest evidence before rendering
  let workingOperation = operation;
  let orphanedKeys: string[] = [];
  if (runManifest) {
    const augmented = augmentOperationWithRunManifest(
      workingOperation,
      runManifest,
    );
    workingOperation = augmented.operation;
    orphanedKeys = augmented.orphanedKeys;
  }

  const env = workingOperation.environments.find((e) => e.name === targetEnv);
  const envVars = env?.variables ?? {};

  function resolveCmd(
    cmd: string,
    stepVariables?: Record<string, any>,
  ): string {
    if (!resolveVariables) return cmd;
    return substituteVariables(cmd, envVars, stepVariables);
  }

  function renderStep(step: Step, prefix: string, headingLevel: number): void {
    // Apply env-specific variant overrides before rendering
    const effectiveStep = mergeStepVariant(step, targetEnv);

    // Resolve ${VAR} placeholders (e.g. in foreach-expanded step names) against
    // env variables + this step's own variables when --resolve-vars is set.
    const resolveText = (s: string): string =>
      resolveCmd(s, effectiveStep.variables);

    const hashes = '#'.repeat(headingLevel);
    lines.push(`${hashes} ${prefix}: ${resolveText(effectiveStep.name)}`);
    lines.push('');

    if (effectiveStep.description) {
      const desc = resolveText(effectiveStep.description.trim());
      // Multi-line descriptions are prose, so preserve authored line breaks
      // (single-line stays italicised). preserveLineBreaks is a no-op on text
      // without internal newlines.
      lines.push(desc.includes('\n') ? preserveLineBreaks(desc) : `_${desc}_`);
      lines.push('');
    }

    if (effectiveStep.pic) lines.push(`> PIC: ${effectiveStep.pic}`);
    if (effectiveStep.reviewer)
      lines.push(`> Reviewer: ${effectiveStep.reviewer}`);
    if (effectiveStep.pic || effectiveStep.reviewer) lines.push('');

    if (effectiveStep.needs && effectiveStep.needs.length > 0) {
      lines.push(`> Depends on: ${effectiveStep.needs.join(', ')}`);
      lines.push('');
    }

    if (effectiveStep.timeline) {
      lines.push(
        `> Timeline: ${formatTimelineForDisplay(effectiveStep.timeline)}`,
      );
      lines.push('');
    }

    if (effectiveStep.if) {
      lines.push(`> Condition: ${effectiveStep.if}`);
      lines.push('');
    }

    if (effectiveStep.instruction) {
      lines.push('**Instructions**');
      lines.push('');
      lines.push(preserveLineBreaks(resolveText(effectiveStep.instruction)));
      lines.push('');
    }

    if (effectiveStep.command) {
      const resolvedCmd = resolveText(effectiveStep.command);
      lines.push('**Command**');
      lines.push('');
      if (/^\s*```/.test(resolvedCmd)) {
        lines.push(resolvedCmd.trimEnd());
      } else {
        lines.push('```bash');
        lines.push(resolvedCmd.trimEnd());
        lines.push('```');
      }
      lines.push('');
    }

    if (effectiveStep.script) {
      lines.push(`**Script:** \`${effectiveStep.script}\``);
      lines.push('');
      if (operationDir) {
        try {
          const scriptPath = path.resolve(operationDir, effectiveStep.script);
          const scriptContent = fs.readFileSync(scriptPath, 'utf-8').trimEnd();
          lines.push('```bash');
          lines.push(scriptContent);
          lines.push('```');
        } catch {
          lines.push(`_Script file not found: ${effectiveStep.script}_`);
        }
      }
      lines.push('');
    }

    if (effectiveStep.expect != null) {
      const resolvedExpect = resolveVariables
        ? substituteExpectVars(
            effectiveStep.expect,
            envVars,
            effectiveStep.variables,
          )
        : effectiveStep.expect;
      const parts = renderExpectParts(resolvedExpect);
      if (parts.length > 0) {
        lines.push('**Expected:**');
        for (const p of parts) lines.push(`- [ ] ${p}`);
        lines.push('');
      }
    }

    if (effectiveStep.evidence) {
      const evStatus = effectiveStep.evidence.required
        ? 'Required'
        : 'Optional';
      const evTypes = effectiveStep.evidence.types ?? [];
      const evTypesText = evTypes.length > 0 ? `: ${evTypes.join(', ')}` : '';
      lines.push(`> Evidence ${evStatus}${evTypesText}`);
      lines.push('');

      // Render captured evidence results for this environment, or a
      // command_output capture prompt when none have been recorded yet
      // (parity with the multi-env table and Confluence renderers).
      const envResults = effectiveStep.evidence.results?.[targetEnv];
      if (envResults && envResults.length > 0) {
        lines.push('**Evidence Captured**');
        lines.push('');
        for (const item of envResults as RunEvidenceItem[]) {
          lines.push(renderEvidenceItemMarkdown(item, operationDir).trimEnd());
          lines.push('');
        }
      } else if (evTypes.includes('command_output')) {
        lines.push('```bash');
        lines.push('# Paste command output here');
        lines.push('```');
        lines.push('');
      }
    }

    // Recursively render sub_steps as deeper headings (Step N.1, N.1.1, etc.)
    if (step.sub_steps && step.sub_steps.length > 0) {
      step.sub_steps
        .map((sub, originalIdx) => ({ sub, originalIdx }))
        .filter(
          ({ sub }) =>
            !sub.when || sub.when.length === 0 || sub.when.includes(targetEnv),
        )
        .forEach(({ sub, originalIdx }) => {
          renderStep(
            sub,
            `${prefix}.${originalIdx + 1}`,
            Math.min(headingLevel + 1, 6),
          );
        });
    }

    // Render step-level rollback AFTER sub_steps (mirrors multi-env inline
    // rollback position). Reuses the same recursive renderer as the
    // operation-level plan, so a step-level rollback's own sub_steps render too.
    const rb = effectiveStep.rollback?.[0];
    if (hasRollbackContent(rb)) {
      renderRollbackStepSingleEnv(
        rb,
        '🔄 Rollback',
        Math.min(headingLevel + 1, 6),
        effectiveStep.variables ?? {},
      );
    }
  }

  // Render one rollback step (and its nested sub_steps) recursively. Shared by
  // step-level rollback (Step.rollback) AND the operation-level rollback plan —
  // one renderer, so sub_steps never get dropped by a forgotten copy. Rollback
  // steps are structurally like normal steps: optional name in the heading plus
  // nested sub_steps numbered <label>.N, <label>.N.M, …
  function renderRollbackStepSingleEnv(
    rb: RollbackStep,
    label: string,
    headingLevel: number,
    stepVariables: Record<string, any> = {},
  ): void {
    const substituteVars = rb.options?.substitute_vars ?? true;
    const resolve = resolveVariables && substituteVars;
    const hashes = '#'.repeat(Math.min(headingLevel, 6));
    const heading = rb.name
      ? `${label}: ${resolve ? resolveCmd(rb.name, stepVariables) : rb.name}`
      : label;
    lines.push(`${hashes} ${heading}`);
    lines.push('');

    if (rb.instruction) {
      lines.push('**Instructions**');
      lines.push('');
      lines.push(
        resolve ? resolveCmd(rb.instruction, stepVariables) : rb.instruction,
      );
      lines.push('');
    }

    if (rb.command) {
      lines.push('**Command**');
      lines.push('```bash');
      const cmd = rb.command.trimEnd();
      lines.push(resolve ? resolveCmd(cmd, stepVariables) : cmd);
      lines.push('```');
      lines.push('');
    }

    if (rb.script) {
      lines.push(`**Script:** \`${rb.script}\``);
      lines.push('');
      if (operationDir) {
        try {
          const scriptPath = path.resolve(operationDir, rb.script);
          const scriptContent = fs.readFileSync(scriptPath, 'utf-8').trimEnd();
          lines.push('```bash');
          lines.push(scriptContent);
          lines.push('```');
        } catch {
          lines.push(`_Script file not found: ${rb.script}_`);
        }
        lines.push('');
      }
    }

    if (rb.expect != null) {
      const resolvedExpect = resolve
        ? substituteExpectVars(rb.expect, envVars, stepVariables)
        : rb.expect;
      const parts = renderExpectParts(resolvedExpect);
      if (parts.length > 0) {
        lines.push('**Expected:**');
        for (const p of parts) lines.push(`- [ ] ${p}`);
        lines.push('');
      }
    }

    if (rb.pic || rb.reviewer) {
      lines.push('**Sign-off:**');
      if (rb.pic) lines.push(`- [ ] PIC (${rb.pic})`);
      if (rb.reviewer) lines.push(`- [ ] Reviewer (${rb.reviewer})`);
      lines.push('');
    }

    rb.sub_steps?.forEach((sub, subIndex) => {
      renderRollbackStepSingleEnv(
        sub,
        `${label}.${subIndex + 1}`,
        Math.min(headingLevel + 1, 6),
        stepVariables,
      );
    });
  }

  const lines: string[] = [];
  lines.push(`# ${workingOperation.name} — ${titleCase(targetEnv)}`);
  lines.push('');

  if (runManifest) {
    lines.push(buildRunInfoBlock(runManifest).trimEnd());
    lines.push('');
  }

  const allSteps = workingOperation.steps ?? [];
  // Use original index for step numbers so "Step 6" means the same step
  // regardless of which environments skip earlier when-conditional steps.
  const visibleSteps = allSteps
    .map((step, originalIndex) => ({ step, originalIndex }))
    .filter(
      ({ step }) =>
        !step.when || step.when.length === 0 || step.when.includes(targetEnv),
    );

  visibleSteps.forEach(({ step, originalIndex }, i) => {
    renderStep(step, `Step ${originalIndex + 1}`, 2);
    if (i < visibleSteps.length - 1) {
      lines.push('---');
      lines.push('');
    }
  });

  // Operation-level (global) rollback plan, resolved for this environment
  const globalRollback = workingOperation.rollback;
  if (globalRollback?.steps && globalRollback.steps.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## 🔄 Rollback Plan');
    lines.push('');
    lines.push('If the operation fails, execute the following rollback steps:');
    lines.push('');
    lines.push(`**Automatic:** ${globalRollback.automatic ? 'Yes' : 'No'}`);
    lines.push('');
    if (globalRollback.conditions && globalRollback.conditions.length > 0) {
      lines.push(`**Conditions:** ${globalRollback.conditions.join(', ')}`);
      lines.push('');
    }

    globalRollback.steps.forEach((rb, index) => {
      renderRollbackStepSingleEnv(rb, `Rollback Step ${index + 1}`, 3);
    });
  }

  let result = lines.join('\n');
  if (runManifest && orphanedKeys.length > 0) {
    result += buildOrphanedEvidenceSection(orphanedKeys, runManifest);
  }
  return result;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
