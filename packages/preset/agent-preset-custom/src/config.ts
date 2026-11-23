/** Service configuration: deployment templates, whitelist, and orchestration policy. */
import z from '@deepseek-ai/schemastery'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry/types'

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

/** One additional orchestrator-only row, such as the shared subagent control tools. */
export interface DelegationControlEntry {
  /** Package name of the mounted control plugin row. */
  name: string
  /** Row config passed through to the plugin. */
  config?: Record<string, unknown>
}

/** The delegation row template an orchestrator mounts; its presence enables the orchestrator flag. */
export interface DelegationEntry {
  /** Package name of the mounted delegation plugin row. */
  name: string
  /** Base row config; the service adds `allowedAgentPresets` from the record. */
  config?: Record<string, unknown>
  /** Lead-in text appended to an orchestrator's persona ahead of the rendered delegate roster. */
  rosterTemplate?: string | undefined
  /** Additional orchestrator-only row, such as shared subagent control tools. */
  control?: DelegationControlEntry | undefined
}

/** One plugin row used by the conversational orchestration template. */
export interface OrchestrationPluginEntry {
  /** Package name of the mounted plugin row. */
  name: string
  /** Row config passed through before stored-record values are applied. */
  config?: Record<string, unknown>
  /** Cordis service the row publishes; omission uses the package's known service. */
  service?: string | undefined
}

/** Conversational workers/evaluator composition mounted instead of prompt-only delegation. */
export interface OrchestrationEntry {
  /** Scoped engine service row. */
  engine: OrchestrationPluginEntry
  /** Model-facing orchestrate_agents row. */
  tool: OrchestrationPluginEntry
  /** PDF service row, deduplicated by package name. */
  pdf: OrchestrationPluginEntry
  /** Interactive delivery service row, deduplicated by package name. */
  present: OrchestrationPluginEntry
  /** Evaluator preset; omission uses the orchestrator record itself. */
  evaluatorPreset?: string | undefined
}

/** Stored-record defaults published to the manager form. */
export interface OrchestratorDefaults {
  /** Rounds a new orchestrator record starts with. */
  readonly maxIterations: number
  /** Simultaneously active workers a new orchestrator record starts with. */
  readonly maxParallel: number
  /** Whether a new orchestrator record reports through a PDF. */
  readonly autoReport: boolean
}

/** Maximum values accepted for one stored record. */
export interface OrchestratorCeilings {
  /** Largest stored round count. */
  readonly maxIterations: number
  /** Largest stored parallelism count. */
  readonly maxParallel: number
}

/** Config of the `agent-preset-custom` service row. */
export interface Config {
  /** Site persona prepended to every custom agent's instructions. */
  instructionsPrefix: string
  /** Fixed child rows copied from the deployment's standard preset, minus persona. */
  basePlugins: PresetDefinition['plugins']
  /** Whitelist: entry key → the plugin row a selecting agent mounts. */
  allowedTools: Record<string, AllowedToolsEntry>
  /** Legacy prompt-only delegation template. */
  delegation?: DelegationEntry | undefined
  /** Conversational orchestration template; takes precedence when configured. */
  orchestration?: OrchestrationEntry | undefined
  /** Values materialized for legacy records and omitted wire fields. */
  orchestratorDefaults: OrchestratorDefaults
  /** Maximum stored iteration and parallelism values. */
  orchestratorCeilings: OrchestratorCeilings
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
  delegation: (z.object({
    name: z.string().required(),
    config: z.dict(z.any()),
    rosterTemplate: z.string(),
    control: (z.object({
      name: z.string().required(),
      config: z.dict(z.any()),
    }) as z<DelegationControlEntry | undefined>).default(undefined),
  }) as z<DelegationEntry | undefined>).default(undefined),
  orchestration: (z.object({
    engine: z.object({ name: z.string().required(), config: z.dict(z.any()) }),
    tool: z.object({ name: z.string().required(), config: z.dict(z.any()) }),
    pdf: z.object({ name: z.string().required(), config: z.dict(z.any()) }),
    present: z.object({ name: z.string().required(), config: z.dict(z.any()) }),
    evaluatorPreset: z.string().min(1),
  }) as z<OrchestrationEntry | undefined>).default(undefined),
  orchestratorDefaults: z.object({
    maxIterations: z.number().step(1).min(1).max(10).default(3),
    maxParallel: z.number().step(1).min(1).max(10).default(3),
    autoReport: z.boolean().default(true),
  }).default({ maxIterations: 3, maxParallel: 3, autoReport: true }),
  orchestratorCeilings: z.object({
    maxIterations: z.number().step(1).min(1).max(10).default(10),
    maxParallel: z.number().step(1).min(1).max(10).default(10),
  }).default({ maxIterations: 10, maxParallel: 10 }),
  maxNameChars: z.number().default(64),
  maxDescriptionChars: z.number().default(200),
  maxInstructionsChars: z.number().default(16384),
  maxAgents: z.number().default(50),
}) as z<Config>
