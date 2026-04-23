import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { execSync } from 'node:child_process'
import { Command } from 'commander'
import { OperationExecutor } from '../../lib/executor'
import { SessionUtils, sessionManager } from '../../lib/session-manager'
import { bootstrapSessions, type TmuxSession } from '../../lib/tmux-session'
import { resolveVars, resolveVarsSafe } from '../../lib/variable-resolver'
import { SessionState } from '../../lib/session-state'
import { createEventLogger, type EventLogger } from '../../lib/event-logger'
import { StepController } from '../../lib/tui'
import type { EvidenceType, ExecutionMode, Operation, Step } from '../../models/operation'
import type { EvidenceItem } from '../../models/evidence'
import { parseOperation } from '../../operations/parser'

interface RunOptions {
  env?: string
  environment?: string
  autoApprove?: boolean
  dryRun?: boolean
  mode?: ExecutionMode
  variables?: string[]
  verbose?: boolean
  withAi?: boolean
  continueOnError?: boolean
}

interface ResumeOptions {
  verbose?: boolean
  autoApprove?: boolean
  fromStep?: number
}

// ─── Evidence collection helpers ─────────────────────────────────────────────

function buildEvidenceItem(
  type: EvidenceType,
  content: string | Buffer,
  operator: string,
  filename?: string,
  source = 'manual',
  originalPath?: string,
): EvidenceItem {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8')
  return {
    id: randomUUID(),
    step_id: 'interactive',
    type,
    content,
    filename,
    timestamp: new Date(),
    operator,
    automatic: false,
    validated: true,
    metadata: {
      size: buf.length,
      format: filename ? detectFormat(filename) : 'text/plain',
      source,
      original_path: originalPath,
    },
  }
}

function detectFormat(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    mp4: 'video/mp4',
    json: 'application/json',
    csv: 'text/csv',
    log: 'text/plain',
    txt: 'text/plain',
  }
  return map[ext] ?? 'application/octet-stream'
}

function isImageExtension(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)
}

function evidenceTypeFromFile(filename: string, preferred: EvidenceType[]): EvidenceType {
  if (isImageExtension(filename)) return 'screenshot'
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'log') return 'log'
  if (ext === 'json' || ext === 'csv') return 'command_output'
  return preferred[0] ?? 'file'
}

async function tryClipboardImage(operator: string): Promise<{ success: boolean; item?: EvidenceItem; error?: string }> {
  const tmpPath = join(tmpdir(), `samaritan-clipboard-${Date.now()}.png`)
  try {
    if (process.platform === 'darwin') {
      // Try pngpaste first (common macOS tool), then osascript
      try {
        execSync(`pngpaste "${tmpPath}" 2>/dev/null`, { stdio: 'pipe' })
      } catch {
        execSync(
          `osascript -e 'set d to (the clipboard as «class PNGf»)' \
           -e 'set f to open for access POSIX file "${tmpPath}" with write permission' \
           -e 'write d to f' -e 'close access f'`,
          { stdio: 'pipe' },
        )
      }
    } else if (process.platform === 'linux') {
      // Try xclip then wl-paste
      try {
        execSync(`xclip -selection clipboard -t image/png -o > "${tmpPath}" 2>/dev/null`, { shell: '/bin/sh', stdio: 'pipe' })
      } catch {
        execSync(`wl-paste --type image/png > "${tmpPath}" 2>/dev/null`, { shell: '/bin/sh', stdio: 'pipe' })
      }
    } else {
      return { success: false, error: 'Clipboard image paste is not supported on this platform. Use a file path instead.' }
    }

    if (!existsSync(tmpPath)) {
      return { success: false, error: 'No image found in clipboard. Copy a screenshot first, then try again.' }
    }
    const content = readFileSync(tmpPath)
    if (content.length === 0) {
      return { success: false, error: 'Clipboard image is empty. Copy a screenshot and try again.' }
    }
    const filename = `clipboard-${Date.now()}.png`
    return {
      success: true,
      item: buildEvidenceItem('screenshot', content.toString('base64'), operator, filename, 'clipboard', tmpPath),
    }
  } catch {
    return {
      success: false,
      error: 'Clipboard image paste failed (clipboard tool unavailable). Use a file path instead.',
    }
  }
}

