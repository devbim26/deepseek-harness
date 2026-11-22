import { describe, expect, it } from 'vitest'
import { harness } from './harness.ts'
import { agentOn } from '../../agent-preset-registry/tests/harness.ts'
import type { OrchestrationEntry } from '../src/config.ts'

const orchestration: OrchestrationEntry = {
  engine: { name: '@deepseek-ai/dsh-agent-orchestrator', config: { provider: 'spawn' } },
  tool: { name: '@deepseek-ai/dsh-tool-agent-orchestrator' },
  pdf: { name: '@deepseek-ai/dsh-tool-pdf' },
  present: { name: '@deepseek-ai/dsh-tool-present' },
}

describe('conversational orchestration preset synthesis', () => {
  it('mounts engine, tool, PDF and present with stored delegates and defaults', async () => {
    const { ctx } = await harness({ orchestration })
    const worker = await ctx.customAgentPresets.create({ name: 'Worker', description: 'Reviews drawings', instructions: 'Review.', tools: [], isOrchestrator: false, delegates: [], hidden: false })
    const lead = await ctx.customAgentPresets.create({ name: 'Lead', description: '', instructions: 'Coordinate.', tools: [], isOrchestrator: true, delegates: [worker.id], hidden: false })
    const document = await ctx.agentPresets.readDocument(lead.id)
    expect(document.content).toContain('dsh-agent-orchestrator')
    expect(document.content).toContain('dsh-tool-agent-orchestrator')
    expect(document.content).toContain('dsh-tool-pdf')
    expect(document.content).toContain('dsh-tool-present')
    expect(document.content).toContain('maxIterations')
    expect(document.content).toContain('maxParallel')
    expect(document.content).not.toContain('dsh-tool-subagent')
    expect(document.content).not.toContain('rosterTemplate')
    const agent = await agentOn(ctx, 'orchestration-real', lead.id)
    expect(ctx.agentPresets.serviceFor(agent, 'agentOrchestrator')).toBeDefined()
    expect(ctx.agentPresets.serviceFor(agent, 'pdfReports')).toBeDefined()
    expect(ctx.agentPresets.serviceFor(agent, 'fileDeliveries')).toBeDefined()
    expect(document.content.match(/dsh-tool-pdf/g)).toHaveLength(1)
    expect(document.content.match(/dsh-tool-present/g)).toHaveLength(1)
  }, 20000)

  it('deduplicates PDF and present by package name across base and selected tools', async () => {
    const { ctx } = await harness({
      orchestration,
      basePlugins: [{ id: 'base-pdf', name: '@deepseek-ai/dsh-tool-pdf', config: { maxImages: 2, maxImageBytes: 1024 } }],
      allowedTools: { present: { name: '@deepseek-ai/dsh-tool-present' } },
    })
    const worker = await ctx.customAgentPresets.create({ name: 'Worker', description: '', instructions: 'Review.', tools: [], isOrchestrator: false, delegates: [], hidden: false })
    const lead = await ctx.customAgentPresets.create({ name: 'Lead', description: '', instructions: 'Coordinate.', tools: ['present'], isOrchestrator: true, delegates: [worker.id], hidden: false })
    const agent = await agentOn(ctx, 'orchestration-dedupe', lead.id)
    expect(ctx.agentPresets.serviceFor(agent, 'agentOrchestrator')).toBeDefined()
    const document = await ctx.agentPresets.readDocument(lead.id)
    expect(document.content.match(/dsh-tool-pdf/g)).toHaveLength(1)
    expect(document.content.match(/dsh-tool-present/g)).toHaveLength(1)
  })

  it('keeps the legacy delegation template when orchestration is not configured', async () => {
    const { ctx } = await harness()
    const worker = await ctx.customAgentPresets.create({ name: 'Worker', description: '', instructions: 'Review.', tools: [], isOrchestrator: false, delegates: [], hidden: false })
    const lead = await ctx.customAgentPresets.create({ name: 'Lead', description: '', instructions: 'Coordinate.', tools: [], isOrchestrator: true, delegates: [worker.id], hidden: false })
    await agentOn(ctx, 'legacy-delegation-real', lead.id)
    const document = await ctx.agentPresets.readDocument(lead.id)
    expect(document.content).toContain('dsh-tool-subagent')
    expect(document.content).not.toContain('dsh-tool-agent-orchestrator')
  })
})
