// @vitest-environment jsdom
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { allowAllAccess, bindSnapshotSelector, contextMenuHook, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentActions } from '../src/client/AgentActions.tsx'
import { CreateCustomAgentButton } from '../src/client/CreateCustomAgentButton.tsx'
import { CustomAgentsOverlay } from '../src/client/CustomAgentsOverlay.tsx'
import { CustomAgentsController, type CustomAgentsState } from '../src/client/custom-agents-store.ts'
import type { CustomAgentCatalog, CustomAgentInput, CustomAgentRecord } from '@deepseek-ai/dsh-agent-preset-custom/types'
import { en } from '../src/client/locales.ts'

afterEach(() => { document.body.textContent = '' })

const translations: ReadonlyMap<string, string> = new Map(Object.entries(en))

/** The locale seat as the framework types it; resolves from the English dictionary. */
const t: TranslateNS<'customAgents'> = (key, params) => {
  const raw = translations.get(key) ?? key
  if (params === undefined) return raw
  return raw.replace(/\{(\w+)\}/g, (_, name) => {
    const value = Object.entries(params).find(([entryName]) => entryName === name)?.[1]
    return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  })
}

const seededAgent: CustomAgentRecord = { id: 'custom/agent', slug: 'agent', name: 'Сметчик', description: 'Считает', instructions: 'i', tools: [], isOrchestrator: false, delegates: [], orchestratorMaxIterations: 3, orchestratorMaxParallel: 3, orchestratorAutoReport: true, hidden: false, version: 1, updatedAt: '2026-11-15T00:00:00.000Z' }

const seededLead: CustomAgentRecord = { id: 'custom/lead', slug: 'lead', name: 'Ведущий', description: '', instructions: 'i', tools: [], isOrchestrator: true, delegates: [seededAgent.id], orchestratorMaxIterations: 5, orchestratorMaxParallel: 4, orchestratorAutoReport: false, hidden: true, version: 1, updatedAt: '2026-11-15T00:00:00.000Z' }

const seededGhost: CustomAgentRecord = { id: 'custom/ghost', slug: 'ghost', name: 'Призрак', description: '', instructions: 'i', tools: [], isOrchestrator: false, delegates: [], orchestratorMaxIterations: 3, orchestratorMaxParallel: 3, orchestratorAutoReport: true, hidden: true, version: 1, updatedAt: '2026-11-15T00:00:00.000Z' }

