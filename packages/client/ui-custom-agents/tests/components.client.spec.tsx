// @vitest-environment jsdom
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { allowAllAccess, bindSnapshotSelector, contextMenuHook } from '@deepseek-ai/dsh-client-test-runtime'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreateCustomAgentButton } from '../src/client/CreateCustomAgentButton.tsx'
import { CustomAgentsOverlay } from '../src/client/CustomAgentsOverlay.tsx'
import { CustomAgentsController, type CustomAgentsState } from '../src/client/custom-agents-store.ts'
import type { CustomAgentCatalog, CustomAgentRecord } from '@deepseek-ai/dsh-agent-preset-custom/types'
import { en } from '../src/client/locales.ts'

afterEach(() => { document.body.textContent = '' })

const translations: ReadonlyMap<string, string> = new Map(Object.entries(en))

const seededAgent: CustomAgentRecord = { id: 'custom/agent', slug: 'agent', name: 'Сметчик', description: 'Считает', instructions: 'i', tools: [], version: 1, updatedAt: '2026-11-15T00:00:00.000Z' }

const catalog: CustomAgentCatalog = {
  agents: [seededAgent],
  policy: { allowedTools: [{ key: 'todo', label: 'Задачи' }], maxNameChars: 64, maxDescriptionChars: 200, maxInstructionsChars: 16384, maxAgents: 50 },
}

const READY: CustomAgentsState = {
  status: 'ready', agents: catalog.agents, policy: catalog.policy, saving: false, error: undefined, modalOpen: false, openSeq: 0,
}

/** A hook the surfaces under test never call. */
const unusedHook = (): never => {
  throw new Error('this spec does not read that slot source')
}

/** The scripted remote context; records emitted cordis events. */
function fakeCtx(events: string[]): ClientContext {
  // Member-typed stubs keep every provided face assignable from the real
  // Context, so the final cast stays within comparable types.
  const customAgentPresets: ClientContext['remote']['customAgentPresets'] = {
    list: () => Promise.resolve({ ok: true as const, value: catalog }),
    create: () => Promise.resolve({ ok: true as const, value: seededAgent }),
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
function view(state: Partial<CustomAgentsState> = {}) {
  const events: string[] = []
  const controller = new CustomAgentsController(fakeCtx(events))
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
  return { store: controller.store, load, onDismiss, events, controller }
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
    expect(screen.getByText('Сметчик')).not.toBeNull()
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
    // Enter edit mode of the stored agent.
    fireEvent.click(screen.getByRole('button', { name: en.edit }))
    expect(screen.getByLabelText(en.name)).toHaveProperty('value', 'Сметчик')
    // Close and reopen through the controller: the form must reset.
    act(() => { view_.controller.closeManager() })
    act(() => { view_.controller.openManager() })
    expect(screen.getByRole('dialog')).not.toBeNull()
    expect(screen.getByLabelText(en.name)).toHaveProperty('value', '')
  })
})
