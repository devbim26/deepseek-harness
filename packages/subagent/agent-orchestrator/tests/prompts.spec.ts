import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { evaluatorPrompt, workerFollowUpPrompt, workerPrompt } from '../src/prompts.ts'
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

  it('includes initial circumstances only when supplied and enforces the complete handoff bound', () => {
    expect(evaluatorPrompt(request(), [], 100)).not.toContain('Initial circumstances')
    expect(evaluatorPrompt(request('House 12'), [], 100)).toContain('Initial circumstances: House 12')
    expect(() => evaluatorPrompt(request(), [{ assignmentId: 'worker', rounds: 1 }], 10))
      .toThrow(expect.objectContaining({ code: 'ORCHESTRATION_HANDOFF_LIMIT' }))
  })
})
