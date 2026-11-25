/**
 * ui-custom-agents plugin halves: the browser entry's dictionary, the
 * create-button Factory, and the overlay host against the real SlotRegistry
 * (with fiber teardown proving removal — HMR safety), and the inert node entry.
 */
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { CustomAgentCatalog } from '@deepseek-ai/dsh-agent-preset-custom/types'
import { describe, expect, it, vi, type MockInstance } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { AgentActions, type AgentActionsInjected } from '../src/client/AgentActions.tsx'
import { CreateCustomAgentButton, type CreateCustomAgentButtonInjected } from '../src/client/CreateCustomAgentButton.tsx'
import type { CustomAgentsOverlayInjected } from '../src/client/CustomAgentsOverlay.tsx'
import { CustomAgentsOverlay } from '../src/client/CustomAgentsOverlay.tsx'
import { CustomAgentsController } from '../src/client/custom-agents-store.ts'
import { apply as applyNode } from '../src/index.ts'
import { en, ru, zh } from '../src/client/locales.ts'

/** The catalog the stubbed remote answers: no agents, no whitelisted tools. */
const EMPTY_CATALOG: CustomAgentCatalog = {
  agents: [],
  policy: {
    allowedTools: [],
    delegationAvailable: false,
    orchestratorDefaults: { maxIterations: 3, maxParallel: 3, autoReport: true },
    orchestratorCeilings: { maxIterations: 10, maxParallel: 10 },
    maxNameChars: 64,
    maxDescriptionChars: 200,
    maxInstructionsChars: 16384,
    maxAgents: 50,
  },
}

/** Catalog reads handed to the stubbed presets remote. */
let catalogReads = 0

/** The create button's Factory definition as the plugin passed it to the registry. */
interface CreateButtonDefinition {
  name: string
  scope: string
  locale: string
  inject: () => CreateCustomAgentButtonInjected
}

/** The registry's `registerFactory` as the bench spies record it. */
type RegisterFactorySpy = MockInstance<SlotRegistry['registerFactory']>

/** Boot the browser half over a real slot tree that declares the overlay and the picker action list. */
async function bench(): Promise<{
  ctx: Context
  fiber: ReturnType<Context['plugin']>
  registerFactory: RegisterFactorySpy
}> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'shell.overlay': { kind: 'list', scope: 'root' },
      'agentPreset.picker.actions': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  catalogReads = 0
  const customAgentPresets = {
    list: async () => {
      catalogReads++
      return { ok: true as const, value: EMPTY_CATALOG }
    },
  }
  // The locale plugin binds a settings scope, which reads the connection handle
  // and the forwarded-event port.
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {}, customAgentPresets } as never)
  // Registered twice on purpose: the nested key satisfies the plugin's
  // `inject`, and the property is what `ctx.remote.customAgentPresets` reads,
  // because the double is a plain provided object rather than a Service.
  ctx.provide('remote.customAgentPresets', customAgentPresets as never)
  ctx.provide('configForms', { developerTools: { enabled: createSnapshotStore(true) }, get: () => stubConfigForm().scope } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  const registerFactory: RegisterFactorySpy = vi.spyOn(ctx.slots, 'registerFactory')
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await vi.waitFor(() => { expect(createButtonDefined(ctx)).toBe(true) })
  return { ctx, fiber, registerFactory }
}

/** Whether the create button's Factory definition is live. */
function createButtonDefined(ctx: Context): boolean {
  return ctx.slots.snapshot('factory:customAgents.createButton').length > 0
}

/** The one Factory definition the plugin registered. */
function createButtonDefinition(registerFactory: RegisterFactorySpy): CreateButtonDefinition {
  const [options, component] = registerFactory.mock.calls[0] ?? []
  if (component !== CreateCustomAgentButton) throw new Error('the plugin registered no create button Factory')
  return options as CreateButtonDefinition
}

