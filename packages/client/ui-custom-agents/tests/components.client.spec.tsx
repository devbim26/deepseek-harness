// @vitest-environment jsdom
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { allowAllAccess, bindSnapshotSelector, contextMenuHook } from '@deepseek-ai/dsh-client-test-runtime'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreateCustomAgentButton } from '../src/client/CreateCustomAgentButton.tsx'
import { CustomAgentsOverlay } from '../src/client/CustomAgentsOverlay.tsx'
import { CustomAgentsController, type CustomAgentsState } from '../src/client/custom-agents-store.ts'
import type { CustomAgentCatalog, CustomAgentInput, CustomAgentRecord } from '@deepseek-ai/dsh-agent-preset-custom/types'
import { en } from '../src/client/locales.ts'

afterEach(() => { document.body.textContent = '' })

const translations: ReadonlyMap<string, string> = new Map(Object.entries(en))

const seededAgent: CustomAgentRecord = { id: 'custom/agent', slug: 'agent', name: 'Сметчик', description: 'Считает', instructions: 'i', tools: [], isOrchestrator: false, delegates: [], hidden: false, version: 1, updatedAt: '2026-11-15T00:00:00.000Z' }

const seededLead: CustomAgentRecord = { id: 'custom/lead', slug: 'lead', name: 'Ведущий', description: '', instructions: 'i', tools: [], isOrchestrator: true, delegates: [seededAgent.id], hidden: true, version: 1, updatedAt: '2026-11-15T00:00:00.000Z' }

const catalog: CustomAgentCatalog = {
  agents: [seededAgent, seededLead],
  policy: {
    allowedTools: [
      { key: 'drawing5', label: 'Чертежи (drawing5)', description: 'Инструменты чертежей. Отметьте, чтобы агент имел доступ.' },
      { key: 'smeta', label: 'Сметы (БелЕНиР)' },
    ],
    delegationAvailable: true,
    maxNameChars: 64,
    maxDescriptionChars: 200,
    maxInstructionsChars: 16384,
    maxAgents: 50,
  },
}

const READY: CustomAgentsState = {
  status: 'ready', agents: catalog.agents, policy: catalog.policy, saving: false, error: undefined, modalOpen: false, openSeq: 0,
}

/** A hook the surfaces under test never call. */
const unusedHook = (): never => {
  throw new Error('this spec does not read that slot source')
}

/** The scripted remote context; records emitted cordis events and create inputs. */
function fakeCtx(events: string[], creates: CustomAgentInput[] = [], catalogOverride?: CustomAgentCatalog): ClientContext {
  // Member-typed stubs keep every provided face assignable from the real
  // Context, so the final cast stays within comparable types.
  const customAgentPresets: ClientContext['remote']['customAgentPresets'] = {
    list: () => Promise.resolve({ ok: true as const, value: catalogOverride ?? catalog }),
    create: (input: CustomAgentInput) => {
      creates.push(input)
      return Promise.resolve({ ok: true as const, value: seededAgent })
    },
    update: () => Promise.resolve({ ok: true as const, value: seededAgent }),
    delete: () => Promise.resolve({ ok: true as const, value: undefined }),
  }
  const partial = {
    remote: { customAgentPresets },
    emit: ((event: 'custom-agents/changed') => { events.push(event) }) as ClientContext['emit'],
  }
  return partial as ClientContext
}

/** The manager surfaces composed with the framework seats a slot entry receives. */
function view(state: Partial<CustomAgentsState> = {}, catalogOverride?: CustomAgentCatalog) {
  const events: string[] = []
  const creates: CustomAgentInput[] = []
  const controller = new CustomAgentsController(fakeCtx(events, creates, catalogOverride))
  // Seed the controller's own store: the overlay subscribes to the same store
  // instance the injected face hands out.
  controller.store.set({ ...READY, ...state })
  const load = vi.fn(async () => {})
  const onDismiss = vi.fn()
  const shared = {
    t: (key: keyof typeof en, params?: Record<string, unknown>): string => {
      const raw = translations.get(key) ?? key
      return params === undefined ? raw : raw.replace(/\{(\w+)\}/g, (_, name) => String(params[name]))
    },
    useCustomAgents: bindSnapshotSelector(controller.store as SnapshotStore<CustomAgentsState>),
    ...allowAllAccess,
    usePanelInfo: unusedHook,
    useSessions: unusedHook,
    useSessionStatus: unusedHook,
    useSessionRetainInfo: unusedHook,
    useWorkspaces: unusedHook,
    useResource: unusedHook,
    useContextMenu: contextMenuHook(),
  }
  render(
    <>
      <CreateCustomAgentButton {...shared} controller={controller} load={load} onDismiss={onDismiss} />
      <CustomAgentsOverlay {...shared} controller={controller} />
    </>,
  )
  return { store: controller.store, load, onDismiss, events, creates, controller }
}

