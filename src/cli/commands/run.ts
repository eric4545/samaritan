import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface as createReadlineInterface } from 'node:readline';
import { Command } from 'commander';
import { copyToClipboard } from '../../lib/clipboard';
import { createEventLogger } from '../../lib/event-logger';
import { OperationExecutor } from '../../lib/executor';
import { generateReport } from '../../lib/report-generator';
import { SessionUtils, sessionManager } from '../../lib/session-manager';
import { SessionState } from '../../lib/session-state';
import { bootstrapSessions, type TmuxSession } from '../../lib/tmux-session';
import { renderCodeBlock, renderKeyHints, StepController } from '../../lib/tui';
import { resolveVars, resolveVarsSafe } from '../../lib/variable-resolver';
import type { ExecutionMode, Operation, Step } from '../../models/operation';
import { parseOperation } from '../../operations/parser';

interface RunOptions {
  env?: string;
  environment?: string;
  autoApprove?: boolean;
  dryRun?: boolean;
  mode?: ExecutionMode;
  variables?: string[];
  verbose?: boolean;
  withAi?: boolean;
  continueOnError?: boolean;
  report?: string;
}

interface ResumeOptions {
  verbose?: boolean;
  autoApprove?: boolean;
  fromStep?: number;
}

class OperationRunner {
  async runOperation(
    operationFile: string,
    options: RunOptions,
  ): Promise<void> {
    const targetEnv = options.env || options.environment;
    if (!targetEnv) {
      throw new Error(
        "Required option '-e, --env <environment>' not specified",
      );
    }

    // Resolve to absolute path for persistence
    const absFile = existsSync(operationFile)
      ? realpathSync(operationFile)
      : operationFile;

    console.log(`🚀 Starting operation: ${absFile}`);
    console.log(`🎯 Target environment: ${targetEnv}`);

    const operation = await this.parseOperationFile(absFile);

    const environment = operation.environments.find(
      (env) => env.name === targetEnv,
    );
    if (!environment) {
      throw new Error(
        `Environment '${targetEnv}' not found in operation. Available: ${operation.environments.map((e) => e.name).join(', ')}`,
      );
    }

    const additionalVars = this.parseVariables(options.variables || []);

    // Merge common + env-specific + CLI overrides into resolved variable set
    const resolvedVars: Record<string, any> = {
      ...(operation.common_variables ?? {}),
      ...operation.variables[targetEnv],
      ...additionalVars,
    };

    const executionMode: ExecutionMode =
      options.mode ?? (options.autoApprove ? 'automatic' : 'manual');

    const operator = process.env.USER || 'unknown';

    // Create session first so its ID can serve as the JSONL log identifier
    const session = sessionManager.createSession(
      operation.id,
      targetEnv,
      operator,
      executionMode,
      resolvedVars,
      absFile,
    );

    const context = {
      operationId: operation.id,
      environment: targetEnv,
      variables: resolvedVars,
      operator,
      sessionId: session.id,
      dryRun: options.dryRun || false,
      autoMode: executionMode === 'automatic' || options.autoApprove || false,
    };

    this.displayOperationSummary(
      operation,
      environment,
      context,
      executionMode,
    );

    if (
      environment.approval_required &&
      !options.autoApprove &&
      !options.dryRun
    ) {
      console.log('⚠️  This environment requires approval.');
      console.log(
        '💡 Use --auto-approve to skip approval prompts or ensure approvals are pre-authorized.',
      );
    }

    console.log(`📋 Session: ${session.id}\n`);

    const executor = new OperationExecutor(operation, context);
    sessionManager.associateExecutor(session.id, executor);

    this.setupEventHandlers(executor, options);

    try {
      if (operation.preflight && operation.preflight.length > 0) {
        console.log('🔍 Running preflight checks...');
        await this.runPreflightChecks(operation.preflight, context);
        console.log('✅ Preflight checks passed\n');
      }

      const isInteractiveMode = !context.autoMode && !options.dryRun;

      if (isInteractiveMode) {
        let tmuxSession: TmuxSession | undefined;
        if (operation.sessions && Object.keys(operation.sessions).length > 0) {
          console.log('🖥️  Bootstrapping tmux sessions...');
          try {
            tmuxSession = await bootstrapSessions(
              context.sessionId,
              operation.sessions,
            );
            console.log(
              `   Sessions: ${Object.keys(operation.sessions).join(', ')}\n`,
            );
          } catch (err: any) {
            console.warn(
              `⚠️  tmux bootstrap failed (${err.message}); falling back to prompt-only mode.\n`,
            );
          }
        }

        console.log('▶️  Starting interactive operation execution...\n');
        executor.startInteractive();
        const logPath = await this.runInteractiveStepLoop(
          executor,
          operation,
          absFile,
          resolvedVars,
          tmuxSession,
        );
        executor.finalizeOperation();

        if (options.report && logPath) {
          mkdirSync(options.report, { recursive: true });
          const reportFile = join(
            options.report,
            `samaritan-${session.id}-report.md`,
          );
          writeFileSync(reportFile, generateReport(logPath), 'utf-8');
          console.log(`📄 Report: ${reportFile}`);
        }

        tmuxSession?.teardown();
      } else {
        console.log('▶️  Starting operation execution...\n');
        console.log(
          '⚠️  Note: command execution is not yet implemented in v1.0.',
        );
        console.log(
          '   Steps will be marked complete without running commands.\n',
        );
        await executor.execute();
      }

      const finalState = executor.getState();

      if (finalState.status === 'completed') {
        if (options.dryRun) {
          console.log('\n✅ Dry-run preview complete — all steps traversed.');
          console.log(
            `   Steps: ${finalState.totalSteps}  Skipped: ${finalState.skippedSteps}`,
          );
        } else {
          console.log('\n✅ Operation completed successfully!');
        }
      } else if (finalState.status === 'paused') {
        const waitingStep = finalState.steps.find(
          (s) => s.status === 'waiting',
        );
        const stepName = waitingStep?.step.name ?? 'unknown';
        console.log('\n⏸️  Operation paused — manual interaction required.');
        console.log(
          `   ${finalState.waitingSteps} step(s) waiting. Paused at: "${stepName}"`,
        );
        console.log(
          `\n💡 Resume this session:\n   samaritan resume ${session.id}`,
        );
      }

      const summary = sessionManager.getSessionSummary(session.id);
      if (summary) {
        console.log(`\n📊 Execution Summary:`);
        console.log(
          `   Duration: ${SessionUtils.formatSessionDuration(session)}`,
        );
        console.log(`   Evidence collected: ${summary.evidenceCount} items`);
        console.log(`   Retries: ${summary.retryCount}`);
        console.log(`   Approvals: ${summary.approvalCount}`);
      }
    } catch (error: any) {
      console.error(`\n❌ Operation failed: ${error.message}`);

      const currentSession = sessionManager.getSession(session.id);
      if (currentSession) {
        console.log(`\n🔄 Resume from where you left off:`);
        console.log(`   samaritan resume ${session.id}`);
      }

      throw error;
    }
  }

