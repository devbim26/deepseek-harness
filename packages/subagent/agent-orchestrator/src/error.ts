/** Typed orchestration failures. */
import { HarnessError } from '@deepseek-ai/dsh-error'

/** Stable codes an orchestration failure can carry. */
export type AgentOrchestratorErrorCode =
  | 'ORCHESTRATION_INVALID_REQUEST'
  | 'ORCHESTRATION_NESTED'
  | 'ORCHESTRATION_WORKER_FAILED'
  | 'ORCHESTRATION_EVALUATOR_FAILED'
  | 'ORCHESTRATION_FAILED'
  | 'ORCHESTRATION_CANCELLED'
  | 'ORCHESTRATION_HANDOFF_LIMIT'
  | 'ORCHESTRATION_REPORT_UNAVAILABLE'
  | 'ORCHESTRATION_REPORT_FAILED'
  | 'ORCHESTRATION_CLEANUP_FAILED'
  | 'ORCHESTRATION_NOT_FOUND'
  | 'HUMAN_INPUT_FORBIDDEN'

/** Expected orchestration failure with a stable machine code. */
export class AgentOrchestratorError extends HarnessError {
  constructor(message: string, code: AgentOrchestratorErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'AgentOrchestratorError'
  }
}
