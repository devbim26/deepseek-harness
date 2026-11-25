/** Model-visible prompts owned by the conversational engine. */
import { AgentOrchestratorError } from './error.ts'
import type { AgentOrchestrationAssignment, AgentOrchestrationFollowUp, AgentOrchestrationStartRequest, AgentOrchestrationWorkerResult } from './types.ts'

const AUTONOMY = 'Do not ask a human questions or wait for confirmation. Record missing facts as explicit assumptions or gaps and continue with the available evidence.'

/**
 * The text format of the model-authored report strings the run PDF prints. The
 * PDF renders a small Markdown subset, and `==...==` is the one mark it adds
 * to it; the engine removes that mark from every text that leaves the run.
 */
const REPORT_FORMAT = 'Every text field of the report is printed in a PDF that renders a small Markdown subset: '
  + 'write it as prose, "- " list items, or a pipe table with a header row and a --- separator row, '
  + 'and wrap the key facts, figures, and conclusions in ==...== so they print on a yellow band. '
  + 'Mark sparingly and never a whole sentence.'

/**
 * The exact decision shapes the evaluator must produce, stated field by field
 * so the answer survives the strict decoder. Each kind omits the other kinds'
 * fields rather than leaving them empty. The last line states the report text
 * format, because the decision's summary, assumptions, and gaps reach the PDF.
 */
const EVALUATOR_CONTRACT = [
  'Evaluate completeness. Answer with exactly one JSON object using only these fields and no others:',
  '- {"kind":"follow-ups","followUps":[{"assignmentId":"<a known assignment id>","question":"<targeted question>","circumstances":"<optional new facts>"}]} to request targeted follow-ups for known assignment ids;',
  '- {"kind":"complete","summary":"<summary>","assumptions":["..."],"gaps":["..."]} to complete;',
  '- {"kind":"partial","summary":"<summary>","reason":"<why incomplete>","assumptions":["..."],"gaps":["..."]} or {"kind":"blocked","summary":"<summary>","reason":"<why incomplete>","assumptions":["..."],"gaps":["..."]} when the objective cannot be completed.',
  'Fields of the other kinds must be omitted, not left empty or null. Do not request more work than the remaining round budget can perform.',
  REPORT_FORMAT,
].join('\n')

/**
 * Corrective follow-up after an invalid structured decision.
 * @param diagnostic - The decoder diagnostic the rejected answer failed with.
 * @returns The corrective follow-up prompt restating the decision contract.
 */
export function evaluatorCorrectionPrompt(diagnostic: string): string {
  return [
    `Your previous structured decision was rejected: ${diagnostic}`,
    'Answer again with a corrected decision. ' + EVALUATOR_CONTRACT,
  ].join('\n\n')
}

/**
 * Build the initial self-contained worker task.
 *
 * @param assignment - Assignment carrying the delegate prompt for this worker.
 * @returns The assignment prompt, the autonomy statement, the report instruction, and the report text format.
 */
export function workerPrompt(assignment: AgentOrchestrationAssignment): string {
  return `${assignment.prompt}\n\n${AUTONOMY}\nReturn a structured report with summary, evidence, assumptions, and gaps. ${REPORT_FORMAT}`
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
    EVALUATOR_CONTRACT,
  ].filter(line => line !== '').join('\n\n')
}
