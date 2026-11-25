import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { evaluatorCorrectionPrompt, evaluatorPrompt, workerFollowUpPrompt, workerPrompt } from '../src/prompts.ts'
import type { AgentOrchestrationStartRequest } from '../src/types.ts'

const parent = {} as Agent

function request(circumstances?: string): AgentOrchestrationStartRequest {
  return {
    parent,
    objective: 'Inspect',
    ...(circumstances === undefined ? {} : { circumstances }),
    assignments: [{ id: 'worker', prompt: 'Review the drawing' }],
    maxIterations: 2,
    maxParallel: 1,
  }
}

describe('orchestration prompts', () => {
  it('builds initial and follow-up worker tasks with and without circumstances', () => {
    expect(workerPrompt(request().assignments[0]!)).toContain('Review the drawing')
    expect(workerPrompt(request().assignments[0]!)).toContain('structured report')
    expect(workerFollowUpPrompt({ assignmentId: 'worker', question: 'Check dimensions' }))
      .not.toContain('New circumstances')
    expect(workerFollowUpPrompt({ assignmentId: 'worker', question: 'Check dimensions', circumstances: 'Scale 1:100' }))
      .toContain('New circumstances: Scale 1:100')
  })

  it('states the report text format to the worker and to the evaluator', () => {
    for (const prompt of [workerPrompt(request().assignments[0]!), evaluatorPrompt(request(), [], 100)]) {
      expect(prompt).toContain('pipe table with a header row and a --- separator row')
      expect(prompt).toContain('wrap the key facts, figures, and conclusions in ==...== so they print on a yellow band')
      expect(prompt).toContain('Mark sparingly and never a whole sentence.')
    }
  })

  it('includes initial circumstances only when supplied and enforces the complete handoff bound', () => {
    expect(evaluatorPrompt(request(), [], 100)).not.toContain('Initial circumstances')
    expect(evaluatorPrompt(request('House 12'), [], 100)).toContain('Initial circumstances: House 12')
    expect(() => evaluatorPrompt(request(), [{ assignmentId: 'worker', rounds: 1 }], 10))
      .toThrow(expect.objectContaining({ code: 'ORCHESTRATION_HANDOFF_LIMIT' }))
  })

  it('restates the decision contract after a rejected structured decision', () => {
    const prompt = evaluatorCorrectionPrompt('evaluator structured decision is invalid: expected summary')
    expect(prompt.startsWith([
      'Your previous structured decision was rejected: evaluator structured decision is invalid: expected summary',
      'Answer again with a corrected decision. Evaluate completeness.',
    ].join('\n\n'))).toBe(true)
    for (const kind of ['"kind":"follow-ups"', '"kind":"complete"', '"kind":"partial"', '"kind":"blocked"']) {
      expect(prompt).toContain(kind)
    }
  })
})
