// @vitest-environment jsdom
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreateCustomAgentButton } from '../src/client/CreateCustomAgentButton.tsx'
import { CustomAgentsOverlay } from '../src/client/CustomAgentsOverlay.tsx'
import { CustomAgentsController, type CustomAgentsState } from '../src/client/custom-agents-store.ts'
import type { CustomAgentCatalog } from '@deepseek-ai/dsh-agent-preset-custom/types'
import { en } from '../src/client/locales.ts'

afterEach(() => { document.body.textContent = '' })

const translations: ReadonlyMap<string, string> = new Map(Object.entries(en))
const t = (key: string, params?: Record<string, unknown>): string => {
  const raw = translations.get(key) ?? key
  return params === undefined ? raw : raw.replace(/\{(\w+)\}/g, (_, name) => String(params[name]))
}

const catalog: CustomAgentCatalog = {
  agents: [{ id: 'custom/agent', slug: 'agent', name: 'Сметчик', description: 'Считает', instructions: 'i', tools: [], version: 1, updatedAt: '2026-11-15T00:00:00.000Z' }],
  policy: { allowedTools: ['todo'], maxNameChars: 64, maxDescriptionChars: 200, maxInstructionsChars: 16384, maxAgents: 50 },
}

const READY: CustomAgentsState = {
  status: 'ready', agents: catalog.agents, policy: catalog.policy, saving: false, error: undefined, modalOpen: false,
}

/** The scripted remote context; records emitted cordis events. */
function fakeCtx(events: string[]): ClientContext {
  const partial = {
    remote: { customAgentPresets: {
      list: () => Promise.resolve({ ok: true as const, value: catalog }),
      create: () => Promise.resolve({ ok: true as const, value: catalog.agents[0] }),
      update: () => Promise.resolve({ ok: true as const, value: catalog.agents[0] }),
      delete: () => Promise.resolve({ ok: true as const, value: undefined }),
    } },
    emit: (event: string) => { events.push(event) },
  }
  return partial as ClientContext
}

function view(state: Partial<CustomAgentsState> = {}) {
  const events: string[] = []
  const controller = new CustomAgentsController(fakeCtx(events))
  // Seed the controller's own store: the overlay subscribes to the same store
  // instance the injected face hands out.
  controller.store.set({ ...READY, ...state })
  const load = vi.fn(async () => {})
  const onDismiss = vi.fn()
  const props = {
    t,
    useCustomAgents: bindSnapshotSelector(controller.store as SnapshotStore<CustomAgentsState>),
    controller,
    load,
    onDismiss,
  }
  render(
    <>
      <CreateCustomAgentButton {...props} />
      <CustomAgentsOverlay t={t} useCustomAgents={props.useCustomAgents} controller={controller} />
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

  it('submits the form and emits custom-agents/changed', async () => {
    const view_ = view()
    fireEvent.click(entry())
    fireEvent.change(screen.getByLabelText(en.name), { target: { value: 'Отчётчик' } })
    fireEvent.change(screen.getByLabelText(en.instructions), { target: { value: 'Собирай отчёт.' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => expect(view_.events).toContain('custom-agents/changed'))
    expect(screen.getByText(en.saved)).not.toBeNull()
  })
})
