import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { SessionId } from '@deepseek-ai/dsh-session'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import SubagentRuntime, { STRUCTURED_OUTPUT_TOOL } from '../src/index.ts'
import { mountLocalActivations } from './local-activation.ts'
import { mountWorkingDirectoryFixture } from './working-directory-fixture.ts'
import { TestSessionQuery } from './test-session-query.ts'
import { loadStoredSession } from './persistence-helpers.ts'

const SCHEMA: ObjectJsonSchema = {
  type: 'object',
  properties: { answer: { type: 'number' } },
  required: ['answer'],
}

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
})

async function setup(script: ConstructorParameters<typeof MockAdapter>[0]) {
  const ctx = new Context()
  contexts.push(ctx)
  const adapter = new MockAdapter(script)
  await mountAgentLoopTestDependencies(ctx)
  await mountLocalActivations(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TestSessionQuery)
  await mountWorkingDirectoryFixture(ctx)
  await ctx.plugin(SubagentRuntime)
  ctx.subagents.registerProvider({
    name: 'spawn',
    capabilities: { agentOptions: true, agentPreset: false, outputSchema: true, depthLimit: true },
    inheritsParentContext: false,
    prepareContinuable: () => Promise.resolve({}),
  })
  ctx.llm.registerAdapter(['mock'], adapter)
  const parent = await ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  return { ctx, parent, adapter }
}

function start(parent: Agent, outputSchema?: ObjectJsonSchema) {
  return {
    provider: 'spawn',
    label: 'initial round',
    delivery: 'caller' as const,
    parent,
    prompt: [{ type: 'text' as const, text: 'initial prompt' }],
    ...(outputSchema === undefined ? {} : { outputSchema }),
    signal: new AbortController().signal,
  }
}

function resume(parent: Agent, childId: SessionId, outputSchema?: ObjectJsonSchema) {
  return {
    parent,
    childId,
    prompt: [{ type: 'text' as const, text: 'follow-up prompt' }],
    ...(outputSchema === undefined ? {} : { outputSchema }),
    signal: new AbortController().signal,
  }
}

describe('owned subagent continuation', () => {
  it('resumes the same durable Session and returns only the new round result', async () => {
    const { ctx, parent } = await setup([textResponse('first answer'), textResponse('second answer')])
    const initial = await ctx.subagents.startActivation(start(parent))
    const childId = initial.childId
    await expect(initial.result).resolves.toMatchObject({ stopReason: 'completed' })
    await initial.dispose()
    const child = ctx.agents.get(childId)
    expect(child).toBeUndefined()

    const continued = await ctx.subagents.resumeActivation(resume(parent, childId))
    expect(continued.childId).toBe(childId)
    expect(continued.messageId).not.toBe(initial.messageId)
    await expect(continued.result).resolves.toMatchObject({
      stopReason: 'completed',
      output: [{ type: 'text', text: 'second answer' }],
    })
    const stored = await loadStoredSession(ctx.sessionPersistence, childId)
    expect(stored.events.filter(event => event.type === 'assistant/message')).toHaveLength(2)
    expect(stored.events.some(event => event.type === 'user/message'
      && event.data.content.some(block => block.type === 'text' && block.text === 'initial prompt'))).toBe(true)
    expect(stored.events.some(event => event.type === 'user/message'
      && event.data.content.some(block => block.type === 'text' && block.text === 'follow-up prompt'))).toBe(true)
    expect(parent.session.snapshotEvents().some(event => event.type === 'user/message'
      && event.data.source.kind === 'subagent-settled')).toBe(false)
    await continued.dispose()
  })

  it('reattaches structured output on a cold resumed activation', async () => {
    const { ctx, parent } = await setup([
      toolCallResponse('first', STRUCTURED_OUTPUT_TOOL, { answer: 1 }),
      toolCallResponse('second', STRUCTURED_OUTPUT_TOOL, { answer: 2 }),
    ])
    const initial = await ctx.subagents.startActivation(start(parent, SCHEMA))
    await expect(initial.result).resolves.toMatchObject({ structured: { answer: 1 } })
    await initial.dispose()

    const continued = await ctx.subagents.resumeActivation(resume(parent, initial.childId, SCHEMA))
    await expect(continued.result).resolves.toMatchObject({ stopReason: 'completed', structured: { answer: 2 } })
    await continued.dispose()
  })

  it('rejects a running target without queueing another turn', async () => {
    const { ctx, parent, adapter } = await setup(['hang'])
    const initial = await ctx.subagents.startActivation(start(parent))
    await vi.waitFor(() => expect(adapter.requests).toHaveLength(1))
    await expect(ctx.subagents.resumeActivation(resume(parent, initial.childId)))
      .rejects.toMatchObject({ code: 'ACTIVATION_BUSY' })
    await initial.dispose()
    await expect(initial.result).resolves.toMatchObject({ stopReason: 'aborted' })
    expect(adapter.requests).toHaveLength(1)
  })

  it('runs local setup before the first model request on create and cold resume', async () => {
    const calls: string[] = []
    const { ctx, parent } = await setup([
      () => { calls.push('first request'); return textResponse('first') },
      () => { calls.push('second request'); return textResponse('second') },
    ])
    const initialSetup = vi.fn(() => { calls.push('initial setup') })
    const initial = await ctx.subagents.startActivation({ ...start(parent), setup: initialSetup })
    await initial.result
    await initial.dispose()
    const resumeSetup = vi.fn(() => { calls.push('resume setup') })
    const continued = await ctx.subagents.resumeActivation({ ...resume(parent, initial.childId), setup: resumeSetup })
    await continued.result
    await continued.dispose()
    expect(calls).toEqual(['initial setup', 'first request', 'resume setup', 'second request'])
    expect(initialSetup).toHaveBeenCalledOnce()
    expect(resumeSetup).toHaveBeenCalledOnce()
  })

  it('rejects a concurrent continuation once the first one owns the child', async () => {
    const { ctx, parent } = await setup([textResponse('first'), 'hang'])
    const initial = await ctx.subagents.startActivation(start(parent))
    await initial.result
    await initial.dispose()
    const first = await ctx.subagents.resumeActivation(resume(parent, initial.childId))
    await expect(ctx.subagents.resumeActivation(resume(parent, initial.childId)))
      .rejects.toMatchObject({ code: 'ACTIVATION_BUSY' })
    await first.dispose()
  })

  it('rejects a caller from another root tree', async () => {
    const { ctx, parent } = await setup([textResponse('first')])
    const other = await ctx.agentLoop.create(SessionId('other'), { provider: 'mock', model: 'mock' })
    const initial = await ctx.subagents.startActivation(start(parent))
    await initial.result
    await initial.dispose()
    await expect(ctx.subagents.resumeActivation(resume(other, initial.childId)))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
})
