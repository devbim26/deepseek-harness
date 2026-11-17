/** Service configuration: the deployment-authored template, whitelist, and limits. */
import z from '@deepseek-ai/schemastery'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'

/** One whitelisted plugin row that a selecting agent mounts. */
export interface AllowedToolsEntry {
  /** Package name of the mounted plugin row. */
  name: string
  /** Optional row config; the Loader validates it when the agent mounts the row. */
  config?: unknown
  /** Human-readable label the manager form renders; the key when omitted. */
  label?: string
  /** Optional one-sentence description the form renders under the checkbox. */
  description?: string
}

/** The delegation row template an orchestrator mounts; its presence enables the orchestrator flag. */
export interface DelegationEntry {
  /** Package name of the mounted delegation plugin row. */
  name: string
  /** Base row config; the service adds `allowedAgentPresets` from the record. */
  config?: Record<string, unknown>
}

/** Config of the `agent-preset-custom` service row. */
export interface Config {
  /** Site persona prepended to every custom agent's instructions. */
  instructionsPrefix: string
  /** Fixed child rows (agent-instructions, time-context, compaction) the deployment copies from its standard preset, minus persona. */
  basePlugins: PresetDefinition['plugins']
  /** Whitelist: entry key → the plugin row a selecting agent mounts; an unchecked entry is a hard block. */
  allowedTools: Record<string, AllowedToolsEntry>
  /** Delegation row template for orchestrators; omit or pass `undefined` to disable the orchestrator flag entirely. */
  delegation?: DelegationEntry | undefined
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
  allowedTools: z.dict(z.object({ name: z.string().required(), config: z.any(), label: z.string(), description: z.string() })).default({}),
  delegation: (z.object({ name: z.string().required(), config: z.dict(z.any()) }) as z<DelegationEntry | undefined>).default(undefined),
  maxNameChars: z.number().default(64),
  maxDescriptionChars: z.number().default(200),
  maxInstructionsChars: z.number().default(16384),
  maxAgents: z.number().default(50),
}) as z<Config>