async function collectEvidenceInteractive(
  rl: import('node:readline/promises').Interface,
  step: Step,
  stepIndex: number,
  operator: string,
  logger: EventLogger,
  sessionId: string,
): Promise<EvidenceItem[]> {
  const required = step.evidence?.required ?? false
  const types: EvidenceType[] = step.evidence?.types ?? ['screenshot']
  const collected: EvidenceItem[] = []

  const showStatus = () => {
    const typeList = types.join(', ')
    console.log(`\n    📎 Evidence ${required ? 'required' : 'optional'}: ${typeList}`)
    if (collected.length === 0) {
      console.log('    ─ Collected: 0 items')
    } else {
      console.log(`    ─ Collected: ${collected.length} item(s)`)
      for (const item of collected) {
        console.log(`      • ${item.type}: ${item.filename ?? 'inline text'}`)
      }
    }
  }

  while (true) {
    showStatus()
    const ans = await rl.question(
      '\n    Add evidence [text/image/path/list/done/skip]: ',
    )
    const trimmed = ans.trim()
    const lower = trimmed.toLowerCase()

    if (lower === 'done') {
      if (required && collected.length === 0) {
        console.log('    ⚠️  Evidence is required. Add at least one item, or type "skip" to skip the step.')
        continue
      }
      break
    }

    if (lower === 'skip') {
      if (required && collected.length === 0) {
        console.log('    ⚠️  Skipping step without evidence (override).')
      }
      return []
    }

    if (lower === 'list') {
      showStatus()
      continue
    }

    if (lower === 'text') {
      console.log('    Enter text evidence (blank line to finish):')
      const lines: string[] = []
      while (true) {
        const line = await rl.question('    > ')
        if (line === '') break
        lines.push(line)
      }
      if (lines.length > 0) {
        const content = lines.join('\n')
        const type: EvidenceType = types.includes('command_output') ? 'command_output' : (types.includes('log') ? 'log' : 'command_output')
        const item = buildEvidenceItem(type, content, operator, undefined, 'text')
        collected.push(item)
        sessionManager.addEvidence(sessionId, item)
        logger.emit({ type: 'evidence_collected', step: stepIndex, evidence_type: type, source: 'text' })
        console.log('    ✅ Text evidence added.')
      }
      continue
    }

    if (lower === 'image') {
      const result = await tryClipboardImage(operator)
      if (result.success && result.item) {
        collected.push(result.item)
        sessionManager.addEvidence(sessionId, result.item)
        logger.emit({ type: 'evidence_collected', step: stepIndex, evidence_type: 'screenshot', source: 'clipboard' })
        console.log(`    ✅ Clipboard image attached: ${result.item.filename}`)
      } else {
        console.log(`    ⚠️  ${result.error}`)
      }
      continue
    }

    // Treat input as a file path (handles spaces, special chars, tilde)
    const filePath = trimmed.replace(/^~/, process.env.HOME ?? '~')
    if (!filePath) continue

    if (!existsSync(filePath)) {
      console.log(`    ⚠️  File not found: ${filePath}`)
      continue
    }
    try {
      const content = readFileSync(filePath)
      const filename = filePath.split('/').pop() ?? filePath
      const type = evidenceTypeFromFile(filename, types)
      const stored = isImageExtension(filename) ? content.toString('base64') : content.toString('utf-8')
      const item = buildEvidenceItem(type, stored, operator, filename, 'path', filePath)
      collected.push(item)
      sessionManager.addEvidence(sessionId, item)
      logger.emit({ type: 'evidence_collected', step: stepIndex, evidence_type: type, source: 'path', path: filePath })
      console.log(`    ✅ File evidence attached: ${filename} (${type})`)
    } catch {
      console.log(`    ⚠️  Cannot read file: ${filePath}`)
    }
  }

  return collected
}

// ─── OperationRunner ──────────────────────────────────────────────────────────

