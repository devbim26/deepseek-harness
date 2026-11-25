/** One foreground orchestration run and its complete child lifecycle. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentActivation, SubagentResult } from '@deepseek-ai/dsh-subagent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { AgentOrchestratorError } from './error.ts'
import { evaluatorPrompt, workerFollowUpPrompt, workerPrompt } from './prompts.ts'
import { createOrchestrationPdf } from './report.ts'
import { decodeEvaluatorDecision, decodeWorkerReport, EVALUATOR_DECISION_SCHEMA, WORKER_REPORT_SCHEMA } from './schemas.ts'
import type {
  AgentOrchestrationEvaluatorDecision, AgentOrchestrationFollowUp,
  AgentOrchestrationResult, AgentOrchestrationRun,
  AgentOrchestrationRunId, AgentOrchestrationSnapshot,
  AgentOrchestrationStartRequest, AgentOrchestrationTerminalStatus,
  AgentOrchestrationWorkerResult,
} from './types.ts'

/** Deployment-resolved engine settings consumed by one run. */
export interface OrchestrationRuntimeConfig {
  readonly provider: string
  readonly maxHandoffChars: number
  readonly reportDirectory: string
}

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Deny human input before every orchestrated child's first model request. */
function autonomousSetup(childCtx: Context): void {
  childCtx.tools.guard(exec => exec.name === 'ask_user_question'
    ? {
      reason: 'Human input is forbidden in this autonomous run. Record the unresolved fact as a gap and continue.',
      info: { name: 'AgentOrchestratorError', code: 'HUMAN_INPUT_FORBIDDEN' },
    }
    : undefined)
}

/**
 * Copy a snapshot without the PDF highlight marks. The run keeps its report
 * texts as the models wrote them, because the PDF prints `==...==` on the
 * yellow band; a snapshot leaves the run for the calling model, the Remote
 * surface, and run journals, which read the mark as literal text.
 * @param snapshot - A snapshot or result holding the report texts of the run.
 * @returns The copy with every closed `==...==` reduced to its text.
 */
function published<T extends AgentOrchestrationSnapshot>(snapshot: T): T {
  const unmarked = (text: string): string => text.replace(/==(.+?)==/g, '$1')
  const unmarkedList = (texts: readonly string[]): string[] => texts.map(unmarked)
  return {
    ...snapshot,
    summary: unmarked(snapshot.summary),
    workers: snapshot.workers.map(worker => ({
      ...worker,
      ...worker.report === undefined ? {} : {
        report: {
          ...worker.report,
          summary: unmarked(worker.report.summary),
          evidence: unmarkedList(worker.report.evidence),
          assumptions: unmarkedList(worker.report.assumptions),
          gaps: unmarkedList(worker.report.gaps),
        },
      },
    })),
    assumptions: unmarkedList(snapshot.assumptions),
    gaps: unmarkedList(snapshot.gaps),
    errors: unmarkedList(snapshot.errors),
  }
}

/** Holder-owned run controller. */
export class OrchestrationRunController implements AgentOrchestrationRun {
  readonly result: Promise<AgentOrchestrationResult>
  private readonly controller = new AbortController()
  private readonly activations = new Set<SubagentActivation>()
  private readonly pendingDisposals = new Set<Promise<void>>()
  private readonly disposalFailures: unknown[] = []
  private readonly workers: AgentOrchestrationWorkerResult[]
  private evaluatorChildId: SessionId | undefined
  private snapshotValue: AgentOrchestrationSnapshot
  private terminal = false
  private cancelReason: string | undefined
  private disposed: Promise<void> | undefined
  private readonly externalAbort: () => void

  constructor(
    private readonly ctx: Context,
    private readonly config: OrchestrationRuntimeConfig,
    private readonly request: AgentOrchestrationStartRequest,
    readonly id: AgentOrchestrationRunId,
    private readonly onUpdate: (snapshot: AgentOrchestrationSnapshot) => void,
  ) {
    this.workers = request.assignments.map(assignment => ({ assignmentId: assignment.id, rounds: 0 }))
    this.snapshotValue = {
      id, status: 'queued', objective: request.objective, rounds: 0, summary: '',
      workers: this.workers, assumptions: [], gaps: [], errors: [],
    }
    this.externalAbort = () => { this.cancel('orchestration signal aborted') }
    if (request.signal?.aborted) this.externalAbort()
    else request.signal?.addEventListener('abort', this.externalAbort, { once: true })
    this.result = Promise.resolve().then(() => this.drive())
  }

  /**
   * Read the current process-local snapshot.
   *
   * @returns The latest active or settled run snapshot.
   */
  snapshot(): AgentOrchestrationSnapshot {
    return this.snapshotValue
  }

