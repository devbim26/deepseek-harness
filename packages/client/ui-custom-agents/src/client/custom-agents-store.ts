/** Client store for the custom-agent manager: one catalog load and CRUD writes. */
// Type-only: pulls the ui-agent-preset Events merge (the custom-agents/changed
// event) into this program.
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
  /** Whether the manager dialog is showing; lives here so it outlives the entry that opened it. */
  modalOpen: boolean
  /** Bumped on every open; keys the dialog so each open mounts a fresh form. */
  openSeq: number
  /** The agent a page asked the dialog to open on; undefined opens a blank create. */
  editId?: string | undefined
}

const INITIAL: CustomAgentsState = { status: 'idle', agents: [], policy: undefined, saving: false, error: undefined, modalOpen: false, openSeq: 0, editId: undefined }

/** Outcome of one write, for the form's error surface. */
export type WriteOutcome =
  | { ok: true; record: CustomAgentRecord | undefined }
  | { ok: false; kind: 'limit' | 'invalid' | 'conflict' | 'not-found' | 'unavailable'; reason?: string }

/** Loads the catalog and performs CRUD through the typed remote. */
export class CustomAgentsController {
  /** Manager snapshot the overlay subscribes to. */
  readonly store: SnapshotStore<CustomAgentsState> = createSnapshotStore(INITIAL)

  constructor(private readonly ctx: ClientContext) {}

  /**
   * Show the manager dialog with a fresh form and read the catalog behind it.
   * @param editId - roster id of the agent to open in edit mode; omitted opens a blank create.
   */
  openManager(editId?: string): void {
    const previous = this.store.getSnapshot()
    this.store.set({ ...previous, modalOpen: true, openSeq: previous.openSeq + 1, editId })
    void this.load()
  }

  /** Hide the manager dialog and drop the edit request that came with it. */
  closeManager(): void {
    this.store.set({ ...this.store.getSnapshot(), modalOpen: false, editId: undefined })
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

  /**
   * Create one agent from the submitted fields; the service re-validates.
   * @param input - the form fields.
   * @returns the created record, or the coded failure for the form.
   */
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

  /**
   * Update one agent under optimistic concurrency.
   * @param id - the record id.
   * @param input - the form fields.
   * @param version - the caller's version stamp.
   * @returns the updated record, or the coded failure for the form.
   */
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

  /**
   * Delete one agent under optimistic concurrency.
   * @param id - the record id.
   * @param version - the caller's version stamp.
   * @returns ok with no record, or the coded failure for the form.
   */
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
