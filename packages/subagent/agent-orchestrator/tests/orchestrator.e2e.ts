/**
 * With-key smoke of the conversational orchestration engine.
 *
 * The run needs `DEEPSEEK_API_KEY` and a model that answers the worker's and
 * the evaluator's structured-output request. Without the key the suite skips
 * itself, so a keyless CI run stays green.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import * as ToolPdf from '@deepseek-ai/dsh-tool-pdf'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek-api-key'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import AgentOrchestrator from '../src/index.ts'

/** Модель и провайдер смоук-прогона. */
const MODEL = process.env.DSH_ORCHESTRATOR_E2E_MODEL ?? 'deepseek-v4-flash'
const PROVIDER = 'deepseek-official'

/** Рабочая папка сессии в смоук-прогоне. */
class SmokeWorkingDirectory extends Service {
  private readonly directories = new WeakMap<Session, string>()
  constructor(ctx: Context, private readonly root: string) { super(ctx, 'workingDirectory') }
  get(session: Session): string { return this.directories.get(session) ?? session.header.cwd ?? this.root }
  ensure(agent: Agent, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    return Promise.resolve(this.get(agent.session))
  }
  set(agent: Agent, path: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    const resolved = resolve(this.get(agent.session), path)
    this.directories.set(agent.session, resolved)
    return Promise.resolve(resolved)
  }
}

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

describe.skipIf(!process.env.DEEPSEEK_API_KEY)('conversational orchestration smoke', () => {
  it('runs workers and an evaluator against the real model', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-orchestrator-e2e-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const ctx = new Context()
    cleanups.push(() => ctx.fiber.dispose())
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions') })
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SmokeWorkingDirectory, root)
    await ctx.plugin(LocalFileSystem, { cwd: root })
    await ctx.plugin(LocalAttachmentStore, { dshHome: root })
    await ctx.plugin(ToolPdf, { maxImages: 2, maxImageBytes: 1024 })
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
    await ctx.plugin(LlmDeepSeek, { models: [{ id: MODEL }] })
    await ctx.plugin(AgentOrchestrator, {
      provider: 'spawn', maxHandoffChars: 65_536, maxSettledRuns: 4, reportDirectory: 'reports',
    })
    const parent = await ctx.agentLoop.create(SessionId('orchestrator-smoke'), {
      provider: PROVIDER, model: MODEL,
    }, { cwd: root })

    const run = ctx.agentOrchestrator.start({
      parent,
      objective: 'Назовите один проверяемый факт о сумме чисел от 1 до 10 и кратко объясните его.',
      assignments: [{
        id: 'worker',
        prompt: 'Посчитайте сумму чисел от 1 до 10 и верните структурированный отчёт: краткое резюме, доказательства, допущения и пробелы.',
      }],
      maxIterations: 1,
      maxParallel: 1,
      report: { title: 'Смоук-отчёт оркестрации', details: [] },
    })
    const result = await run.result
    await run.dispose()
    if (result.status === 'failed') console.info('orchestrator e2e failed:', result.summary, result.errors.join(' | '))
    expect(['complete', 'partial', 'budget-limited']).toContain(result.status)
    expect(result.workers.length).toBe(1)
    expect(result.pdf?.pages ?? 0).toBeGreaterThan(0)
  }, 180_000)
})