  cancel(reason = 'orchestration cancelled'): void {
    if (this.terminal || this.cancelReason !== undefined) return
    this.cancelReason = reason
    this.controller.abort(reason)
    for (const activation of this.activations) this.trackDisposal(activation.dispose())
  }

  dispose(): Promise<void> {
    if (!this.terminal) this.cancel('orchestration disposed')
    this.disposed ??= this.result.then(() => undefined)
    return this.disposed
  }

  private trackDisposal(disposal: Promise<void>): void {
    this.pendingDisposals.add(disposal)
    void disposal.then(
      () => { this.pendingDisposals.delete(disposal) },
      (error: unknown) => {
        this.pendingDisposals.delete(disposal)
        this.disposalFailures.push(error)
      },
    )
  }

  private update(snapshot: Partial<AgentOrchestrationSnapshot>): void {
    this.snapshotValue = published({ ...this.snapshotValue, ...snapshot, workers: [...this.workers] })
    this.onUpdate(this.snapshotValue)
  }

  private updateWorker(assignmentId: string, patch: Partial<AgentOrchestrationWorkerResult>): void {
    const index = this.workers.findIndex(worker => worker.assignmentId === assignmentId)
    const previous = this.workers[index]
    if (previous !== undefined) this.workers[index] = { ...previous, ...patch }
    this.update({ workers: [...this.workers] })
  }

  private async useActivation(activation: SubagentActivation): Promise<SubagentResult> {
    this.activations.add(activation)
    if (this.controller.signal.aborted) this.trackDisposal(activation.dispose())
    try {
      return await activation.result
    } finally {
      try {
        await activation.dispose()
      } finally {
        this.activations.delete(activation)
      }
    }
  }

  private async startChild(
    childId: SessionId | undefined,
    agentPreset: string | undefined,
    label: string,
    prompt: string,
    outputSchema: ObjectJsonSchema,
  ): Promise<{ childId: SessionId; result: SubagentResult }> {
    this.controller.signal.throwIfAborted()
    const activation = childId === undefined
      ? await this.ctx.subagents.startActivation({
        provider: this.config.provider,
        label,
        delivery: 'caller',
        parent: this.request.parent,
        prompt: [{ type: 'text', text: prompt }],
        outputSchema,
        setup: autonomousSetup,
        signal: this.controller.signal,
        ...(agentPreset === undefined ? {} : { agentPreset }),
      })
      : await this.ctx.subagents.resumeActivation({
        parent: this.request.parent,
        childId,
        prompt: [{ type: 'text', text: prompt }],
        outputSchema,
        setup: autonomousSetup,
        signal: this.controller.signal,
      })
    const result = await this.useActivation(activation)
    return { childId: activation.childId, result }
  }

  private async runWorker(assignmentId: string, followUp?: AgentOrchestrationFollowUp): Promise<void> {
    const assignment = this.request.assignments.find(candidate => candidate.id === assignmentId)
    if (assignment === undefined) {
      throw new AgentOrchestratorError(`follow-up names an unknown assignment id: ${assignmentId}`, 'ORCHESTRATION_EVALUATOR_FAILED')
    }
    const previous = this.workers.find(worker => worker.assignmentId === assignmentId)
    const { childId: activatedChildId, result } = await this.startChild(
      previous?.childId,
      assignment.agentPreset,
      `worker ${assignmentId}`,
      followUp === undefined ? workerPrompt(assignment) : workerFollowUpPrompt(followUp),
      WORKER_REPORT_SCHEMA,
    )
    this.updateWorker(assignmentId, { childId: activatedChildId, rounds: (previous?.rounds ?? 0) + 1, error: undefined })
    if (result.stopReason !== 'completed' || result.structured === undefined) {
      this.updateWorker(assignmentId, {
        error: result.diagnostic ?? `worker ended with ${result.stopReason} without a valid structured report`,
      })
      return
    }
    try {
      const report = decodeWorkerReport(result.structured)
      this.updateWorker(assignmentId, { report, error: undefined })
    } catch (error: unknown) {
      this.updateWorker(assignmentId, { error: failureText(error) })
    }
  }

  private async runWorkers(followUps: readonly AgentOrchestrationFollowUp[] | undefined): Promise<void> {
    const targets: readonly (AgentOrchestrationFollowUp | { readonly assignmentId: string })[] = followUps
      ?? this.request.assignments.map(assignment => ({ assignmentId: assignment.id }))
    let next = 0
    const lanes = Array.from({ length: Math.min(this.request.maxParallel, targets.length) }, async () => {
      while (!this.controller.signal.aborted) {
        const index = next++
        if (index >= targets.length) return
        const target = targets[index]
        if (target === undefined) return
        await this.runWorker(target.assignmentId, followUps === undefined ? undefined : target as AgentOrchestrationFollowUp)
      }
    })
    await Promise.all(lanes)
  }

