import { describe, expect, it } from 'vitest'
import { resolveRecord } from '../src/spec.ts'
import { standardConfig } from './harness.ts'

describe('stored custom agent resolution', () => {
  it('uses configured defaults for omitted orchestration values', () => {
    expect(resolveRecord({
      id: 'custom/agent', slug: 'agent', name: 'Agent', description: '', instructions: 'Work.',
      tools: [], isOrchestrator: false, delegates: [], hidden: false, version: 1,
      updatedAt: '2026-11-22T00:00:00.000Z',
    }, standardConfig)).toMatchObject({ orchestratorMaxIterations: 3, orchestratorMaxParallel: 3, orchestratorAutoReport: true })
  })

  it('preserves explicitly stored orchestration values', () => {
    expect(resolveRecord({
      id: 'custom/agent', slug: 'agent', name: 'Agent', description: '', instructions: 'Work.',
      tools: [], isOrchestrator: true, delegates: [], orchestratorMaxIterations: 7,
      orchestratorMaxParallel: 5, orchestratorAutoReport: false, hidden: false, version: 1,
      updatedAt: '2026-11-22T00:00:00.000Z',
    }, standardConfig)).toMatchObject({ orchestratorMaxIterations: 7, orchestratorMaxParallel: 5, orchestratorAutoReport: false })
  })
})
