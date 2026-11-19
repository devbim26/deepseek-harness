import { describe, expect, it } from 'vitest'
import { harness } from './harness.ts'

describe('custom agent presets service', () => {
  it('serves an empty catalog and the deployment policy before any write', async () => {
    const { ctx } = await harness()
    const catalog = await ctx.customAgentPresets.remoteExportList()
    expect(catalog.agents).toEqual([])
    expect(catalog.policy).toMatchObject({
      allowedTools: [
        { key: 'ask-user', label: 'Ask the user' },
        { key: 'todo', label: 'Task list', description: 'Keep a task list.' },
      ],
      maxNameChars: 64,
      maxInstructionsChars: 16384,
      maxAgents: 50,
    })
  })

  it('defaults an omitted label to the key and omits an absent description', async () => {
    const { ctx } = await harness({
      allowedTools: { smeta: { name: '@deepseek-ai/dsh-mcp-client' } },
    })
    const catalog = await ctx.customAgentPresets.remoteExportList()
    const [option] = catalog.policy.allowedTools
    if (option === undefined) throw new Error('the policy lost the whitelisted option')
    expect(option).toEqual({ key: 'smeta', label: 'smeta' })
    expect('description' in option).toBe(false)
  })

  it('reports delegation availability from the deployment config', async () => {
    const { ctx } = await harness()
    expect((await ctx.customAgentPresets.remoteExportList()).policy.delegationAvailable).toBe(true)
    const plain = await harness({ delegation: undefined })
    expect((await plain.ctx.customAgentPresets.remoteExportList()).policy.delegationAvailable).toBe(false)
  })

  it('creates a record, mounts it into the registry roster, and derives unique slugs', async () => {
    const { ctx } = await harness()
    const first = await ctx.customAgentPresets.create({ name: 'Сметчик', description: 'Считает объёмы.', instructions: 'Считай объёмы работ.', tools: ['todo'], isOrchestrator: false, delegates: [], hidden: false })
    expect(first.id).toBe('custom/agent')
    expect(first.version).toBe(1)
    const second = await ctx.customAgentPresets.create({ name: 'Отчётчик', description: '', instructions: 'Собирай отчёт.', tools: [], isOrchestrator: false, delegates: [], hidden: false })
    expect(second.id).toBe('custom/agent-2')
    const roster = await ctx.agentPresets.remoteExportList()
    const row = roster.presets.find(preset => preset.id === 'custom/agent')
    expect(row).toMatchObject({ name: 'Сметчик', description: 'Считает объёмы.' })
  })

  it('synthesizes the persona prefix, base rows, and whitelisted tool rows', async () => {
    const { ctx } = await harness()
    const created = await ctx.customAgentPresets.create({ name: 'Helper', description: '', instructions: 'Be brief.', tools: ['todo'], isOrchestrator: false, delegates: [], hidden: false })
    const document = await ctx.agentPresets.readDocument(created.id)
    expect(document.content).toContain('You are the drawings assistant. Be brief.')
    expect(document.content).toContain('dsh-tool-todo')
  })

  it('mounts the delegation row with the record delegates for an orchestrator', async () => {
    const { ctx } = await harness()
    const worker = await ctx.customAgentPresets.create({ name: 'Worker', description: '', instructions: 'Do the work.', tools: [], isOrchestrator: false, delegates: [], hidden: false })
    const lead = await ctx.customAgentPresets.create({ name: 'Lead', description: '', instructions: 'Run the workers.', tools: [], isOrchestrator: true, delegates: [worker.id], hidden: false })
    const document = await ctx.agentPresets.readDocument(lead.id)
    expect(document.content).toContain('dsh-tool-subagent')
    expect(document.content).toContain('allowedAgentPresets')
    expect(document.content).toContain(worker.id)
    const row = await ctx.agentPresets.resolve(lead.id)
    expect(row.broken).toBeUndefined()
  })

  it('appends the delegate roster to the orchestrator persona from the configured template', async () => {
    const { ctx } = await harness({
      delegation: {
        name: '@deepseek-ai/dsh-tool-subagent',
        config: { provider: 'spawn', toolName: 'subagent' },
        rosterTemplate: 'Your agents for subagent launches:',
      },
    })
    const worker = await ctx.customAgentPresets.create({ name: 'Worker', description: 'Does the work.', instructions: 'Do the work.', tools: [], isOrchestrator: false, delegates: [], hidden: false })
    const lead = await ctx.customAgentPresets.create({ name: 'Lead', description: '', instructions: 'Run the workers.', tools: [], isOrchestrator: true, delegates: [worker.id], hidden: false })
    const document = await ctx.agentPresets.readDocument(lead.id)
    expect(document.content).toContain('Your agents for subagent launches:')
    expect(document.content).toContain(`- ${worker.id} «Worker» — Does the work.`)
    // The template feeds the persona text, not the delegation tool row.
    expect(document.content).not.toContain('rosterTemplate')
    const row = await ctx.agentPresets.resolve(lead.id)
    expect(row.broken).toBeUndefined()
  })

  it('leaves the persona prefix unchanged when no roster template is configured', async () => {
    const { ctx } = await harness()
    const worker = await ctx.customAgentPresets.create({ name: 'Worker', description: 'Does the work.', instructions: 'Do the work.', tools: [], isOrchestrator: false, delegates: [], hidden: false })
    const lead = await ctx.customAgentPresets.create({ name: 'Lead', description: '', instructions: 'Run the workers.', tools: [], isOrchestrator: true, delegates: [worker.id], hidden: false })
    const document = await ctx.agentPresets.readDocument(lead.id)
    expect(document.content).toContain('You are the drawings assistant. Run the workers.')
    expect(document.content).not.toContain('«Worker»')
  })

  it('rejects orchestrator writes that break the delegates invariants', async () => {
    const { ctx } = await harness()
    const plain = { name: 'X', description: '', instructions: 'i' }
    await expect(ctx.customAgentPresets.create({ ...plain, tools: [], isOrchestrator: true, delegates: [], hidden: false }))
      .rejects.toMatchObject({ code: 'custom-agent-presets/invalid', details: { reason: 'empty-delegates' } })
    await expect(ctx.customAgentPresets.create({ ...plain, tools: [], isOrchestrator: true, delegates: ['custom/missing'], hidden: false }))
      .rejects.toMatchObject({ code: 'custom-agent-presets/invalid', details: { reason: 'unknown-delegate' } })
    const w1 = await ctx.customAgentPresets.create({ ...plain, name: 'W1', tools: [], isOrchestrator: false, delegates: [], hidden: false })
    const w2 = await ctx.customAgentPresets.create({ ...plain, name: 'W2', tools: [], isOrchestrator: false, delegates: [], hidden: false })
    const lead = await ctx.customAgentPresets.create({ ...plain, name: 'Lead', tools: [], isOrchestrator: true, delegates: [w1.id], hidden: false })
    await expect(ctx.customAgentPresets.create({ ...plain, name: 'Chain', tools: [], isOrchestrator: true, delegates: [lead.id], hidden: false }))
      .rejects.toMatchObject({ code: 'custom-agent-presets/invalid', details: { reason: 'orchestrator-delegate' } })
    // w2 naming itself: the self check fires before the delegate table lookup.
    await expect(ctx.customAgentPresets.update(w2.id, { name: 'W2', description: '', instructions: 'i', tools: [], isOrchestrator: true, delegates: [w2.id], hidden: false }, w2.version))
      .rejects.toMatchObject({ code: 'custom-agent-presets/invalid', details: { reason: 'self-delegate' } })
    // w1 already launched by lead: it cannot itself become an orchestrator.
    await expect(ctx.customAgentPresets.update(w1.id, { name: 'W1', description: '', instructions: 'i', tools: [], isOrchestrator: true, delegates: [w2.id], hidden: false }, w1.version))
      .rejects.toMatchObject({ code: 'custom-agent-presets/invalid', details: { reason: 'referenced-by-orchestrator' } })
  })

  it('marks a hidden agent in the roster but keeps it resolvable', async () => {
    const { ctx } = await harness()
    const ghost = await ctx.customAgentPresets.create({ name: 'Ghost', description: '', instructions: 'Work unseen.', tools: [], isOrchestrator: false, delegates: [], hidden: true })
    const roster = await ctx.agentPresets.remoteExportList()
    expect(roster.presets.find(preset => preset.id === ghost.id)).toMatchObject({ hidden: true })
    await expect(ctx.agentPresets.resolve(ghost.id)).resolves.not.toHaveProperty('broken')
  })

  it('replaces the definition on update and drops it on delete', async () => {
    const { ctx } = await harness()
    const created = await ctx.customAgentPresets.create({ name: 'Helper', description: 'v1', instructions: 'v1', tools: [], isOrchestrator: false, delegates: [], hidden: false })
    const updated = await ctx.customAgentPresets.update(created.id, { name: 'Helper', description: 'v2', instructions: 'v2', tools: ['todo'], isOrchestrator: false, delegates: [], hidden: false }, created.version)
    expect(updated.version).toBe(2)
    const roster = await ctx.agentPresets.remoteExportList()
    expect(roster.presets.find(preset => preset.id === created.id)).toMatchObject({ description: 'v2' })
    await ctx.customAgentPresets.remove(created.id, updated.version)
    const after = await ctx.agentPresets.remoteExportList()
    expect(after.presets.find(preset => preset.id === created.id)).toBeUndefined()
  })

  it('mounts the deployment control row beside delegation for orchestrators only', async () => {
    const { ctx } = await harness({
      delegation: {
        name: '@deepseek-ai/dsh-tool-subagent',
        config: { provider: 'spawn', toolName: 'subagent' },
        control: { name: '@deepseek-ai/dsh-tool-subagent-control' },
      },
    })
    const worker = await ctx.customAgentPresets.create({ name: 'Worker', description: '', instructions: 'Do the work.', tools: [], isOrchestrator: false, delegates: [], hidden: false })
    const lead = await ctx.customAgentPresets.create({ name: 'Lead', description: '', instructions: 'Run the workers.', tools: [], isOrchestrator: true, delegates: [worker.id], hidden: false })
    const document = await ctx.agentPresets.readDocument(lead.id)
    expect(document.content).toContain('dsh-tool-subagent')
    expect(document.content).toContain('dsh-tool-subagent-control')
    const workerDocument = await ctx.agentPresets.readDocument(worker.id)
    expect(workerDocument.content).not.toContain('dsh-tool-subagent-control')
  })

  it('remounts referencing orchestrators when a delegate is updated', async () => {
    const { ctx } = await harness({
      delegation: {
        name: '@deepseek-ai/dsh-tool-subagent',
        config: { provider: 'spawn', toolName: 'subagent' },
        rosterTemplate: 'Your agents:',
      },
    })
    const worker = await ctx.customAgentPresets.create({ name: 'Worker', description: 'v1', instructions: 'i', tools: [], isOrchestrator: false, delegates: [], hidden: false })
    const lead = await ctx.customAgentPresets.create({ name: 'Lead', description: '', instructions: 'Run the workers.', tools: [], isOrchestrator: true, delegates: [worker.id], hidden: false })
    await ctx.customAgentPresets.update(worker.id, { name: 'Worker', description: 'v2', instructions: 'i', tools: [], isOrchestrator: false, delegates: [], hidden: false }, worker.version)
    // The lead's stored record keeps its version; only its mounted definition moves.
    const catalog = await ctx.customAgentPresets.remoteExportList()
    expect(catalog.agents.find(agent => agent.id === lead.id)).toMatchObject({ version: 1, delegates: [worker.id] })
    const document = await ctx.agentPresets.readDocument(lead.id)
    expect(document.content).toContain(`- ${worker.id} «Worker» — v2`)
  })

  it('cascades a deleted agent out of delegates and unmounts the tool when the list empties', async () => {
    const { ctx } = await harness()
    const worker = await ctx.customAgentPresets.create({ name: 'Worker', description: '', instructions: 'Do the work.', tools: [], isOrchestrator: false, delegates: [], hidden: false })
    const lead = await ctx.customAgentPresets.create({ name: 'Lead', description: '', instructions: 'Run the workers.', tools: [], isOrchestrator: true, delegates: [worker.id], hidden: false })
    await ctx.customAgentPresets.remove(worker.id, worker.version)
    const catalog = await ctx.customAgentPresets.remoteExportList()
    expect(catalog.agents.find(agent => agent.id === lead.id)).toMatchObject({ isOrchestrator: true, delegates: [], version: 2 })
    const document = await ctx.agentPresets.readDocument(lead.id)
    expect(document.content).not.toContain('dsh-tool-subagent')
  })

  it('rejects stale versions, over-cap creates, and unknown identities with coded errors', async () => {
    const { ctx } = await harness({ maxAgents: 1 })
    const created = await ctx.customAgentPresets.create({ name: 'Helper', description: '', instructions: 'x', tools: [], isOrchestrator: false, delegates: [], hidden: false })
    await expect(ctx.customAgentPresets.update(created.id, { name: 'Helper', description: '', instructions: 'y', tools: [], isOrchestrator: false, delegates: [], hidden: false }, created.version - 1))
      .rejects.toMatchObject({ code: 'custom-agent-presets/conflict' })
    await expect(ctx.customAgentPresets.remove('custom/missing', 1))
      .rejects.toMatchObject({ code: 'custom-agent-presets/not-found' })
    await expect(ctx.customAgentPresets.create({ name: 'Second', description: '', instructions: 'x', tools: [], isOrchestrator: false, delegates: [], hidden: false }))
      .rejects.toMatchObject({ code: 'custom-agent-presets/limit' })
  })
})