  private async runEvaluator(): Promise<AgentOrchestrationEvaluatorDecision> {
    const prompt = evaluatorPrompt(this.request, this.workers, this.config.maxHandoffChars)
    const { childId, result } = await this.startChild(
      this.evaluatorChildId,
      this.request.evaluatorPreset,
      'orchestration evaluator',
      prompt,
      EVALUATOR_DECISION_SCHEMA,
    )
    this.evaluatorChildId = childId
    if (result.stopReason !== 'completed' || result.structured === undefined) {
      throw new AgentOrchestratorError(result.diagnostic ?? `evaluator ended with ${result.stopReason} without a structured decision: ${JSON.stringify(result.output)}`, 'ORCHESTRATION_EVALUATOR_FAILED')
    }
    return decodeEvaluatorDecision(result.structured)
  }

  private terminalResult(
    status: AgentOrchestrationTerminalStatus,
    summary: string,
    extra: { assumptions?: readonly string[]; gaps?: readonly string[]; errors?: readonly string[] } = {},
  ): AgentOrchestrationResult {
    const workerErrors = this.workers.flatMap(worker => worker.error === undefined ? [] : [worker.error])
    const workerGaps = this.workers.flatMap(worker => worker.report?.gaps ?? [])
    const workerAssumptions = this.workers.flatMap(worker => worker.report?.assumptions ?? [])
    return {
      ...this.snapshotValue,
      status,
      rounds: this.snapshotValue.rounds,
      summary,
      workers: [...this.workers],
      assumptions: [...workerAssumptions, ...extra.assumptions ?? []],
      gaps: [...workerGaps, ...workerErrors, ...extra.gaps ?? []],
      errors: [...workerErrors, ...extra.errors ?? []],
    }
  }

  private async loop(): Promise<AgentOrchestrationResult> {
    let followUps: readonly AgentOrchestrationFollowUp[] | undefined
    for (let round = 1; ; round++) {
      this.controller.signal.throwIfAborted()
      await this.runWorkers(followUps)
      this.controller.signal.throwIfAborted()
      const decision = await this.runEvaluator()
      this.update({ rounds: round })
      switch (decision.kind) {
        case 'complete':
          return this.terminalResult('complete', decision.summary, decision)
        case 'partial':
        case 'blocked':
          return this.terminalResult('partial', decision.summary, { ...decision, gaps: [...decision.gaps, decision.reason] })
        case 'follow-ups': {
          const known = new Set(this.request.assignments.map(assignment => assignment.id))
          if (decision.followUps.some(followUp => !known.has(followUp.assignmentId))) {
            throw new AgentOrchestratorError('evaluator named an unknown assignment', 'ORCHESTRATION_EVALUATOR_FAILED')
          }
          if (round === this.request.maxIterations) {
            return this.terminalResult('budget-limited', `Iteration budget exhausted after ${round} round(s).`, {
              gaps: ['The evaluator still requested follow-up work.'],
            })
          }
          followUps = decision.followUps
          break
        }
      }
    }
  }

  private async settleChildren(): Promise<void> {
    const failures: unknown[] = [...this.disposalFailures]
    while (this.pendingDisposals.size > 0) {
      const results = await Promise.allSettled([...this.pendingDisposals])
      for (const result of results) if (result.status === 'rejected') failures.push(result.reason)
    }
    if (failures.length > 0) {
      throw new AgentOrchestratorError('orchestration child cleanup failed', 'ORCHESTRATION_CLEANUP_FAILED', {
        cause: new AggregateError(failures),
      })
    }
  }

  private async drive(): Promise<AgentOrchestrationResult> {
    let result: AgentOrchestrationResult
    this.update({ status: 'running' })
    try {
      result = await this.loop()
    } catch (error: unknown) {
      this.controller.abort(error)
      result = this.controller.signal.aborted && this.cancelReason !== undefined
        ? this.terminalResult('cancelled', this.cancelReason, { errors: [this.cancelReason] })
        : this.terminalResult('failed', failureText(error), { errors: [failureText(error)] })
    }
    try {
      await this.settleChildren()
    } catch (error: unknown) {
      result = this.terminalResult('failed', failureText(error), { errors: [failureText(error)] })
    }
    if (this.request.report !== undefined && ['complete', 'partial', 'budget-limited'].includes(result.status)) {
      try {
        const pdf = await createOrchestrationPdf(
          this.ctx, this.request.parent, this.config.reportDirectory, this.request.report, this.id, result, this.controller.signal,
        )
        result = { ...result, pdf }
      } catch (error: unknown) {
        result = this.terminalResult('failed', failureText(error), { errors: [failureText(error)] })
      }
    }
    this.terminal = true
    this.request.signal?.removeEventListener('abort', this.externalAbort)
    this.update(result)
    return published(result)
  }
}
