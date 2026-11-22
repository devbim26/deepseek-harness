/** Durable custom-agent records and configured default resolution. */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Config } from './config.ts'
import type { CustomAgentRecord } from './types.ts'

/** Durable representation; omitted orchestration fields belong to older builds and older clients. */
export type StoredCustomAgentRecord = Omit<CustomAgentRecord, 'orchestratorMaxIterations' | 'orchestratorMaxParallel' | 'orchestratorAutoReport'> & {
  readonly orchestratorMaxIterations?: number | undefined
  readonly orchestratorMaxParallel?: number | undefined
  readonly orchestratorAutoReport?: boolean | undefined
}

/** Zod shape of one stored record; validates every read at the durable boundary. */
export const customAgentRecord = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  instructions: z.string(),
  tools: z.array(z.string()),
  isOrchestrator: z.boolean().default(false),
  delegates: z.array(z.string()).default([]),
  orchestratorMaxIterations: z.number().optional(),
  orchestratorMaxParallel: z.number().optional(),
  orchestratorAutoReport: z.boolean().optional(),
  hidden: z.boolean().default(false),
  version: z.number().int(),
  updatedAt: z.string(),
})

/**
 * Materialize configured defaults without changing the domain version.
 *
 * @param record - Stored record, whose omitted orchestration fields belong to older builds.
 * @param config - Deployment configuration supplying the orchestration defaults.
 * @returns The full custom-agent record with every orchestration field present.
 */
export function resolveRecord(record: StoredCustomAgentRecord, config: Config): CustomAgentRecord {
  return {
    ...record,
    orchestratorMaxIterations: record.orchestratorMaxIterations ?? config.orchestratorDefaults.maxIterations,
    orchestratorMaxParallel: record.orchestratorMaxParallel ?? config.orchestratorDefaults.maxParallel,
    orchestratorAutoReport: record.orchestratorAutoReport ?? config.orchestratorDefaults.autoReport,
  }
}

/** The custom-agent domain: one `agents` table keyed by roster id. */
export const customAgentsDomainSpec = defineDomain({
  name: 'custom_agent_presets',
  version: 1,
  invalidRecords: 'backup-and-skip',
  tables: { agents: domainTable<string, StoredCustomAgentRecord>(customAgentRecord) },
})