function entry(): HTMLElement {
  return screen.getByRole('menuitem', { name: new RegExp(en.open) })
}

describe('custom agent picker entry', () => {
  it('opens the manager dialog through the overlay and lists the site agents', () => {
    const view_ = view()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(entry())
    expect(view_.onDismiss).toHaveBeenCalledOnce()
    expect(view_.load).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog')).not.toBeNull()
    // The roster lists both seeded agents; the delegate checklist repeats the regular one's name.
    expect(screen.getAllByText('Сметчик').length).toBeGreaterThan(0)
    expect(screen.getByText('Ведущий')).not.toBeNull()
  })

  it('keeps the dialog open after the menu entry unmounts', () => {
    const view_ = view()
    fireEvent.click(entry())
    expect(screen.getByRole('dialog')).not.toBeNull()
    // The menu closing unmounts the entry; the dialog lives in the overlay.
    act(() => { view_.controller.closeManager() })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('submits the form, closes the dialog, and emits custom-agents/changed', async () => {
    const view_ = view()
    fireEvent.click(entry())
    fireEvent.change(screen.getByLabelText(en.name), { target: { value: 'Отчётчик' } })
    fireEvent.change(screen.getByLabelText(en.instructions), { target: { value: 'Собирай отчёт.' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => expect(view_.events).toContain('custom-agents/changed'))
    expect(view_.store.getSnapshot().modalOpen).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens a fresh create form on every open, never the previous editing state', () => {
    const view_ = view()
    fireEvent.click(entry())
    // Enter edit mode of the stored agent; each roster row carries its own Edit.
    fireEvent.click(screen.getAllByRole('button', { name: en.edit })[0]!)
    expect(screen.getByLabelText(en.name)).toHaveProperty('value', 'Сметчик')
    // Close and reopen through the controller: the form must reset.
    act(() => { view_.controller.closeManager() })
    act(() => { view_.controller.openManager() })
    expect(screen.getByRole('dialog')).not.toBeNull()
    expect(screen.getByLabelText(en.name)).toHaveProperty('value', '')
  })

  it('switches an agent being edited back to a blank create form from the roster', () => {
    view()
    fireEvent.click(entry())
    fireEvent.click(screen.getAllByRole('button', { name: en.edit })[0]!)
    expect(screen.getByLabelText(en.name)).toHaveProperty('value', 'Сметчик')
    fireEvent.click(screen.getByRole('button', { name: en.newAgent }))
    expect(screen.getByLabelText(en.name)).toHaveProperty('value', '')
    expect(screen.getByRole('heading', { name: en.createTitle })).not.toBeNull()
  })

  it('renders one checkbox per whitelisted plugin with its description, unchecked by default', () => {
    view()
    fireEvent.click(entry())
    const drawing5 = screen.getByRole('checkbox', { name: 'Чертежи (drawing5)' })
    const smeta = screen.getByRole('checkbox', { name: 'Сметы (БелЕНиР)' })
    expect(drawing5).not.toBeNull()
    expect(smeta).not.toBeNull()
    expect(screen.getByText('Инструменты чертежей. Отметьте, чтобы агент имел доступ.')).not.toBeNull()
    // Blocking semantics start unchecked: the created agent mounts nothing.
    expect(drawing5).toHaveProperty('checked', false)
    expect(smeta).toHaveProperty('checked', false)
  })

  it('submits only the checked plugin keys with the form', async () => {
    const view_ = view()
    fireEvent.click(entry())
    fireEvent.change(screen.getByLabelText(en.name), { target: { value: 'Чертёжник' } })
    fireEvent.change(screen.getByLabelText(en.instructions), { target: { value: 'Работай с чертежами.' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Чертежи (drawing5)' }))
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => expect(view_.events).toContain('custom-agents/changed'))
    expect(view_.creates).toEqual([{ name: 'Чертёжник', description: '', instructions: 'Работай с чертежами.', tools: ['drawing5'], isOrchestrator: false, delegates: [], hidden: false }])
  })

  it('offers the orchestrator checkbox only when the deployment allows delegation', () => {
    // The seeded state and the catalog answer must agree: opening the manager
    // refreshes the store from the remote in the background.
    const unavailable: CustomAgentCatalog = { ...catalog, policy: { ...catalog.policy, delegationAvailable: false } }
    view({ agents: [seededAgent], policy: unavailable.policy }, unavailable)
    fireEvent.click(entry())
    expect(screen.queryByRole('checkbox', { name: en.orchestrator })).toBeNull()
    // Visibility stays a plain per-agent choice, independent of delegation.
    expect(screen.getByRole('checkbox', { name: en.visible })).not.toBeNull()
  })

  it('gates the delegate list behind the orchestrator checkbox and submits the new fields', async () => {
    const view_ = view()
    fireEvent.click(entry())
    const orchestrator = screen.getByRole('checkbox', { name: en.orchestrator })
    expect(orchestrator).toHaveProperty('checked', false)
    // The roster marks the seeded orchestrator and the agent it keeps out of the picker.
    expect(screen.getByText(en.orchestratorBadge)).not.toBeNull()
    expect(screen.getByText(en.hiddenBadge)).not.toBeNull()
    // The delegate checklist renders inert until the orchestrator checkbox turns it on.
    const delegate = screen.getByRole('checkbox', { name: 'Сметчик' })
    expect(delegate.closest('[class*="delegatesDisabled"]')).not.toBeNull()
    // The visibility checkbox mirrors `hidden` inverted.
    expect(screen.getByRole('checkbox', { name: en.visible })).toHaveProperty('checked', true)
    fireEvent.click(orchestrator)
    expect(screen.getByRole('checkbox', { name: 'Сметчик' }).closest('[class*="delegatesDisabled"]')).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Сметчик' }))
    expect(screen.getByRole('checkbox', { name: 'Сметчик' })).toHaveProperty('checked', true)
    fireEvent.change(screen.getByLabelText(en.name), { target: { value: 'Диспетчер' } })
    fireEvent.change(screen.getByLabelText(en.instructions), { target: { value: 'Раздавай задачи.' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => expect(view_.events).toContain('custom-agents/changed'))
    expect(view_.creates[0]).toMatchObject({ isOrchestrator: true, delegates: ['custom/agent'], hidden: false })
  })

  it('clears the delegate selection when the orchestrator checkbox turns off', () => {
    view()
    fireEvent.click(entry())
    fireEvent.click(screen.getByRole('checkbox', { name: en.orchestrator }))
    const delegate = screen.getByRole('checkbox', { name: 'Сметчик' })
    fireEvent.click(delegate)
    expect(delegate).toHaveProperty('checked', true)
    fireEvent.click(delegate)
    expect(delegate).toHaveProperty('checked', false)
    fireEvent.click(delegate)
    fireEvent.click(screen.getByRole('checkbox', { name: en.orchestrator }))
    // Turning orchestration off drops the delegate list with it.
    expect(screen.getByRole('checkbox', { name: 'Сметчик' })).toHaveProperty('checked', false)
    expect(screen.getByRole('checkbox', { name: 'Сметчик' }).closest('[class*="delegatesDisabled"]')).not.toBeNull()
  })

  it('submits a hidden agent after unchecking the visibility toggle', async () => {
    const view_ = view()
    fireEvent.click(entry())
    fireEvent.change(screen.getByLabelText(en.name), { target: { value: 'Тихоня' } })
    fireEvent.change(screen.getByLabelText(en.instructions), { target: { value: 'Работай незаметно.' } })
    fireEvent.click(screen.getByRole('checkbox', { name: en.visible }))
    expect(screen.getByRole('checkbox', { name: en.visible })).toHaveProperty('checked', false)
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => expect(view_.events).toContain('custom-agents/changed'))
    expect(view_.creates[0]).toMatchObject({ isOrchestrator: false, delegates: [], hidden: true })
  })

  it('shows the empty delegate state when the roster holds no other regular agents', () => {
    const orchestratorOnly: CustomAgentCatalog = { ...catalog, agents: [seededLead] }
    view({ agents: [seededLead] }, orchestratorOnly)
    fireEvent.click(entry())
    expect(screen.getByText(en.noDelegates)).not.toBeNull()
  })
})