/** The dialog host's business face as the overlay entry hands it out. */
function overlayFace(ctx: Context): CustomAgentsOverlayInjected {
  const entry = ctx.slots.entries('shell.overlay').find(candidate => (
    candidate.options.id === 'custom-agents-dialog' && candidate.component === CustomAgentsOverlay
  ))
  if (entry === undefined) throw new Error('the dialog host registered no overlay entry')
  const inject = entry.inject as (() => CustomAgentsOverlayInjected) | undefined
  if (inject === undefined) throw new Error('the dialog host registered no inject face')
  return inject()
}

describe('ui-custom-agents browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.customAgentPresets'])
  })

  it('offers the create button as a root Factory over the manager controller', async () => {
    const { registerFactory } = await bench()
    const definition = createButtonDefinition(registerFactory)
    expect(definition.name).toBe('customAgents.createButton')
    expect(definition.scope).toBe('root')
    expect(definition.locale).toBe('customAgents')
    const controller = definition.inject().controller
    expect(controller).toBeInstanceOf(CustomAgentsController)
    // Opening shows the dialog and reads the catalog behind it.
    controller.openManager()
    expect(controller.store.getSnapshot().modalOpen).toBe(true)
    expect(catalogReads).toBe(1)
  })

  it('hosts the dialog in the frame-wide overlay over the same store', async () => {
    const { ctx, registerFactory } = await bench()
    createButtonDefinition(registerFactory).inject().controller.openManager()
    const face = overlayFace(ctx)
    expect(face.hooks.customAgents.getSnapshot().modalOpen).toBe(true)
    face.controller.closeManager()
    expect(face.hooks.customAgents.getSnapshot().modalOpen).toBe(false)
  })

  it('adds no row to the preset picker', async () => {
    const { ctx } = await bench()
    expect(ctx.slots.entries('agentPreset.picker.actions')).toHaveLength(0)
  })

  it('offers the row actions as a root Factory over the same controller, and teardown removes it', async () => {
    const { ctx, fiber, registerFactory } = await bench()
    const call = registerFactory.mock.calls.find(([options]) => (options as { name?: string }).name === 'customAgents.agentActions')
    if (call === undefined) throw new Error('the plugin registered no agent actions Factory')
    const [options, component] = call
    expect(component).toBe(AgentActions)
    expect((options as { scope?: string }).scope).toBe('root')
    const inject = (options as { inject?: () => AgentActionsInjected }).inject
    if (inject === undefined) throw new Error('the agent actions Factory registered no inject face')
    expect(inject().controller).toBeInstanceOf(CustomAgentsController)
    await fiber.dispose()
    expect(ctx.slots.snapshot('factory:customAgents.agentActions')).toHaveLength(0)
  })

  it('registers the Factory and the overlay host, and fiber teardown removes both (HMR safety)', async () => {
    const { ctx, fiber } = await bench()
    expect(createButtonDefined(ctx)).toBe(true)
    expect(ctx.slots.entries('shell.overlay').map(entry => entry.options.id)).toContain('custom-agents-dialog')
    await fiber.dispose()
    expect(createButtonDefined(ctx)).toBe(false)
    expect(ctx.slots.entries('shell.overlay')).toHaveLength(0)
  })

  it('registers its dictionary under its own namespace and releases it with the fiber', async () => {
    const { ctx, fiber } = await bench()
    const translate = ctx.locale.bind('customAgents')
    ctx.locale.setLocale('ru')
    expect(translate('open')).toBe(ru.open)
    ctx.locale.setLocale('en')
    expect(translate('open')).toBe(en.open)

    // Withdrawn dictionaries leave the key unresolved rather than translated.
    await fiber.dispose()
    expect(translate('open')).not.toBe(en.open)
  })

  it('keeps the Russian and Chinese dictionaries key-identical to the English source', () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort())
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })
})

describe('ui-custom-agents node half', () => {
  it('contributes no host behavior', () => {
    // The node half exists only so the plugin appears in the Loader tree.
    expect(applyNode).not.toThrow()
  })
})
