import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { toolCallResponse, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { STRUCTURED_OUTPUT_TOOL } from '@deepseek-ai/dsh-subagent'
import { engineFixture, type EngineFixture, type EngineScript } from '../../agent-orchestrator/tests/harness.ts'
import * as ToolOrchestrator from '../src/index.ts'
import * as ToolPresent from '@deepseek-ai/dsh-tool-present'

const fixtures: EngineFixture[] = []
let callId = 0
afterEach(async () => { for (const fixture of fixtures.splice(0).reverse()) await fixture.dispose() })

function worker(answer = 'done') {
  return toolCallResponse(`worker-${answer}`, STRUCTURED_OUTPUT_TOOL, {
    summary: answer, evidence: ['evidence'], assumptions: [], gaps: [],
  })
}

function complete(summary = 'complete') {
  return toolCallResponse('evaluator-complete', STRUCTURED_OUTPUT_TOOL, {
    kind: 'complete', summary, assumptions: [], gaps: [],
  })
}

function config(overrides: Partial<ToolOrchestrator.Config> = {}): ToolOrchestrator.Config {
  return {
    delegates: [{ id: 'worker', name: 'Worker', description: 'Inspect the drawing' }],
    maxIterations: 3,
    maxParallel: 1,
    autoReport: false,
    maxSummaryChars: 100,
    maxGapCount: 2,
    maxGapChars: 20,
    ...overrides,
  }
}

async function setup(
  script: EngineScript,
  overrides: Partial<ToolOrchestrator.Config> = {},
  options: { present?: boolean; pdf?: boolean } = {},
) {
  const fixture = await engineFixture(script, { pdf: options.present === true || options.pdf === true, presets: ['worker'] })
  fixtures.push(fixture)
  if (options.present === true) await fixture.ctx.plugin(ToolPresent, { maxFiles: 2 })
  const fiber = fixture.ctx.plugin(ToolOrchestrator, config(overrides))
  await fiber
  const execute = (args: unknown) => executeToolFixture(fixture.ctx, {
    signal: new AbortController().signal,
    callId: ToolCallId(`orchestration-${++callId}`),
    name: 'orchestrate_agents', arguments: args, agent: fixture.parent,
  })
  return { fixture, execute, fiber }
}

describe('orchestrate_agents', () => {
  it('exposes objective, circumstances, and optional assignments but no model or budget controls', async () => {
    const { fixture } = await setup([worker(), complete()])
    const schema = fixture.ctx.tools.schemas().find(candidate => candidate.name === 'orchestrate_agents')
    expect(schema).toBeDefined()
    expect(Object.keys(schema!.parameters.properties ?? {}).sort()).toEqual(['assignments', 'circumstances', 'objective'])
    expect(JSON.stringify(schema)).not.toContain('maxIterations')
    expect(JSON.stringify(schema)).not.toContain('evaluatorPreset')
  })

  it('uses stored delegates and limits and returns a bounded domain outcome', async () => {
    const { execute, fixture } = await setup([
      worker('short'), complete(`start${'x'.repeat(200)}end`),
    ], { maxSummaryChars: 12, maxGapCount: 1, maxGapChars: 5 })
    const result = await execute({ objective: 'Inspect everything', circumstances: 'House 12' })
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(result.value).toMatchObject({ status: 'complete', rounds: 1, summary: 'startxxxxxxx' })
    expect(result.value).toHaveProperty('workers', [{ assignmentId: 'worker', childId: expect.any(String), rounds: 1 }])
    expect(result.meta).toMatchObject({ kind: 'agent-orchestration', status: 'complete', rounds: 1 })
    expect(result.meta).not.toHaveProperty('pdf')
    expect(fixture.ctx.tools.get('orchestrate_agents', fixture.parent)?.isConcurrencySafe?.({ objective: 'Inspect' })).toBe(true)
  })

  it('rejects assignments outside the stored delegate subset before starting work', async () => {
    const { execute, fixture } = await setup([])
    const result = await execute({
      objective: 'Inspect', assignments: [{ id: 'unlisted', prompt: 'Do unauthorized work' }],
    })
    expect(result.isError).toBe(true)
    expect(result.error?.info).toEqual({ name: 'AgentOrchestratorError', code: 'ORCHESTRATION_INVALID_REQUEST' })
    expect(fixture.adapter.requests).toHaveLength(0)
  })

  it('does not report evaluator failure as a successful domain outcome', async () => {
    const { execute } = await setup([worker(), textResponse('malformed evaluator')])
    const result = await execute({ objective: 'Inspect' })
    expect(result.isError).toBe(true)
    expect(result.error?.info).toEqual({ name: 'AgentOrchestratorError', code: 'ORCHESTRATION_FAILED' })
  })

  it('presents the returned PDF only after a successful auto-report run', async () => {
    const { execute, fixture } = await setup([worker(), complete()], { autoReport: true }, { present: true })
    fixture.parent.session.append('turn/start', { turn: 1 })
    const result = await execute({ objective: 'Отчёт по дому' })
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(result.value).toHaveProperty('pdf.name', expect.stringMatching(/\.pdf$/))
    expect(result.meta).toMatchObject({ kind: 'agent-orchestration', status: 'complete', rounds: 1, pdf: { name: expect.stringMatching(/\.pdf$/) } })
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('PDF:') })
    expect(fixture.parent.session.snapshotEvents().filter(event => event.type === 'deliverables/presented')).toHaveLength(1)
  })

  it.each(['partial', 'budget-limited'] as const)('returns %s as a successful domain outcome', async (status) => {
    const decision = status === 'partial'
      ? toolCallResponse('evaluator-partial', STRUCTURED_OUTPUT_TOOL, { kind: 'partial', summary: 'partial', reason: 'missing', assumptions: [], gaps: ['gap'] })
      : toolCallResponse('evaluator-follow-up', STRUCTURED_OUTPUT_TOOL, { kind: 'follow-ups', followUps: [{ assignmentId: 'worker', question: 'more' }] })
    const { execute } = await setup([worker(), decision], { maxIterations: 1 })
    const result = await execute({ objective: 'Inspect' })
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(result.value).toHaveProperty('status', status)
  })

  it('guards the root before the first request and lifts the guard after cancellation', async () => {
    const { fixture } = await setup(['hang'])
    fixture.ctx.tools.register(defineTool({
      name: 'ask_user_question', description: 'Question fixture.', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { answered: { type: 'boolean', required: true } } }, render: () => [] },
      execute: async () => ({ answered: true }),
    }))
    const controller = new AbortController()
    const pending = executeToolFixture(fixture.ctx, {
      signal: controller.signal, callId: ToolCallId('orchestration-cancel'),
      name: 'orchestrate_agents', arguments: { objective: 'Inspect' }, agent: fixture.parent,
    })
    await vi.waitFor(() => expect(fixture.adapter.requests).toHaveLength(1))
    const ask = () => executeToolFixture(fixture.ctx, {
      signal: new AbortController().signal, callId: ToolCallId(`question-${++callId}`),
      name: 'ask_user_question', arguments: {}, agent: fixture.parent,
    })
    expect((await ask()).error?.info).toEqual({ name: 'AgentOrchestratorError', code: 'HUMAN_INPUT_FORBIDDEN' })
    controller.abort()
    expect((await pending).error?.info).toEqual({ name: 'AgentOrchestratorError', code: 'ORCHESTRATION_CANCELLED' })
    expect((await ask()).isError).toBe(false)
  })

  it('rejects empty objectives, empty assignment lists, and duplicate assignments', async () => {
    const { execute, fixture } = await setup([])
    for (const args of [
      { objective: ' ' },
      { objective: 'Inspect', assignments: [] },
      { objective: 'Inspect', assignments: [{ id: 'worker', prompt: 'one' }, { id: 'worker', prompt: 'two' }] },
    ]) {
      expect((await execute(args)).isError).toBe(true)
    }
    expect(fixture.adapter.requests).toHaveLength(0)
  })

  it('fails loudly for duplicate or blank stored delegate identities', () => {
    for (const delegates of [
      [{ id: 'worker', name: 'One', description: '' }, { id: 'worker', name: 'Two', description: '' }],
      [{ id: ' ', name: 'Worker', description: '' }],
      [{ id: 'worker', name: ' ', description: '' }],
    ]) {
      expect(() => ToolOrchestrator.apply(new Context(), config({ delegates })))
        .toThrow(expect.objectContaining({ code: 'ORCHESTRATION_INVALID_REQUEST' }))
    }
  })

  it('requires a calling Agent and an orchestration engine', async () => {
    const { fixture } = await setup([])
    const withoutAgent = await executeToolFixture(fixture.ctx, {
      signal: new AbortController().signal, callId: ToolCallId('orchestration-no-agent'),
      name: 'orchestrate_agents', arguments: { objective: 'Inspect' },
    })
    expect(withoutAgent.isError).toBe(true)

    const ctx = new Context()
    try {
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(ToolOrchestrator, config())
      const result = await executeToolFixture(ctx, {
        signal: new AbortController().signal, callId: ToolCallId('orchestration-no-engine'),
        name: 'orchestrate_agents', arguments: { objective: 'Inspect' }, agent: {} as Agent,
      })
      expect(result.isError).toBe(true)
      expect(result.error?.info?.name).toBe('ToolContextUnavailableError')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('requires file delivery when a report exists', async () => {
    const { execute } = await setup([worker(), complete()], { autoReport: true }, { pdf: true })
    const result = await execute({ objective: 'Report without delivery' })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.name).toBe('ToolContextUnavailableError')
  })

  it('bounds every returned gap and preserves custom assignment context', async () => {
    const decision = toolCallResponse('evaluator-gaps', STRUCTURED_OUTPUT_TOOL, {
      kind: 'complete', summary: 'done', assumptions: [], gaps: ['123456789', 'second'],
    })
    const { execute, fixture } = await setup([worker(), decision], { maxGapCount: 1, maxGapChars: 5 })
    const result = await execute({
      objective: 'Inspect', circumstances: 'House 12', assignments: [{ id: 'worker', prompt: 'Check custom sheet' }],
    })
    expect(result.value).toHaveProperty('gaps', ['12345'])
    expect(JSON.stringify(fixture.adapter.requests[0])).toContain('Check custom sheet')
    expect(JSON.stringify(fixture.adapter.requests[0])).toContain('House 12')
  })

  it('releases the human-question guard even when run disposal fails', async () => {
    const { execute, fixture } = await setup([worker(), complete()])
    const start = fixture.ctx.agentOrchestrator.start.bind(fixture.ctx.agentOrchestrator)
    vi.spyOn(fixture.ctx.agentOrchestrator, 'start').mockImplementation((request) => {
      const run = start(request)
      vi.spyOn(run, 'dispose').mockRejectedValue(new Error('dispose failed'))
      return run
    })
    fixture.ctx.tools.register(defineTool({
      name: 'ask_user_question', description: 'Question fixture.', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { answered: { type: 'boolean', required: true } } }, render: () => [] },
      execute: async () => ({ answered: true }),
    }))
    expect((await execute({ objective: 'Inspect' })).isError).toBe(true)
    const after = await executeToolFixture(fixture.ctx, {
      signal: new AbortController().signal, callId: ToolCallId('question-after-dispose-failure'),
      name: 'ask_user_question', arguments: {}, agent: fixture.parent,
    })
    expect(after.isError).toBe(false)
  })

  it('forwards an explicit evaluator preset and tolerates a worker without a child id', async () => {
    const { execute, fixture } = await setup([worker(), complete()], { evaluatorPreset: 'worker' })
    const start = fixture.ctx.agentOrchestrator.start.bind(fixture.ctx.agentOrchestrator)
    vi.spyOn(fixture.ctx.agentOrchestrator, 'start').mockImplementation((request) => {
      const run = start(request)
      Object.defineProperty(run, 'result', {
        value: run.result.then(result => ({
          ...result,
          workers: result.workers.map(worker => ({ assignmentId: worker.assignmentId, rounds: worker.rounds })),
        })),
      })
      return run
    })
    const result = await execute({ objective: 'Inspect' })
    expect(result.isError).toBe(false)
    expect(result.value).toHaveProperty('workers', [{ assignmentId: 'worker', rounds: 1 }])
  })

  it('releases the guard when engine.start fails before returning a run', async () => {
    const { execute, fixture } = await setup([])
    vi.spyOn(fixture.ctx.agentOrchestrator, 'start').mockImplementation(() => { throw new Error('start failed') })
    fixture.ctx.tools.register(defineTool({
      name: 'ask_user_question', description: 'Question fixture.', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { answered: { type: 'boolean', required: true } } }, render: () => [] },
      execute: async () => ({ answered: true }),
    }))
    expect((await execute({ objective: 'Inspect' })).isError).toBe(true)
    const after = await executeToolFixture(fixture.ctx, {
      signal: new AbortController().signal, callId: ToolCallId('question-after-start-failure'),
      name: 'ask_user_question', arguments: {}, agent: fixture.parent,
    })
    expect(after.isError).toBe(false)
  })

  it('removes the tool registration on fiber disposal', async () => {
    const { fixture, fiber } = await setup([])
    expect(fixture.ctx.tools.get('orchestrate_agents', fixture.parent)).toBeDefined()
    await fiber.dispose()
    expect(fixture.ctx.tools.get('orchestrate_agents', fixture.parent)).toBeUndefined()
  })
})
