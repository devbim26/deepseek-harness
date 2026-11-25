/** Service Definition and local provider for foreground conversational orchestration. */
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-tool-pdf/types'
import { AgentOrchestratorError } from './error.ts'
import { OrchestrationRunController } from './run.ts'
import type {
  AgentOrchestrationRun, AgentOrchestrationRunId,
  AgentOrchestrationSnapshot, AgentOrchestrationStartRequest,
} from './types.ts'

export * from './types.ts'
export { AgentOrchestratorError } from './error.ts'
export type { AgentOrchestratorErrorCode } from './error.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentOrchestrator: AgentOrchestrator
  }
}

/** Deployment-owned orchestration limits and artifact placement. */
export interface Config {
  /** Local subagent provider used for workers and evaluator. */
  readonly provider: string
  /** Maximum characters in one serialized evaluator handoff. */
  readonly maxHandoffChars: number
  /** Maximum process-local settled snapshots retained per scoped service. */
  readonly maxSettledRuns: number
  /** Session-relative directory receiving generated PDF files. */
  readonly reportDirectory: string
}
/** Resolve direct and Loader configuration through one explicit validation step. */
function resolveConfig(config: Config): Config {
  const resolved = AgentOrchestrator.Config(config)
  if (resolved.provider.trim() === '' || resolved.reportDirectory.trim() === ''
    || isAbsolute(resolved.reportDirectory) || resolved.reportDirectory.split(/[\\/]/).includes('..')) {
    throw new AgentOrchestratorError('provider must be non-empty and reportDirectory must be a safe Session-relative path', 'ORCHESTRATION_INVALID_REQUEST')
  }
  return resolved
}

/** Scoped local conversational orchestration engine. */
export class AgentOrchestrator extends Service {
  static inject = ['subagents', 'agents']

  static Config: z<Config> = z.object({
    provider: z.string().default('spawn'),
    maxHandoffChars: z.number().step(1).min(1024).max(1_000_000).default(65_536),
    maxSettledRuns: z.number().step(1).min(1).max(64).default(32),
    reportDirectory: z.string().default('reports'),
  }) as z<Config>

  private readonly resolved: Config
  private readonly controllers = new Map<AgentOrchestrationRunId, OrchestrationRunController>()
  private readonly snapshots = new Map<AgentOrchestrationRunId, AgentOrchestrationSnapshot>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'agentOrchestrator')
    this.resolved = resolveConfig(config)
    ctx.effect(() => async () => {
      await Promise.allSettled([...this.controllers.values()].map(run => run.dispose()))
    }, 'agent-orchestrator.dispose')
  }

  /**
   * Start one foreground run after validating root ownership and stored task limits.
   * @param request - exact root, delegate tasks, evaluator preset, budgets, report, and cancellation.
   * @returns an owned run whose result resolves after full child cleanup.
   */
  start(request: AgentOrchestrationStartRequest): AgentOrchestrationRun {
    this.assertStart(request)
    const id = brandString<AgentOrchestrationRunId>(`orchestration-${randomUUID()}`)
    const run = new OrchestrationRunController(this.ctx, this.resolved, request, id, (snapshot) => { this.publish(snapshot) })
    this.controllers.set(id, run)
    this.snapshots.set(id, run.snapshot())
    return run
  }

  /**
   * Read one active or retained settled snapshot.
   * @param id - orchestration run id.
   * @returns the current snapshot, or undefined after eviction/no such run.
   */
  status(id: AgentOrchestrationRunId): AgentOrchestrationSnapshot | undefined {
    return this.snapshots.get(id)
  }

  /**
   * Cancel one known run and return its latest snapshot without waiting for settlement.
   * @param id - orchestration run id.
   * @param reason - safe cancellation reason.
   * @returns the snapshot after cancellation admission.
   */
  cancel(id: AgentOrchestrationRunId, reason?: string): AgentOrchestrationSnapshot {
    const run = this.controllers.get(id)
    if (run === undefined) throw new AgentOrchestratorError(`unknown orchestration run "${id}"`, 'ORCHESTRATION_NOT_FOUND')
    run.cancel(reason)
    return run.snapshot()
  }

  private assertStart(request: AgentOrchestrationStartRequest): void {
    if (this.ctx.agents.get(request.parent.id) !== request.parent
      || this.ctx.subagents.rootOf(request.parent) !== request.parent) {
      throw new AgentOrchestratorError('orchestration requires the exact live root Agent', 'ORCHESTRATION_NESTED')
    }
    if (request.objective.trim() === '' || request.assignments.length === 0
      || !Number.isSafeInteger(request.maxIterations) || request.maxIterations < 1 || request.maxIterations > 10
      || !Number.isSafeInteger(request.maxParallel) || request.maxParallel < 1 || request.maxParallel > 10) {
      throw new AgentOrchestratorError('orchestration requires an objective, assignments, and budgets from 1 to 10', 'ORCHESTRATION_INVALID_REQUEST')
    }
    const ids = new Set<string>()
    for (const assignment of request.assignments) {
      if (assignment.id.trim() === '' || assignment.prompt.trim() === '' || ids.has(assignment.id)
        || assignment.agentPreset !== undefined && assignment.agentPreset.trim() === '') {
        throw new AgentOrchestratorError('assignment ids must be unique and every task must be non-empty', 'ORCHESTRATION_INVALID_REQUEST')
      }
      ids.add(assignment.id)
    }
    if (request.evaluatorPreset !== undefined && request.evaluatorPreset.trim() === '') {
      throw new AgentOrchestratorError('evaluatorPreset must be non-empty when supplied', 'ORCHESTRATION_INVALID_REQUEST')
    }
    if (request.report !== undefined) {
      if (request.report.title.trim() === '' || request.report.details.some(detail => detail.label.trim() === '')) {
        throw new AgentOrchestratorError('report title and detail labels must be non-empty', 'ORCHESTRATION_INVALID_REQUEST')
      }
      if (this.ctx.get('pdfReports') === undefined) {
        throw new AgentOrchestratorError('orchestration report requires the pdfReports service', 'ORCHESTRATION_REPORT_UNAVAILABLE')
      }
    }
  }

  private publish(snapshot: AgentOrchestrationSnapshot): void {
    this.snapshots.set(snapshot.id, snapshot)
    if (snapshot.status === 'queued' || snapshot.status === 'running') return
    this.controllers.delete(snapshot.id)
    for (const [id, candidate] of this.snapshots) {
      if (this.snapshots.size <= this.resolved.maxSettledRuns) break
      if (candidate.status !== 'queued' && candidate.status !== 'running') this.snapshots.delete(id)
    }
  }
}

export default AgentOrchestrator
