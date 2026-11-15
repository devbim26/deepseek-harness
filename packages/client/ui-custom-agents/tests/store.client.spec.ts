import { describe, expect, it } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { CustomAgentsController } from '../src/client/custom-agents-store.ts'
import type { CustomAgentCatalog } from '@deepseek-ai/dsh-agent-preset-custom/types'

const catalog: CustomAgentCatalog = {
  agents: [{ id: 'custom/agent', slug: 'agent', name: 'Сметчик', description: 'd', instructions: 'i', tools: [], version: 1, updatedAt: '2026-11-15T00:00:00.000Z' }],
  policy: { allowedTools: [{ key: 'todo', label: 'Задачи' }], maxNameChars: 64, maxDescriptionChars: 200, maxInstructionsChars: 16384, maxAgents: 50 },
}

/** A scripted remote answering fixed outcomes; records emitted events. */
function fakeCtx(outcomes: {
  list?: { ok: boolean; value?: CustomAgentCatalog; message?: string }
  create?: { ok: boolean }
  events?: string[]
}): ClientContext {
  const partial = {
    remote: {
      customAgentPresets: {
        list: () => outcomes.list?.ok === true
          ? Promise.resolve({ ok: true as const, value: outcomes.list.value })
          : Promise.resolve({ ok: false as const, error: new RemoteError('gateway/internal', outcomes.list?.message ?? 'down', {}) }),
        create: () => Promise.resolve(outcomes.create?.ok === true
          ? { ok: true as const, value: catalog.agents[0] }
          : { ok: false as const, error: new RemoteError('gateway/internal', 'refused', {}) }),
        update: () => Promise.resolve({ ok: true as const, value: catalog.agents[0] }),
        remove: () => Promise.resolve({ ok: true as const, value: undefined }),
      },
    },
    emit: (event: string) => { outcomes.events?.push(event) },
  }
  return partial as ClientContext
}

describe('custom agents store', () => {
  it('loads the catalog into ready state', async () => {
    const controller = new CustomAgentsController(fakeCtx({ list: { ok: true, value: catalog } }))
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready',
      agents: [expect.objectContaining({ name: 'Сметчик' })],
      policy: expect.objectContaining({ allowedTools: [{ key: 'todo', label: 'Задачи' }] }),
    })
  })

  it('marks the remote unavailable on failure', async () => {
    const controller = new CustomAgentsController(fakeCtx({ list: { ok: false, message: 'down' } }))
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('unavailable')
  })

  it('emits custom-agents/changed after a successful create', async () => {
    const events: string[] = []
    const controller = new CustomAgentsController(fakeCtx({ create: { ok: true }, events }))
    const outcome = await controller.create({ name: 'x', description: '', instructions: 'y', tools: [] })
    expect(outcome.ok).toBe(true)
    expect(events).toContain('custom-agents/changed')
  })

  it('surfaces coded write failures for the form', async () => {
    const controller = new CustomAgentsController(fakeCtx({ create: { ok: false } }))
    const outcome = await controller.create({ name: 'x', description: '', instructions: 'y', tools: [] })
    expect(outcome).toMatchObject({ ok: false, kind: 'unavailable' })
  })
})
