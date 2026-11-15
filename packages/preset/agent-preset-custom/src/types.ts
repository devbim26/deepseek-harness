/** Client-safe payloads and error details owned by the custom-agent-presets domain. */

/**
 * One user-created agent as a client reads it.
 */
export interface CustomAgentRecord {
  /** Roster identity: `custom/<slug>`. */
  readonly id: string
  /** The slug behind the id; immutable after create. */
  readonly slug: string
  /** Display name. */
  readonly name: string
  /** One sentence on what this agent is for. */
  readonly description: string
  /** Persona instructions rendered as the agent's prompt prefix. */
  readonly instructions: string
  /** Keys of the deployment whitelist this agent mounts. */
  readonly tools: readonly string[]
  /** Optimistic-concurrency stamp; every write increments it. */
  readonly version: number
  /** Last write time, ISO-8601. */
  readonly updatedAt: string
}

/** Fields a client submits for create or update. */
export interface CustomAgentInput {
  readonly name: string
  readonly description: string
  readonly instructions: string
  readonly tools: readonly string[]
}

/** One whitelisted tool as the form renders it. */
export interface CustomAgentToolOption {
  /** The record key the agent stores. */
  readonly key: string
  /** Human-readable label; the key when the deployment config omits one. */
  readonly label: string
}

/** The deployment-authored limits and whitelist the form renders against. */
export interface CustomAgentPolicy {
  readonly allowedTools: readonly CustomAgentToolOption[]
  readonly maxNameChars: number
  readonly maxDescriptionChars: number
  readonly maxInstructionsChars: number
  readonly maxAgents: number
}

/** The catalog one deployment currently serves. */
export interface CustomAgentCatalog {
  readonly agents: readonly CustomAgentRecord[]
  readonly policy: CustomAgentPolicy
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** A field broke its limit or names an unknown tool. */
    'custom-agent-presets/invalid': { readonly reason: string }
    /** No stored record carries the requested identity. */
    'custom-agent-presets/not-found': { readonly agentPreset: string }
    /** The deployment-wide cap is reached, or no slug remains for a name. */
    'custom-agent-presets/limit': { readonly reason: string }
    /** The caller's version stamp does not match the stored record. */
    'custom-agent-presets/conflict': { readonly expectedVersion: number }
  }
}

export {}
