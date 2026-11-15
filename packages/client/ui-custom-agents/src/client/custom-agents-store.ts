/** Client store for the custom-agent manager: one catalog load and CRUD writes. */
// Type-only: pulls the ui-agent-preset merges (the picker action slot and the
// custom-agents/changed event) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { CustomAgentInput, CustomAgentPolicy, CustomAgentRecord } from '@deepseek-ai/dsh-agent-preset-custom/types'

/** Render state of the manager. */
export interface CustomAgentsState {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
  agents: readonly CustomAgentRecord[]
  policy: CustomAgentPolicy | undefined
  saving: boolean
  error: string | undefined
  /** Whether the manager dialog is showing; lives here so it outlives the picker menu. */
  modalOpen: boolean
}

const INITIAL: CustomAgentsState = { status: 'idle', agents: [], policy: undefined, saving: false, error: undefined, modalOpen: false }

/** Outcome of one write, for the form's error surface. */
export type WriteOutcome =
  | { ok: true; record: CustomAgentRecord | undefined }
  | { ok: false; kind: 'limit' | 'invalid' | 'conflict' | 'not-found' | 'unavailable'; reason?: string }

/** Loads the catalog and performs CRUD through the typed remote. */
export class CustomAgentsController {
  readonly store: SnapshotStore<CustomAgentsState> = createSnapshotStore(INITIAL)

  constructor(private readonly ctx: ClientContext) {}

  /** Show the manager dialog; the picker menu entry calls this before dismissing itself. */
  openManager(): void {
    this.store.set({ ...this.store.getSnapshot(), modalOpen: true })
    void this.load()
  }

  /** Hide the manager dialog. */
  closeManager(): void {
    this.store.set({ ...this.store.getSnapshot(), modalOpen: false })
  }

  /** Read the catalog; an unreachable remote marks the manager unavailable, not empty. */
  async load(): Promise<void> {
    this.store.set({ ...this.store.getSnapshot(), status: 'loading' })
    const result = await this.ctx.remote.customAgentPresets.list()
    if (!result.ok) {
      this.store.set({ ...this.store.getSnapshot(), status: 'unavailable', error: result.error.message })
      return
    }
    this.store.set({ ...this.store.getSnapshot(), status: 'ready', agents: result.value.agents, policy: result.value.policy, error: undefined })
  }

  async create(input: CustomAgentInput): Promise<WriteOutcome> {
    this.store.set({ ...this.store.getSnapshot(), saving: true })
    try {
      const result = await this.ctx.remote.customAgentPresets.create(input)
      if (!result.ok) return this.writeFailure(result.error)
      await this.load()
      this.ctx.emit('custom-agents/changed')
      return { ok: true, record: result.value }
    } finally {
      this.store.set({ ...this.store.getSnapshot(), saving: false })
    }
  }

  async update(id: string, input: CustomAgentInput, version: number): Promise<WriteOutcome> {
    this.store.set({ ...this.store.getSnapshot(), saving: true })
    try {
      const result = await this.ctx.remote.customAgentPresets.update(id, input, version)
      if (!result.ok) return this.writeFailure(result.error)
      await this.load()
      this.ctx.emit('custom-agents/changed')
      return { ok: true, record: result.value }
    } finally {
      this.store.set({ ...this.store.getSnapshot(), saving: false })
    }
  }

  async remove(id: string, version: number): Promise<WriteOutcome> {
    const result = await this.ctx.remote.customAgentPresets.delete(id, version)
    if (!result.ok) return this.writeFailure(result.error)
    await this.load()
    this.ctx.emit('custom-agents/changed')
    return { ok: true, record: undefined }
  }

  private writeFailure(error: { code: string; message: string }): WriteOutcome {
    if (error.code === 'custom-agent-presets/limit') return { ok: false, kind: 'limit', reason: error.message }
    if (error.code === 'custom-agent-presets/conflict') return { ok: false, kind: 'conflict', reason: error.message }
    if (error.code === 'custom-agent-presets/not-found') return { ok: false, kind: 'not-found', reason: error.message }
    if (error.code === 'custom-agent-presets/invalid') return { ok: false, kind: 'invalid', reason: error.message }
    return { ok: false, kind: 'unavailable', reason: error.message }
  }
}
