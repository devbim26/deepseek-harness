/** The durable declaration of the custom-agent-presets domain. */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { CustomAgentRecord } from './types.ts'

/** Zod shape of one stored record; validates every read at the durable boundary. */
export const customAgentRecord = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  instructions: z.string(),
  tools: z.array(z.string()),
  version: z.number().int(),
  updatedAt: z.string(),
})

/**
 * The custom-agent domain: one `agents` table keyed by roster id. Records
 * that no longer parse are backed up and skipped at open, so a bad file
 * cannot take the deployment down; the backup and log line are the
 * visible quarantine.
 */
export const customAgentsDomainSpec = defineDomain({
  name: 'custom_agent_presets',
  version: 1,
  invalidRecords: 'backup-and-skip',
  tables: { agents: domainTable<string, CustomAgentRecord>(customAgentRecord) },
})
