/** Public request, result, and run-handle contracts for conversational orchestration. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Branded identity of one foreground orchestration run. */
export type AgentOrchestrationRunId = Branded<'AgentOrchestrationRunId'>

/** One delegate selected by the owning preset. */
export interface AgentOrchestrationAssignment {
  /** Stable assignment id used by evaluator follow-ups. */
  readonly id: string
  /** Independent preset id; omitted inherits the parent composition. */
  readonly agentPreset?: string
  /** Complete initial task for the worker. */
  readonly prompt: string
}

/** Optional PDF output owned by the run, never a client-selected path. */
export interface AgentOrchestrationReportRequest {
  /** Report title. */
  readonly title: string
  /** Additional key/value facts rendered near the beginning of the report. */
  readonly details: readonly { readonly label: string; readonly value: string }[]
}

/** Start inputs for one foreground run. */
export interface AgentOrchestrationStartRequest {
  /** Exact live root Agent owning every child. */
  readonly parent: Agent
  /** Original user objective. */
  readonly objective: string
  /** New facts available at run start. */
  readonly circumstances?: string | undefined
  /** Stored or explicitly authorized delegate tasks. */
  readonly assignments: readonly AgentOrchestrationAssignment[]
  /** Evaluator preset; omitted inherits the parent composition. */
  readonly evaluatorPreset?: string
  /** Maximum worker/evaluator rounds, including the first. */
  readonly maxIterations: number
  /** Maximum simultaneously active worker Activations. */
  readonly maxParallel: number
  /** PDF to create after a non-failed terminal outcome; omitted disables reporting. */
  readonly report?: AgentOrchestrationReportRequest
  /** External cancellation joined to the run-owned controller. */
  readonly signal?: AbortSignal
}

/** Structured worker report captured by the subagent runtime. */
export interface AgentOrchestrationWorkerReport {
  readonly summary: string
  readonly evidence: readonly string[]
  readonly assumptions: readonly string[]
  readonly gaps: readonly string[]
}

/** Evaluator request for targeted worker continuation. */
export interface AgentOrchestrationFollowUp {
  readonly assignmentId: string
  readonly question: string
  readonly circumstances?: string | undefined
}

/** Structured evaluator decision. */
export type AgentOrchestrationEvaluatorDecision =
  | { readonly kind: 'follow-ups'; readonly followUps: readonly AgentOrchestrationFollowUp[] }
  | { readonly kind: 'complete'; readonly summary: string; readonly assumptions: readonly string[]; readonly gaps: readonly string[] }
  | { readonly kind: 'partial'; readonly summary: string; readonly reason: string; readonly assumptions: readonly string[]; readonly gaps: readonly string[] }
  | { readonly kind: 'blocked'; readonly summary: string; readonly reason: string; readonly assumptions: readonly string[]; readonly gaps: readonly string[] }

/** Latest result of one assignment. */
export interface AgentOrchestrationWorkerResult {
  readonly assignmentId: string
  readonly childId?: SessionId | undefined
  readonly rounds: number
  readonly report?: AgentOrchestrationWorkerReport | undefined
  readonly error?: string | undefined
}

/** PDF metadata safe for Remote and run journals. */
export interface AgentOrchestrationPdf {
  readonly path: string
  readonly name: string
  readonly bytes: number
  readonly pages: number
}

/** Process-local run status; process loss is reported by the owning adapter. */
export type AgentOrchestrationStatus = 'queued' | 'running' | 'complete' | 'partial' | 'budget-limited' | 'failed' | 'cancelled'

/** Settled statuses that may produce a terminal result value. */
export type AgentOrchestrationTerminalStatus = Exclude<AgentOrchestrationStatus, 'queued' | 'running'>

/** Current active or settled run snapshot. */
export interface AgentOrchestrationSnapshot {
  readonly id: AgentOrchestrationRunId
  readonly status: AgentOrchestrationStatus
  readonly objective: string
  readonly rounds: number
  readonly summary: string
  readonly workers: readonly AgentOrchestrationWorkerResult[]
  readonly assumptions: readonly string[]
  readonly gaps: readonly string[]
  readonly errors: readonly string[]
  readonly pdf?: AgentOrchestrationPdf
}

/** Terminal run result; only complete/partial/budget-limited may carry a PDF. */
export interface AgentOrchestrationResult extends AgentOrchestrationSnapshot {
  readonly status: AgentOrchestrationTerminalStatus
}

/** Holder-owned foreground run. */
export interface AgentOrchestrationRun {
  readonly id: AgentOrchestrationRunId
  /** Resolves with every terminal outcome, including infrastructure failure. */
  readonly result: Promise<AgentOrchestrationResult>
  /** Request cancellation; the first reason wins. */
  cancel(reason?: string): void
  /** Cancel unfinished work and await child and PDF quiescence. */
  dispose(): Promise<void>
}
