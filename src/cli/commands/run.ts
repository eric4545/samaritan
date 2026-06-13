import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  createInterface as createReadlineInterface,
  emitKeypressEvents,
} from 'node:readline';
import { Command } from 'commander';
import { detectMimeType } from '../../evidence/collector';
import { renderExpectDescription } from '../../lib/assertions';
import type { CaptureBackend } from '../../lib/capture-backend';
import { copyToClipboard } from '../../lib/clipboard';
import { createEventLogger } from '../../lib/event-logger';
import { OperationExecutor } from '../../lib/executor';
import { indexToLetters } from '../../lib/letter-sequence';
import { generateReport } from '../../lib/report-generator';
import { buildStepRecords, readEvents } from '../../lib/session-log';
import { SessionUtils, sessionManager } from '../../lib/session-manager';
import {
  getRunReportPath,
  getSessionEvidenceDir,
} from '../../lib/session-persistence';
import { SessionState } from '../../lib/session-state';
import {
  bootstrapSessions,
  listTmuxPanes,
  TmuxPaneCapture,
  type TmuxSession,
  validateTmuxTarget,
} from '../../lib/tmux-session';
import {
  renderAssertOutcome,
  renderCodeBlock,
  renderKeyHints,
  renderVerifyOutcome,
  StepController,
} from '../../lib/tui';
import {
  listUnresolvedVars,
  resolveVars,
  resolveVarsSafe,
} from '../../lib/variable-resolver';
import type { EvidenceItem } from '../../models/evidence';
import type {
  EvidenceType,
  ExecutionMode,
  Operation,
  Step,
} from '../../models/operation';
import { parseOperation } from '../../operations/parser';

// Cap free-form pasted evidence; larger payloads should be file attachments.
const MAX_PASTED_EVIDENCE_BYTES = 10 * 1024 * 1024;

interface FlatStep {
  step: Step;
  label: string;
}

interface RunOptions {
  env?: string;
  environment?: string;
  autoApprove?: boolean;
  dryRun?: boolean;
  mode?: ExecutionMode;
  attach?: string;
  variables?: string[];
  verbose?: boolean;
  continueOnError?: boolean;
  report?: string;
}

interface ResumeOptions {
  verbose?: boolean;
  autoApprove?: boolean;
  fromStep?: number;
}

