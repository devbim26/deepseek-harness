import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { agentOn } from '../../agent-preset-registry/tests/harness.ts'
import { harness } from './harness.ts'
import type { OrchestrationEntry } from '../src/config.ts'

const fakeEngine = new URL('./fixtures/fake-agent-orchestrator.js', import.meta.url).href

const orchestration: OrchestrationEntry = {
  engine: { name: fakeEngine, service: 'agentOrchestrator' },
  tool: { name: '@deepseek-ai/dsh-tool-agent-orchestrator' },
  pdf: { name: '@deepseek-ai/dsh-tool-pdf' },
  present: { name: '@deepseek-ai/dsh-tool-present' },
}

describe('custom agent orchestration remote', () => {
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
    const engine = ctx.agentPresets.serviceFor(await ctx.agents.get(SessionId('remote-limits'))!, 'agentOrchestrator') as unknown as { requests: unknown[] }
    expect(engine.requests[0]).toMatchObject({ maxIterations: 5, maxParallel: 2 })
    expect(engine.requests[0]).toMatchObject({ assignments: [{ id: worker.id, agentPreset: worker.id }] })
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
  })

  it('refuses a Session whose composed preset is not an orchestrator', async () => {
    const { ctx } = await harness({ orchestration })
    const worker = await ctx.customAgentPresets.create({ name: 'Worker', description: '', instructions: 'Review.', tools: [], isOrchestrator: false, delegates: [], hidden: false })
    await agentOn(ctx, 'remote-plain', worker.id)
    await expect(ctx.customAgentOrchestrations.orchestrationStart({
      sessionId: 'remote-plain', objective: 'Inspect',
    }, new AbortController().signal)).rejects.toMatchObject({ code: 'custom-agent-orchestrations/invalid' })
  })
})