class OperationRunner {
  async runOperation(
    operationFile: string,
    options: RunOptions,
  ): Promise<void> {
    const targetEnv = options.env || options.environment
    if (!targetEnv) {
      throw new Error("Required option '-e, --env <environment>' not specified")
    }

    const absFile = existsSync(operationFile)
      ? realpathSync(operationFile)
      : operationFile

    console.log(`🚀 Starting operation: ${absFile}`)
    console.log(`🎯 Target environment: ${targetEnv}`)

    const operation = await this.parseOperationFile(absFile)

    const environment = operation.environments.find(
      (env) => env.name === targetEnv,
    )
    if (!environment) {
      throw new Error(
        `Environment '${targetEnv}' not found in operation. Available: ${operation.environments.map((e) => e.name).join(', ')}`,
      )
    }

    const additionalVars = this.parseVariables(options.variables || [])
    const resolvedVars: Record<string, any> = {
      ...(operation.common_variables ?? {}),
      ...operation.variables[targetEnv],
      ...additionalVars,
    }

    const executionMode: ExecutionMode =
      options.mode ?? (options.autoApprove ? 'automatic' : 'manual')

    const context = {
      operationId: operation.id,
      environment: targetEnv,
      variables: resolvedVars,
      operator: process.env.USER || 'unknown',
      sessionId: `run-${operation.id}-${Date.now()}`,
      dryRun: options.dryRun || false,
      autoMode: executionMode === 'automatic' || options.autoApprove || false,
    }

    this.displayOperationSummary(operation, environment, context, executionMode)

    if (environment.approval_required && !options.autoApprove && !options.dryRun) {
      console.log('⚠️  This environment requires approval.')
      console.log('💡 Use --auto-approve to skip approval prompts or ensure approvals are pre-authorized.')
    }

    const session = sessionManager.createSession(
      operation.id,
      targetEnv,
      context.operator,
      executionMode,
      resolvedVars,
      absFile,
    )

    console.log(`📋 Session: ${session.id}`)

    // Create JSONL event logger for this session
    const logger = createEventLogger(context.sessionId)
    console.log(`📝 Session log: ${logger.path}\n`)
    logger.emit({ type: 'session_start', operation: operation.name, environment: targetEnv, session_id: context.sessionId })

    const executor = new OperationExecutor(operation, context)
    sessionManager.associateExecutor(session.id, executor)

    this.setupEventHandlers(executor, options)
    this.wireLoggerToExecutor(logger, executor)

    try {
      if (operation.preflight && operation.preflight.length > 0) {
        console.log('🔍 Running preflight checks...')
        await this.runPreflightChecks(operation.preflight, context)
        console.log('✅ Preflight checks passed\n')
      }

      const isInteractiveMode = !context.autoMode && !options.dryRun

      if (isInteractiveMode) {
        let tmuxSession: TmuxSession | undefined
        if (operation.sessions && Object.keys(operation.sessions).length > 0) {
          console.log('🖥️  Bootstrapping tmux sessions...')
          try {
            tmuxSession = await bootstrapSessions(context.sessionId, operation.sessions)
            console.log(`   Sessions: ${Object.keys(operation.sessions).join(', ')}\n`)
          } catch (err: any) {
            console.warn(
              `⚠️  tmux bootstrap failed (${err.message}); falling back to prompt-only mode.\n`,
            )
          }
        }

        console.log('▶️  Starting interactive operation execution...\n')
        executor.startInteractive()
        await this.runInteractiveStepLoop(
          executor, operation, absFile, resolvedVars, executionMode,
          tmuxSession, logger, session.id,
        )
        executor.finalizeOperation()

        tmuxSession?.teardown()
      } else {
        console.log('▶️  Starting operation execution...\n')
        await executor.execute()
      }

      const finalState = executor.getState()

      if (finalState.status === 'completed') {
        if (options.dryRun) {
          console.log('\n✅ Dry-run preview complete — all steps traversed.')
          console.log(
            `   Steps: ${finalState.totalSteps}  Skipped: ${finalState.skippedSteps}`,
          )
        } else {
          console.log('\n✅ Operation completed successfully!')
        }
      } else if (finalState.status === 'paused') {
        const waitingStep = finalState.steps.find((s) => s.status === 'waiting')
        const stepName = waitingStep?.step.name ?? 'unknown'
        console.log('\n⏸️  Operation paused — manual interaction required.')
        console.log(
          `   ${finalState.waitingSteps} step(s) waiting. Paused at: "${stepName}"`,
        )
        console.log(`\n💡 Resume this session:\n   samaritan resume ${session.id}`)
      }

      const summary = sessionManager.getSessionSummary(session.id)
      if (summary) {
        console.log('\n📊 Execution Summary:')
        console.log(`   Duration: ${SessionUtils.formatSessionDuration(session)}`)
        console.log(`   Evidence collected: ${summary.evidenceCount} items`)
        console.log(`   Retries: ${summary.retryCount}`)
        console.log(`   Approvals: ${summary.approvalCount}`)
      }
    } catch (error: any) {
      console.error(`\n❌ Operation failed: ${error.message}`)

      const currentSession = sessionManager.getSession(session.id)
      if (currentSession) {
        console.log('\n🔄 Resume from where you left off:')
        console.log(`   samaritan resume ${session.id}`)
      }

      throw error
    } finally {
      logger.close()
      console.log(`\n📝 Session log saved: ${logger.path}`)
    }
  }

