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
/** Object schema the model receives for an evaluator decision. */
export const EVALUATOR_DECISION_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  properties: { kind: { type: 'string', enum: ['follow-ups', 'complete', 'partial', 'blocked'] } },
  required: ['kind'],
  additionalProperties: true,
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
    throw new AgentOrchestratorError(`worker structured report is invalid: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`, 'ORCHESTRATION_WORKER_FAILED', { cause: parsed.error })
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
    throw new AgentOrchestratorError(`evaluator structured decision is invalid: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`, 'ORCHESTRATION_EVALUATOR_FAILED', { cause: parsed.error })
  }
  return parsed.data
}
