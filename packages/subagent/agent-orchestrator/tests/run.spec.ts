import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { STRUCTURED_OUTPUT_TOOL } from '@deepseek-ai/dsh-subagent'
import type { SubagentActivation, SubagentResult } from '@deepseek-ai/dsh-subagent'
import { toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { engineFixture, type EngineFixture } from './harness.ts'

const fixtures: EngineFixture[] = []
afterEach(async () => { for (const fixture of fixtures.splice(0).reverse()) await fixture.dispose() })

function worker(answer = 'done') {
  return toolCallResponse(`worker-${answer}`, STRUCTURED_OUTPUT_TOOL, { summary: answer, evidence: [], assumptions: [], gaps: [] })
}
function evaluator(value: object) {
  return toolCallResponse('evaluator-decision', STRUCTURED_OUTPUT_TOOL, value)
}
function complete() {
  return evaluator({ kind: 'complete', summary: 'complete', assumptions: [], gaps: [] })
}
function request(fixture: EngineFixture) {
  return { parent: fixture.parent, objective: 'Inspect', assignments: [{ id: 'worker', prompt: 'Review' }], maxIterations: 2, maxParallel: 1 }
}
describe('orchestration run failure and cancellation paths', () => {
  it('honors an already-aborted external signal without starting children', async () => {
    const fixture = await engineFixture([])
    fixtures.push(fixture)
    const controller = new AbortController()
    controller.abort('aborted before start')
    const run = fixture.ctx.agentOrchestrator.start({ ...request(fixture), signal: controller.signal })
    run.cancel('terminal cancellation is ignored')
    await expect(run.result).resolves.toMatchObject({ status: 'cancelled', summary: 'orchestration signal aborted' })
    await Promise.all([run.dispose(), run.dispose()])
    expect(fixture.adapter.requests).toHaveLength(0)
  })

  it('fails when the evaluator names an unknown follow-up assignment', async () => {
    const fixture = await engineFixture([
      worker(), evaluator({ kind: 'follow-ups', followUps: [{ assignmentId: 'unknown', question: 'More' }] }),
    ])
    fixtures.push(fixture)
    const run = fixture.ctx.agentOrchestrator.start(request(fixture))
    await expect(run.result).resolves.toMatchObject({ status: 'failed', summary: 'evaluator named an unknown assignment' })
    await run.dispose()
  })

  it('prints the PDF highlight marks in the report and publishes the report texts without them', async () => {
    const fixture = await engineFixture([
      toolCallResponse('worker-marked', STRUCTURED_OUTPUT_TOOL, {
        summary: 'Checked ==3 nodes==.', evidence: ['==W-1== is fine'], assumptions: ['==Scale 1:100=='], gaps: [],
      }),
      evaluator({ kind: 'complete', summary: 'Found ==3 remarks==.', assumptions: ['overall ==assumption=='], gaps: [] }),
    ], { pdf: true })
    fixtures.push(fixture)
    const create = vi.spyOn(fixture.ctx.pdfReports, 'create')
    const run = fixture.ctx.agentOrchestrator.start({
      ...request(fixture), report: { title: 'Отчёт', details: [] },
    })
    const result = await run.result
    expect(create.mock.calls[0]?.[1].blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text', heading: 'Сводка', text: 'Found ==3 remarks==.' }),
      expect.objectContaining({ type: 'text', heading: 'Доказательства', text: '- ==W-1== is fine' }),
    ]))
    expect(result).toMatchObject({
      status: 'complete',
      summary: 'Found 3 remarks.',
      // Worker assumptions precede the evaluator's own.
      assumptions: ['Scale 1:100', 'overall assumption'],
      workers: [{ assignmentId: 'worker', report: { summary: 'Checked 3 nodes.', evidence: ['W-1 is fine'], assumptions: ['Scale 1:100'] } }],
    })
    expect(JSON.stringify(result)).not.toContain('==')
    // The retained snapshot is the same published copy, not the marked run state.
    expect(fixture.ctx.agentOrchestrator.status(result.id)).toEqual(result)
    await run.dispose()
  })

  it('keeps a schema-invalid worker report as a worker gap and maps blocked to partial', async () => {
    const fixture = await engineFixture([
      worker(), evaluator({ kind: 'blocked', summary: 'blocked summary', reason: 'missing evidence', assumptions: [], gaps: [] }),
    ])
    fixtures.push(fixture)
    const run = fixture.ctx.agentOrchestrator.start(request(fixture))
    await expect(run.result).resolves.toMatchObject({ status: 'partial', summary: 'blocked summary' })
    await run.dispose()
  })

  it('records malformed worker structured output instead of accepting it', async () => {
    const fixture = await engineFixture([
      toolCallResponse('invalid-worker', STRUCTURED_OUTPUT_TOOL, { summary: '', evidence: [], assumptions: [], gaps: [] }),
      evaluator({ kind: 'partial', summary: 'partial', reason: 'invalid worker', assumptions: [], gaps: [] }),
    ])
    fixtures.push(fixture)
    const run = fixture.ctx.agentOrchestrator.start(request(fixture))
    const result = await run.result
    expect(result.status).toBe('partial')
    expect(result.workers[0]?.error).toContain('worker structured report is invalid')
    await run.dispose()
  })

  it('disposes an activation admitted while cancellation is in flight', async () => {
    const fixture = await engineFixture([])
    fixtures.push(fixture)
    const controller = new AbortController()
    const pending = Promise.withResolvers<SubagentResult>()
    let disposals = 0
    const child: SubagentActivation = {
      childId: SessionId('worker-abort-race'), name: 'worker-abort-race', result: pending.promise,
      dispose: () => {
        disposals += 1
        pending.reject(new Error('activation aborted'))
        return disposals === 1 ? new Promise<void>((resolve) => { setTimeout(resolve, 0) }) : Promise.resolve()
      },
    }
    vi.spyOn(fixture.ctx.subagents, 'startActivation').mockImplementation(() => {
      controller.abort('cancel during admission')
      return Promise.resolve(child)
    })
    const run = fixture.ctx.agentOrchestrator.start({ ...request(fixture), signal: controller.signal })
    await expect(run.result).resolves.toMatchObject({ status: 'cancelled', summary: 'orchestration signal aborted' })
    await run.dispose()
  })

  it('retains non-Error failure text from a provider boundary', async () => {
    const fixture = await engineFixture([])
    fixtures.push(fixture)
    vi.spyOn(fixture.ctx.subagents, 'startActivation').mockRejectedValue('provider string failure')
    const run = fixture.ctx.agentOrchestrator.start(request(fixture))
    await expect(run.result).resolves.toMatchObject({ status: 'failed', summary: 'provider string failure' })
    await run.dispose()
  })

  it('reports child cleanup failure after cancellation reaches quiescence', async () => {
    const fixture = await engineFixture([])
    fixtures.push(fixture)
    const pending = Promise.withResolvers<SubagentResult>()
    let disposals = 0
    const child: SubagentActivation = {
      childId: SessionId('worker-cleanup'), name: 'worker-cleanup', result: pending.promise,
      dispose: () => {
        disposals += 1
        if (disposals > 1) return Promise.resolve()
        pending.reject(new Error('activation aborted'))
        return new Promise<void>((_resolve, reject) => { setTimeout(() => { reject(new Error('dispose failed')) }, 0) })
      },
    }
    vi.spyOn(fixture.ctx.subagents, 'startActivation').mockResolvedValue(child)
    const run = fixture.ctx.agentOrchestrator.start(request(fixture))
    await vi.waitFor(() => expect(fixture.ctx.subagents.startActivation).toHaveBeenCalledOnce())
    run.cancel('cancel cleanup')
    await expect(run.result).resolves.toMatchObject({ status: 'failed', summary: 'orchestration child cleanup failed' })
    await run.dispose()
  })

  it('turns a PDF writer failure into a failed run without publication metadata', async () => {
    const fixture = await engineFixture([worker(), complete()], { pdf: true })
    fixtures.push(fixture)
    await writeFile(join(fixture.root, 'reports'), 'not a directory')
    const run = fixture.ctx.agentOrchestrator.start({
      ...request(fixture), report: { title: 'Report', details: [] },
    })
    const result = await run.result
    expect(result).toMatchObject({ status: 'failed', summary: 'orchestration PDF creation failed' })
    expect(result.pdf).toBeUndefined()
    await run.dispose()
  })
})
