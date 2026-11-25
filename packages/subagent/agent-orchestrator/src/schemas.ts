/** Model-boundary schemas and decoders for worker reports and evaluator decisions. */
import { z } from 'zod'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { AgentOrchestratorError } from './error.ts'
import type { AgentOrchestrationEvaluatorDecision, AgentOrchestrationWorkerReport } from './types.ts'

const shortList = z.array(z.string().trim().min(1).max(2_000)).max(32)
const workerReport = z.object({
  summary: z.string().trim().min(1).max(16_000),
  evidence: shortList,
  assumptions: shortList,
  gaps: shortList,
}).strict()

/** Object schema the model receives for a worker report. */
export const WORKER_REPORT_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    assumptions: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'evidence', 'assumptions', 'gaps'],
  additionalProperties: false,
}

const followUp = z.object({
  assignmentId: z.string().trim().min(1).max(256),
  question: z.string().trim().min(1).max(16_000),
  circumstances: z.string().trim().min(1).max(8_000).optional(),
}).strict()
const followUps = z.object({
  kind: z.literal('follow-ups'),
  followUps: z.array(followUp).min(1).max(32),
}).strict()
const complete = z.object({
  kind: z.literal('complete'),
  summary: z.string().trim().min(1).max(16_000),
  assumptions: shortList,
  gaps: shortList,
}).strict()
const partial = z.object({
  kind: z.enum(['partial', 'blocked']),
  summary: z.string().trim().min(1).max(16_000),
  reason: z.string().trim().min(1).max(4_000),
  assumptions: shortList,
  gaps: shortList,
}).strict()
const evaluatorDecision = z.discriminatedUnion('kind', [followUps, complete, partial])
/**
 * Object schema the model receives for an evaluator decision. It mirrors the
 * strict decoder field by field: a schema that only names `kind` invites the
 * model to omit the summary or to add free-form keys, and those answers then
 * fail the decoder.
 */
export const EVALUATOR_DECISION_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: ['follow-ups', 'complete', 'partial', 'blocked'],
      description: 'The decision kind. The remaining fields are required or omitted exactly as their descriptions state.',
    },
    summary: {
      type: 'string',
      description: 'Required for complete, partial, or blocked: a one-paragraph summary of the current evidence. Omit for follow-ups.',
    },
    reason: {
      type: 'string',
      description: 'Required for partial or blocked: why the objective cannot be completed. Omit for follow-ups and complete.',
    },
    assumptions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Required for complete, partial, or blocked: the explicit assumptions made. Omit for follow-ups.',
    },
    gaps: {
      type: 'array',
      items: { type: 'string' },
      description: 'Required for complete, partial, or blocked: the remaining evidence gaps. Omit for follow-ups.',
    },
    followUps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          assignmentId: { type: 'string', description: 'Id of a known assignment.' },
          question: { type: 'string', description: 'The targeted follow-up question for that worker.' },
          circumstances: { type: 'string', description: 'Optional new facts for that worker.' },
        },
        required: ['assignmentId', 'question'],
        additionalProperties: false,
      },
      description: 'Required for follow-ups: the targeted follow-ups to send. Omit for complete, partial, or blocked.',
    },
  },
  required: ['kind'],
  additionalProperties: false,
}

/**
 * Decode a validated structured worker value into its domain contract.
 *
 * @param value - Structured value captured from the worker result.
 * @returns The validated worker report.
 * @throws AgentOrchestratorError with `ORCHESTRATION_WORKER_FAILED` on a schema mismatch.
 */
export function decodeWorkerReport(value: unknown): AgentOrchestrationWorkerReport {
  const parsed = workerReport.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues.at(0)
    throw new AgentOrchestratorError(`worker structured report is invalid: ${issue?.message ?? parsed.error.message}`, 'ORCHESTRATION_WORKER_FAILED', { cause: parsed.error })
  }
  return parsed.data
}

/**
 * Decode an evaluator decision and reject unknown follow-up shapes.
 *
 * @param value - Structured value captured from the evaluator result.
 * @returns The validated evaluator decision.
 * @throws AgentOrchestratorError with `ORCHESTRATION_EVALUATOR_FAILED` on a schema mismatch.
 */
export function decodeEvaluatorDecision(value: unknown): AgentOrchestrationEvaluatorDecision {
  const parsed = evaluatorDecision.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues.at(0)
    throw new AgentOrchestratorError(`evaluator structured decision is invalid: ${issue?.message ?? parsed.error.message}`, 'ORCHESTRATION_EVALUATOR_FAILED', { cause: parsed.error })
  }
  return parsed.data
}
