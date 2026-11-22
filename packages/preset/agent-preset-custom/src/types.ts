/** Client-safe payloads and error details owned by the custom-agent-presets domain. */
import type { OrchestratorCeilings, OrchestratorDefaults } from './config.ts'

/** One user-created agent as a client reads it. */
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
  /** Whether this agent may launch other custom agents as subagents. */
  readonly isOrchestrator: boolean
  /** Ids of the custom agents this orchestrator launches; regular agents only. */
  readonly delegates: readonly string[]
  /** Maximum worker/evaluator rounds, including the first. */
  readonly orchestratorMaxIterations: number
  /** Maximum simultaneously active workers. */
  readonly orchestratorMaxParallel: number
  /** Whether a successful domain outcome creates a PDF report. */
  readonly orchestratorAutoReport: boolean
  /** Whether the preset picker offers this agent; hidden agents stay launchable by orchestrators. */
  readonly hidden: boolean
  /** Optimistic-concurrency stamp; every write increments it. */
  readonly version: number
  /** Last write time, ISO-8601. */
  readonly updatedAt: string
}

/** Fields a client submits for create or update; omitted orchestration values receive policy defaults. */
export interface CustomAgentInput {
  readonly name: string
  readonly description: string
  readonly instructions: string
  readonly tools: readonly string[]
  readonly isOrchestrator: boolean
  readonly delegates: readonly string[]
  readonly orchestratorMaxIterations?: number | undefined
  readonly orchestratorMaxParallel?: number | undefined
  readonly orchestratorAutoReport?: boolean | undefined
  readonly hidden: boolean
}

/** Fully resolved input persisted by create and update. */
export type ResolvedCustomAgentInput = Omit<CustomAgentInput, 'orchestratorMaxIterations' | 'orchestratorMaxParallel' | 'orchestratorAutoReport'> & {
  readonly orchestratorMaxIterations: number
  readonly orchestratorMaxParallel: number
  readonly orchestratorAutoReport: boolean
}

/** One whitelisted tool as the form renders it. */
export interface CustomAgentToolOption {
  /** The record key the agent stores. */
  readonly key: string
  /** Human-readable label; the key when the deployment config omits one. */
  readonly label: string
  /** Deployment-authored description the form renders under the checkbox; omitted when none. */
  readonly description?: string
}

/** The deployment-authored limits and whitelist the form renders against. */
export interface CustomAgentPolicy {
  readonly allowedTools: readonly CustomAgentToolOption[]
  /** Whether either delegation template enables the orchestrator checkbox. */
  readonly delegationAvailable: boolean
  readonly orchestratorDefaults: OrchestratorDefaults
  readonly orchestratorCeilings: OrchestratorCeilings
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

/** One delegate task a caller may assign. */
export interface CustomAgentOrchestrationAssignment {
  /** Identifier of one stored delegate. */
  readonly id: string
  /** Initial task for that delegate. */
  readonly prompt: string
}

/** Start request for one orchestration run. */
export interface CustomAgentOrchestrationStartRequest {
  /** Session whose live root owns the run. */
  readonly sessionId: string
  /** Complete user objective. */
  readonly objective: string
  /** Optional facts available at the start. */
  readonly circumstances?: string | undefined
  /** Optional subset of the stored delegates with their initial tasks. */
  readonly assignments?: readonly CustomAgentOrchestrationAssignment[] | undefined
  /** Optional report title and key/value facts for the generated PDF. */
  readonly report?: {
    readonly title: string
    readonly details?: readonly { readonly label: string; readonly value: string }[]
  } | undefined
}

/** Run identity addressed by the status and cancel calls. */
export interface CustomAgentOrchestrationRunRequest {
  /** Session whose live root owns the run. */
  readonly sessionId: string
  /** Run identity returned by the start call. */
  readonly runId: string
}

/** Latest state of one orchestration run. */
export interface CustomAgentOrchestrationStatusValue {
  /** Run identity. */
  readonly runId: string
  /** Current status. */
  readonly status: 'queued' | 'running' | 'complete' | 'partial' | 'budget-limited' | 'failed' | 'cancelled'
  /** Completed worker/evaluator rounds. */
  readonly rounds: number
  /** Consolidated summary. */
  readonly summary: string
  /** Latest state of each delegate. */
  readonly workers: readonly { readonly assignmentId: string; readonly childId?: string; readonly rounds: number }[]
  /** Known gaps and unproven assumptions. */
  readonly gaps: readonly string[]
  /** Generated PDF metadata; absent until a domain outcome produced one. */
  readonly pdf?: { readonly path: string; readonly name: string; readonly bytes: number; readonly pages: number }
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
    /** The request or the stored record does not allow this orchestration. */
    'custom-agent-orchestrations/invalid': { readonly reason: string }
    /** The Session, its live root, or the engine service is not available. */
    'custom-agent-orchestrations/unavailable': { readonly reason: string }
    /** The run is unknown in this process. */
    'custom-agent-orchestrations/not-found': { readonly runId: string }
  }
}

export {}