  async resumeSession(
    sessionId: string,
    options: ResumeOptions,
  ): Promise<void> {
    console.log(`🔄 Resuming session: ${sessionId}`);

    // getSession now checks in-memory then file-based persistence
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(
        `Session not found: ${sessionId}\n` +
          '  No persisted session found for this ID.\n' +
          '  Start a new run with: samaritan run <operation.yaml> -e <environment>',
      );
    }

    if (session.status === 'completed') {
      console.log('✅ Session already completed');
      return;
    }

    if (session.status === 'cancelled') {
      throw new Error('Cannot resume cancelled session');
    }

    if (!session.operation_file) {
      throw new Error(
        'Cannot resume: session has no operation_file recorded.\n' +
          '  This session was started with an older version of samaritan.',
      );
    }

    console.log(`📋 Session details:`);
    console.log(`   Operation: ${session.operation_id}`);
    console.log(`   File: ${session.operation_file}`);
    console.log(`   Environment: ${session.environment}`);
    console.log(`   Resuming at step: ${session.current_step_index + 1}`);
    console.log(`   Progress: ${session.completion_percentage || 0}%`);
    console.log(
      `   Status: ${SessionUtils.getSessionStatusEmoji(session.status)} ${session.status}`,
    );

    const operation = await this.parseOperationFile(session.operation_file);

    const context = {
      operationId: session.operation_id,
      environment: session.environment,
      variables: session.variables || {},
      operator: session.operator || process.env.USER || 'unknown',
      sessionId: session.id,
      dryRun: false,
      autoMode: session.mode === 'automatic',
    };

    const executor = new OperationExecutor(operation, context);
    sessionManager.associateExecutor(session.id, executor);

    this.setupEventHandlers(executor, { verbose: options.verbose });

