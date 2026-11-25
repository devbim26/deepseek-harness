/** PDF report Host route: status semantics, preflight-only HEAD, and one written report per GET. */

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import {
  SESSION_FORMAT_VERSION, Session, type SessionEvent, type SessionHeader, type SessionId,
} from '@deepseek-ai/dsh-session'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { PdfReportCreateRequest, PdfReportResult } from '@deepseek-ai/dsh-tool-pdf/types'
import { apply, inject } from '../src/index.ts'
import { resolveReportDirectory } from '../src/report-route.ts'
import { SESSION_PDF_REPORT_PATH } from '../src/routes.ts'

const SID = 'pdf-report-route' as SessionId
const messageId = (value: string): MessageId => brandString<MessageId>(value)

/** The report writer call the route makes. */
type CreateReport = (
  agent: Agent,
  request: PdfReportCreateRequest,
  signal: AbortSignal,
) => Promise<PdfReportResult>

/** The complete committed log one Session query engine read returns. */
type ReadSession = (id: SessionId) => Promise<{
  session: SessionHeader
  inheritedEventCount: number
  events: readonly SessionEvent[]
}>

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

/** One Session carrying a human question and a final answer. */
function seededSession(id: SessionId, cwd: string, withContent = true): Session {
  const session = Session.create(id, [], {
    version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd, isSeeded: false,
  })
  if (!withContent) return session
  session.append('turn/start', { turn: 1 })
  session.append('user/message', {
    role: 'user',
    id: messageId('user-1'),
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'Покажи листы' }],
  }, { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    stream: [],
    message: {
      role: 'assistant',
      id: messageId('assistant-1'),
      source: { kind: 'model', provider: 'test', model: 'test' },
      content: [{ type: 'text', text: '## Раздел\n\nГотово.' }],
    },
  }, { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return session
}

/** Compose the plugin with a live Agent and stubbed Session query and report services. */
async function mounted(options: {
  readonly agent?: 'live' | 'missing' | 'absent'
  readonly withService?: boolean
  readonly withQuery?: boolean
  readonly readFails?: true | 'value'
  readonly withContent?: boolean
  readonly maxReportChars?: number
} = {}): Promise<{
  readonly shared: ReturnType<HostConnectionService['createSharedFetchHandler']>
  readonly connection: HostConnectionService
  readonly create: Mock<CreateReport>
  readonly readSession: Mock<ReadSession>
  readonly root: string
  readonly dispose: () => Promise<void>
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-session-pdf-report-'))
  roots.push(root)
  const session = seededSession(SID, root, options.withContent !== false)
  const written = join(root, 'written.pdf')
  await writeFile(written, '%PDF-1.7 report')
  const create = vi.fn(async (
    _agent: Agent,
    _request: PdfReportCreateRequest,
    _signal: AbortSignal,
  ): Promise<PdfReportResult> => ({
    path: written,
    bytes: 18,
    pages: 1,
    imagesEmbedded: 0,
    imagesSkipped: [],
    availableImageCalls: [],
  }))
  const readSession = vi.fn(async (_id: SessionId) => {
    // The non-Error rejection covers the sanitizedFailure arm that wraps thrown values.
    if (options.readFails === 'value') throw 'storage unavailable'
    if (options.readFails === true) throw new Error(`failed at ${join(root, 'session.v4.jsonl')}`)
    return { session: session.header, inheritedEventCount: 0, events: session.snapshotEvents() }
  })
  const ctx = new Context()
  ctx.provide('commands', { register: () => () => {} } as never)
  const agentState = options.agent ?? 'live'
  if (agentState !== 'absent') {
    ctx.provide('agents', {
      get: (id: SessionId) => agentState === 'live' && id === SID ? { id: SID, session } : undefined,
    } as never)
  }
  if (options.withService !== false) ctx.provide('pdfReports', { create } as never)
  if (options.withQuery !== false) ctx.provide('sessionQuery', { readSession } as never)
  const connection = new HostConnectionService(ctx, [], {} as BrowserAuth)
  const fiber = ctx.plugin({
    inject: [...inject],
    apply: (context: Context) => {
      apply(context, { maxReportChars: options.maxReportChars ?? 200000 })
    },
  })
  await fiber
  return {
    shared: connection.createSharedFetchHandler('/api'),
    connection,
    create,
    readSession,
    root,
    dispose: () => fiber.dispose(),
  }
}