  async resumeSession(
    sessionId: string,
    options: ResumeOptions,
  ): Promise<void> {
    console.log(`🔄 Resuming session: ${sessionId}`)

    const session = sessionManager.getSession(sessionId)
    if (!session) {
      throw new Error(
        `Session not found: ${sessionId}\n` +
          '  No persisted session found for this ID.\n' +
          '  Start a new run with: samaritan run <operation.yaml> -e <environment>',
      )
    }

    if (session.status === 'completed') {
      console.log('✅ Session already completed')
      return
    }

    if (session.status === 'cancelled') {
      throw new Error('Cannot resume cancelled session')
    }

    if (!session.operation_file) {
      throw new Error(
        'Cannot resume: session has no operation_file recorded.\n' +
          '  This session was started with an older version of samaritan.',
      )
    }

    console.log('📋 Session details:')
    console.log(`   Operation: ${session.operation_id}`)
    console.log(`   File: ${session.operation_file}`)
    console.log(`   Environment: ${session.environment}`)
    console.log(`   Resuming at step: ${session.current_step_index + 1}`)
    console.log(`   Progress: ${session.completion_percentage || 0}%`)
    console.log(
      `   Status: ${SessionUtils.getSessionStatusEmoji(session.status)} ${session.status}`,
    )

    const operation = await this.parseOperationFile(session.operation_file)

    const context = {
      operationId: session.operation_id,
      environment: session.environment,
      variables: session.variables || {},
      operator: session.operator || process.env.USER || 'unknown',
      sessionId: session.id,
      dryRun: false,
      autoMode: session.mode === 'automatic',
    }

    const logger = createEventLogger(`resume-${session.id}-${Date.now()}`)
    console.log(`📝 Session log: ${logger.path}\n`)
    logger.emit({ type: 'session_start', operation: operation.name, environment: session.environment, resumed: true, original_session: session.id })

    const executor = new OperationExecutor(operation, context)
    sessionManager.associateExecutor(session.id, executor)

    this.setupEventHandlers(executor, { verbose: options.verbose })
    this.wireLoggerToExecutor(logger, executor)

    let tmuxSession: TmuxSession | undefined
    if (operation.sessions && Object.keys(operation.sessions).length > 0) {
      console.log('\n🖥️  Bootstrapping tmux sessions...')
      try {
        tmuxSession = await bootstrapSessions(session.id, operation.sessions)
        console.log(`   Sessions: ${Object.keys(operation.sessions).join(', ')}\n`)
      } catch (err: any) {
        console.warn(
          `⚠️  tmux bootstrap failed (${err.message}); continuing without tmux.\n`,
        )
      }
    }

    console.log('\n▶️  Resuming operation execution...\n')
    executor.resumeFromIndex(session.current_step_index)

    try {
      await this.runInteractiveStepLoop(
        executor, operation, session.operation_file, context.variables,
        session.mode, tmuxSession, logger, session.id,
      )
      executor.finalizeOperation()
      tmuxSession?.teardown()

      console.log('\n✅ Session resumed and completed!')
    } finally {
      logger.close()
      console.log(`\n📝 Session log saved: ${logger.path}`)
    }
  }

