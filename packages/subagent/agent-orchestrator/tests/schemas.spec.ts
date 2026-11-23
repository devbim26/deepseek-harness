import { describe, expect, it } from 'vitest'
import { decodeEvaluatorDecision, decodeWorkerReport } from '../src/schemas.ts'

const report = { summary: ' done ', evidence: ['evidence'], assumptions: [], gaps: [] }

describe('orchestration model-boundary decoders', () => {
  it('decodes a worker report and rejects malformed values with the worker code', () => {
    expect(decodeWorkerReport(report)).toEqual({ ...report, summary: 'done' })
    for (const value of [
      null,
      {},
      { ...report, extra: true },
      { ...report, summary: '' },
      { ...report, evidence: [''] },
      { ...report, evidence: Array.from({ length: 33 }, (_, index) => String(index)) },
      { ...report, summary: 'x'.repeat(16_001) },
    ]) {
      expect(() => decodeWorkerReport(value)).toThrow(expect.objectContaining({ code: 'ORCHESTRATION_WORKER_FAILED' }))
    }
  })

  it('decodes every evaluator decision variant', () => {
    expect(decodeEvaluatorDecision({ kind: 'follow-ups', followUps: [{ assignmentId: 'a', question: 'q', circumstances: 'c' }] }))
      .toEqual({ kind: 'follow-ups', followUps: [{ assignmentId: 'a', question: 'q', circumstances: 'c' }] })
    expect(decodeEvaluatorDecision({ kind: 'follow-ups', followUps: [{ assignmentId: 'a', question: 'q' }] }))
      .toEqual({ kind: 'follow-ups', followUps: [{ assignmentId: 'a', question: 'q' }] })
    expect(decodeEvaluatorDecision({ kind: 'complete', summary: 'done', assumptions: ['a'], gaps: [] }))
      .toEqual({ kind: 'complete', summary: 'done', assumptions: ['a'], gaps: [] })
    for (const kind of ['partial', 'blocked'] as const) {
      expect(decodeEvaluatorDecision({ kind, summary: 's', reason: 'r', assumptions: [], gaps: ['g'] }))
        .toEqual({ kind, summary: 's', reason: 'r', assumptions: [], gaps: ['g'] })
    }
  })

  it('rejects malformed evaluator decisions with the evaluator code', () => {
    for (const value of [
      null,
      {},
      { kind: 'unknown' },
      { kind: 'follow-ups', followUps: [] },
      { kind: 'follow-ups', followUps: [{ assignmentId: '', question: 'q' }] },
      { kind: 'follow-ups', followUps: [{ assignmentId: 'a', question: 'q', extra: true }] },
      { kind: 'complete', summary: '', assumptions: [], gaps: [] },
      { kind: 'complete', summary: 'done', assumptions: [], gaps: [], extra: true },
      { kind: 'partial', summary: 's', reason: '', assumptions: [], gaps: [] },
      { kind: 'blocked', summary: 's', reason: 'r', assumptions: [], gaps: [''] },
    ]) {
      expect(() => decodeEvaluatorDecision(value)).toThrow(expect.objectContaining({ code: 'ORCHESTRATION_EVALUATOR_FAILED' }))
    }
  })
})