function request(init?: RequestInit): Request {
  return new Request(`http://host${SESSION_PDF_REPORT_PATH}?sessionId=${SID}`, init)
}

describe('Session PDF report Fetch route', () => {
  it('writes one report per GET and returns it as an attachment', async () => {
    const { shared, connection, create, readSession, dispose } = await mounted()
    const response = await shared.fetch(request(), connection.browserPeer)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition'))
      .toBe('attachment; filename="dsh-session-pdf-report-route-report.pdf"')
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0)
    // The committed log comes from the Session query engine, never from a synchronous Session read.
    expect(readSession).toHaveBeenCalledOnce()
    expect(readSession.mock.calls[0]?.[0]).toBe(SID)
    expect(create).toHaveBeenCalledOnce()
    const call = create.mock.calls[0]
    if (call === undefined) throw new Error('the report writer was not called')
    const [owner, reportRequest] = call
    expect(owner.id).toBe(SID)
    expect(reportRequest.title).toBe('Session report pdf-report-route')
    expect(reportRequest.includeSkippedImagesAppendix).toBe(true)
    expect(reportRequest.actor).toEqual({ agent: owner })
    expect(reportRequest.filePath.startsWith('reports/session-report-pdf-report-route-')).toBe(true)
    expect(reportRequest.filePath.endsWith('.pdf')).toBe(true)
    await dispose()
  })

  it('answers HEAD with the preflight only and writes no file', async () => {
    const { shared, connection, create, root, dispose } = await mounted()
    const response = await shared.fetch(request({ method: 'HEAD' }), connection.browserPeer)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.body).toBeNull()
    expect(create).not.toHaveBeenCalled()
    expect(await readdir(root)).toEqual(['written.pdf'])
    await dispose()
  })

  it('removes the route with the plugin fiber', async () => {
    const { shared, connection, dispose } = await mounted()
    await dispose()
    expect((await shared.fetch(request(), connection.browserPeer)).status).toBe(404)
  })

  it('rejects a missing session id', async () => {
    const { shared, connection, dispose } = await mounted()
    const response = await shared.fetch(
      new Request(`http://host${SESSION_PDF_REPORT_PATH}`),
      connection.browserPeer,
    )
    expect(response.status).toBe(400)
    await dispose()
  })

  it('answers 409 when the Session has no live Agent', async () => {
    const { shared, connection, create, dispose } = await mounted({ agent: 'missing' })
    const response = await shared.fetch(request(), connection.browserPeer)
    expect(response.status).toBe(409)
    expect(await response.text()).toBe('session PDF report requires a live Session')
    expect(create).not.toHaveBeenCalled()
    await dispose()
  })

  it('answers 503 when the agent registry is absent', async () => {
    const { shared, connection, dispose } = await mounted({ agent: 'absent' })
    const response = await shared.fetch(request(), connection.browserPeer)
    expect(response.status).toBe(503)
    await dispose()
  })

  it('answers 503 when the report service is absent', async () => {
    const { shared, connection, dispose } = await mounted({ withService: false })
    const response = await shared.fetch(request(), connection.browserPeer)
    expect(response.status).toBe(503)
    await dispose()
  })

  it('answers 503 when the Session query engine is absent', async () => {
    const { shared, connection, create, dispose } = await mounted({ withQuery: false })
    const response = await shared.fetch(request(), connection.browserPeer)
    expect(response.status).toBe(503)
    expect(create).not.toHaveBeenCalled()
    await dispose()
  })

  it('answers a sanitized 500 when the committed log cannot be read', async () => {
    const { shared, connection, create, root, dispose } = await mounted({ readFails: true })
    const response = await shared.fetch(request(), connection.browserPeer)
    expect(response.status).toBe(500)
    const detail = await response.text()
    expect(detail).toBe('session PDF report failed to read the session log')
    expect(detail).not.toContain(root)
    expect(create).not.toHaveBeenCalled()
    await dispose()
  })

  it('answers the same sanitized 500 when the log read rejects with a non-Error value', async () => {
    const { shared, connection, dispose } = await mounted({ readFails: 'value' })
    const response = await shared.fetch(request(), connection.browserPeer)
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('session PDF report failed to read the session log')
    await dispose()
  })

  it('propagates an aborted request before the log is read', async () => {
    const { shared, connection, create, readSession, dispose } = await mounted()
    const abort = new AbortController()
    const reason = new Error('report request cancelled')
    abort.abort(reason)
    await expect(shared.fetch(request({ signal: abort.signal }), connection.browserPeer)).rejects.toBe(reason)
    expect(readSession).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    await dispose()
  })

  it('answers 422 when the Session carries no reportable content', async () => {
    const { shared, connection, create, dispose } = await mounted({ withContent: false })
    const response = await shared.fetch(request(), connection.browserPeer)
    expect(response.status).toBe(422)
    expect(create).not.toHaveBeenCalled()
    await dispose()
  })

  it('answers 413 when the report exceeds the configured text limit', async () => {
    const { shared, connection, create, dispose } = await mounted({ maxReportChars: 5 })
    const response = await shared.fetch(request(), connection.browserPeer)
    expect(response.status).toBe(413)
    expect(create).not.toHaveBeenCalled()
    await dispose()
  })

  it('answers a sanitized 500 when the report cannot be written', async () => {
    const { shared, connection, create, dispose } = await mounted()
    create.mockRejectedValueOnce(new Error('failed at /private/host/session'))
    const response = await shared.fetch(request(), connection.browserPeer)
    expect(response.status).toBe(500)
    const detail = await response.text()
    expect(detail).toBe('session PDF report failed to write the document')
    expect(detail).not.toContain('/private/host')
    await dispose()
  })

  it('answers a sanitized 500 when the written report cannot be read back', async () => {
    const { shared, connection, create, root, dispose } = await mounted()
    create.mockResolvedValueOnce({
      path: join(root, 'missing.pdf'), bytes: 18, pages: 1, imagesEmbedded: 0, imagesSkipped: [], availableImageCalls: [],
    })
    const response = await shared.fetch(request(), connection.browserPeer)
    expect(response.status).toBe(500)
    const detail = await response.text()
    expect(detail).toBe('session PDF report failed to read the document')
    expect(detail).not.toContain(root)
    await dispose()
  })

  it('propagates the cancellation of an aborted request instead of answering 500', async () => {
    const { shared, connection, create, dispose } = await mounted()
    const abort = new AbortController()
    const reason = new Error('report request cancelled')
    create.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      abort.abort(reason)
      reject(reason)
    }))
    await expect(shared.fetch(request({ signal: abort.signal }), connection.browserPeer)).rejects.toBe(reason)
    await dispose()
  })

  it('leaves the written report in the workspace', async () => {
    const { shared, connection, root, dispose } = await mounted()
    await shared.fetch(request(), connection.browserPeer)
    expect(await readdir(root)).toContain('written.pdf')
    expect((await readFile(join(root, 'written.pdf'), 'utf8')).startsWith('%PDF')).toBe(true)
    await dispose()
  })
})

describe('report directory resolution', () => {
  it('resolves a Session-relative directory without its trailing separators', () => {
    expect(resolveReportDirectory('reports')).toBe('reports')
    expect(resolveReportDirectory('out/reports/')).toBe('out/reports')
    expect(resolveReportDirectory('out\\reports\\')).toBe('out\\reports')
  })

  it.each([
    ['blank', ''],
    ['whitespace', '   '],
    ['POSIX absolute', '/reports'],
    ['Windows root-relative', '\\reports'],
    ['Windows absolute', 'C:\\reports'],
    ['Windows absolute with a forward slash', 'C:/reports'],
    ['drive-relative', 'C:reports'],
    ['UNC', '\\\\server\\share\\reports'],
    ['parent segment', '../reports'],
    ['nested parent segment', 'reports/../../out'],
  ])('rejects a %s directory', (_label, directory: string) => {
    expect(() => resolveReportDirectory(directory))
      .toThrow('reportDirectory must be a safe Session-relative path')
  })
})