  private wireLoggerToExecutor(logger: EventLogger, executor: OperationExecutor): void {
    executor.on('operation_started', (e) => {
      logger.emit({ type: 'operation_started', operation: e.operationId, message: e.message })
    })
    executor.on('step_started', (e) => {
      logger.emit({ type: 'step_start', step: e.stepIndex ?? 0, name: e.step?.name, step_id: e.stepId })
    })
    executor.on('step_completed', (e) => {
      logger.emit({ type: 'step_complete', step: e.stepIndex ?? 0, duration: e.result?.duration })
    })
    executor.on('step_failed', (e) => {
      logger.emit({ type: 'step_failed', step: e.stepIndex ?? 0, error: e.error, message: e.message })
    })
    executor.on('step_skipped', (e) => {
      logger.emit({ type: 'step_skipped', step: e.stepIndex ?? 0 })
    })
    executor.on('operation_completed', (e) => {
      logger.emit({ type: 'operation_completed', message: e.message })
    })
    executor.on('operation_failed', (e) => {
      logger.emit({ type: 'operation_failed', message: e.message, error: e.error })
    })
  }

  private async runInteractiveStepLoop(
    executor: OperationExecutor,
    operation: Operation,
    operationFile: string,
    vars: Record<string, any>,
    mode: ExecutionMode,
    tmuxSession: TmuxSession | undefined,
    logger: EventLogger,
    sessionId: string,
  ): Promise<void> {
    const { createInterface } = await import('node:readline/promises')
    const rl = createInterface({ input: process.stdin, output: process.stdout })

    const state = executor.getState()
    const sessionState = new SessionState()
    const operator = state.context.operator

    for (const [key, value] of Object.entries(vars)) {
      sessionState.capture(key, String(value))
    }

    const autoSend = operation.run?.auto_send ?? false
    const autoExec = operation.run?.auto_exec ?? false

    const controller = tmuxSession
      ? new StepController({
          logger,
          tmux: tmuxSession,
          sessionState,
          autoSend,
          autoExec,
          sessions: operation.sessions,
        })
      : null

    const DIVIDER = '─'.repeat(60)

    const tryResolve = (text: string | undefined): string | undefined => {
      if (!text) return text
      try {
        return resolveVars(text, vars)
      } catch {
        return resolveVarsSafe(text, vars)
      }
    }

    try {
      const steps = executor.getState().steps

      for (let i = executor.getState().currentStepIndex; i < steps.length; i++) {
        const { step } = steps[i]
        const stepNum = `[${i + 1}/${steps.length}]`
        const typeLabel = step.type.toUpperCase()

        const resolvedCommand = tryResolve(step.command)
        const resolvedInstruction = tryResolve(step.instruction)

        console.log(`\n${DIVIDER}`)
        console.log(`${stepNum} ${typeLabel}: ${step.name}`)
        if (step.description) console.log(`    ${step.description}`)
        if (step.pic) console.log(`    PIC      : ${step.pic}`)
        if (step.reviewer) console.log(`    Reviewer : ${step.reviewer}`)
        if (step.session) console.log(`    Session  : ${step.session}`)
        if (step.ticket) console.log(`    Ticket   : ${Array.isArray(step.ticket) ? step.ticket.join(', ') : step.ticket}`)

        const evidenceRequired = step.evidence?.required === true

        if (step.type === 'automatic') {
          if (resolvedCommand) console.log(`\n    $ ${resolvedCommand}`)

          if (controller && step.session && resolvedCommand) {
            const ans = await rl.question(
              '\n    ▶  Send to tmux? [Enter=yes / s=skip / q=quit]: ',
            )
            const choice = ans.trim().toLowerCase()
            if (choice === 'q' || choice === 'quit') {
              console.log('\n⛔ Execution aborted by operator.')
              break
            }
            if (choice === 's' || choice === 'skip') {
              executor.skipStep(i)
              logger.emit({ type: 'step_skipped', step: i, name: step.name, reason: 'operator_skip' })
              console.log('    ⏭  Skipped.')
              continue
            }
            await controller.sendCommand(step.session, resolvedCommand, i)
            await executor.executeStepManually(i, `sent via tmux [${step.session}]`)
            console.log(`    📤 Sent to tmux pane [${step.session}].`)

            if (step.verify) {
              console.log(`    🔍 Running verify: ${tryResolve(step.verify.command) ?? step.verify.command}`)
              const { state: vState, assertResult } = await controller.runVerify(step, i)
              if (assertResult) {
                const icon = assertResult.pass ? '✅ PASS' : '❌ FAIL'
                console.log(`    ${icon} Assert (${assertResult.type}): expected "${assertResult.expected}"`)
                if (!assertResult.pass) {
                  const override = await rl.question(
                    '    ⚠️  Assertion failed. Override and continue? [y/N]: ',
                  )
                  if (override.trim().toLowerCase() !== 'y') {
                    console.log('    ❌ Stopping due to failed assertion.')
                    break
                  }
                }
              }
              console.log(`    ✅ Verify: ${vState}`)
            }
          } else {
            const ans = await rl.question(
              '\n    ▶  Execute? [Enter=yes / s=skip / q=quit]: ',
            )
            const choice = ans.trim().toLowerCase()
            if (choice === 'q' || choice === 'quit') {
              console.log('\n⛔ Execution aborted by operator.')
              break
            }
            if (choice === 's' || choice === 'skip') {
              executor.skipStep(i)
              logger.emit({ type: 'step_skipped', step: i, name: step.name, reason: 'operator_skip' })
              console.log('    ⏭  Skipped.')
              continue
            }
            await executor.executeStepManually(i, 'confirmed')
            console.log('    ✅ Step marked complete.')
          }

          if (evidenceRequired) {
            const items = await collectEvidenceInteractive(rl, step, i, operator, logger, sessionId)
            if (items.length > 0) {
              console.log(`    📎 ${items.length} evidence item(s) collected.`)
            }
          }
        } else if (step.type === 'manual') {
          if (resolvedInstruction) console.log(`\n    ${resolvedInstruction}`)
          if (resolvedCommand) console.log(`\n    Command reference:\n    $ ${resolvedCommand}`)

          if (evidenceRequired) {
            // Evidence loop IS the completion gate for evidence-required manual steps
            const items = await collectEvidenceInteractive(rl, step, i, operator, logger, sessionId)
            // 'skip' from evidence loop returns empty array → skip the step
            if (items.length === 0 && step.evidence?.required) {
              executor.skipStep(i)
              logger.emit({ type: 'step_skipped', step: i, name: step.name, reason: 'evidence_skipped' })
              console.log('    ⏭  Step skipped (no evidence provided).')
              continue
            }
            await executor.executeStepManually(i, `evidence collected: ${items.length} item(s)`)
            console.log(`    ✅ Step complete with ${items.length} evidence item(s).`)
          } else {
            const notes = await rl.question(
              '\n    ✋ Mark done (notes/Enter=confirm, "skip"=skip, "abort"=abort): ',
            )
            const choice = notes.trim().toLowerCase()
            if (choice === 'abort') {
              console.log('\n⛔ Execution aborted by operator.')
              break
            }
            if (choice === 'skip') {
              executor.skipStep(i)
              logger.emit({ type: 'step_skipped', step: i, name: step.name, reason: 'operator_skip' })
              console.log('    ⏭  Skipped.')
              continue
            }
            await executor.executeStepManually(i, notes.trim() || 'confirmed')
            console.log('    ✅ Step marked complete.')
          }
        } else if (step.type === 'approval') {
          if (resolvedInstruction) console.log(`\n    ${resolvedInstruction}`)
          const ans = await rl.question(
            '\n    ⚡ "approve" / "reject" / "skip": ',
          )
          const choice = ans.trim().toLowerCase()
          if (choice === 'approve') {
            await executor.executeStepManually(i, 'approved')
            logger.emit({ type: 'user_input', step: i, decision: 'approved' })
            console.log('    ✅ Approved.')
          } else if (choice === 'reject') {
            executor.skipStep(i)
            logger.emit({ type: 'user_input', step: i, decision: 'rejected' })
            console.log('    ❌ Rejected — step skipped.')
          } else {
            executor.skipStep(i)
            console.log('    ⏭  Skipped.')
          }
        } else {
          await executor.executeStepManually(i, 'confirmed')
        }
      }

      console.log(`\n${DIVIDER}`)
    } finally {
      rl.close()
    }
  }

