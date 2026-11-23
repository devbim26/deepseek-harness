import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentOrchestrationRun, AgentOrchestrationSnapshot } from '@deepseek-ai/dsh-agent-orchestrator'
import type AgentOrchestrator from '@deepseek-ai/dsh-agent-orchestrator'
import { agentOn } from '../../agent-preset-registry/tests/harness.ts'
import { harness } from './harness.ts'
import type { HarnessConfig } from './harness.ts'
import type { OrchestrationEntry } from '../src/config.ts'
import CustomAgentOrchestrations, { orchestrationSessionResource } from '../src/orchestration.ts'
import { standardConfig } from './harness.ts'

const fakeEngine = new URL('./fixtures/fake-agent-orchestrator.js', import.meta.url).href

const orchestration: OrchestrationEntry = {
  engine: { name: fakeEngine, service: 'agentOrchestrator' },
  tool: { name: '@deepseek-ai/dsh-tool-agent-orchestrator' },
  pdf: { name: '@deepseek-ai/dsh-tool-pdf' },
  present: { name: '@deepseek-ai/dsh-tool-present' },
}

interface FakeRequest {
  objective: string
  assignments: readonly { id: string; agentPreset: string; prompt: string }[]
  evaluatorPreset?: string
  maxIterations: number
  maxParallel: number
  report?: { title: string; details: readonly { label: string; value: string }[] }
}

interface FakeRuns {
  get(runId: string): { run: AgentOrchestrationRun; snapshot: AgentOrchestrationSnapshot } | undefined
}

interface FakeControls {
  rejectResult?: boolean
  disposeError?: Error
}

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose() })

async function remoteFixture(sessionId: string, config: Partial<HarnessConfig> = {}) {
  const { ctx } = await harness({ orchestration, ...config })
  contexts.push(ctx)
  const worker = await ctx.customAgentPresets.create({ name: 'Worker', description: 'Reviews', instructions: 'Review.', tools: [], isOrchestrator: false, delegates: [], hidden: false })
  const lead = await ctx.customAgentPresets.create({ name: 'Lead', description: '', instructions: 'Coordinate.', tools: [], isOrchestrator: true, delegates: [worker.id], hidden: false })
  await agentOn(ctx, sessionId, lead.id)
  return { ctx, worker, lead }
}

function engineFor(ctx: Context, sessionId: string): AgentOrchestrator {
  const agent = ctx.agents.get(SessionId(sessionId))
  if (agent === undefined) throw new Error(`missing agent ${sessionId}`)
  const engine = ctx.agentPresets.serviceFor(agent, 'agentOrchestrator')
  if (engine === undefined) throw new Error(`missing engine for ${sessionId}`)
  return engine
}

function fakeField<T>(engine: AgentOrchestrator, key: string): T {
  return Reflect.get(engine, key) as T
}

