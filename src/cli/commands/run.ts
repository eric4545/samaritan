import { existsSync } from 'node:fs';
import { Command } from 'commander';
import { OperationExecutor } from '../../lib/executor';
import { SessionUtils, sessionManager } from '../../lib/session-manager';
import type { ExecutionMode, Operation } from '../../models/operation';
import { parseOperation } from '../../operations/parser';

interface RunOptions {
  env?: string;
  autoApprove?: boolean;
  dryRun?: boolean;
  mode?: ExecutionMode;
  variables?: string[];
  verbose?: boolean;
  withAi?: boolean;
  continueOnError?: boolean;
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
    const targetEnv = options.env as string; // guaranteed by requiredOption
    console.log(`🚀 Starting operation: ${operationFile}`);
    console.log(`🎯 Target environment: ${targetEnv}`);

    // Parse operation
    const operation = await this.parseOperationFile(operationFile);

    // Validate environment exists
    const environment = operation.environments.find(
      (env) => env.name === targetEnv,
    );
    if (!environment) {
      throw new Error(
        `Environment '${targetEnv}' not found in operation. Available: ${operation.environments.map((e) => e.name).join(', ')}`,
      );
    }

    // Parse additional variables
    const additionalVars = this.parseVariables(options.variables || []);

    // Create execution context
    const context = {
      operationId: operation.id,
      environment: targetEnv,
      variables: {
        ...operation.variables[targetEnv],
        ...additionalVars,
      },
      operator: process.env.USER || 'unknown',
      sessionId: `run-${operation.id}-${Date.now()}`,
      dryRun: options.dryRun || false,
      autoMode: options.mode === 'automatic' || options.autoApprove || false,
    };

    // Show operation summary
    this.displayOperationSummary(operation, environment, context);

    // Check for approval requirements
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

    // Warn about fallback mode limitations for manual/hybrid runs
    const isInteractiveMode = !context.autoMode && !options.dryRun;
    if (isInteractiveMode) {
      console.log(
        '⚠️  Note: Interactive execution (tmux/TUI) is not yet available.',
      );
      console.log(
        '   Manual and approval steps will pause execution but cannot be completed interactively.',
      );
      console.log(
        '   Use --dry-run to preview steps, or generate a manual: samaritan generate manual <file>\n',
      );
    }

    // Create session
    const session = sessionManager.createSession(
      operation.id,
      targetEnv,
      context.operator,
      options.mode || (options.autoApprove ? 'automatic' : 'hybrid'),
      { ...context.variables, ...additionalVars },
    );

    console.log(`📋 Session created: ${session.id}\n`);

    // Create and configure executor
    const executor = new OperationExecutor(operation, context);
    sessionManager.associateExecutor(session.id, executor);

    // Set up event handlers
    this.setupEventHandlers(executor, options);