  private async parseOperationFile(filePath: string): Promise<Operation> {
    if (!existsSync(filePath)) {
      throw new Error(`Operation file not found: ${filePath}`)
    }
    return await parseOperation(filePath)
  }

  private parseVariables(variableStrings: string[]): Record<string, any> {
    const variables: Record<string, any> = {}
    for (const varString of variableStrings) {
      const [key, value] = varString.split('=', 2)
      if (!key || value === undefined) {
        throw new Error(
          `Invalid variable format: ${varString}. Use KEY=VALUE format.`,
        )
      }
      try {
        variables[key] = JSON.parse(value)
      } catch {
        variables[key] = value
      }
    }
    return variables
  }

  private displayOperationSummary(
    operation: Operation,
    environment: any,
    context: any,
    mode: ExecutionMode,
  ): void {
    console.log('\n📋 Operation Summary:')
    console.log(`   Name: ${operation.name} v${operation.version}`)
    console.log(`   Description: ${operation.description}`)
    console.log(`   Environment: ${environment.name} (${environment.description})`)
    console.log(`   Steps: ${operation.steps.length}`)
    console.log(`   Preflight checks: ${operation.preflight?.length || 0}`)
    console.log(`   Execution mode: ${mode}`)
    console.log(`   Dry run: ${context.dryRun ? 'Yes' : 'No'}`)

    if (environment.approval_required) {
      console.log('   ⚠️  Approval required for this environment')
    }
    if (environment.validation_required) {
      console.log('   ✅ Validation required for this environment')
    }

    console.log('')
  }

