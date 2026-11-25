import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { unsupportedInbox, unsupportedModel } from '@deepseek-ai/dsh-agent-loop-testkit'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import WorkingDirectoryService from '@deepseek-ai/dsh-working-directory'
import * as SessionLogDownload from '@deepseek-ai/dsh-session-log-export'
import * as ToolPdfRuntime from '@deepseek-ai/dsh-tool-pdf/runtime'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('session-log-download real Loader composition', () => {
  it('discovers and executes /export through the assembled command plane', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-session-export-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-commands'",
      "- name: '@deepseek-ai/dsh-session-log-export'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    context.provide('connection', {
      fetch: { register: () => () => Promise.resolve() },
    } as never)
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-session', SessionStore],
      ['@deepseek-ai/dsh-commands', CommandRuntime],
      ['@deepseek-ai/dsh-session-log-export', SessionLogDownload],
    ])
    serveLoaderModules(context, modules)
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    const session = (context.get('sessions') as SessionStore)
      .create(SessionId('loader-session-export'), { meta: { createdAt: 1 } })
    const agent = { session, status: 'idle', options: {} } as unknown as Agent
    expect(context.commands.list(agent)).toContainEqual({
      definitionId: '@deepseek-ai/dsh-session-log-export',
      name: 'export', description: 'Download this Session log as a ZIP archive',
    })
    const execution = await context.commands.execute(agent, '/export', [], new AbortController().signal)
    expect(execution?.result).toEqual({ kind: 'success', text: 'Session log download requested.' })
    expect(session.snapshotEvents().map(event => event.type)).toEqual(['command/run', 'command/done'])
    expect(session.deriveMessages()).toEqual([])
  })

  it('assembles a PDF report from the live Session without a model turn', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-session-pdf-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-commands'",
      "- name: '@deepseek-ai/dsh-session-log-export'",
      "- name: '@deepseek-ai/dsh-tool-pdf/runtime'",
      '  config:',
      '    maxImages: 4',
      '    maxImageBytes: 1048576',
      "- name: '@deepseek-ai/dsh-agent'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-session-projection'",
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-working-directory'",
      "- name: '@deepseek-ai/dsh-fs-local'",
      '  config:',
      `    cwd: '${root}'`,
      "- name: '@deepseek-ai/dsh-attachment-local'",
      '  config:',
      `    dshHome: '${root}'`,
      '',
    ].join('\n'))

    const routes = new Map<string, (request: Request) => Promise<Response>>()
    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    context.provide('connection', {
      fetch: {
        register: (route: { readonly path: string; readonly fetch: (request: Request) => Promise<Response> }) => {
          routes.set(route.path, route.fetch)
          return () => { routes.delete(route.path) }
        },
      },
    } as never)
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-session', SessionStore],
      ['@deepseek-ai/dsh-commands', CommandRuntime],
      ['@deepseek-ai/dsh-session-log-export', SessionLogDownload],
      ['@deepseek-ai/dsh-tool-pdf/runtime', ToolPdfRuntime],
      ['@deepseek-ai/dsh-agent', AgentRegistry],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-working-directory', WorkingDirectoryService],
      ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
      ['@deepseek-ai/dsh-attachment-local', LocalAttachmentStore],
    ])
    serveLoaderModules(context, modules)
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    const sessionId = SessionId('loader-session-pdf')
    const session = (context.get('sessions') as SessionStore)
      .create(sessionId, { meta: { createdAt: 1, cwd: root } })
    session.append('turn/start', { turn: 1 })
    session.append('user/message', {
      role: 'user',
      id: 'loader-user-1' as never,
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'Покажи листы' }],
    }, { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      stream: [],
      message: {
        role: 'assistant',
        id: 'loader-assistant-1' as never,
        source: { kind: 'model', provider: 'fixture', model: 'fixture' },
        content: [{ type: 'text', text: '## Раздел\n\nГотово.' }],
      },
    }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    // The route reads the committed log through the Session query engine; a
    // real engine needs a persistence backend this composition does not mount.
    context.provide('sessionQuery', {
      readSession: async () => ({ session: session.header, inheritedEventCount: 0, events: session.snapshotEvents() }),
    } as never)

    const agent = await registerAgent(context, sessionId, session)
    expect(context.commands.list(agent)).toContainEqual({
      definitionId: '@deepseek-ai/dsh-session-log-export/report',
      name: 'report', description: 'Download a PDF report of this Session',
    })

    const execution = await context.commands.execute(agent, '/report', [], new AbortController().signal)
    expect(execution?.result).toEqual({ kind: 'success', text: 'Session PDF report download requested.' })
    const types = session.snapshotEvents().map(event => event.type)
    expect(types).toContain('command/run')
    expect(types).toContain('command/done')
    expect(types).not.toContain('step/start')
    expect(types.filter(type => type === 'assistant/message')).toHaveLength(1)
    // No model adapter is mounted at all, and the runtime registered no tool.
    expect(context.get('llm')).toBeUndefined()
    expect(context.tools.schemas().map(schema => schema.name)).not.toContain('pdf_report')

    const route = routes.get('/api/session.report.pdf')
    if (route === undefined) throw new Error('the PDF report route was not registered')
    const url = `http://host/api/session.report.pdf?sessionId=${String(sessionId)}`
    const head = await route(new Request(url, { method: 'HEAD' }))
    expect(head.status).toBe(200)
    expect(await readdir(join(root, 'reports')).catch(() => [])).toEqual([])

    const response = await route(new Request(url))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('%PDF')

    const written = await readdir(join(root, 'reports'))
    expect(written).toHaveLength(1)
    expect(written[0]).toMatch(/^session-report-loader-session-pdf-[0-9a-f-]+\.pdf$/u)
    const stored = await readFile(join(root, 'reports', written[0]!))
    expect(stored.subarray(0, 4).toString('latin1')).toBe('%PDF')
  })
})

/**
 * Serve the listed plugin modules to the real Loader.
 * @param context - the booted Host context carrying the Loader.
 * @param modules - plugin modules by import specifier.
 */
function serveLoaderModules(context: Context, modules: Map<string, unknown>): void {
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
}

/**
 * Register one live Agent that owns a Session, without a model adapter.
 * @param context - the booted Host context.
 * @param sessionId - the Session the Agent owns.
 * @param session - the Session the Agent owns.
 * @returns the registered Agent.
 */
async function registerAgent(context: Context, sessionId: SessionId, session: Session): Promise<Agent> {
  let scope: Scope
  const agent: Agent = {
    id: sessionId,
    options: {},
    session,
    model: unsupportedModel(),
    inbox: unsupportedInbox(),
    status: 'idle',
    get ctx() { return scope.ctx },
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  await context.plugin(Object.assign((inner: Context) => { scope = createScope(inner, agent) }, { inject: ['tools'] }))
  await (context.get('agents') as AgentRegistry).register(agent)
  return agent
}
