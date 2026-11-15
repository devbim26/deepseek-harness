import { describe, expect, it } from 'vitest'
import { harness } from './harness.ts'

describe('custom agent presets service', () => {
  it('serves an empty catalog and the deployment policy before any write', async () => {
    const { ctx } = await harness()
    const catalog = await ctx.customAgentPresets.remoteExportList()
    expect(catalog.agents).toEqual([])
    expect(catalog.policy).toMatchObject({
      allowedTools: ['ask-user', 'todo'],
      maxNameChars: 64,
      maxInstructionsChars: 16384,
      maxAgents: 50,
    })
  })

  it('creates a record, mounts it into the registry roster, and derives unique slugs', async () => {
    const { ctx } = await harness()
    const first = await ctx.customAgentPresets.create({ name: 'Сметчик', description: 'Считает объёмы.', instructions: 'Считай объёмы работ.', tools: ['todo'] })
    expect(first.id).toBe('custom/agent')
    expect(first.version).toBe(1)
    const second = await ctx.customAgentPresets.create({ name: 'Отчётчик', description: '', instructions: 'Собирай отчёт.', tools: [] })
    expect(second.id).toBe('custom/agent-2')
    const roster = await ctx.agentPresets.remoteExportList()
    const row = roster.presets.find(preset => preset.id === 'custom/agent')
    expect(row).toMatchObject({ name: 'Сметчик', description: 'Считает объёмы.' })
  })

  it('synthesizes the persona prefix, base rows, and whitelisted tool rows', async () => {
    const { ctx } = await harness()
    const created = await ctx.customAgentPresets.create({ name: 'Helper', description: '', instructions: 'Be brief.', tools: ['todo'] })
    const document = await ctx.agentPresets.readDocument(created.id)
    expect(document.content).toContain('You are the drawings assistant. Be brief.')
    expect(document.content).toContain('dsh-tool-todo')
  })

  it('replaces the definition on update and drops it on delete', async () => {
    const { ctx } = await harness()
    const created = await ctx.customAgentPresets.create({ name: 'Helper', description: 'v1', instructions: 'v1', tools: [] })
    const updated = await ctx.customAgentPresets.update(created.id, { name: 'Helper', description: 'v2', instructions: 'v2', tools: ['todo'] }, created.version)
    expect(updated.version).toBe(2)
    const roster = await ctx.agentPresets.remoteExportList()
    expect(roster.presets.find(preset => preset.id === created.id)).toMatchObject({ description: 'v2' })
    await ctx.customAgentPresets.remove(created.id, updated.version)
    const after = await ctx.agentPresets.remoteExportList()
    expect(after.presets.find(preset => preset.id === created.id)).toBeUndefined()
  })

  it('rejects stale versions, over-cap creates, and unknown identities with coded errors', async () => {
    const { ctx } = await harness({ maxAgents: 1 })
    const created = await ctx.customAgentPresets.create({ name: 'Helper', description: '', instructions: 'x', tools: [] })
    await expect(ctx.customAgentPresets.update(created.id, { name: 'Helper', description: '', instructions: 'y', tools: [] }, created.version - 1))
      .rejects.toMatchObject({ code: 'custom-agent-presets/conflict' })
    await expect(ctx.customAgentPresets.remove('custom/missing', 1))
      .rejects.toMatchObject({ code: 'custom-agent-presets/not-found' })
    await expect(ctx.customAgentPresets.create({ name: 'Second', description: '', instructions: 'x', tools: [] }))
      .rejects.toMatchObject({ code: 'custom-agent-presets/limit' })
  })
})
