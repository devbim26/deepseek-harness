import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { toolCallResponse, textResponse, MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { STRUCTURED_OUTPUT_TOOL } from '@deepseek-ai/dsh-subagent'
import { orchestrationReportBlocks } from '../src/report.ts'
import { engineFixture, type EngineFixture } from './harness.ts'

const fixtures: EngineFixture[] = []
afterEach(async () => { for (const fixture of fixtures.splice(0).reverse()) await fixture.dispose() })

function worker(answer: string, gaps: string[] = []) {
  return toolCallResponse(`worker-${answer}`, STRUCTURED_OUTPUT_TOOL, {
    summary: answer, evidence: [`evidence ${answer}`], assumptions: [], gaps,
  })
}

function followUp(question: string) {
  return toolCallResponse(`evaluator-${question}`, STRUCTURED_OUTPUT_TOOL, {
    kind: 'follow-ups',
    followUps: [{ assignmentId: 'worker', question, circumstances: 'new fact' }],
  })
}

function complete(summary = 'complete') {
  return toolCallResponse(`evaluator-${summary}`, STRUCTURED_OUTPUT_TOOL, {
    kind: 'complete', summary, assumptions: [], gaps: [],
  })
}

function partial() {
  return toolCallResponse('evaluator-partial', STRUCTURED_OUTPUT_TOOL, {
    kind: 'partial', summary: 'partial summary', reason: 'missing input', assumptions: [], gaps: ['worker report missing'],
  })
}

function request(fixture: EngineFixture, maxIterations = 3) {
  return {
    parent: fixture.parent,
    objective: 'Inspect the drawing',
    assignments: [{ id: 'worker', prompt: 'Inspect sheet 1' }],
    maxIterations,
    maxParallel: 1,
  }
}

class ParallelAdapter extends MockAdapter {
  readonly gate = Promise.withResolvers<undefined>()
  active = 0
  maxActive = 0

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const iterator = super.stream(options) as AsyncGenerator<StreamChunk>
    const first = await iterator.next()
    if (first.done === true) return
    this.active += 1
    this.maxActive = Math.max(this.maxActive, this.active)
    try {
      if (this.requests.length <= 2) await this.gate.promise
      yield first.value
      for await (const chunk of iterator) yield chunk
    } finally {
      this.active -= 1
    }
  }
}

