/** User-created agent presets: durable CRUD, mounted into the preset registry. */
import { Context, Service } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the storageDomain Context merge (ctx.storageDomain).
import type {} from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { Config } from './config.ts'
import { customAgentsDomainSpec } from './spec.ts'
import { synthesizeDefinition } from './definition.ts'
import type { CustomAgentCatalog, CustomAgentPolicy, CustomAgentRecord } from './types.ts'

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
}

export default CustomAgentPresets