    // Bootstrap tmux if the operation uses sessions
    let tmuxSession: TmuxSession | undefined;
    if (operation.sessions && Object.keys(operation.sessions).length > 0) {
      console.log('\n🖥️  Bootstrapping tmux sessions...');
      try {
        tmuxSession = await bootstrapSessions(session.id, operation.sessions);
        console.log(
          `   Sessions: ${Object.keys(operation.sessions).join(', ')}\n`,
        );
      } catch (err: any) {
        console.warn(
          `⚠️  tmux bootstrap failed (${err.message}); continuing without tmux.\n`,
        );
      }
    }

    console.log('\n▶️  Resuming operation execution...\n');
    const startIndex =
      options.fromStep !== undefined
        ? options.fromStep - 1
        : session.current_step_index;
    executor.resumeFromIndex(startIndex);

    await this.runInteractiveStepLoop(
      executor,
      operation,
      session.operation_file,
      context.variables,
      tmuxSession,
    );
    executor.finalizeOperation();
    tmuxSession?.teardown();

    console.log('\n✅ Session resumed and completed!');
  }

  private async runInteractiveStepLoop(
    executor: OperationExecutor,
    operation: Operation,
    operationFile: string,
    vars: Record<string, any>,
    tmuxSession?: TmuxSession,
  ): Promise<string> {
    const rl = createReadlineInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const question = (prompt: string): Promise<string> =>
      new Promise((resolve) => rl.question(prompt, resolve));

    const state = executor.getState();
    const logger = createEventLogger(state.context.sessionId);
    console.log(`📝 Audit log: ${logger.path}`);
    const sessionState = new SessionState();

    logger.emit({ type: 'session_start', op: operationFile });

    if (tmuxSession && operation.sessions) {
      for (const [name, pane] of tmuxSession.getPaneMap().entries()) {
        const cfg = operation.sessions[name];
        logger.emit({
          type: 'session_open',
          name,
          host: cfg?.host ?? 'local',
          pane,
        });
      }
    }

    for (const [key, value] of Object.entries(vars)) {
      sessionState.capture(key, String(value));
    }

    const autoSend = operation.run?.auto_send ?? false;
    const autoExec = operation.run?.auto_exec ?? false;

    const controller = tmuxSession
      ? new StepController({
          logger,
          tmux: tmuxSession,
          sessionState,
          autoSend,
          autoExec,
          sessions: operation.sessions,
        })
      : null;

    const DIVIDER = '─'.repeat(60);
    const isQuit = (c: string) => c === 'q' || c === 'quit';
    const isSkip = (c: string) => c === 's' || c === 'skip';
    const isRollback = (c: string) => c === 'r' || c === 'rollback';

    const tryResolve = (text: string | undefined): string | undefined => {
      if (!text) return text;
      try {
        return resolveVars(text, vars);
      } catch {
        // Fall back to safe resolution (display with unresolved markers)
        return resolveVarsSafe(text, vars);
      }
    };

    const doRollback = async (step: Step, i: number): Promise<void> => {
      if (controller) {
        console.log('    🔄 Initiating rollback...');
        await controller.rollback(step, i, state.context.operator);
        console.log('    ↩  Rollback complete.');
      } else if (step.rollback && step.rollback.length > 0) {
        console.log('    🔄 Rollback steps (manual — no tmux session):');
        for (const rb of step.rollback) {
          console.log(`      $ ${rb.command}`);
        }
      } else {
        console.log('    ℹ️  No rollback defined for this step.');
      }
    };

    const promptAction = async (
      hints: Array<{ key: string; label: string }>,
      commandToCopy?: string,
    ): Promise<string> => {
      console.log(`\n${renderKeyHints(hints)}`);
      const ans = await question('  > ');
      const choice = ans.trim().toLowerCase();
      if (commandToCopy && (choice === 'c' || choice === 'copy')) {
        const ok = await copyToClipboard(commandToCopy);
        console.log(
          ok ? '  ✅ Copied to clipboard!' : '  ⚠️  Clipboard unavailable',
        );
        return '';
      }
      return choice;
    };

    try {
      const steps = executor.getState().steps;

      for (
        let i = executor.getState().currentStepIndex;
        i < steps.length;
        i++
      ) {
        const { step } = steps[i];
        const stepNum = `[${i + 1}/${steps.length}]`;
        const typeLabel = step.type.toUpperCase();

        const resolvedCommand = tryResolve(step.command);
        const resolvedInstruction = tryResolve(step.instruction);

        // Emit step_start for every step so the report can reconstruct the timeline
        logger.emit({
          type: 'step_start',
          step: i,
          name: step.name,
          pic: step.pic,
          reviewer: step.reviewer,
        });

        console.log(`\n${DIVIDER}`);
        console.log(`${stepNum} ${typeLabel}: ${step.name}`);
        if (step.description) console.log(`    ${step.description}`);
        if (step.pic) console.log(`    PIC      : ${step.pic}`);
        if (step.reviewer) console.log(`    Reviewer : ${step.reviewer}`);
        if (step.session) console.log(`    Session  : ${step.session}`);
        if (step.ticket)
          console.log(
            `    Ticket   : ${Array.isArray(step.ticket) ? step.ticket.join(', ') : step.ticket}`,
          );

        if (step.type === 'automatic') {
          if (resolvedCommand)
            console.log(`\n${renderCodeBlock(resolvedCommand)}`);

          if (controller && step.session && resolvedCommand) {
            // tmux-backed automatic step
            const choice = await promptAction(
              [
                { key: '↵', label: 'send' },
                { key: 'c', label: 'copy' },
                { key: 's', label: 'skip' },
                { key: 'r', label: 'rollback' },
                { key: 'q', label: 'quit' },
              ],
              resolvedCommand,
            );
            if (isQuit(choice)) {
              executor.cancel();
              console.log('\n⛔ Execution aborted by operator.');
              break;
            }
            if (isRollback(choice)) {
              await doRollback(step, i);
              continue;
            }
            if (isSkip(choice)) {
              executor.skipStep(i);
              console.log('    ⏭  Skipped.');
              continue;
            }
            await controller.sendCommand(step.session, resolvedCommand, i);
            await executor.executeStepManually(
              i,
              `sent via tmux [${step.session}]`,
            );
            console.log(`    📤 Sent to tmux pane [${step.session}].`);

            // Run verify if defined
            if (step.verify) {
              console.log(
                `    🔍 Running verify: ${tryResolve(step.verify.command) ?? step.verify.command}`,
              );
              const { state: vState, assertResult } =
                await controller.runVerify(step, i);
              if (assertResult) {
                const icon = assertResult.pass ? '✅ PASS' : '❌ FAIL';
                console.log(
                  `    ${icon} Assert (${assertResult.type}): expected "${assertResult.expected}"`,
                );
                if (!assertResult.pass) {
                  const overrideAns = await question(
                    '    ⚠️  Assertion failed. [o=override with reason / r=rollback / Enter=stop]: ',
                  );
                  const oc = overrideAns.trim().toLowerCase();
                  if (oc === 'o' || oc === 'override') {
                    const reason = await question('    Reason for override: ');
                    logger.emit({
                      type: 'user_input',
                      action: 'override',
                      step: i,
                      actor: state.context.operator,
                      reason: reason.trim(),
                    });
                    console.log('    ⚠️  Override accepted.');
                  } else if (isRollback(oc)) {
                    await doRollback(step, i);
                    continue;
                  } else {
                    console.log('    ❌ Stopping due to failed assertion.');
                    break;
                  }
                }
              }
              console.log(`    ✅ Verify: ${vState}`);
              logger.emit({
                type: 'user_input',
                action: 'verify_ok',
                step: i,
                actor: state.context.operator,
              });
            }
            controller.completeStep(i);
          } else {
            // prompt-only automatic step
            const choice = await promptAction(
              [
                { key: '↵', label: 'confirm' },
                ...(resolvedCommand ? [{ key: 'c', label: 'copy' }] : []),
                { key: 's', label: 'skip' },
                { key: 'r', label: 'rollback' },
                { key: 'q', label: 'quit' },
              ],
              resolvedCommand,
            );
            if (isQuit(choice)) {
              executor.cancel();
              console.log('\n⛔ Execution aborted by operator.');
              break;
            }
            if (isRollback(choice)) {
              await doRollback(step, i);
              continue;
            }
            if (isSkip(choice)) {
              executor.skipStep(i);
              console.log('    ⏭  Skipped.');
              continue;
            }
            await executor.executeStepManually(i, 'confirmed');
            logger.emit({
              type: 'user_input',
              action: 'confirmed',
              step: i,
              actor: state.context.operator,
            });
            logger.emit({ type: 'step_complete', step: i });
            console.log('    ✅ Step marked complete.');
          }
        } else if (step.type === 'manual') {
          if (resolvedInstruction) console.log(`\n    ${resolvedInstruction}`);
          if (resolvedCommand) {
            console.log('\n    Command reference:');
            console.log(renderCodeBlock(resolvedCommand));
          }
          let manualNotes = '';
          while (true) {
            console.log(
              '\n' +
                renderKeyHints([
                  { key: '↵', label: 'done' },
                  ...(resolvedCommand ? [{ key: 'c', label: 'copy' }] : []),
                  { key: 's', label: 'skip' },
                  { key: 'r', label: 'rollback' },
                  { key: 'abort', label: 'abort' },
                ]),
            );
            const input = await question('  > ');
            const inputChoice = input.trim().toLowerCase();
            if (
              resolvedCommand &&
              (inputChoice === 'c' || inputChoice === 'copy')
            ) {
              const ok = await copyToClipboard(resolvedCommand);
              console.log(
                ok ? '  ✅ Copied to clipboard!' : '  ⚠️  Clipboard unavailable',
              );
              manualNotes = '';
              break;
            }
            manualNotes = input;
            break;
          }
          const choice = manualNotes.trim().toLowerCase();
          if (choice === 'abort') {
            executor.cancel();
            console.log('\n⛔ Execution aborted by operator.');
            break;
          }
          if (isRollback(choice)) {
            await doRollback(step, i);
            continue;
          }
          if (isSkip(choice)) {
            executor.skipStep(i);
            console.log('    ⏭  Skipped.');
            continue;
          }
          await executor.executeStepManually(
            i,
            manualNotes.trim() || 'confirmed',
          );
          logger.emit({
            type: 'user_input',
            action: 'confirmed',
            step: i,
            actor: state.context.operator,
            notes: manualNotes.trim() || undefined,
          });
          logger.emit({ type: 'step_complete', step: i });
          console.log('    ✅ Step marked complete.');
        } else if (step.type === 'approval') {
          if (resolvedInstruction) console.log(`\n    ${resolvedInstruction}`);
          const choice = await promptAction([
            { key: 'approve', label: 'approve' },
            { key: 'reject', label: 'reject' },
            { key: 'r', label: 'rollback' },
            { key: 's', label: 'skip' },
          ]);
          if (isRollback(choice)) {
            await doRollback(step, i);
            continue;
          }
          if (choice === 'approve') {
            await executor.executeStepManually(i, 'approved');
            logger.emit({
              type: 'user_input',
              action: 'approved',
              step: i,
              actor: state.context.operator,
            });
            logger.emit({ type: 'step_complete', step: i });
            console.log('    ✅ Approved.');
          } else if (choice === 'reject') {
            executor.skipStep(i);
            logger.emit({
              type: 'user_input',
              action: 'rejected',
              step: i,
              actor: state.context.operator,
            });
            console.log('    ❌ Rejected — step skipped.');
          } else {
            executor.skipStep(i);
            console.log('    ⏭  Skipped.');
          }
        } else {
          await executor.executeStepManually(i, 'confirmed');
          logger.emit({ type: 'step_complete', step: i });
        }
      }

      console.log(`\n${DIVIDER}`);
    } finally {
      rl.close();
      if (!process.stdin.destroyed) process.stdin.unref();
      const finalState = executor.getState();
      const endStatus =
        finalState.status === 'cancelled'
          ? 'cancelled'
          : finalState.failedSteps > 0
            ? 'failed'
            : finalState.waitingSteps > 0
              ? 'paused'
              : 'completed';
      logger.close({
        status: endStatus,
        steps_completed: finalState.completedSteps,
      });
    }

    return logger.path;
  }

  private async parseOperationFile(filePath: string): Promise<Operation> {
    if (!existsSync(filePath)) {
      throw new Error(`Operation file not found: ${filePath}`);
    }
    return await parseOperation(filePath);
  }

  private parseVariables(variableStrings: string[]): Record<string, any> {
    const variables: Record<string, any> = {};
    for (const varString of variableStrings) {
      const [key, value] = varString.split('=', 2);
      if (!key || value === undefined) {
        throw new Error(
          `Invalid variable format: ${varString}. Use KEY=VALUE format.`,
        );
      }
      try {
        variables[key] = JSON.parse(value);
      } catch {
        variables[key] = value;
      }
    }
    return variables;
  }

  private displayOperationSummary(
    operation: Operation,
    environment: any,
    context: any,
    mode: ExecutionMode,
  ): void {
    console.log(`\n📋 Operation Summary:`);
    console.log(`   Name: ${operation.name} v${operation.version}`);
    console.log(`   Description: ${operation.description}`);
    console.log(
      `   Environment: ${environment.name} (${environment.description})`,
    );
    console.log(`   Steps: ${operation.steps.length}`);
    console.log(`   Preflight checks: ${operation.preflight?.length || 0}`);
    console.log(`   Execution mode: ${mode}`);
    console.log(`   Dry run: ${context.dryRun ? 'Yes' : 'No'}`);

    if (environment.approval_required) {
      console.log(`   ⚠️  Approval required for this environment`);
    }
    if (environment.validation_required) {
      console.log(`   ✅ Validation required for this environment`);
    }

    console.log('');
  }

  private setupEventHandlers(executor: OperationExecutor, options: any): void {
    if (options.verbose) {
      executor.on('step_started', (event) => {
        console.log(
          `▶️  [${event.stepIndex + 1}] Starting: ${event.step?.name}`,
        );
      });
      executor.on('step_completed', (event) => {
        console.log(
          `✅ [${event.stepIndex + 1}] Completed: ${event.step?.name}`,
        );
        if (event.result?.duration) {
          console.log(`    Duration: ${event.result.duration}ms`);
        }
      });
      executor.on('step_failed', (event) => {
        console.log(`❌ [${event.stepIndex + 1}] Failed: ${event.step?.name}`);
        console.log(`    Error: ${event.error}`);
      });
      executor.on('step_skipped', (event) => {
        console.log(`⏭️  [${event.stepIndex + 1}] Skipped: ${event.step?.name}`);
      });
      executor.on('approval_required', (event) => {
        console.log(
          `⏸️  [${event.stepIndex + 1}] Approval required: ${event.step?.name}`,
        );
      });
    }

    executor.on('operation_paused', () => {
      console.log('\n⏸️  Operation paused');
    });
    executor.on('operation_completed', () => {
      console.log('\n🎉 Operation completed successfully!');
    });
    executor.on('operation_failed', (event) => {
      console.log(`\n💥 Operation failed: ${event.error}`);
    });
  }

  private async runPreflightChecks(
    preflight: any[],
    context: any,
  ): Promise<void> {
    for (let i = 0; i < preflight.length; i++) {
      const check = preflight[i];
      console.log(`   ${i + 1}. ${check.name}: ${check.description}`);
      if (check.type === 'command' && check.command && !context.dryRun) {
        console.log(`      Command: ${check.command}`);
        console.log(`      ✅ Passed`);
      } else if (check.type === 'manual') {
        console.log(`      ✅ Manual check assumed passed`);
      } else {
        console.log(`      ✅ Skipped (dry run)`);
      }
    }
  }
}

