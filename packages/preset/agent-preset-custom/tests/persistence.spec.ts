import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { harness } from './harness.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

describe('custom agent persistence', () => {
  it('reopens records from the json backend after the process context is disposed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-custom-agents-'))
    roots.push(root)
    const first = await harness({}, { jsonRoot: root })
    const created = await first.ctx.customAgentPresets.create({ name: 'Helper', description: 'd', instructions: 'i', tools: ['todo'] })
    await first.ctx.fiber.dispose()

    const second = await harness({}, { jsonRoot: root })
    const catalog = await second.ctx.customAgentPresets.remoteExportList()
    expect(catalog.agents).toMatchObject([{ id: created.id, version: 1 }])
    const roster = await second.ctx.agentPresets.remoteExportList()
    expect(roster.presets.find(preset => preset.id === created.id)).toMatchObject({ name: 'Helper' })
  })
})
