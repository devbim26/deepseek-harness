import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { STRUCTURED_OUTPUT_TOOL } from '@deepseek-ai/dsh-subagent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import AgentOrchestrator from '../src/index.ts'
import type { Config } from '../src/index.ts'
import type { AgentOrchestrationRunId, AgentOrchestrationStartRequest } from '../src/types.ts'
import { engineFixture, type EngineFixture } from './harness.ts'

const fixtures: EngineFixture[] = []
afterEach(async () => { for (const fixture of fixtures.splice(0).reverse()) await fixture.dispose() })

const config: Config = { provider: 'spawn', maxHandoffChars: 65_536, maxSettledRuns: 8, reportDirectory: 'reports' }

function worker(answer = 'done') {
  return toolCallResponse(`worker-${answer}`, STRUCTURED_OUTPUT_TOOL, { summary: answer, evidence: [], assumptions: [], gaps: [] })
}
function complete() {
  return toolCallResponse('evaluator-complete', STRUCTURED_OUTPUT_TOOL, { kind: 'complete', summary: 'complete', assumptions: [], gaps: [] })
}
function request(fixture: EngineFixture): AgentOrchestrationStartRequest {
  return { parent: fixture.parent, objective: 'Inspect', assignments: [{ id: 'worker', prompt: 'Review' }], maxIterations: 1, maxParallel: 1 }
}

describe('AgentOrchestrator service', () => {
  it('rejects invalid numeric configuration through the schema', () => {
    for (const patch of [{ maxHandoffChars: 1023 }, { maxSettledRuns: 0 }, { maxSettledRuns: 65 }]) {
      expect(() => new AgentOrchestrator(new Context(), { ...config, ...patch })).toThrow()
    }
  })

  it.each([
    { provider: ' ' },
    { reportDirectory: ' ' },
    { reportDirectory: '/absolute' },
    { reportDirectory: '../outside' },
    { reportDirectory: 'reports/../outside' },
  ])('rejects unsafe service configuration (%j)', (patch) => {
    expect(() => new AgentOrchestrator(new Context(), { ...config, ...patch }))
      .toThrow(expect.objectContaining({ code: 'ORCHESTRATION_INVALID_REQUEST' }))
  })

  it('validates start requests before allocating a run', async () => {
    const fixture = await engineFixture([])
    fixtures.push(fixture)
    const base = request(fixture)
    const invalid: AgentOrchestrationStartRequest[] = [
      { ...base, objective: ' ' },
      { ...base, assignments: [] },
      { ...base, maxIterations: 0 },
      { ...base, maxIterations: 11 },
      { ...base, maxIterations: 1.5 },
      { ...base, maxParallel: 0 },
      { ...base, maxParallel: 11 },
      { ...base, maxParallel: 1.5 },
      { ...base, assignments: [{ id: '', prompt: 'Review' }] },
      { ...base, assignments: [{ id: 'worker', prompt: ' ' }] },
      { ...base, assignments: [{ id: 'worker', prompt: 'Review' }, { id: 'worker', prompt: 'Again' }] },
      { ...base, assignments: [{ id: 'worker', prompt: 'Review', agentPreset: ' ' }] },
      { ...base, evaluatorPreset: ' ' },
      { ...base, report: { title: ' ', details: [] } },
      { ...base, report: { title: 'Report', details: [{ label: ' ', value: 'x' }] } },
      { ...base, report: { title: 'Report', details: [] } },
    ]
    for (const candidate of invalid) {
      expect(() => fixture.ctx.agentOrchestrator.start(candidate))
        .toThrow(expect.objectContaining({ code: expect.stringMatching(/^ORCHESTRATION_/) }))
    }
    expect(fixture.adapter.requests).toHaveLength(0)
  })

  it('reports unknown runs and cancels through the service', async () => {
    const fixture = await engineFixture(['hang'])
    fixtures.push(fixture)
    const missing = brandString<AgentOrchestrationRunId>('orchestration-missing')
    expect(fixture.ctx.agentOrchestrator.status(missing)).toBeUndefined()
    expect(() => fixture.ctx.agentOrchestrator.cancel(missing)).toThrow(expect.objectContaining({ code: 'ORCHESTRATION_NOT_FOUND' }))
    const run = fixture.ctx.agentOrchestrator.start(request(fixture))
    await vi.waitFor(() => expect(fixture.adapter.requests).toHaveLength(1))
    expect(fixture.ctx.agentOrchestrator.cancel(run.id, 'service cancellation').status).toBe('running')
    await expect(run.result).resolves.toMatchObject({ status: 'cancelled', summary: 'service cancellation' })
    expect(() => fixture.ctx.agentOrchestrator.cancel(run.id, 'settled run is no longer active'))
      .toThrow(expect.objectContaining({ code: 'ORCHESTRATION_NOT_FOUND' }))
    await run.dispose()
  })

  it('disposes active controllers with the service', async () => {
    const fixture = await engineFixture(['hang'])
    fixtures.push(fixture)
    const run = fixture.ctx.agentOrchestrator.start(request(fixture))
    await vi.waitFor(() => expect(fixture.adapter.requests).toHaveLength(1))
    const result = run.result
    await fixture.ctx.fiber.dispose()
    await expect(result).resolves.toMatchObject({ status: 'cancelled', summary: 'orchestration disposed' })
  })

  it('evicts only settled snapshots beyond the configured retention', async () => {
    const fixture = await engineFixture([worker(), complete(), 'hang', worker(), complete()], { maxSettledRuns: 1 })
    fixtures.push(fixture)
    const first = fixture.ctx.agentOrchestrator.start(request(fixture))
    await first.result
    const active = fixture.ctx.agentOrchestrator.start(request(fixture))
    await vi.waitFor(() => expect(fixture.adapter.requests).toHaveLength(3))
    const last = fixture.ctx.agentOrchestrator.start(request(fixture))
    await last.result
    expect(fixture.ctx.agentOrchestrator.status(first.id)).toBeUndefined()
    expect(fixture.ctx.agentOrchestrator.status(last.id)).toBeUndefined()
    expect(fixture.ctx.agentOrchestrator.status(active.id)).toMatchObject({ status: 'running' })
    fixture.ctx.agentOrchestrator.cancel(active.id)
    await active.result
    expect(fixture.ctx.agentOrchestrator.status(active.id)).toMatchObject({ status: 'cancelled' })
    expect(fixture.ctx.agentOrchestrator.status(last.id)).toBeUndefined()
    await Promise.all([first.dispose(), active.dispose(), last.dispose()])
  })
})
