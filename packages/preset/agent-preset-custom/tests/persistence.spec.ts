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
    const created = await first.ctx.customAgentPresets.create({ name: 'Helper', description: 'd', instructions: 'i', tools: ['todo'], isOrchestrator: false, delegates: [], hidden: false })
    await first.ctx.fiber.dispose()

    const second = await harness({}, { jsonRoot: root })
    const catalog = await second.ctx.customAgentPresets.remoteExportList()
    expect(catalog.agents).toMatchObject([{ id: created.id, version: 1 }])
    const roster = await second.ctx.agentPresets.remoteExportList()
    expect(roster.presets.find(preset => preset.id === created.id)).toMatchObject({ name: 'Helper' })
  })

  it('defaults the delegation fields for a record written by an older build', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-custom-agents-'))
    roots.push(root)
    const first = await harness({}, { jsonRoot: root })
    const created = await first.ctx.customAgentPresets.create({ name: 'Legacy', description: '', instructions: 'i', tools: [], isOrchestrator: false, delegates: [], hidden: false })
    await first.ctx.fiber.dispose()

    // Strip the new fields from the stored file, simulating an older build's record.
    const { readdir, readFile, writeFile } = await import('node:fs/promises')
    for (const rel of await readdir(root, { recursive: true })) {
      const path = join(root, String(rel))
      if (!path.endsWith('.json')) continue
      const raw = await readFile(path, 'utf8')
      if (!raw.includes(created.id)) continue
      const record: Record<string, unknown> = JSON.parse(raw)
      delete record.isOrchestrator
      delete record.delegates
      delete record.hidden
      await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    }

    const second = await harness({}, { jsonRoot: root })
    const catalog = await second.ctx.customAgentPresets.remoteExportList()
    expect(catalog.agents.find(agent => agent.id === created.id)).toMatchObject({ isOrchestrator: false, delegates: [], hidden: false })
  })
})