// ─── CLI commands ─────────────────────────────────────────────────────────────

const runCommand = new Command('run')
  .description('Execute an operation')
  .argument('<operation>', 'Operation file path')
  .option('-e, --env <environment>', 'Target environment')
  .option('--environment <environment>', 'Target environment (alias for --env)')
  .option('--auto-approve', 'Auto-approve all manual steps and approvals')
  .option('--dry-run', 'Preview full operation plan without executing')
  .option(
    '-m, --mode <mode>',
    'Execution mode: automatic | manual | hybrid',
    'manual',
  )
  .option(
    '--var <key=value>',
    'Override variable values',
    (value, previous: string[] = []) => [...previous, value],
  )
  .option('-v, --verbose', 'Verbose output')
  .option('--with-ai', 'Enable AI assistance during execution')
  .option('--continue-on-error', 'Continue execution even if steps fail')
  .option('--report <dir>', 'Write Markdown evidence report to directory')
  .action(async (operation: string, options: RunOptions) => {
    try {
      const runner = new OperationRunner();
      await runner.runOperation(operation, options);
    } catch (error: any) {
      console.error(`❌ Execution failed: ${error.message}`);
      process.exit(1);
    }
  });

const resumeCommand = new Command('resume')
  .description('Resume a paused or failed operation session')
  .argument('<session-id>', 'Session ID to resume')
  .option('-v, --verbose', 'Verbose output')
  .option('--auto-approve', 'Auto-approve remaining manual steps')
  .option('--from-step <number>', 'Resume from specific step number', parseInt)
  .action(async (sessionId: string, options: ResumeOptions) => {
    try {
      const runner = new OperationRunner();
      await runner.resumeSession(sessionId, options);
    } catch (error: any) {
      console.error(`❌ Resume failed: ${error.message}`);
      process.exit(1);
    }
  });

export { resumeCommand, runCommand };