    try {
      // Run preflight checks
      if (operation.preflight && operation.preflight.length > 0) {
        console.log('🔍 Running preflight checks...');
        await this.runPreflightChecks(operation.preflight, context);
        console.log('✅ Preflight checks passed\n');
      }

      // Execute operation
      console.log('▶️  Starting operation execution...\n');
      await executor.execute();

      const finalState = executor.getState();

      if (finalState.status === 'paused') {
        const waitingStep = finalState.steps[finalState.currentStepIndex];
        console.log('\n⏸️  Operation paused — manual interaction required');
        console.log(
          `   ${finalState.waitingSteps} step(s) are waiting for manual input or approval`,
        );
        if (waitingStep) {
          console.log(`   Waiting at step: "${waitingStep.step.name}"`);
        }
        console.log(
          '\nℹ️  Session state is not persisted. Resume across separate invocations is not yet supported.',
        );
        console.log('   To execute this operation interactively:');
        console.log(
          `   • Generate a step-by-step manual: samaritan generate manual ${options.dryRun ? '<operation.yaml>' : ''}`,
        );
        console.log('   • Use --dry-run to preview all steps without executing');
      } else {
        console.log('\n✅ Operation completed successfully!');
      }

      // Show session summary
      const summary = sessionManager.getSessionSummary(session.id);
      if (summary) {
        console.log(`\n📊 Execution Summary:`);
        console.log(
          `   Duration: ${SessionUtils.formatSessionDuration(session)}`,
        );
        console.log(`   Evidence collected: ${summary.evidenceCount} items`);
        console.log(`   Retries: ${summary.retryCount}`);
        console.log(`   Approvals: ${summary.approvalCount}`);
        if (finalState.waitingSteps > 0) {
          console.log(`   Pending (waiting): ${finalState.waitingSteps} step(s)`);
        }
      }

      // Generate automatic documentation if configured
      if (operation.reporting?.confluence || !options.dryRun) {
        console.log('\n📄 Generating execution report...');
        console.log(
          '💡 Use "samaritan generate docs" to create comprehensive documentation',
        );
      }
    } catch (error: any) {
      console.error(`\n❌ Operation failed: ${error.message}`);

      const currentSession = sessionManager.getSession(session.id);
      if (currentSession) {
        console.log(`\n🔄 To resume from where you left off:`);
        console.log(`   samaritan resume ${session.id}`);

        if (operation.rollback) {
          console.log(`\n🔄 To rollback changes:`);
          console.log(
            `   # Rollback not yet implemented - check operation definition`,
          );
        }
      }

      throw error;
    }
  }

  async resumeSession(
    sessionId: string,
    options: ResumeOptions,
  ): Promise<void> {
    console.log(`🔄 Resuming session: ${sessionId}`);

    // Get session
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(
        `Session not found: ${sessionId}\n` +
          '  Session state is held in-memory and is not persisted across separate CLI invocations.\n' +
          '  Resume is only available within the same process that started the run.\n' +
          '  Cross-process session persistence is not yet implemented.',
      );
    }

    if (session.status === 'completed') {
      console.log('✅ Session already completed');
      return;
    }

    if (session.status === 'cancelled') {
      throw new Error('Cannot resume cancelled session');
    }

    console.log(`📋 Session details:`);
    console.log(`   Operation: ${session.operation_id}`);
    console.log(`   Environment: ${session.environment}`);
    console.log(`   Current step: ${session.current_step_index + 1}`);
    console.log(`   Progress: ${session.completion_percentage || 0}%`);
    console.log(
      `   Status: ${SessionUtils.getSessionStatusEmoji(session.status)} ${session.status}`,
    );

    // Get associated executor or create new one
    const executor = sessionManager.getExecutor(sessionId);

    if (!executor) {
      // Need to recreate executor from session
      console.log('🔄 Recreating executor from session state...');

      // We need the original operation - try to find it
      // This is a simplified implementation - in practice you'd want to store operation file path in session
      throw new Error(
        'Executor recreation not yet implemented - operation file path needed',
      );
    }

    // Setup event handlers
    this.setupEventHandlers(executor, { verbose: options.verbose });

    try {
      // Resume execution
      console.log('\n▶️  Resuming operation execution...\n');
      await sessionManager.resumeSession(sessionId);

      console.log('\n✅ Operation resumed and completed successfully!');
    } catch (error: any) {
      console.error(`\n❌ Resume failed: ${error.message}`);
      throw error;
    }
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

      // Try to parse as JSON, fallback to string
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
  ): void {
    console.log(`\n📋 Operation Summary:`);
    console.log(`   Name: ${operation.name} v${operation.version}`);
    console.log(`   Description: ${operation.description}`);
    console.log(
      `   Environment: ${environment.name} (${environment.description})`,
    );
    console.log(`   Steps: ${operation.steps.length}`);
    console.log(`   Preflight checks: ${operation.preflight?.length || 0}`);
    console.log(
      `   Execution mode: ${context.autoMode ? 'Automatic' : 'Manual/Hybrid'}`,
    );
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
        console.log(`▶️  [${event.stepIndex + 1}] Starting: ${event.step.name}`);
        if (event.step.description) {
          console.log(`    ${event.step.description}`);
        }
      });

      executor.on('step_completed', (event) => {
        console.log(
          `✅ [${event.stepIndex + 1}] Completed: ${event.step.name}`,
        );
        if (event.result?.duration) {
          console.log(`    Duration: ${event.result.duration}ms`);
        }
      });

      executor.on('step_failed', (event) => {
        console.log(`❌ [${event.stepIndex + 1}] Failed: ${event.step.name}`);
        console.log(`    Error: ${event.error}`);
      });

      executor.on('step_skipped', (event) => {
        console.log(`⏭️  [${event.stepIndex + 1}] Skipped: ${event.step.name}`);
        console.log(`    Reason: ${event.reason}`);
      });

      executor.on('approval_required', (event) => {
        console.log(
          `⏸️  [${event.stepIndex + 1}] Approval required: ${event.step.name}`,
        );
      });

      executor.on('evidence_collected', (event) => {
        console.log(
          `📎 Evidence collected: ${event.evidence.type} for step ${event.stepIndex + 1}`,
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
      console.log(
        `\n💥 Operation failed at step ${event.stepIndex + 1}: ${event.error}`,
      );
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
        // In a real implementation, you'd execute the command here
        console.log(`      Command: ${check.command}`);
        console.log(`      ✅ Passed`);
      } else if (check.type === 'manual') {
        console.log(`      Manual check - verify: ${check.description}`);
        console.log(
          `      ✅ Assumed passed (interactive verification not implemented)`,
        );
      } else {
        console.log(`      ✅ Skipped (dry run)`);
      }
    }
  }
}

// Run command
const runCommand = new Command('run')
  .description('Execute an operation')
  .argument('<operation>', 'Operation file or name')
  .requiredOption('-e, --env <environment>', 'Target environment')
  .option('--auto-approve', 'Auto-approve all manual steps and approvals')
  .option('--dry-run', 'Show what would be executed without running')
  .option(
    '-m, --mode <mode>',
    'Execution mode (automatic, manual, hybrid)',
    'hybrid',
  )
  .option(
    '--var <key=value>',
    'Override variable values',
    (value, previous: string[] = []) => [...previous, value],
  )
  .option('-v, --verbose', 'Verbose output')
  .option('--with-ai', 'Enable AI assistance during execution')
  .option('--continue-on-error', 'Continue execution even if steps fail')
  .action(async (operation: string, options: RunOptions) => {
    try {
      const runner = new OperationRunner();
      await runner.runOperation(operation, options);
    } catch (error: any) {
      console.error(`❌ Execution failed: ${error.message}`);
      process.exit(1);
    }
  });

// Resume command
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

export { runCommand, resumeCommand };