describe('custom agent orchestration remote', () => {
  it('resolves the Session resource for Remote authorization', () => {
    expect(orchestrationSessionResource({ sessionId: 'remote-resource' })).toBe('remote-resource')
  })

  it('starts a run for the live orchestrator root and returns its identity', async () => {
    const { ctx } = await harness({ orchestration })
    const worker = await ctx.customAgentPresets.create({ name: 'Worker', description: 'Reviews', instructions: 'Review.', tools: [], isOrchestrator: false, delegates: [], hidden: false })
    const lead = await ctx.customAgentPresets.create({ name: 'Lead', description: '', instructions: 'Coordinate.', tools: [], isOrchestrator: true, delegates: [worker.id], hidden: false })
    await agentOn(ctx, 'remote-lead', lead.id)
    const started = await ctx.customAgentOrchestrations.orchestrationStart({
      sessionId: 'remote-lead',
      objective: 'Inspect the drawings',
      assignments: [{ id: worker.id, prompt: 'Check sheet 1' }],
    }, new AbortController().signal)
    expect(started).toMatchObject({ runId: 'orchestration-1', status: 'complete', rounds: 1, summary: 'finished Inspect the drawings' })
    const status = await ctx.customAgentOrchestrations.orchestrationStatus({ sessionId: 'remote-lead', runId: started.runId })
    expect(status).toMatchObject({ runId: 'orchestration-1', status: 'complete' })
  })

  it('keeps the stored delegate subset and limits', async () => {
    const { ctx } = await harness({ orchestration })
    const worker = await ctx.customAgentPresets.create({ name: 'Worker', description: 'Reviews', instructions: 'Review.', tools: [], isOrchestrator: false, delegates: [], hidden: false })
    const lead = await ctx.customAgentPresets.create({ name: 'Lead', description: '', instructions: 'Coordinate.', tools: [], isOrchestrator: true, delegates: [worker.id], hidden: false, orchestratorMaxIterations: 5, orchestratorMaxParallel: 2 })
    await agentOn(ctx, 'remote-limits', lead.id)
    await ctx.customAgentOrchestrations.orchestrationStart({
      sessionId: 'remote-limits',
      objective: 'Inspect',
      assignments: [{ id: worker.id, prompt: 'Check sheet 1' }],
    }, new AbortController().signal)
    const engine = engineFor(ctx, 'remote-limits')
    expect(fakeField<FakeRequest[]>(engine, 'requests')[0]).toMatchObject({ maxIterations: 5, maxParallel: 2 })
    expect(fakeField<FakeRequest[]>(engine, 'requests')[0]).toMatchObject({ assignments: [{ id: worker.id, agentPreset: worker.id }] })
  })

  it('rejects a delegate outside the stored subset', async () => {
    const { ctx } = await harness({ orchestration })
    const worker = await ctx.customAgentPresets.create({ name: 'Worker', description: '', instructions: 'Review.', tools: [], isOrchestrator: false, delegates: [], hidden: false })
    const lead = await ctx.customAgentPresets.create({ name: 'Lead', description: '', instructions: 'Coordinate.', tools: [], isOrchestrator: true, delegates: [worker.id], hidden: false })
    await agentOn(ctx, 'remote-subset', lead.id)
    await expect(ctx.customAgentOrchestrations.orchestrationStart({
      sessionId: 'remote-subset',
      objective: 'Inspect',
      assignments: [{ id: 'custom/unlisted', prompt: 'Unauthorized' }],
    }, new AbortController().signal)).rejects.toMatchObject({ code: 'custom-agent-orchestrations/invalid' })
  })

  it('reports an unknown run instead of a stale success', async () => {
    const { ctx } = await harness({ orchestration })
    const worker = await ctx.customAgentPresets.create({ name: 'Worker', description: '', instructions: 'Review.', tools: [], isOrchestrator: false, delegates: [], hidden: false })
    const lead = await ctx.customAgentPresets.create({ name: 'Lead', description: '', instructions: 'Coordinate.', tools: [], isOrchestrator: true, delegates: [worker.id], hidden: false })
    await agentOn(ctx, 'remote-unknown', lead.id)
    await expect(ctx.customAgentOrchestrations.orchestrationStatus({ sessionId: 'remote-unknown', runId: 'orchestration-404' }))
      .rejects.toMatchObject({ code: 'custom-agent-orchestrations/not-found' })
    await expect(ctx.customAgentOrchestrations.orchestrationCancel({ sessionId: 'remote-unknown', runId: 'orchestration-404' }))
      .rejects.toMatchObject({ code: 'custom-agent-orchestrations/not-found' })
  })

  it('refuses a Session whose composed preset is not an orchestrator', async () => {
    const { ctx } = await harness({ orchestration })
    const worker = await ctx.customAgentPresets.create({ name: 'Worker', description: '', instructions: 'Review.', tools: [], isOrchestrator: false, delegates: [], hidden: false })
    await agentOn(ctx, 'remote-plain', worker.id)
    await expect(ctx.customAgentOrchestrations.orchestrationStart({
      sessionId: 'remote-plain', objective: 'Inspect',
    }, new AbortController().signal)).rejects.toMatchObject({ code: 'custom-agent-orchestrations/invalid' })
  })

  it('forwards default assignments, report metadata, and evaluator preset', async () => {
    const { ctx, worker } = await remoteFixture('remote-report', { orchestration: { ...orchestration, evaluatorPreset: 'custom/evaluator' } })
    await ctx.customAgentOrchestrations.orchestrationStart({
      sessionId: 'remote-report', objective: 'Inspect', circumstances: 'House 12',
      report: { title: 'Custom report', details: [{ label: 'House', value: '12' }] },
    }, new AbortController().signal)
    const engine = engineFor(ctx, 'remote-report')
    expect(fakeField<FakeRequest[]>(engine, 'requests')[0]).toMatchObject({
      evaluatorPreset: 'custom/evaluator',
      report: { title: 'Custom report', details: [{ label: 'House', value: '12' }] },
    })
    expect(fakeField<FakeRequest[]>(engine, 'requests')[0]?.assignments[0]).toMatchObject({ id: worker.id, agentPreset: worker.id })
    expect(fakeField<FakeRequest[]>(engine, 'requests')[0]?.assignments[0]?.prompt).toContain('Perform the part of the objective')
  })

  it('omits reporting when disabled or the supplied title is blank', async () => {
    const { ctx, lead } = await remoteFixture('remote-no-report')
    await ctx.customAgentOrchestrations.orchestrationStart({
      sessionId: 'remote-no-report', objective: 'Inspect', report: { title: ' ', details: [] },
    }, new AbortController().signal)
    expect(fakeField<FakeRequest[]>(engineFor(ctx, 'remote-no-report'), 'requests')[0]?.report).toBeUndefined()
    await ctx.customAgentPresets.update(lead.id, {
      name: lead.name, description: lead.description, instructions: lead.instructions,
      tools: [], isOrchestrator: true, delegates: lead.delegates, hidden: false, orchestratorAutoReport: false,
    }, lead.version)
    await agentOn(ctx, 'remote-report-disabled', lead.id)
    await ctx.customAgentOrchestrations.orchestrationStart({ sessionId: 'remote-report-disabled', objective: 'Inspect' }, new AbortController().signal)
    expect(fakeField<FakeRequest[]>(engineFor(ctx, 'remote-report-disabled'), 'requests')[0]?.report).toBeUndefined()
  })

  it('cancels a known run and bounds the projected snapshot', async () => {
    const { ctx } = await remoteFixture('remote-cancel')
    const started = await ctx.customAgentOrchestrations.orchestrationStart({ sessionId: 'remote-cancel', objective: 'Inspect' }, new AbortController().signal)
    const engine = engineFor(ctx, 'remote-cancel')
    const stored = fakeField<FakeRuns>(engine, 'runs').get(started.runId)!
    Object.assign(stored.snapshot, {
      summary: 'x'.repeat(2_100),
      gaps: Array.from({ length: 25 }, (_, index) => `gap-${index}`),
      workers: [{ ...stored.snapshot.workers[0]!, childId: SessionId('worker-child') }],
      pdf: { path: '/workspace/report.pdf', name: 'report.pdf', bytes: 100, pages: 1 },
    })
    const cancelled = await ctx.customAgentOrchestrations.orchestrationCancel({ sessionId: 'remote-cancel', runId: started.runId })
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.summary).toHaveLength(2_000)
    expect(cancelled.gaps).toHaveLength(20)
    expect(cancelled.pdf).toMatchObject({ name: 'report.pdf' })
    await expect(ctx.customAgentOrchestrations.orchestrationStatus({ sessionId: 'remote-cancel', runId: started.runId }))
      .resolves.toMatchObject({ status: 'cancelled' })
  })

  it('reports a missing engine snapshot and contains a rejected run result', async () => {
    const { ctx } = await remoteFixture('remote-missing-snapshot')
    const engine = engineFor(ctx, 'remote-missing-snapshot')
    fakeField<FakeControls>(engine, 'controls').rejectResult = true
    const started = await ctx.customAgentOrchestrations.orchestrationStart({ sessionId: 'remote-missing-snapshot', objective: 'Inspect' }, new AbortController().signal)
    expect(started.runId).toBe('orchestration-1')
    vi.spyOn(engine, 'status').mockReturnValue(undefined)
    await expect(ctx.customAgentOrchestrations.orchestrationStatus({ sessionId: 'remote-missing-snapshot', runId: started.runId }))
      .rejects.toMatchObject({ code: 'custom-agent-orchestrations/not-found' })
    await expect(ctx.customAgentOrchestrations.orchestrationCancel({ sessionId: 'remote-missing-snapshot', runId: started.runId }))
      .rejects.toMatchObject({ code: 'custom-agent-orchestrations/not-found' })
  })

  it('rejects a start whose engine snapshot is already unavailable', async () => {
    const { ctx } = await remoteFixture('remote-start-missing-snapshot')
    vi.spyOn(engineFor(ctx, 'remote-start-missing-snapshot'), 'status').mockReturnValue(undefined)
    await expect(ctx.customAgentOrchestrations.orchestrationStart({ sessionId: 'remote-start-missing-snapshot', objective: 'Inspect' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'custom-agent-orchestrations/not-found' })
  })

  it('rejects aborted starts, empty objectives, and empty or duplicate delegate lists', async () => {
    const { ctx, worker } = await remoteFixture('remote-validation')
    const controller = new AbortController()
    controller.abort()
    await expect(ctx.customAgentOrchestrations.orchestrationStart({ sessionId: 'remote-validation', objective: 'Inspect' }, controller.signal)).rejects.toThrow()
    await expect(ctx.customAgentOrchestrations.orchestrationStart({ sessionId: 'remote-validation', objective: ' ' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'custom-agent-orchestrations/invalid' })
    await expect(ctx.customAgentOrchestrations.orchestrationStart({ sessionId: 'remote-validation', objective: 'Inspect', assignments: [] }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'custom-agent-orchestrations/invalid' })
    await expect(ctx.customAgentOrchestrations.orchestrationStart({
      sessionId: 'remote-validation', objective: 'Inspect', assignments: [{ id: worker.id, prompt: 'one' }, { id: worker.id, prompt: 'two' }],
    }, new AbortController().signal)).rejects.toMatchObject({ code: 'custom-agent-orchestrations/invalid' })
  })

  it('rejects missing, non-root, preset-less, and non-stored owners', async () => {
    const { ctx, lead } = await remoteFixture('remote-owners')
    await expect(ctx.customAgentOrchestrations.orchestrationStart({ sessionId: 'remote-missing', objective: 'Inspect' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'custom-agent-orchestrations/unavailable' })
    const child = await ctx.subagents.startActivation({
      provider: 'spawn', label: 'nested', delivery: 'caller', parent: ctx.agents.get(SessionId('remote-owners'))!,
      prompt: [{ type: 'text', text: 'work' }], signal: new AbortController().signal,
    })
    await expect(ctx.customAgentOrchestrations.orchestrationStart({ sessionId: child.childId, objective: 'Inspect' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'custom-agent-orchestrations/invalid' })
    await child.dispose()
    await ctx.agentLoop.create(SessionId('remote-no-preset'), { provider: 'mock', model: 'mock' })
    await expect(ctx.customAgentOrchestrations.orchestrationStart({ sessionId: 'remote-no-preset', objective: 'Inspect' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'custom-agent-orchestrations/invalid' })
    await ctx.agentPresets.register({ id: 'external', plugins: [] })
    await agentOn(ctx, 'remote-external', 'external')
    await expect(ctx.customAgentOrchestrations.orchestrationStart({ sessionId: 'remote-external', objective: 'Inspect' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'custom-agent-orchestrations/invalid' })
    expect(lead.isOrchestrator).toBe(true)
  })

  it('rejects an orchestrator whose delegate list became empty', async () => {
    const { ctx, worker, lead } = await remoteFixture('remote-empty-delegates')
    await ctx.customAgentPresets.remove(worker.id, worker.version)
    expect((await ctx.customAgentPresets.remoteExportList()).agents.find(agent => agent.id === lead.id)?.delegates).toEqual([])
    await expect(ctx.customAgentOrchestrations.orchestrationStart({ sessionId: 'remote-empty-delegates', objective: 'Inspect' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'custom-agent-orchestrations/invalid' })
  })

  it('reports an unavailable scoped engine', async () => {
    const { ctx } = await harness()
    contexts.push(ctx)
    await ctx.plugin(CustomAgentOrchestrations, standardConfig)
    const worker = await ctx.customAgentPresets.create({ name: 'Worker', description: '', instructions: 'Review.', tools: [], isOrchestrator: false, delegates: [], hidden: false })
    const lead = await ctx.customAgentPresets.create({ name: 'Lead', description: '', instructions: 'Coordinate.', tools: [], isOrchestrator: true, delegates: [worker.id], hidden: false })
    await agentOn(ctx, 'remote-no-engine', lead.id)
    await expect(ctx.customAgentOrchestrations.orchestrationStart({ sessionId: 'remote-no-engine', objective: 'Inspect' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'custom-agent-orchestrations/unavailable' })
  })

  it('contains run disposal failures during service teardown', async () => {
    const { ctx } = await remoteFixture('remote-dispose')
    const started = await ctx.customAgentOrchestrations.orchestrationStart({ sessionId: 'remote-dispose', objective: 'Inspect' }, new AbortController().signal)
    const stored = fakeField<FakeRuns>(engineFor(ctx, 'remote-dispose'), 'runs').get(started.runId)!
    vi.spyOn(stored.run, 'dispose').mockRejectedValue(new Error('dispose failed'))
    await ctx.fiber.dispose()
  })
})
