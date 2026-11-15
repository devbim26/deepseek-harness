/** Service configuration: the deployment-authored template, whitelist, and limits. */
import z from '@deepseek-ai/schemastery'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'

/** One whitelisted plugin row that a selecting agent mounts. */
export interface AllowedToolsEntry {
  /** Package name of the mounted plugin row. */
  name: string
  /** Optional row config; the Loader validates it when the agent mounts the row. */
  config?: unknown
}

/** Config of the `agent-preset-custom` service row. */
export interface Config {
  /** Site persona prepended to every custom agent's instructions. */
  instructionsPrefix: string
  /** Fixed child rows (agent-instructions, time-context, compaction) the deployment copies from its standard preset, minus persona. */
  basePlugins: PresetDefinition['plugins']
  /** Whitelist: entry key → the plugin row a selecting agent mounts. */
  allowedTools: Record<string, AllowedToolsEntry>
  /** Name length cap. */
  maxNameChars: number
  /** Description length cap. */
  maxDescriptionChars: number
  /** Instructions length cap. */
  maxInstructionsChars: number
  /** Deployment-wide record cap. */
  maxAgents: number
}

/** Runtime schema for the service row. */
export const Config: z<Config> = z.object({
  instructionsPrefix: z.string().default(''),
  basePlugins: z.array(z.any()).default([]),
  allowedTools: z.dict(z.object({ name: z.string().required(), config: z.any() })).default({}),
  maxNameChars: z.number().default(64),
  maxDescriptionChars: z.number().default(200),
  maxInstructionsChars: z.number().default(16384),
  maxAgents: z.number().default(50),
}) as z<Config>
