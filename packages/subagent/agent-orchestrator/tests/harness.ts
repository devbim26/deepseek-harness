import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Group from '@deepseek-ai/cordis-plugin-group'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as ToolPdf from '@deepseek-ai/dsh-tool-pdf'
import AgentOrchestrator from '../src/index.ts'

/** Minimal query engine: the orchestrator reads Session projections, never the corpus search. */
class StubSessionQuery extends SessionQueryEngine {
  override searchSessions(
    ..._args: Parameters<SessionQueryEngine['searchSessions']>
  ): ReturnType<SessionQueryEngine['searchSessions']> {
    return Promise.resolve({ items: [] })
  }

  override searchEvents(
    ...args: Parameters<SessionQueryEngine['searchEvents']>
  ): ReturnType<SessionQueryEngine['searchEvents']> {
    return this.readSurface(args[0].sessionId).then(surface => ({
      session: surface.session,
      items: [],
    }))
  }
}

class FixtureWorkingDirectory extends Service {
  private readonly directories = new WeakMap<Session, string>()
  constructor(ctx: Context, private readonly root: string) { super(ctx, 'workingDirectory') }
  get(session: Session): string { return this.directories.get(session) ?? session.header.cwd ?? this.root }
  ensure(agent: Agent, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    return Promise.resolve(this.get(agent.session))
  }
  set(agent: Agent, path: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    const cwd = resolve(this.get(agent.session), path)
    this.directories.set(agent.session, cwd)
    return Promise.resolve(cwd)
  }
}

export interface EngineFixture {
  ctx: Context
  parent: Agent
  adapter: MockAdapter
  errors: unknown[]
  root: string
  dispose(): Promise<void>
}

/** Script shape accepted by the mock model adapter. */
export type EngineScript = ConstructorParameters<typeof MockAdapter>[0]

export async function engineFixture(
  script: ConstructorParameters<typeof MockAdapter>[0],
  options: {
    adapter?: MockAdapter
    pdf?: boolean
    maxHandoffChars?: number
    maxSettledRuns?: number
    reportDirectory?: string
    presets?: readonly string[]
  } = {},
): Promise<EngineFixture> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-agent-orchestrator-'))
  const ctx = new Context()
  const adapter = options.adapter ?? new MockAdapter(script)
  if (options.presets !== undefined && options.presets.length > 0) {
    await ctx.plugin(Loader, {})
    ctx.loader.builtins.group = Group
  }
  const errors: unknown[] = []
  ctx.on('agent/error', ({ agent, error }) => {
    errors.push({ agent: agent.id, error: error instanceof Error ? error.stack : String(error) })
  })
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions') })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(StubSessionQuery)
  await ctx.plugin(FixtureWorkingDirectory, root)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  if (options.presets !== undefined && options.presets.length > 0) {
    await ctx.plugin(AgentPresets, { default: options.presets[0] ?? null })
    for (const id of options.presets) await ctx.agentPresets.register({ id, plugins: [] })
  }
  ctx.llm.registerAdapter(['mock'], adapter)
  const parent = await ctx.agentLoop.create(SessionId('parent'), {
    provider: 'mock', model: 'mock',
  }, { cwd: root })
  if (options.pdf === true) {
    await ctx.plugin(LocalFileSystem, { cwd: root })
    await ctx.plugin(LocalAttachmentStore, { dshHome: root })
    await ctx.plugin(ToolPdf, { maxImages: 2, maxImageBytes: 1024 })
  }
  await ctx.plugin(AgentOrchestrator, {
    provider: 'spawn', maxHandoffChars: options.maxHandoffChars ?? 65_536,
    maxSettledRuns: options.maxSettledRuns ?? 8,
    reportDirectory: options.reportDirectory ?? 'reports',
  })
  return {
    ctx, parent, adapter, errors, root,
    dispose: async () => {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    },
  }
}
