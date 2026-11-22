/** Model-facing entry to a stored conversational orchestration preset. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { AgentOrchestrationAssignment, AgentOrchestrationRun } from '@deepseek-ai/dsh-agent-orchestrator'
import { defineTool, ToolArgsError, ToolContextUnavailableError } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-tool-present/types'
import { ToolAgentOrchestratorError } from './error.ts'
import type { OrchestrationToolResult } from './types.ts'

export type { OrchestrationToolPdf, OrchestrationToolResult, OrchestrationToolStatus, OrchestrationToolWorker } from './types.ts'

/** Stable Loader identity. */
export const name = 'tool-agent-orchestrator'

/** Tool registry; optional engine and delivery services resolve at execution. */
export const inject = ['tools']

/** One delegate stored in the owning custom-agent record. */
export interface OrchestrationDelegate {
  /** Identifier of the stored delegate; its preset id. */
  readonly id: string
  /** Display name of the delegate shown in the model-facing result. */
  readonly name: string
  /** One-line role description handed to the worker prompt. */
  readonly description: string
}

/** Deployment and stored-record settings; none are model-writable. */
export interface Config {
  /** Stored delegates this preset may run. */
  readonly delegates: readonly OrchestrationDelegate[]
  /** Preset used for the evaluator child; omission uses the orchestrator record. */
  readonly evaluatorPreset?: string | undefined
  /** Maximum worker/evaluator rounds, including the first. */
  readonly maxIterations: number
  /** Maximum simultaneously active worker Activations. */
  readonly maxParallel: number
  /** Whether a successful domain outcome creates a PDF report. */
  readonly autoReport: boolean
  /** Maximum characters of the summary returned to the model. */
  readonly maxSummaryChars: number
  /** Maximum gap entries returned to the model. */
  readonly maxGapCount: number
  /** Maximum characters per gap entry returned to the model. */
  readonly maxGapChars: number
}

/** Validated stored orchestration settings. */
export const Config: z<Config> = z.object({
  delegates: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), description: z.string() })).min(1).max(10),
  evaluatorPreset: (z.string().min(1) as z<string | undefined>).default(undefined),
  maxIterations: z.number().step(1).min(1).max(10).default(3),
  maxParallel: z.number().step(1).min(1).max(10).default(3),
  autoReport: z.boolean().default(true),
  maxSummaryChars: z.number().step(1).min(1).max(65_536).default(4_000),
  maxGapCount: z.number().step(1).min(0).max(100).default(32),
  maxGapChars: z.number().step(1).min(1).max(10_000).default(500),
}) as z<Config>

/** Optional assignment supplied by the model. */
interface AssignmentInput {
  readonly id: string
  readonly prompt: string
}

/** Optional model arguments after schema decoding. */
interface ToolInput {
  readonly objective: string
  readonly circumstances?: string | undefined
  readonly assignments?: readonly AssignmentInput[] | undefined
}

