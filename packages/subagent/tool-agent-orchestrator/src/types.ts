/** Model-safe result of one stored conversational orchestration preset. */

/** Terminal domain outcomes that may be returned to the model. */
export type OrchestrationToolStatus = 'complete' | 'partial' | 'budget-limited'

/** Non-binary PDF metadata returned by the engine. */
export interface OrchestrationToolPdf {
  readonly path: string
  readonly name: string
  readonly bytes: number
  readonly pages: number
}

/** Latest public state of one stored delegate. */
export interface OrchestrationToolWorker {
  readonly assignmentId: string
  readonly childId?: string
  readonly rounds: number
}

/** Bounded model-facing orchestration result. */
export interface OrchestrationToolResult {
  readonly id: string
  readonly status: OrchestrationToolStatus
  readonly rounds: number
  readonly summary: string
  readonly workers: readonly OrchestrationToolWorker[]
  readonly gaps: readonly string[]
  readonly pdf?: OrchestrationToolPdf
}
