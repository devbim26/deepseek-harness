/** User-created agent presets: durable CRUD, mounted into the preset registry. */
import { Context, Service } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the storageDomain Context merge (ctx.storageDomain).
import type {} from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { Config } from './config.ts'
import { customAgentsDomainSpec } from './spec.ts'
import { synthesizeDefinition } from './definition.ts'
import { slugForName, validateInput } from './validate.ts'
import type { CustomAgentCatalog, CustomAgentInput, CustomAgentPolicy, CustomAgentRecord } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    customAgentPresets: CustomAgentPresets
  }
}

/** Registry-backed CRUD for deployment-constrained, user-created agent presets. */
export class CustomAgentPresets extends TypertRemoteService {
  static inject = ['agentPresets', 'storageDomain']
  static Config = Config

  private table?: KvTable<string, CustomAgentRecord>
  private readonly registrations = new Map<string, () => Promise<void>>()

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'customAgentPresets')
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(customAgentsDomainSpec)
    this.table = domain.table('agents')
    this.ctx.effect(() => async () => {
      for (const dispose of [...this.registrations.values()]) await dispose()
      this.registrations.clear()
      await domain.close()
    }, 'custom-agent-presets.dispose')
    for (const record of [...this.table.entries()].map(([, value]) => value)) {
      await this.mount(record)
    }
  }

  /** Mount one record as a registry definition and remember its disposer. */
  private async mount(record: CustomAgentRecord): Promise<void> {
    // Delegate records feed the synthesized orchestrator roster; a record
    // referencing a delegate missing from this table fails loud here.
    const delegateRecords = record.delegates.map((id) => {
      const delegate = this.requireTable().get(id)
      if (delegate === undefined) throw new Error(`custom-agent-presets: the table no longer carries the '${id}' delegate`)
      return delegate
    })
    const dispose = await this.ctx.agentPresets.register(synthesizeDefinition(record, this.config, delegateRecords))
    this.registrations.set(record.id, dispose)
  }

  private requireTable(): KvTable<string, CustomAgentRecord> {
    const table = this.table
    if (table === undefined) throw new Error('custom-agent-presets: the service has not initialized')
    return table
  }

  private policy(): CustomAgentPolicy {
    return {
      allowedTools: Object.entries(this.config.allowedTools)
        .map(([key, entry]) => ({
          key,
          label: entry.label ?? key,
          ...(entry.description === undefined ? {} : { description: entry.description }),
        })),
      delegationAvailable: this.config.delegation !== undefined,
      maxNameChars: this.config.maxNameChars,
      maxDescriptionChars: this.config.maxDescriptionChars,
      maxInstructionsChars: this.config.maxInstructionsChars,
      maxAgents: this.config.maxAgents,
    }
  }

  /**
   * Serve the current catalog and the deployment policy.
   * @returns every stored record plus the whitelist and limits the form renders against.
   */
  @Remote('list')
  async remoteExportList(): Promise<CustomAgentCatalog> {
    const table = this.requireTable()
    const agents = [...table.entries()].map(([, value]) => value)
    return { agents, policy: this.policy() }
  }

  /** Derive the first unused `custom/<slug>` id for a name. */
  private unusedId(name: string): string {
    const table = this.requireTable()
    const base = slugForName(name)
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? base : `${base}-${n}`
      if (table.get(`custom/${candidate}`) === undefined) return `custom/${candidate}`
      if (n >= 99) {
        throw new RemoteError('custom-agent-presets/limit', 'No free slug for this name', { reason: 'slug-exhausted' })
      }
    }
  }

  /** Cross-record invariants: an orchestrator launches existing regular agents, never itself. */
  private validateDelegates(delegates: readonly string[], selfId: string): void {
    const table = this.requireTable()
    for (const id of delegates) {
      if (id === selfId) throw new RemoteError('custom-agent-presets/invalid', 'An agent cannot launch itself', { reason: 'self-delegate' })
      const target = table.get(id)
      if (target === undefined) throw new RemoteError('custom-agent-presets/invalid', `Unknown delegate: ${id}`, { reason: 'unknown-delegate' })
      if (target.isOrchestrator) throw new RemoteError('custom-agent-presets/invalid', `Delegates must not be orchestrators: ${id}`, { reason: 'orchestrator-delegate' })
    }
  }

  /** An agent another orchestrator launches cannot become an orchestrator itself. */
  private assertNotLaunched(id: string): void {
    for (const [otherId, record] of this.requireTable().entries()) {
      if (otherId !== id && record.delegates.includes(id)) {
        throw new RemoteError('custom-agent-presets/invalid', `Another orchestrator launches this agent: ${otherId}`, { reason: 'referenced-by-orchestrator' })
      }
    }
  }

  /** Validate the orchestrator shape shared by create and update. */
  private assertOrchestratorFields(fields: Pick<CustomAgentInput, 'isOrchestrator' | 'delegates'>, selfId: string): void {
    if (!fields.isOrchestrator) return
    if (fields.delegates.length === 0) {
      throw new RemoteError('custom-agent-presets/invalid', 'An orchestrator must launch at least one agent', { reason: 'empty-delegates' })
    }
    this.assertNotLaunched(selfId)
    this.validateDelegates(fields.delegates, selfId)
  }

  /**
   * Validate, persist, and mount one new agent; the id derives from the name.
   * @param input - the client-submitted fields.
   * @returns the stored record at version 1.
   */
  @Remote('create')
  async create(input: CustomAgentInput): Promise<CustomAgentRecord> {
    const table = this.requireTable()
    if (table.size >= this.config.maxAgents) {
      throw new RemoteError(
        'custom-agent-presets/limit',
        `The deployment allows at most ${this.config.maxAgents} custom agents`,
        { reason: 'max-agents' },
      )
    }
    const fields = await validateInput(input, this.config)
    const id = this.unusedId(fields.name)
    this.assertOrchestratorFields(fields, id)
    const record: CustomAgentRecord = {
      id,
      slug: id.slice('custom/'.length),
      ...fields,
      version: 1,
      updatedAt: new Date().toISOString(),
    }
    await table.put(record.id, record)
    await this.mount(record)
    return record
  }

  /**
   * Validate, persist, and remount one agent as a new revision; running
   * sessions keep their composition. Referencing orchestrators remount too —
   * the synthesized roster mirrors the delegate's current name and
   * description — while their stored records keep their versions.
   * @param id - the record id.
   * @param input - the client-submitted fields.
   * @param version - the caller's version stamp.
   * @returns the stored record at `version + 1`.
   */
  @Remote('update')
  async update(id: string, input: CustomAgentInput, version: number): Promise<CustomAgentRecord> {
    const table = this.requireTable()
    const stored = table.get(id)
    if (stored === undefined) {
      throw new RemoteError('custom-agent-presets/not-found', `Unknown custom agent: ${id}`, { agentPreset: id })
    }
    if (stored.version !== version) {
      throw new RemoteError('custom-agent-presets/conflict', 'The record changed elsewhere; reload and retry', { expectedVersion: stored.version })
    }
    const fields = await validateInput(input, this.config)
    this.assertOrchestratorFields(fields, id)
    const previous = this.registrations.get(id)
    if (previous !== undefined) await previous()
    this.registrations.delete(id)
    const record: CustomAgentRecord = { ...stored, ...fields, version: stored.version + 1, updatedAt: new Date().toISOString() }
    await table.put(id, record)
    await this.mount(record)
    for (const [otherId, other] of table.entries()) {
      if (!other.delegates.includes(id)) continue
      const previousRegistration = this.registrations.get(otherId)
      if (previousRegistration !== undefined) await previousRegistration()
      this.registrations.delete(otherId)
      await this.mount(other)
    }
    return record
  }

  /**
   * Unmount and delete one agent under optimistic concurrency.
   * @param id - the record id.
   * @param version - the caller's version stamp.
   */
  @Remote('delete')
  async remove(id: string, version: number): Promise<void> {
    const table = this.requireTable()
    const stored = table.get(id)
    if (stored === undefined) {
      throw new RemoteError('custom-agent-presets/not-found', `Unknown custom agent: ${id}`, { agentPreset: id })
    }
    if (stored.version !== version) {
      throw new RemoteError('custom-agent-presets/conflict', 'The record changed elsewhere; reload and retry', { expectedVersion: stored.version })
    }
    const previous = this.registrations.get(id)
    if (previous !== undefined) await previous()
    this.registrations.delete(id)
    await table.delete(id)
    // Cascade: drop the deleted agent from every orchestrator's delegates and
    // remount the trimmed records; an emptied list unmounts the tool row.
    for (const [otherId, record] of table.entries()) {
      if (!record.delegates.includes(id)) continue
      const next: CustomAgentRecord = {
        ...record,
        delegates: record.delegates.filter(entry => entry !== id),
        version: record.version + 1,
        updatedAt: new Date().toISOString(),
      }
      await table.put(otherId, next)
      const previousRegistration = this.registrations.get(otherId)
      if (previousRegistration !== undefined) await previousRegistration()
      this.registrations.delete(otherId)
      await this.mount(next)
    }
  }
}

export default CustomAgentPresets
