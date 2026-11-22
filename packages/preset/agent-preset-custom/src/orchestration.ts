/** Remote adapter for stored conversational orchestrations. */
import { Context, Service } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AgentOrchestrationRunId } from '@deepseek-ai/dsh-agent-orchestrator'
import type { AgentOrchestrationRun, AgentOrchestrationSnapshot } from '@deepseek-ai/dsh-agent-orchestrator'
import type {} from '@deepseek-ai/dsh-subagent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Config } from './config.ts'
import type {
  CustomAgentOrchestrationRunRequest,
  CustomAgentOrchestrationStartRequest,
  CustomAgentOrchestrationStatusValue,
  CustomAgentRecord,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    customAgentOrchestrations: CustomAgentOrchestrations
  }
}

const invalid = (reason: string) => new RemoteError('custom-agent-orchestrations/invalid', reason, { reason })
const unavailable = (reason: string) => new RemoteError('custom-agent-orchestrations/unavailable', reason, { reason })

/** Remote facade over the scoped orchestration engine of one stored orchestrator. */
export class CustomAgentOrchestrations extends TypertRemoteService {
  static inject = ['agentPresets', 'agents', 'customAgentPresets', 'subagents']

  private readonly runs = new Map<string, AgentOrchestrationRun>()

  /** @param ctx - Host context carrying the agent, preset, and subagent services. */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'customAgentOrchestrations')
  }

  protected async [Service.init](): Promise<void> {
    this.ctx.effect(() => async () => {
      const runs = [...this.runs.values()]
      this.runs.clear()
      await Promise.allSettled(runs.map(run => run.dispose()))
    }, 'custom-agent-orchestrations.dispose')
  }

  /**
   * Start one foreground orchestration run for a stored orchestrator Session.
   * @param request - Session, objective, optional circumstances, delegate subset, and report metadata.
   * @param signal - admission cancellation; the run itself outlives this call.
   * @returns the run identity and its first snapshot.
   */
  @Remote({ name: 'orchestrationStart', resources: { session: request => SessionId(request.sessionId) } })
  async orchestrationStart(
    request: CustomAgentOrchestrationStartRequest,
    signal: AbortSignal,
  ): Promise<CustomAgentOrchestrationStatusValue> {
    signal.throwIfAborted()
    if (request.objective.trim() === '') throw invalid('The objective must not be empty')
    const agent = this.liveRoot(request.sessionId)
    const record = this.orchestratorRecord(agent)
    const engine = this.ctx.agentPresets.serviceFor(agent, 'agentOrchestrator')
    if (engine === undefined) throw unavailable('The orchestrator preset does not provide an orchestration engine')
    const assignments = this.assignments(record, request)
    const report = this.report(record, request)
    const run = engine.start({
      parent: agent,
      objective: request.objective,
      ...request.circumstances === undefined ? {} : { circumstances: request.circumstances },
      assignments,
      ...this.config.orchestration?.evaluatorPreset === undefined ? {} : { evaluatorPreset: this.config.orchestration.evaluatorPreset },
      maxIterations: record.orchestratorMaxIterations,
      maxParallel: record.orchestratorMaxParallel,
      ...report === undefined ? {} : { report },
    })
    this.runs.set(this.key(request.sessionId, run.id), run)
    void run.result.catch(() => undefined)
    return this.value(run.id, engine.status(run.id))
  }

  /**
   * Read the current state of one run owned by this process.
   * @param request - Session and run identity.
   * @returns the latest snapshot.
   */
  @Remote({ name: 'orchestrationStatus', resources: { session: request => SessionId(request.sessionId) } })
  async orchestrationStatus(request: CustomAgentOrchestrationRunRequest): Promise<CustomAgentOrchestrationStatusValue> {
    const run = this.runs.get(this.key(request.sessionId, request.runId))
    if (run === undefined) throw this.unknownRun(request.runId)
    const agent = this.liveRoot(request.sessionId)
    const engine = this.ctx.agentPresets.serviceFor(agent, 'agentOrchestrator')
    const snapshot = engine?.status(AgentOrchestrationRunId(request.runId))
    if (snapshot === undefined) throw this.unknownRun(request.runId)
    return this.value(request.runId, snapshot)
  }

  /**
   * Cancel one run owned by this process.
   * @param request - Session and run identity.
   * @returns the snapshot after cancellation admission.
   */
  @Remote({ name: 'orchestrationCancel', resources: { session: request => SessionId(request.sessionId) } })
  async orchestrationCancel(request: CustomAgentOrchestrationRunRequest): Promise<CustomAgentOrchestrationStatusValue> {
    const run = this.runs.get(this.key(request.sessionId, request.runId))
    if (run === undefined) throw this.unknownRun(request.runId)
    const agent = this.liveRoot(request.sessionId)
    const engine = this.ctx.agentPresets.serviceFor(agent, 'agentOrchestrator')
    run.cancel('orchestration cancelled by the caller')
    const snapshot = engine?.status(AgentOrchestrationRunId(request.runId))
    if (snapshot === undefined) throw this.unknownRun(request.runId)
    return this.value(request.runId, snapshot)
  }

  private unknownRun(runId: string): RemoteError<'custom-agent-orchestrations/not-found'> {
    return new RemoteError('custom-agent-orchestrations/not-found', `Unknown orchestration run: ${runId}`, { runId })
  }

  private key(sessionId: string, runId: string): string {
    return `${sessionId}${runId}`
  }

  private liveRoot(sessionId: string): Agent {
    const agent = this.ctx.agents.get(SessionId(sessionId))
    if (agent === undefined) throw unavailable('The Session has no live Agent')
    if (this.ctx.subagents.rootOf(agent) !== agent) throw invalid('Only the exact live root Agent may own an orchestration')
    return agent
  }

  private orchestratorRecord(agent: Agent): CustomAgentRecord {
    const presetId = this.ctx.agentPresets.composedPreset(agent.ctx)
    if (presetId === undefined) throw invalid('The Session has no composed agent preset')
    const record = this.ctx.customAgentPresets.record(presetId)
    if (record === undefined) throw invalid('The composed preset is not a stored custom agent')
    if (!record.isOrchestrator || record.delegates.length === 0) throw invalid('The composed preset is not a stored orchestrator')
    return record
  }

  private assignments(
    record: CustomAgentRecord,
    request: CustomAgentOrchestrationStartRequest,
  ): readonly { id: string; agentPreset: string; prompt: string }[] {
    const supplied = request.assignments
    if (supplied !== undefined && supplied.length === 0) throw invalid('Assignments must be omitted or contain at least one delegate')
    const selected = supplied ?? record.delegates.map(id => ({ id, prompt: '' }))
    const seen = new Set<string>()
    return selected.map((assignment) => {
      if (!record.delegates.includes(assignment.id)) throw invalid(`Unknown stored delegate: ${assignment.id}`)
      if (seen.has(assignment.id)) throw invalid(`Duplicate assignment: ${assignment.id}`)
      seen.add(assignment.id)
      const prompt = assignment.prompt.trim() === ''
        ? `Objective: ${request.objective}\n\nPerform the part of the objective that matches this delegate's role.`
        : `Objective: ${request.objective}\n\n${assignment.prompt}`
      return { id: assignment.id, agentPreset: assignment.id, prompt }
    })
  }

  private report(
    record: CustomAgentRecord,
    request: CustomAgentOrchestrationStartRequest,
  ): { title: string; details: readonly { label: string; value: string }[] } | undefined {
    if (!record.orchestratorAutoReport) return undefined
    const title = request.report?.title.trim() ?? request.objective
    if (title.trim() === '') return undefined
    return { title, details: request.report?.details ?? [] }
  }

  private value(runId: string, snapshot: AgentOrchestrationSnapshot | undefined): CustomAgentOrchestrationStatusValue {
    if (snapshot === undefined) throw this.unknownRun(runId)
    return {
      runId: snapshot.id,
      status: snapshot.status,
      rounds: snapshot.rounds,
      summary: snapshot.summary.slice(0, 2_000),
      workers: snapshot.workers.map(worker => ({
        assignmentId: worker.assignmentId,
        ...worker.childId === undefined ? {} : { childId: worker.childId },
        rounds: worker.rounds,
      })),
      gaps: snapshot.gaps.slice(0, 20),
      ...snapshot.pdf === undefined ? {} : { pdf: snapshot.pdf },
    }
  }
}

export default CustomAgentOrchestrations