const catalog: CustomAgentCatalog = {
  agents: [seededAgent, seededLead, seededGhost],
  policy: {
    allowedTools: [
      { key: 'drawing5', label: 'Чертежи (drawing5)', description: 'Инструменты чертежей. Отметьте, чтобы агент имел доступ.' },
      { key: 'smeta', label: 'Сметы (БелЕНиР)' },
    ],
    delegationAvailable: true,
    orchestratorDefaults: { maxIterations: 3, maxParallel: 3, autoReport: true },
    orchestratorCeilings: { maxIterations: 10, maxParallel: 10 },
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

/** Every remote write the manager performs, in call order. */
interface Writes {
  creates: CustomAgentInput[]
  updates: [id: string, input: CustomAgentInput, version: number][]
  deletes: [id: string, version: number][]
}

/** The scripted remote context; records emitted cordis events and the three write kinds. */
function fakeCtx(events: string[], writes: Writes, catalogOverride?: CustomAgentCatalog, deleteFails = false): ClientContext {
  // Member-typed stubs keep every provided face assignable from the real
  // Context, so the final cast stays within comparable types.
  const customAgentPresets: ClientContext['remote']['customAgentPresets'] = {
    list: () => Promise.resolve({ ok: true as const, value: catalogOverride ?? catalog }),
    create: (input: CustomAgentInput) => {
      writes.creates.push(input)
      return Promise.resolve({ ok: true as const, value: seededAgent })
    },
    update: (id: string, input: CustomAgentInput, version: number) => {
      writes.updates.push([id, input, version])
      return Promise.resolve({ ok: true as const, value: seededAgent })
    },
    delete: (id: string, version: number) => {
      writes.deletes.push([id, version])
      if (deleteFails) {
        return Promise.resolve({ ok: false as const, error: new RemoteError('custom-agent-presets/conflict', 'The record changed elsewhere; reload and retry', { expectedVersion: 2 }) })
      }
      return Promise.resolve({ ok: true as const, value: undefined })
    },
  }
  const partial = {
    remote: { customAgentPresets },
    emit: ((event: 'custom-agents/changed') => { events.push(event) }) as ClientContext['emit'],
  }
  return partial as ClientContext
}

/** The framework seats the manager surfaces receive, bound to one controller's store. */
function seatsFor(controller: CustomAgentsController) {
  return {
    t,
    useCustomAgents: bindSnapshotSelector(controller.store),
    ...allowAllAccess,
    usePanelInfo: unusedHook,
    useSessions: unusedHook,
    useSessionStatus: unusedHook,
    useSessionRetainInfo: unusedHook,
    useWorkspaces: unusedHook,
    useResource: unusedHook,
    useContextMenu: contextMenuHook(),
    renderFactorySlot: unusedHook,
    useFactorySlot: unusedHook,
  }
}

/** The manager surfaces composed with the framework seats a slot entry receives. */
function view(state: Partial<CustomAgentsState> = {}, catalogOverride?: CustomAgentCatalog, options: { deleteFails?: boolean } = {}) {
  const events: string[] = []
  const writes: Writes = { creates: [], updates: [], deletes: [] }
  const controller = new CustomAgentsController(fakeCtx(events, writes, catalogOverride, options.deleteFails === true))
  // Seed the controller's own store: the overlay subscribes to the same store
  // instance the injected face hands out.
  controller.store.set({ ...READY, ...state })
  const shared = seatsFor(controller)
  // The entry and the dialog host render apart, as they do in the application:
  // the entry sits in a page, the dialog in the frame-wide overlay.
  const entryRender = render(<CreateCustomAgentButton {...shared} controller={controller} />)
  render(<CustomAgentsOverlay {...shared} controller={controller} />)
  return { store: controller.store, events, creates: writes.creates, writes, controller, unmountEntry: entryRender.unmount }
}

function entry(): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(en.open) })
}

