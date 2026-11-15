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
    const dispose = await this.ctx.agentPresets.register(synthesizeDefinition(record, this.config))
    this.registrations.set(record.id, dispose)
  }

  private requireTable(): KvTable<string, CustomAgentRecord> {
    const table = this.table
    if (table === undefined) throw new Error('custom-agent-presets: the service has not initialized')
    return table
  }

  private policy(): CustomAgentPolicy {
    return {
      allowedTools: Object.keys(this.config.allowedTools),
      maxNameChars: this.config.maxNameChars,
      maxDescriptionChars: this.config.maxDescriptionChars,
      maxInstructionsChars: this.config.maxInstructionsChars,
      maxAgents: this.config.maxAgents,
    }
  }

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
    const previous = this.registrations.get(id)
    if (previous !== undefined) await previous()
    this.registrations.delete(id)
    const record: CustomAgentRecord = { ...stored, ...fields, version: stored.version + 1, updatedAt: new Date().toISOString() }
    await table.put(id, record)
    await this.mount(record)
    return record
  }

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
  }
}

export default CustomAgentPresets