/** Register the stored orchestration preset as one model tool. */
export function apply(ctx: Context, config: Config): void {
  const ids = new Set<string>()
  for (const delegate of config.delegates) {
    if (delegate.id.trim() === '' || delegate.name.trim() === '' || ids.has(delegate.id)) {
      throw new ToolAgentOrchestratorError('orchestration delegates require unique non-empty ids and names', 'ORCHESTRATION_INVALID_REQUEST')
    }
    ids.add(delegate.id)
  }

  ctx.tools.register(defineTool({
    name: 'orchestrate_agents',
    description: 'Run the configured delegates and evaluator as one autonomous orchestration. The delegates work in parallel up to the stored limit, the evaluator can send targeted follow-ups on the same agent conversations, and the tool returns a consolidated result. Use this for a task that benefits from several specialist reviews; do not use it for a single delegate or a task you can complete directly.',
    parameters: {
      objective: { type: 'string', required: true, description: 'Complete user objective for the orchestration.' },
      circumstances: { type: 'string', description: 'Optional facts and constraints available at the start. Missing facts belong in the resulting gaps, not in a question to the user.' },
      assignments: {
        type: 'array',
        description: 'Optional subset of the configured delegates with a specific initial task for each. Omit to run every configured delegate.',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: 'Identifier of one configured delegate.' },
            prompt: { type: 'string', required: true, description: 'Specific initial task for this delegate within the objective.' },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          status: { type: 'string', required: true, enum: ['complete', 'partial', 'budget-limited'] },
          rounds: { type: 'integer', required: true },
          summary: { type: 'string', required: true },
          workers: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                assignmentId: { type: 'string', required: true },
                childId: { type: 'string' },
                rounds: { type: 'integer', required: true },
              },
            },
          },
          gaps: { type: 'array', required: true, items: { type: 'string' } },
          pdf: {
            type: 'object', additionalProperties: false,
            properties: {
              path: { type: 'string', required: true }, name: { type: 'string', required: true },
              bytes: { type: 'integer', required: true }, pages: { type: 'integer', required: true },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.status}: ${value.summary}${value.pdf === undefined ? '' : `\nPDF: ${value.pdf.path}`}` }],
      presentationMeta: (_args, value) => ({ kind: 'agent-orchestration', id: value.id, status: value.status, rounds: value.rounds, ...value.pdf === undefined ? {} : { pdf: value.pdf } }),
    },
    isConcurrencySafe: () => true,
    async execute(rawArgs, exec) {
      if (exec.agent === undefined) throw new ToolContextUnavailableError('orchestrate_agents requires a calling agent')
      const engine = ctx.get('agentPresets')?.serviceFor(exec.agent, 'agentOrchestrator') ?? ctx.get('agentOrchestrator')
      if (engine === undefined) throw new ToolContextUnavailableError('orchestrate_agents requires the agent-orchestrator service')
      const args = rawArgs as ToolInput
      const selected = selectAssignments(args, config.delegates)
      const liftGuard = ctx.tools.guard(execution => execution.name === 'ask_user_question'
        ? {
          reason: 'Human input is forbidden in this autonomous run. Record the unresolved fact as a gap and continue.',
          info: { name: 'AgentOrchestratorError', code: 'HUMAN_INPUT_FORBIDDEN' },
        }
        : undefined)
      let run: AgentOrchestrationRun | undefined
      try {
        run = engine.start({
          parent: exec.agent,
          objective: args.objective,
          ...args.circumstances === undefined ? {} : { circumstances: args.circumstances },
          assignments: selected,
          ...config.evaluatorPreset === undefined ? {} : { evaluatorPreset: config.evaluatorPreset },
          maxIterations: config.maxIterations,
          maxParallel: config.maxParallel,
          ...config.autoReport ? { report: { title: args.objective, details: [] } } : {},
          signal: exec.signal,
        })
        const result = await run.result
        if (result.status === 'failed') throw new ToolAgentOrchestratorError(result.summary, 'ORCHESTRATION_FAILED')
        if (result.status === 'cancelled') throw new ToolAgentOrchestratorError(result.summary, 'ORCHESTRATION_CANCELLED')
        if (config.autoReport && result.pdf !== undefined) {
          const deliveries = ctx.get('agentPresets')?.serviceFor(exec.agent, 'fileDeliveries') ?? ctx.get('fileDeliveries')
          if (deliveries === undefined) throw new ToolContextUnavailableError('orchestrate_agents auto-report requires the file-delivery service')
          await deliveries.present(exec.agent, [{ path: result.pdf.path, description: `Orchestration report: ${args.objective}` }], exec)
        }
        return {
          id: result.id,
          status: result.status,
          rounds: result.rounds,
          summary: result.summary.slice(0, config.maxSummaryChars),
          workers: result.workers.map(worker => ({
            assignmentId: worker.assignmentId,
            ...worker.childId === undefined ? {} : { childId: worker.childId },
            rounds: worker.rounds,
          })),
          gaps: result.gaps.slice(0, config.maxGapCount).map(gap => gap.slice(0, config.maxGapChars)),
          ...result.pdf === undefined ? {} : { pdf: result.pdf },
        } satisfies OrchestrationToolResult
      } finally {
        if (run !== undefined) await run.dispose()
        liftGuard()
      }
    },
  }))
}

/** Resolve the optional model subset against the stored delegates. */
function selectAssignments(args: ToolInput, delegates: readonly OrchestrationDelegate[]): AgentOrchestrationAssignment[] {
  if (args.objective.trim() === '') throw new ToolArgsError(['orchestrate_agents requires a non-empty objective'])
  const supplied = args.assignments
  if (supplied !== undefined && supplied.length === 0) throw new ToolArgsError(['assignments must be omitted or contain at least one delegate'])
  const selected = supplied ?? delegates.map(delegate => ({ id: delegate.id, prompt: '' }))
  const seen = new Set<string>()
  return selected.map((assignment) => {
    const delegate = delegates.find(candidate => candidate.id === assignment.id)
    if (delegate === undefined) throw new ToolAgentOrchestratorError(`unknown stored delegate "${assignment.id}"`, 'ORCHESTRATION_INVALID_REQUEST')
    if (seen.has(assignment.id)) throw new ToolAgentOrchestratorError(`duplicate assignment "${assignment.id}"`, 'ORCHESTRATION_INVALID_REQUEST')
    seen.add(assignment.id)
    const task = assignment.prompt.trim() === ''
      ? `Perform the part of the objective that matches your role: ${delegate.description}`
      : assignment.prompt
    return {
      id: delegate.id,
      agentPreset: delegate.id,
      prompt: [`Objective: ${args.objective}`, `Delegate: ${delegate.name} — ${delegate.description}`, task, ...args.circumstances === undefined ? [] : [`Circumstances: ${args.circumstances}`]].join('\n\n'),
    }
  })
}