  private setupEventHandlers(executor: OperationExecutor, options: any): void {
    if (options.verbose) {
      executor.on('step_started', (event) => {
        console.log(`▶️  [${event.stepIndex + 1}] Starting: ${event.step?.name}`)
      })
      executor.on('step_completed', (event) => {
        console.log(`✅ [${event.stepIndex + 1}] Completed: ${event.step?.name}`)
        if (event.result?.duration) {
          console.log(`    Duration: ${event.result.duration}ms`)
        }
      })
      executor.on('step_failed', (event) => {
        console.log(`❌ [${event.stepIndex + 1}] Failed: ${event.step?.name}`)
        console.log(`    Error: ${event.error}`)
      })
      executor.on('step_skipped', (event) => {
        console.log(`⏭️  [${event.stepIndex + 1}] Skipped: ${event.step?.name}`)
      })
      executor.on('approval_required', (event) => {
        console.log(`⏸️  [${event.stepIndex + 1}] Approval required: ${event.step?.name}`)
      })
    }

    executor.on('operation_paused', () => {
      console.log('\n⏸️  Operation paused')
    })
    executor.on('operation_completed', () => {
      console.log('\n🎉 Operation completed successfully!')
    })
    executor.on('operation_failed', (event) => {
      console.log(`\n💥 Operation failed: ${event.error}`)
    })
  }

  private async runPreflightChecks(preflight: any[], context: any): Promise<void> {
    for (let i = 0; i < preflight.length; i++) {
      const check = preflight[i]
      console.log(`   ${i + 1}. ${check.name}: ${check.description}`)
      if (check.type === 'command' && check.command && !context.dryRun) {
        console.log(`      Command: ${check.command}`)
        console.log('      ✅ Passed')
      } else if (check.type === 'manual') {
        console.log('      ✅ Manual check assumed passed')
      } else {
        console.log('      ✅ Skipped (dry run)')
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
  .action(async (operation: string, options: RunOptions) => {
    try {
      const runner = new OperationRunner()
      await runner.runOperation(operation, options)
    } catch (error: any) {
      console.error(`❌ Execution failed: ${error.message}`)
      process.exit(1)
    }
  })

const resumeCommand = new Command('resume')
  .description('Resume a paused or failed operation session')
  .argument('<session-id>', 'Session ID to resume')
  .option('-v, --verbose', 'Verbose output')
  .option('--auto-approve', 'Auto-approve remaining manual steps')
  .option('--from-step <number>', 'Resume from specific step number', parseInt)
  .action(async (sessionId: string, options: ResumeOptions) => {
    try {
      const runner = new OperationRunner()
      await runner.resumeSession(sessionId, options)
    } catch (error: any) {
      console.error(`❌ Resume failed: ${error.message}`)
      process.exit(1)
    }
  })

export { runCommand, resumeCommand }