describe('conversational agent orchestration', () => {
  it('runs an initial round and two follow-ups on the same child Session', async () => {
    const fixture = await engineFixture([
      worker('round 1'), followUp('clarify round 2'),
      worker('round 2'), followUp('clarify round 3'),
      worker('round 3'), complete(),
    ])
    fixtures.push(fixture)
    const run = fixture.ctx.agentOrchestrator.start(request(fixture))
    const result = await run.result
    expect(result, JSON.stringify(fixture.errors)).toMatchObject({ status: 'complete', rounds: 3, summary: 'complete' })
    expect(result.workers[0]).toMatchObject({ assignmentId: 'worker', rounds: 3 })
    const childId = result.workers[0]?.childId
    expect(childId).toBeDefined()
    using observation = await fixture.ctx.sessionQuery.observeSession(childId!)
    expect(observation.events.filter(event => event.type === 'assistant/message')).toHaveLength(3)
    expect(JSON.stringify(observation.events)).toContain('clarify round 3')
    expect(JSON.stringify(observation.events)).toContain('new fact')
    await run.dispose()
    expect(fixture.ctx.agentOrchestrator.status(run.id)).toMatchObject({ status: 'complete', rounds: 3 })
  }, 30_000)

  it('reports budget-limited when the last evaluator still requests work', async () => {
    const fixture = await engineFixture([worker('only round'), followUp('more work')])
    fixtures.push(fixture)
    const run = fixture.ctx.agentOrchestrator.start(request(fixture, 1))
    await expect(run.result).resolves.toMatchObject({ status: 'budget-limited', rounds: 1 })
    await run.dispose()
  })

  it('keeps a malformed worker result visible as a gap in a partial outcome', async () => {
    const fixture = await engineFixture([textResponse('not structured'), partial()])
    fixtures.push(fixture)
    const run = fixture.ctx.agentOrchestrator.start(request(fixture))
    const result = await run.result
    expect(result.status).toBe('partial')
    expect(result.workers[0]?.error).toContain('structured')
    expect(result.gaps).toContain('worker report missing')
    await run.dispose()
  })

  it('fails without a successful outcome when evaluator output is malformed', async () => {
    const fixture = await engineFixture([worker('done'), textResponse('not an evaluator decision')])
    fixtures.push(fixture)
    const run = fixture.ctx.agentOrchestrator.start(request(fixture))
    await expect(run.result).resolves.toMatchObject({ status: 'failed', rounds: 0 })
    await run.dispose()
  })

  it('cancels active work and reaches quiescence', async () => {
    const fixture = await engineFixture(['hang'])
    fixtures.push(fixture)
    const run = fixture.ctx.agentOrchestrator.start(request(fixture))
    await vi.waitFor(() => expect(fixture.adapter.requests).toHaveLength(1))
    run.cancel('test cancellation')
    await expect(run.result).resolves.toMatchObject({ status: 'cancelled' })
    await run.dispose()
    expect(fixture.ctx.agents.list()).toEqual([fixture.parent])
  })

  it('denies human questions on a cold-resumed worker and continues with a gap', async () => {
    const fixture = await engineFixture([
      worker('initial'), followUp('ask for missing data'),
      toolCallResponse('ask', 'ask_user_question', { questions: [] }),
      worker('continued', ['question forbidden']),
      complete(),
    ])
    fixtures.push(fixture)
    fixture.ctx.tools.register(defineTool({
      name: 'ask_user_question',
      description: 'Question fixture.',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { answered: { type: 'boolean' } } },
        render: () => [{ type: 'text', text: 'answered' }],
      },
      execute: () => { throw new Error('the execution guard did not run') },
    }))
    const run = fixture.ctx.agentOrchestrator.start(request(fixture))
    const result = await run.result
    expect(result).toMatchObject({ status: 'complete', rounds: 2 })
    const childId = result.workers[0]?.childId
    expect(childId, JSON.stringify(result.workers)).toBeDefined()
    using observation = await fixture.ctx.sessionQuery.observeSession(childId!)
    expect(JSON.stringify(observation.events)).toContain('HUMAN_INPUT_FORBIDDEN')
    await run.dispose()
  })

  it('denies nested orchestration from a non-root child', async () => {
    const fixture = await engineFixture(['hang'])
    fixtures.push(fixture)
    const child = await fixture.ctx.subagents.startActivation({
      provider: 'spawn', label: 'child', delivery: 'caller', parent: fixture.parent,
      prompt: [{ type: 'text', text: 'work' }], signal: new AbortController().signal,
    })
    const nested = fixture.ctx.agents.get(child.childId)
    expect(nested).toBeDefined()
    expect(() => fixture.ctx.agentOrchestrator.start({ ...request(fixture), parent: nested! }))
      .toThrow(expect.objectContaining({ code: 'ORCHESTRATION_NESTED' }))
    await child.dispose()
  })

  it('honors maxParallel across independent workers', async () => {
    const adapter = new ParallelAdapter([worker('one'), worker('two'), complete()])
    const fixture = await engineFixture([], { adapter })
    fixtures.push(fixture)
    const run = fixture.ctx.agentOrchestrator.start({
      ...request(fixture),
      assignments: [{ id: 'worker', prompt: 'Inspect sheet 1' }, { id: 'worker-2', prompt: 'Inspect sheet 2' }],
      maxParallel: 2,
    })
    await vi.waitFor(() => expect(adapter.requests).toHaveLength(2))
    expect(adapter.maxActive).toBe(2)
    adapter.gate.resolve(undefined)
    const result = await run.result
    expect(result).toMatchObject({ status: 'complete', rounds: 1 })
    expect(result.workers).toHaveLength(2)
    await run.dispose()
  })

  it('writes a real PDF after a complete run', async () => {
    const fixture = await engineFixture([worker('done'), complete()], { pdf: true })
    fixtures.push(fixture)
    const run = fixture.ctx.agentOrchestrator.start({
      ...request(fixture),
      report: { title: 'Отчёт по чертежам', details: [{ label: 'Дом', value: '12' }] },
    })
    const result = await run.result
    expect(result.pdf).toMatchObject({ name: `${run.id}.pdf`, pages: 1 })
    expect(result.pdf?.bytes).toBeGreaterThan(0)
    const bytes = await readFile(join(fixture.root, 'reports', `${run.id}.pdf`))
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('%PDF')
    await run.dispose()
  })

  it('marks a partial PDF and does not create one for evaluator failure', async () => {
    const partialFixture = await engineFixture([worker('done'), partial()], { pdf: true })
    fixtures.push(partialFixture)
    const partialRun = partialFixture.ctx.agentOrchestrator.start({
      ...request(partialFixture), report: { title: 'Частичный отчёт', details: [] },
    })
    const partialResult = await partialRun.result
    expect(partialResult.status).toBe('partial')
    expect(orchestrationReportBlocks({ title: 'Частичный отчёт', details: [] }, partialResult, partialFixture.parent.session)[0])
      .toMatchObject({ heading: 'Неполный результат' })
    await partialRun.dispose()

    const failedFixture = await engineFixture([worker('done'), textResponse('broken evaluator')], { pdf: true })
    fixtures.push(failedFixture)
    const failedRun = failedFixture.ctx.agentOrchestrator.start({
      ...request(failedFixture), report: { title: 'Не должен существовать', details: [] },
    })
    const failedResult = await failedRun.result
    expect(failedResult.status).toBe('failed')
    expect(failedResult.pdf).toBeUndefined()
    expect(await stat(join(failedFixture.root, 'reports')).catch(() => undefined)).toBeUndefined()
    await failedRun.dispose()
  })

  it('enforces the complete evaluator handoff limit', async () => {
    const fixture = await engineFixture([
      toolCallResponse('large-worker', STRUCTURED_OUTPUT_TOOL, {
        summary: 'done', evidence: ['x'.repeat(2_000)], assumptions: [], gaps: [],
      }),
    ], { maxHandoffChars: 1024 })
    fixtures.push(fixture)
    const run = fixture.ctx.agentOrchestrator.start(request(fixture))
    await expect(run.result).resolves.toMatchObject({ status: 'failed', summary: expect.stringContaining('1024') })
    await run.dispose()
  })
})