function flattenStepsForExecution(steps: Step[], prefix = ''): FlatStep[] {
  const result: FlatStep[] = [];
  steps.forEach((step, i) => {
    const label = prefix ? `${prefix}${indexToLetters(i)}` : String(i + 1);
    if (step.sub_steps && step.sub_steps.length > 0) {
      result.push({ step, label });
      result.push(...flattenStepsForExecution(step.sub_steps, label));
    } else {
      result.push({ step, label });
    }
  });
  return result;
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
      options.mode ?? (options.autoApprove ? 'automatic' : 'sidecar');

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

    const { flatSteps, execOperation } = this.prepareFlatOperation(operation);

    this.displayOperationSummary(
      execOperation,
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

    const executor = new OperationExecutor(execOperation, context);
    sessionManager.associateExecutor(session.id, executor);

    this.setupEventHandlers(executor, options);

    try {
      const isInteractiveMode = !context.autoMode && !options.dryRun;

      if (isInteractiveMode) {
        let tmuxSession: TmuxSession | undefined;
        let captureBackend: CaptureBackend | undefined;

        if (executionMode === 'sidecar' && options.attach) {
          // Sidecar + --attach: validate and attach to operator's pane
          if (validateTmuxTarget(options.attach)) {
            const paneCapture = new TmuxPaneCapture(
              context.sessionId,
              options.attach,
            );
            paneCapture.attach();
            captureBackend = paneCapture;
            console.log(
              `🔗 Attached capture to tmux pane: ${options.attach}\n`,
            );
          } else {
            console.warn(
              `⚠️  --attach target "${options.attach}" is not a valid tmux pane; continuing without capture.\n`,
            );
          }
        } else if (
          operation.sessions &&
          Object.keys(operation.sessions).length > 0
        ) {
          console.log('🖥️  Bootstrapping tmux sessions...');
          try {
            tmuxSession = await bootstrapSessions(
              context.sessionId,
              operation.sessions,
            );
            captureBackend = tmuxSession;
            console.log(
              `   Sessions: ${Object.keys(operation.sessions).join(', ')}`,
            );
            if (executionMode === 'sidecar') {
              console.log(
                `   Attach with: tmux attach -t samaritan-${context.sessionId}\n`,
              );
            } else {
              console.log('');
            }
          } catch (err: any) {
            console.warn(
              `⚠️  tmux bootstrap failed (${err.message}); falling back to prompt-only mode.\n`,
            );
          }
        } else if (executionMode === 'sidecar' && process.env.TMUX) {
          console.log(
            '💡 Tip: press [t] during a step to attach a tmux pane for [v] verify.\n',
          );
        }

        console.log('▶️  Starting interactive operation execution...\n');
        executor.startInteractive();
        const logPath = await this.runInteractiveStepLoop(
          executor,
          operation,
          absFile,
          resolvedVars,
          executionMode,
          tmuxSession,
          captureBackend,
          flatSteps,
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

        // Tear down in the right order: capture backend first (never kills
        // operator's pane), then the spawn-own tmux session.
        if (captureBackend && captureBackend !== tmuxSession) {
          captureBackend.teardown();
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
      } else if (finalState.status === 'cancelled') {
        // An operator abort stops the run but should never strand the
        // session — persist it as paused so it stays resumable.
        sessionManager.pauseSession(session.id);
        console.log('\n⏸️  Run aborted — progress saved.');
        console.log(
          `\n💡 Resume this session:\n   samaritan resume ${session.id}`,
        );
        console.log('   List saved sessions:   samaritan sessions');
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
          '  List saved sessions with: samaritan sessions\n' +
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

    const { flatSteps, execOperation } = this.prepareFlatOperation(operation);
    const executor = new OperationExecutor(execOperation, context);
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

    const resumeMode: ExecutionMode =
      (session.mode as ExecutionMode | undefined) ?? 'sidecar';
    await this.runInteractiveStepLoop(
      executor,
      operation,
      session.operation_file,
      context.variables,
      resumeMode,
      tmuxSession,
      tmuxSession,
      flatSteps,
    );
    executor.finalizeOperation();
    tmuxSession?.teardown();

    if (executor.getState().status === 'cancelled') {
      sessionManager.pauseSession(session.id);
      console.log('\n⏸️  Run aborted — progress saved.');
      console.log(
        `\n💡 Resume this session:\n   samaritan resume ${session.id}`,
      );
    } else {
      console.log('\n✅ Session resumed and completed!');
    }
  }

  private prepareFlatOperation(operation: Operation): {
    flatSteps: FlatStep[];
    execOperation: Operation;
  } {
    const flatSteps = flattenStepsForExecution(operation.steps);
    return {
      flatSteps,
      execOperation: { ...operation, steps: flatSteps.map((f) => f.step) },
    };
  }

  private async runInteractiveStepLoop(
    executor: OperationExecutor,
    operation: Operation,
    operationFile: string,
    vars: Record<string, any>,
    mode: ExecutionMode,
    tmuxSession: TmuxSession | undefined,
    captureBackend: CaptureBackend | undefined,
    flatSteps: FlatStep[],
  ): Promise<string> {
    const rl = createReadlineInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const question = (prompt: string): Promise<string> =>
      new Promise((resolve) => rl.question(prompt, resolve));

    if (process.stdin.isTTY) emitKeypressEvents(process.stdin);

    // Single-char action keys that fire immediately without pressing Enter.
    // Multi-char words (abort, approve, reject) still require Enter — intentional.
    const IMMEDIATE_ACTION_CHARS = new Set([
      'c',
      'n',
      'e',
      'x',
      'v',
      't',
      's',
      'r',
      'q',
    ]);

    const readActionKey = (): Promise<string> => {
      if (!process.stdin.isTTY) return question('  > ');

      rl.pause();
      // Readline keeps its own keypress listener attached even while paused —
      // once stdin is resumed in raw mode below, that listener would echo
      // every key a second time ("t" renders as "tt") and buffer it into
      // rl.line, leaking stray characters into the next question() prompt.
      // Suspend all pre-existing listeners while we read, restore on cleanup.
      const suspended = process.stdin.listeners('keypress').slice() as Array<
        (...args: any[]) => void
      >;
      for (const listener of suspended) {
        process.stdin.removeListener('keypress', listener);
      }
      process.stdin.setRawMode(true);
      // rl.pause() pauses stdin, which both stops keypress events and drops
      // the last live handle — without an explicit resume the event loop
      // drains and the process exits silently at the prompt.
      process.stdin.resume();
      process.stdout.write('  > ');

      return new Promise((resolve) => {
        let buffer = '';

        const handler = (ch: string | undefined, key: any) => {
          if (key?.ctrl && key.name === 'c') {
            cleanup();
            process.stdout.write('^C\n');
            process.exit(130);
          }
          if (key?.name === 'return' || key?.name === 'enter') {
            cleanup();
            process.stdout.write('\n');
            resolve(buffer);
            return;
          }
          if (key?.name === 'backspace' && buffer.length > 0) {
            buffer = buffer.slice(0, -1);
            process.stdout.write('\b \b');
            return;
          }
          if (!ch || !/[\x20-\x7e]/.test(ch)) return;
          const c = ch.toLowerCase();
          buffer += c;
          process.stdout.write(c);
          if (buffer.length === 1 && IMMEDIATE_ACTION_CHARS.has(c)) {
            cleanup();
            process.stdout.write('\n');
            resolve(c);
          }
        };

        const cleanup = () => {
          process.stdin.removeListener('keypress', handler);
          for (const listener of suspended) {
            process.stdin.on('keypress', listener);
          }
          process.stdin.setRawMode(false);
          rl.resume();
        };

        process.stdin.on('keypress', handler);
      });
    };

    const state = executor.getState();
    const logger = createEventLogger(state.context.sessionId, operationFile);
    console.log(`📝 Audit log: ${logger.path}`);
    const sessionState = new SessionState();

    // Persist progress after each interactive step action. The executor emits
    // step_completed BEFORE it advances currentStepIndex, so the event-driven
    // save in SessionManager records a stale index — this explicit sync
    // persists the post-advance state so `samaritan resume` continues at the
    // right step instead of repeating the one just completed.
    const persistProgress = (): void => {
      sessionManager.updateSessionFromExecutor(
        state.context.sessionId,
        executor.getState(),
      );
      // Fold the durable event log into a structured per-step record on the
      // session JSON, so the persisted session carries step input/output/
      // verification/approval — not just metadata. Crash-safe: refreshed
      // after every step.
      sessionManager.updateStepLog(
        state.context.sessionId,
        buildStepRecords(readEvents(logger.path)),
      );
    };

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

    // In sidecar mode we always construct a controller so [v] verify works.
    // For spawn-own sessions the controller gets the TmuxSession; otherwise null.
    // For non-sidecar we only construct a controller when a tmux session exists.
    const controller =
      mode === 'sidecar'
        ? new StepController({
            logger,
            tmux: tmuxSession,
            sessionState,
            autoSend,
            autoExec,
            sessions: operation.sessions,
          })
        : tmuxSession
          ? new StepController({
              logger,
              tmux: tmuxSession,
              sessionState,
              autoSend,
              autoExec,
              sessions: operation.sessions,
            })
          : null;

    // Mutable capture reference — allows [t] to swap backends mid-run.
    // stepOffset is per-step and re-baselined at the start of each step or on attach.
    const captureRef: {
      backend: CaptureBackend | undefined;
      stepOffset: number;
    } = {
      backend: captureBackend,
      stepOffset: 0,
    };

    const DIVIDER = '─'.repeat(60);
    const isQuit = (c: string) => c === 'q' || c === 'quit';
    const isSkip = (c: string) => c === 's' || c === 'skip';
    const isRollback = (c: string) => c === 'r' || c === 'rollback';

    const warnedUnresolvedVars = new Set<string>();
    const tryResolve = (text: string | undefined): string | undefined => {
      if (!text) return text;
      try {
        return resolveVars(text, vars);
      } catch {
        // Fall back to safe resolution (display with unresolved markers),
        // but tell the operator which variables are missing — once each.
        const missing = listUnresolvedVars(text, vars).filter(
          (name) => !warnedUnresolvedVars.has(name),
        );
        if (missing.length > 0) {
          for (const name of missing) warnedUnresolvedVars.add(name);
          console.warn(
            `    ⚠️  Unresolved variable(s): ${missing.join(', ')} — add them to variables: or pass --var`,
          );
        }
        return resolveVarsSafe(text, vars);
      }
    };

    const doRollback = async (step: Step, i: number): Promise<void> => {
      const hasRollbackSteps = step.rollback && step.rollback.length > 0;
      if (controller && tmuxSession) {
        console.log('    🔄 Initiating rollback...');
        await controller.rollback(step, i, state.context.operator);
        console.log('    ↩  Rollback complete.');
      } else if (hasRollbackSteps) {
        // No tmux to send through (sidecar without sessions) — show the
        // operator what to run; controller still records the audit events.
        console.log('    🔄 Rollback steps (manual — no tmux session):');
        for (const rb of step.rollback ?? []) {
          console.log(`      $ ${tryResolve(rb.command)}`);
        }
        await controller?.rollback(step, i, state.context.operator);
      } else {
        console.log('    ℹ️  No rollback defined for this step.');
      }
    };

    // Shared "what now?" prompt for a failed `expect` assertion — used by both
    // the automatic verify path and manual-step `[v] verify`. Records an
    // override (with reason) in the audit log when chosen; leaves rollback/stop
    // handling (which differ by call site — loop continue/break vs. a void
    // return) to the caller.
    const promptAssertFailureAction = async (
      stepIndex: number,
      opts?: { allowReVerify?: boolean; allowMore?: boolean },
    ): Promise<'override' | 'rollback' | 'stop' | 'reverify' | 'more'> => {
      const extras = [
        ...(opts?.allowMore ? ['m=more'] : []),
        ...(opts?.allowReVerify ? ['v=re-verify'] : []),
      ];
      const extraLabel = extras.length ? ` / ${extras.join(' / ')}` : '';
      const overrideAns = await question(
        `    ⚠️  Assertion failed. [o=override with reason / r=rollback${extraLabel} / Enter=stop]: `,
      );
      const oc = overrideAns.trim().toLowerCase();
      if (oc === 'o' || oc === 'override') {
        const reason = await question('    Reason for override: ');
        logger.emit({
          type: 'user_input',
          action: 'override',
          step: stepIndex,
          actor: state.context.operator,
          reason: reason.trim(),
        });
        console.log('    ⚠️  Override accepted.');
        return 'override';
      }
      if (isRollback(oc)) return 'rollback';
      if (opts?.allowMore && (oc === 'm' || oc === 'more')) return 'more';
      if (
        opts?.allowReVerify &&
        (oc === 'v' || oc === 're-verify' || oc === 'reverify')
      )
        return 'reverify';
      return 'stop';
    };

    const promptAction = async (
      hints: Array<{ key: string; label: string }>,
      commandToCopy?: string,
    ): Promise<string> => {
      console.log(`\n${renderKeyHints(hints)}`);
      const ans = await readActionKey();
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

    // Capture a piece of evidence (terminal output, a file/screenshot/image, or
    // typed text) and store it with the session — like attaching a file in
    // Claude Code: drag the file into the terminal, or type/paste its path.
    const captureEvidence = async (
      stepIndex: number,
      captureSinceStepStart: () => string | undefined,
    ): Promise<void> => {
      const captured = captureSinceStepStart();

      console.log(
        `\n${renderKeyHints([
          ...(captured !== undefined
            ? [{ key: '↵', label: 'capture terminal output' }]
            : []),
          { key: 'f', label: 'file or image' },
          { key: 't', label: 'type/paste text' },
        ])}`,
      );
      const sourceAns = (await question('    Evidence source > '))
        .trim()
        .toLowerCase();

      let evidenceType: EvidenceType = 'command_output';
      let content: string | Buffer = '';
      let filename: string | undefined;
      let storedPath: string | undefined;
      let automatic = false;

      if (
        captured !== undefined &&
        (sourceAns === '' || sourceAns === 'capture')
      ) {
        if (!captured || !captured.trim()) {
          console.log(
            '    ⚠️  No new output captured in this pane since the step started.',
          );
          return;
        }
        console.log(`\n${renderCodeBlock(captured)}`);
        content = captured;
        automatic = true;
      } else if (sourceAns === 'f' || sourceAns === 'file') {
        const rawPath = await question(
          '    Path (drag & drop into terminal): ',
        );
        const resolvedPath = resolveDroppedPath(rawPath);
        if (!resolvedPath || !existsSync(resolvedPath)) {
          console.log(`    ⚠️  File not found: ${rawPath.trim()}`);
          return;
        }
        try {
          content = readFileSync(resolvedPath);
        } catch (err: any) {
          console.log(`    ⚠️  Could not read file: ${err.message}`);
          return;
        }
        filename = basename(resolvedPath);
        evidenceType = inferEvidenceTypeFromExtension(filename);

        const evidenceDir = getSessionEvidenceDir(state.context.sessionId);
        storedPath = join(evidenceDir, `${randomUUID()}-${filename}`);
        copyFileSync(resolvedPath, storedPath);
      } else {
        content = await question('    Paste/type evidence content: ');
        if (Buffer.byteLength(content, 'utf-8') > MAX_PASTED_EVIDENCE_BYTES) {
          console.log(
            '    ⚠️  Pasted content exceeds 10 MB — attach it as a file instead.',
          );
          return;
        }
      }

      const description =
        (await question('    Description (optional): ')).trim() || undefined;

      const size = Buffer.isBuffer(content)
        ? content.length
        : Buffer.byteLength(content, 'utf-8');
      const format = detectMimeType(evidenceType, content, filename);

      // For file/image/video evidence the bytes already live on disk under the
      // session's evidence directory (copied above) — reference that path
      // rather than duplicating the raw content into the persisted session.
      const item: EvidenceItem = {
        id: randomUUID(),
        step_id: String(stepIndex),
        type: evidenceType,
        content: storedPath ?? content,
        filename,
        timestamp: new Date(),
        operator: state.context.operator,
        automatic,
        validated: false,
        metadata: {
          size,
          format,
          source: automatic ? 'tmux' : storedPath ? 'file' : 'manual',
          ...(storedPath ? { original_path: storedPath } : {}),
        },
        description,
      };

      sessionManager.addEvidence(state.context.sessionId, item);

      logger.emit({
        type: 'evidence_captured',
        step: stepIndex,
        evidence_id: item.id,
        evidence_type: evidenceType,
        automatic,
        description,
        ...(storedPath
          ? { filename, path: storedPath }
          : { content: typeof content === 'string' ? content : undefined }),
      });

      const summary = storedPath
        ? `${evidenceType}, saved to ${storedPath}`
        : `${evidenceType}, ${item.metadata.size} bytes`;
      console.log(`    📎 Evidence captured (${summary}).`);
    };

    const stepEvidence = (stepIndex: number): EvidenceItem[] =>
      (
        sessionManager.getSession(state.context.sessionId)?.evidence ?? []
      ).filter((e) => e.step_id === String(stepIndex));

    // Remove a previously captured evidence item from the current step — lists
    // the step's evidence, lets the operator pick one, and deletes any copied
    // file from the session's evidence directory along with the session record.
    const removeStepEvidence = async (stepIndex: number): Promise<void> => {
      const items = stepEvidence(stepIndex);
      if (items.length === 0) {
        console.log('    ⚠️  No evidence captured for this step yet.');
        return;
      }

      console.log('\n    Captured evidence for this step:');
      items.forEach((item, idx) => {
        const label = item.description
          ? `${item.type} — ${item.description}`
          : item.type;
        const location = item.metadata.original_path
          ? ` (${item.metadata.original_path})`
          : '';
        console.log(`      ${idx + 1}) ${label}${location}`);
      });

      const ans = (
        await question('    Remove which? [number / Enter=cancel]: ')
      ).trim();
      if (!ans) return;

      const choice = Number.parseInt(ans, 10);
      if (!Number.isInteger(choice) || choice < 1 || choice > items.length) {
        console.log('    ⚠️  Invalid selection.');
        return;
      }

      const target = items[choice - 1];
      const removed = sessionManager.removeEvidence(
        state.context.sessionId,
        target.id,
      );
      if (!removed) return;

      // Only delete files that live directly inside this session's evidence
      // directory — never touch the operator's original source file. Compare
      // parent directories rather than a string prefix so trailing slashes or
      // relative segments can't produce a false match.
      const evidenceDir = getSessionEvidenceDir(state.context.sessionId);
      if (
        removed.metadata.original_path &&
        dirname(removed.metadata.original_path) === evidenceDir &&
        existsSync(removed.metadata.original_path)
      ) {
        try {
          unlinkSync(removed.metadata.original_path);
        } catch {
          // best-effort cleanup
        }
      }

      logger.emit({
        type: 'evidence_removed',
        step: stepIndex,
        evidence_id: removed.id,
        evidence_type: removed.type,
        description: removed.description,
      });

      console.log('    🗑️  Evidence removed.');
    };

    // Verify pane output already produced by a manual step against `step.expect`
    // — without sending a command (the operator runs it themselves). Renders
    // the full checklist + highlighted output (PASS or FAIL); on FAIL offers
    // a single-key menu to override/rollback/stop, re-verify (re-capture and
    // re-assert), or show the full (non-truncated) output.
    const verifyManualOutput = async (
      step: Step,
      stepIndex: number,
      captureSinceStepStart: () => string | undefined,
    ): Promise<void> => {
      if (!step.expect) return;

      let expand = false;

      while (true) {
        const output = captureSinceStepStart();
        if (output === undefined || !controller) {
          console.log(
            '    ⚠️  Verify requires an attached capture — press [t] to attach a tmux pane.',
          );
          return;
        }

        console.log('    🔍 Checking expected output...');
        const { assertResult, detailed } = controller.verifyOutput(
          step,
          stepIndex,
          output,
        );

        if (!assertResult || !detailed) return;

        console.log(renderVerifyOutcome(detailed, step.expect, { expand }));

        if (assertResult.pass) {
          console.log(
            '    ✅ Verify passed — press [v] again any time to re-check.',
          );
          return;
        }

        const action = await promptAssertFailureAction(stepIndex, {
          allowReVerify: true,
          allowMore: !expand,
        });
        if (action === 'more') {
          expand = true;
          continue;
        }
        if (action === 'reverify') {
          expand = false;
          continue;
        }
        if (action === 'rollback') {
          await doRollback(step, stepIndex);
        } else if (action === 'stop') {
          console.log('    ❌ Stopping due to failed assertion.');
        }
        return;
      }
    };

    try {
      const steps = executor.getState().steps;

      for (
        let i = executor.getState().currentStepIndex;
        i < steps.length;
        i++
      ) {
        const { step } = steps[i];
        const stepNum = `[${flatSteps[i].label}/${steps.length}]`;
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
        if (step.description)
          console.log(`    ${tryResolve(step.description)}`);
        if (step.pic) console.log(`    PIC      : ${step.pic}`);
        if (step.reviewer) console.log(`    Reviewer : ${step.reviewer}`);
        if (step.session) console.log(`    Session  : ${step.session}`);
        if (step.ticket)
          console.log(
            `    Ticket   : ${Array.isArray(step.ticket) ? step.ticket.join(', ') : step.ticket}`,
          );

        // Parent steps (those with sub_steps) are section headers — show any
        // instruction as context then auto-advance; the sub_steps follow.
        if (step.sub_steps && step.sub_steps.length > 0) {
          if (resolvedInstruction) console.log(`\n    ${resolvedInstruction}`);
          console.log('    ▶  (section — sub-steps follow)');
          await executor.executeStepManually(i, 'section header');
          persistProgress();
          logger.emit({ type: 'step_complete', step: i });
          continue;
        }

        // In sidecar mode, automatic steps go through the manual-style loop
        // (display command, operator runs it, [v] to verify). In other modes,
        // automatic steps are handled by the send/verify branch.
        const isSidecarAutomatic =
          step.type === 'automatic' && mode === 'sidecar';

        if (step.type === 'automatic' && !isSidecarAutomatic) {
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
            persistProgress();
            console.log(`    📤 Sent to tmux pane [${step.session}].`);

            // Run verify if defined
            if (step.command && step.expect) {
              console.log(
                `    🔍 Checking expected output for: ${tryResolve(step.command) ?? step.command}`,
              );
              const { state: vState, assertResult } =
                await controller.runVerify(step, i);
              if (assertResult) {
                console.log(renderAssertOutcome(assertResult));
                if (!assertResult.pass) {
                  const action = await promptAssertFailureAction(i);
                  if (action === 'rollback') {
                    await doRollback(step, i);
                    continue;
                  }
                  if (action === 'stop') {
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
            persistProgress();
            logger.emit({
              type: 'user_input',
              action: 'confirmed',
              step: i,
              actor: state.context.operator,
            });
            logger.emit({ type: 'step_complete', step: i });
            console.log('    ✅ Step marked complete.');
          }
        } else if (step.type === 'manual' || isSidecarAutomatic) {
          if (resolvedInstruction) console.log(`\n    ${resolvedInstruction}`);
          if (resolvedCommand) {
            if (isSidecarAutomatic) {
              // Sidecar: display command prominently — operator runs it themselves
              console.log('\n    Run this command in your terminal:');
              console.log(renderCodeBlock(resolvedCommand));
              const sessionName = step.session ?? 'default';
              logger.emit({
                type: 'command_displayed',
                step: i,
                session: sessionName,
                command: resolvedCommand,
              });
            } else {
              console.log('\n    Command reference:');
              console.log(renderCodeBlock(resolvedCommand));
            }
          }

          if (step.expect) {
            console.log(
              `    Expected: ${renderExpectDescription(step.expect)}`,
            );
          }

          // Baseline the capture offset at the start of each step.
          // Uses captureRef so [t] can swap the backend and this closure stays fresh.
          const sessionName = step.session ?? 'default';
          captureRef.stepOffset = captureRef.backend?.hasTarget(sessionName)
            ? captureRef.backend.currentOffset(sessionName)
            : 0;
          const captureSinceStepStart = (): string | undefined => {
            const { backend, stepOffset } = captureRef;
            if (!backend || !backend.hasTarget(sessionName)) return undefined;
            return backend.readOutput(sessionName, stepOffset);
          };

          let manualNotes = '';
          while (true) {
            const evidenceForStep = stepEvidence(i);
            console.log(
              '\n' +
                renderKeyHints([
                  { key: '↵', label: 'done' },
                  ...(resolvedCommand ? [{ key: 'c', label: 'copy' }] : []),
                  { key: 'n', label: 'note' },
                  { key: 'e', label: 'evidence' },
                  ...(evidenceForStep.length
                    ? [{ key: 'x', label: 'remove evidence' }]
                    : []),
                  ...(step.expect ? [{ key: 'v', label: 'verify' }] : []),
                  ...(mode === 'sidecar'
                    ? [{ key: 't', label: 'attach pane' }]
                    : []),
                  { key: 's', label: 'skip' },
                  { key: 'r', label: 'rollback' },
                  { key: 'abort', label: 'abort' },
                ]),
            );
            const input = await readActionKey();
            const inputChoice = input.trim().toLowerCase();
            if (isQuit(inputChoice)) {
              executor.cancel();
              console.log('\n⛔ Execution aborted by operator.');
              manualNotes = '';
              break;
            }
            if (
              resolvedCommand &&
              (inputChoice === 'c' || inputChoice === 'copy')
            ) {
              const ok = await copyToClipboard(resolvedCommand);
              console.log(
                ok ? '  ✅ Copied to clipboard!' : '  ⚠️  Clipboard unavailable',
              );
              continue;
            }
            if (inputChoice === 'n' || inputChoice === 'note') {
              const note = (await question('    Note: ')).trim();
              if (note) {
                logger.emit({
                  type: 'user_input',
                  action: 'note',
                  step: i,
                  actor: state.context.operator,
                  notes: note,
                });
                console.log('    📝 Note recorded.');
              }
              continue;
            }
            if (inputChoice === 'e' || inputChoice === 'evidence') {
              await captureEvidence(i, captureSinceStepStart);
              continue;
            }
            if (
              evidenceForStep.length &&
              (inputChoice === 'x' || inputChoice === 'remove')
            ) {
              await removeStepEvidence(i);
              continue;
            }
            if (
              step.expect &&
              (inputChoice === 'v' || inputChoice === 'verify')
            ) {
              await verifyManualOutput(step, i, captureSinceStepStart);
              continue;
            }
            if (
              mode === 'sidecar' &&
              (inputChoice === 't' || inputChoice === 'attach')
            ) {
              // [t] — attach (or swap) a tmux pane for capture. Offer a
              // numbered picker of existing panes; typing a raw target
              // (e.g. mysession:0.0 or %3) still works.
              const panes = listTmuxPanes();
              let targetAns: string;
              if (panes.length > 0) {
                console.log('\n    Available tmux panes:');
                panes.forEach((p, idx) => {
                  const cmd = p.currentCommand ? `  ${p.currentCommand}` : '';
                  const self = p.isSelf ? '  (this pane — samaritan)' : '';
                  console.log(`      ${idx + 1}) ${p.target}${cmd}${self}`);
                });
                targetAns = (
                  await question(
                    '    Select pane [number or target, Enter to cancel]: ',
                  )
                ).trim();
                const picked = Number.parseInt(targetAns, 10);
                if (
                  Number.isInteger(picked) &&
                  picked >= 1 &&
                  picked <= panes.length &&
                  String(picked) === targetAns
                ) {
                  targetAns = panes[picked - 1].target;
                }
              } else {
                targetAns = (
                  await question('    Tmux pane target (Enter to cancel): ')
                ).trim();
              }
              if (!targetAns) {
                console.log('    ↩  Cancelled.');
                continue;
              }
              if (!validateTmuxTarget(targetAns)) {
                console.log(
                  `    ⚠️  "${targetAns}" is not a valid tmux pane. Skipping.`,
                );
                continue;
              }
              // Tear down a previous TmuxPaneCapture (never tear down a spawn-own TmuxSession)
              if (captureRef.backend && captureRef.backend !== tmuxSession) {
                captureRef.backend.teardown();
              }
              const newCapture = new TmuxPaneCapture(
                `${state.context.sessionId}-${i}`,
                targetAns,
              );
              newCapture.attach();
              captureRef.backend = newCapture;
              // Re-baseline the step offset on the new backend
              captureRef.stepOffset = newCapture.currentOffset(sessionName);
              logger.emit({
                type: 'capture_attach',
                target: targetAns,
                actor: state.context.operator,
              });
              console.log(
                `    🔗 Attached capture to: ${newCapture.describeTarget(sessionName)}`,
              );
              continue;
            }
            manualNotes = input;
            break;
          }

          // If the loop exited via [q]/quit, executor was already cancelled.
          if (executor.getState().status === 'cancelled') break;

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
          persistProgress();
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
            const rationale = (
              await question('    Rationale (optional): ')
            ).trim();
            await executor.executeStepManually(i, 'approved');
            logger.emit({
              type: 'user_input',
              action: 'approved',
              step: i,
              actor: state.context.operator,
              ...(rationale ? { rationale } : {}),
            });
            sessionManager.addApprovalRecord(state.context.sessionId, {
              step_id: step.id ?? String(i),
              approver: state.context.operator,
              approved: true,
              timestamp: new Date(),
              rationale,
            });
            persistProgress();
            logger.emit({ type: 'step_complete', step: i });
            console.log('    ✅ Approved.');
          } else if (choice === 'reject') {
            const rationale = (
              await question('    Rationale (optional): ')
            ).trim();
            executor.skipStep(i);
            logger.emit({
              type: 'user_input',
              action: 'rejected',
              step: i,
              actor: state.context.operator,
              ...(rationale ? { rationale } : {}),
            });
            sessionManager.addApprovalRecord(state.context.sessionId, {
              step_id: step.id ?? String(i),
              approver: state.context.operator,
              approved: false,
              timestamp: new Date(),
              rationale,
            });
            console.log('    ❌ Rejected — step skipped.');
          } else {
            executor.skipStep(i);
            console.log('    ⏭  Skipped.');
          }
        } else {
          await executor.executeStepManually(i, 'confirmed');
          persistProgress();
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
      // Always write the structured step log and a human-readable Markdown
      // report beside the operation — the durable run record, available even
      // without --report. Best-effort: never fail the run on reporting.
      try {
        sessionManager.updateStepLog(
          state.context.sessionId,
          buildStepRecords(readEvents(logger.path)),
        );
        const reportPath = getRunReportPath(
          operationFile,
          state.context.sessionId,
        );
        writeFileSync(reportPath, generateReport(logger.path), 'utf-8');
        console.log(`📄 Report: ${reportPath}`);
      } catch {
        // reporting is best-effort
      }
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
}

// Resolve a path the operator drags into the terminal or types — strips the
// surrounding quotes and backslash-escapes most terminals add on drag-and-drop,
// and expands a leading `~`.
function resolveDroppedPath(raw: string): string | undefined {
  let p = raw.trim();
  if (!p) return undefined;
  if (
    (p.startsWith("'") && p.endsWith("'")) ||
    (p.startsWith('"') && p.endsWith('"'))
  ) {
    p = p.slice(1, -1);
  }
  p = p.replace(/\\(.)/g, '$1');
  if (p.startsWith('~')) {
    p = join(homedir(), p.slice(1));
  }
  return p;
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov'];

function inferEvidenceTypeFromExtension(filename: string): EvidenceType {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext && IMAGE_EXTENSIONS.includes(ext)) return 'screenshot';
  if (ext && VIDEO_EXTENSIONS.includes(ext)) return 'video';
  return 'file';
}

// ─── CLI commands ─────────────────────────────────────────────────────────────

const VALID_MODES: ExecutionMode[] = [
  'sidecar',
  'manual',
  'automatic',
  'hybrid',
];

const runCommand = new Command('run')
  .description('Execute an operation')
  .argument('<operation>', 'Operation file path')
  .option('-e, --env <environment>', 'Target environment')
  .option('--environment <environment>', 'Target environment (alias for --env)')
  .option('--auto-approve', 'Auto-approve all manual steps and approvals')
  .option('--dry-run', 'Preview full operation plan without executing')
  .option(
    '-m, --mode <mode>',
    'Execution mode: sidecar | manual | automatic | hybrid',
    'sidecar',
  )
  .option(
    '--attach <tmux-target>',
    'Attach to an existing tmux pane for sidecar capture (e.g. mysession:0.0)',
  )
  .option(
    '--var <key=value>',
    'Override variable values',
    (value, previous: string[] = []) => [...previous, value],
  )
  .option('-v, --verbose', 'Verbose output')
  .option('--continue-on-error', 'Continue execution even if steps fail')
  .option('--report <dir>', 'Write Markdown evidence report to directory')
  .action(async (operation: string, options: RunOptions) => {
    try {
      if (
        options.mode &&
        !VALID_MODES.includes(options.mode as ExecutionMode)
      ) {
        console.error(
          `❌ Invalid mode "${options.mode}". Must be one of: ${VALID_MODES.join(' | ')}`,
        );
        process.exit(1);
      }
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