describe('custom agent create entry', () => {
  it('opens the manager dialog through the overlay and lists the site agents', async () => {
    // The seeded roster is empty: the dialog lists what opening reads from the remote.
    view({ agents: [] })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(entry())
    expect(screen.getByRole('dialog')).not.toBeNull()
    // The roster lists both seeded agents; the delegate checklist repeats the regular one's name.
    expect((await screen.findAllByText('Сметчик')).length).toBeGreaterThan(0)
    expect(screen.getByText('Ведущий')).not.toBeNull()
  })

  it('keeps the dialog open after the create entry unmounts', () => {
    const view_ = view()
    fireEvent.click(entry())
    expect(screen.getByRole('dialog')).not.toBeNull()
    // The page hosting the entry can go away; the dialog lives in the overlay.
    view_.unmountEntry()
    expect(screen.getByRole('dialog')).not.toBeNull()
    act(() => { view_.controller.closeManager() })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('gives every roster agent its own edit and remove buttons', () => {
    view()
    fireEvent.click(entry())
    // The row controls are buttons a person recognizes, one pair per agent.
    expect(screen.getAllByRole('button', { name: en.edit })).toHaveLength(catalog.agents.length)
    expect(screen.getAllByRole('button', { name: en.remove })).toHaveLength(catalog.agents.length)
  })

  it('opens editing the agent a page asked the dialog to open on', () => {
    const view_ = view()
    act(() => { view_.controller.openManager('custom/agent') })
    expect(screen.getByRole('heading', { name: en.editTitle })).not.toBeNull()
    expect(screen.getByLabelText(en.name)).toHaveProperty('value', 'Сметчик')
  })

  it('opens a blank create when the asked agent is no longer in the catalog', () => {
    const view_ = view()
    act(() => { view_.controller.openManager('custom/gone') })
    expect(screen.getByRole('heading', { name: en.createTitle })).not.toBeNull()
    expect(screen.getByLabelText(en.name)).toHaveProperty('value', '')
  })

  it('saves an edited agent under the version the roster showed', async () => {
    const view_ = view()
    fireEvent.click(entry())
    fireEvent.click(screen.getAllByRole('button', { name: en.edit })[0]!)
    fireEvent.change(screen.getByLabelText(en.description), { target: { value: 'Считает быстрее' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(view_.writes.updates).toHaveLength(1) })
    // The first roster row is the seeded regular agent, stored at version 1.
    expect(view_.writes.updates[0]).toEqual([
      'custom/agent',
      expect.objectContaining({ name: 'Сметчик', description: 'Считает быстрее', isOrchestrator: false, hidden: false }),
      1,
    ])
    expect(view_.events).toContain('custom-agents/changed')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('removes an agent only after the confirming press', async () => {
    const view_ = view()
    fireEvent.click(entry())
    fireEvent.click(screen.getAllByRole('button', { name: en.remove })[0]!)
    // The first press asks; nothing reaches the remote yet.
    const confirm = screen.getByText(en.removeConfirm).parentElement as HTMLElement
    expect(view_.writes.deletes).toEqual([])
    fireEvent.click(within(confirm).getByRole('button', { name: en.remove }))
    await waitFor(() => { expect(view_.writes.deletes).toEqual([['custom/agent', 1]]) })
    expect(view_.events).toContain('custom-agents/changed')
    await waitFor(() => { expect(screen.queryByText(en.removeConfirm)).toBeNull() })
  })

  it('submits the form, closes the dialog, and emits custom-agents/changed', async () => {
    const view_ = view()
    fireEvent.click(entry())
    fireEvent.change(screen.getByLabelText(en.name), { target: { value: 'Отчётчик' } })
    fireEvent.change(screen.getByLabelText(en.instructions), { target: { value: 'Собирай отчёт.' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(view_.events).toContain('custom-agents/changed') })
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
    await waitFor(() => { expect(view_.events).toContain('custom-agents/changed') })
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
    // The roster marks the seeded orchestrator and the agents kept out of the picker.
    expect(screen.getByText(en.orchestratorBadge)).not.toBeNull()
    expect(screen.getAllByText(en.hiddenBadge).length).toBeGreaterThan(0)
    // The delegate checklist renders inert until the orchestrator checkbox turns it on:
    // hidden agents stay launchable choices, but the controls refuse keyboard and AT toggles too.
    const delegate = screen.getByRole('checkbox', { name: 'Сметчик' })
    expect(delegate.closest('[class*="delegatesDisabled"]')).not.toBeNull()
    expect(delegate).toHaveProperty('disabled', true)
    expect(screen.getByRole('checkbox', { name: 'Призрак' })).toHaveProperty('disabled', true)
    // The visibility checkbox mirrors `hidden` inverted.
    expect(screen.getByRole('checkbox', { name: en.visible })).toHaveProperty('checked', true)
    fireEvent.click(orchestrator)
    expect(screen.getByRole('checkbox', { name: 'Сметчик' }).closest('[class*="delegatesDisabled"]')).toBeNull()
    expect(screen.getByRole('checkbox', { name: 'Сметчик' })).toHaveProperty('disabled', false)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Сметчик' }))
    expect(screen.getByRole('checkbox', { name: 'Сметчик' })).toHaveProperty('checked', true)
    fireEvent.change(screen.getByLabelText(en.name), { target: { value: 'Диспетчер' } })
    fireEvent.change(screen.getByLabelText(en.instructions), { target: { value: 'Раздавай задачи.' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(view_.events).toContain('custom-agents/changed') })
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
    await waitFor(() => { expect(view_.events).toContain('custom-agents/changed') })
    expect(view_.creates[0]).toMatchObject({ isOrchestrator: false, delegates: [], hidden: true })
  })

  it('shows the empty delegate state when the roster holds no other regular agents', () => {
    const orchestratorOnly: CustomAgentCatalog = { ...catalog, agents: [seededLead] }
    view({ agents: [seededLead] }, orchestratorOnly)
    fireEvent.click(entry())
    expect(screen.getByText(en.noDelegates)).not.toBeNull()
  })

  it('renders the orchestration limits only for an orchestrator and starts from policy defaults', () => {
    view()
    fireEvent.click(entry())
    expect(screen.queryByRole('spinbutton', { name: en.orchestratorMaxIterations })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: en.orchestrator }))
    expect(screen.getByRole('spinbutton', { name: en.orchestratorMaxIterations })).toHaveProperty('value', '3')
    expect(screen.getByRole('spinbutton', { name: en.orchestratorMaxParallel })).toHaveProperty('value', '3')
    expect(screen.getByRole('checkbox', { name: en.orchestratorAutoReport })).toHaveProperty('checked', true)
  })

  it('submits the changed orchestration limits and the report toggle', async () => {
    const view_ = view()
    fireEvent.click(entry())
    fireEvent.click(screen.getByRole('checkbox', { name: en.orchestrator }))
    fireEvent.change(screen.getByRole('spinbutton', { name: en.orchestratorMaxIterations }), { target: { value: '4' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: en.orchestratorMaxParallel }), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('checkbox', { name: en.orchestratorAutoReport }))
    fireEvent.change(screen.getByLabelText(en.name), { target: { value: 'Диспетчер' } })
    fireEvent.change(screen.getByLabelText(en.instructions), { target: { value: 'Раздавай задачи.' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(view_.events).toContain('custom-agents/changed') })
    expect(view_.creates[0]).toMatchObject({
      isOrchestrator: true,
      orchestratorMaxIterations: 4,
      orchestratorMaxParallel: 2,
      orchestratorAutoReport: false,
    })
  })

  it('restores the stored orchestration values when editing an orchestrator', () => {
    view()
    fireEvent.click(entry())
    fireEvent.click(screen.getAllByRole('button', { name: en.edit })[1]!)
    expect(screen.getByRole('spinbutton', { name: en.orchestratorMaxIterations })).toHaveProperty('value', '5')
    expect(screen.getByRole('spinbutton', { name: en.orchestratorMaxParallel })).toHaveProperty('value', '4')
    expect(screen.getByRole('checkbox', { name: en.orchestratorAutoReport })).toHaveProperty('checked', false)
  })

  it('reports an out-of-range limit and focuses the first invalid field', () => {
    const view_ = view()
    fireEvent.click(entry())
    fireEvent.click(screen.getByRole('checkbox', { name: en.orchestrator }))
    fireEvent.change(screen.getByRole('spinbutton', { name: en.orchestratorMaxIterations }), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText(en.name), { target: { value: 'Диспетчер' } })
    fireEvent.change(screen.getByLabelText(en.instructions), { target: { value: 'Раздавай задачи.' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    expect(view_.creates).toEqual([])
    expect(screen.getByRole('alert').textContent).toContain('1')
    expect(document.activeElement).toBe(screen.getByRole('spinbutton', { name: en.orchestratorMaxIterations }))
  })
})

describe('agent row actions factory', () => {
  it('renders the icon pair and opens the manager on the row agent', () => {
    const view_ = view()
    render(<AgentActions {...seatsFor(view_.controller)} controller={view_.controller} id="custom/agent" version={1} name="Сметчик" />)
    fireEvent.click(screen.getByRole('button', { name: `${en.edit}: Сметчик` }))
    const state = view_.store.getSnapshot()
    expect(state.modalOpen).toBe(true)
    expect(state.editId).toBe('custom/agent')
  })

  it('arms on the first press and removes on the confirming press, stamping the caller version', async () => {
    const view_ = view()
    render(<AgentActions {...seatsFor(view_.controller)} controller={view_.controller} id="custom/agent" version={3} name="Сметчик" />)
    const remove = screen.getByRole('button', { name: `${en.remove}: Сметчик` })
    fireEvent.click(remove)
    // The first press only arms; nothing reaches the remote yet.
    expect(view_.writes.deletes).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: `${en.remove}: Сметчик` }))
    await waitFor(() => { expect(view_.writes.deletes).toEqual([['custom/agent', 3]]) })
    expect(view_.events).toContain('custom-agents/changed')
  })

  it('reports a refused remove in place instead of the buttons', async () => {
    const view_ = view({}, catalog, { deleteFails: true })
    render(<AgentActions {...seatsFor(view_.controller)} controller={view_.controller} id="custom/agent" version={1} name="Сметчик" />)
    const remove = screen.getByRole('button', { name: `${en.remove}: Сметчик` })
    fireEvent.click(remove)
    fireEvent.click(remove)
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(en.conflict) })
  })
})
