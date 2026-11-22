/** Model-visible prompts owned by the conversational engine. */
import { AgentOrchestratorError } from './error.ts'
import type { AgentOrchestrationAssignment, AgentOrchestrationFollowUp, AgentOrchestrationStartRequest, AgentOrchestrationWorkerResult } from './types.ts'

const AUTONOMY = 'Do not ask a human questions or wait for confirmation. Record missing facts as explicit assumptions or gaps and continue with the available evidence.'

/**
 * Build the initial self-contained worker task.
 *
 * @param assignment - Assignment carrying the delegate prompt for this worker.
 * @returns The assignment prompt, the autonomy statement, and the report instruction.
 */
export function workerPrompt(assignment: AgentOrchestrationAssignment): string {
  return `${assignment.prompt}\n\n${AUTONOMY}\nReturn a structured report with summary, evidence, assumptions, and gaps.`
}

/**
 * Build a targeted continuation on the same worker Session.
 *
 * @param followUp - Evaluator follow-up with its question and optional circumstances.
 * @returns The follow-up header, the autonomy statement, and the replacement instruction.
 */
export function workerFollowUpPrompt(followUp: AgentOrchestrationFollowUp): string {
  return [
    `Follow-up for your previous work: ${followUp.question}`,
    followUp.circumstances === undefined ? '' : `New circumstances: ${followUp.circumstances}`,
    AUTONOMY,
    'Return a new structured report that replaces your previous summary and accounts for this follow-up.',
  ].filter(line => line !== '').join('\n\n')
}

/**
 * Build evaluator input with the complete bounded current worker set.
 *
 * @param request - Start request supplying the objective and optional circumstances.
 * @param workers - Current worker results serialized into the handoff.
 * @param maxHandoffChars - Maximum serialized handoff length.
 * @returns The evaluator prompt with its framing and decision instruction.
 * @throws AgentOrchestratorError with `ORCHESTRATION_HANDOFF_LIMIT` when the handoff is oversized.
 */
export function evaluatorPrompt(
  request: AgentOrchestrationStartRequest,
  workers: readonly AgentOrchestrationWorkerResult[],
  maxHandoffChars: number,
): string {
  const serialized = JSON.stringify(workers)
  if (serialized.length > maxHandoffChars) {
    throw new AgentOrchestratorError(`worker handoff exceeds ${maxHandoffChars} characters`, 'ORCHESTRATION_HANDOFF_LIMIT')
  }
  return [
    `Original objective: ${request.objective}`,
    request.circumstances === undefined ? '' : `Initial circumstances: ${request.circumstances}`,
    `Current worker reports: ${serialized}`,
    AUTONOMY,
    'Evaluate completeness. Return targeted follow-ups only for known assignment ids, or complete, partial, or blocked with a summary and explicit assumptions/gaps. Do not request more work than the remaining round budget can perform.',
  ].filter(line => line !== '').join('\n\n')
}
