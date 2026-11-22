/** Expected model-tool failure with a stable machine code. */
import { HarnessError } from '@deepseek-ai/dsh-error'

/** Error type kept local to the function plugin entry. */
export class ToolAgentOrchestratorError extends HarnessError {
  constructor(message: string, code: 'ORCHESTRATION_INVALID_REQUEST' | 'ORCHESTRATION_FAILED' | 'ORCHESTRATION_CANCELLED', options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'AgentOrchestratorError'
  }
}
