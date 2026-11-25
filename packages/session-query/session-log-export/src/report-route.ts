/**
 * Host route that assembles a PDF report from the live Session log.
 *
 * The route owns no report logic: it selects the live Agent that owns the
 * requested Session, reads the committed log through the Session query engine,
 * converts it into report blocks, and hands them to the shared PDF report
 * service. It creates no Agent, starts no model turn, and publishes nothing.
 * @module
 */

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, win32 } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-tool-pdf/types'
import { sessionReport } from './session-report.ts'

/** PDF report placement and size limits. */
export interface SessionPdfReportConfig {
  /** Validated Session-relative directory receiving generated PDF files, without trailing separators. */
  readonly reportDirectory: string
  /** Maximum number of text characters one report may carry. */
  readonly maxReportChars: number
}

/**
 * Resolve the configured report directory to the form the route writes under.
 * @param directory - the configured directory.
 * @returns the directory without trailing separators.
 * @throws Error when the directory is blank, absolute, drive-relative, or climbs out of the workspace.
 */
export function resolveReportDirectory(directory: string): string {
  const normalized = directory.replace(/[\\/]+$/u, '')
  // A drive designator without a separator (`C:reports`) resolves against the
  // per-drive working directory on Windows, not against the Session workspace.
  if (normalized.trim() === ''
    || isAbsolute(normalized)
    || win32.isAbsolute(normalized)
    || /^[A-Za-z]:/u.test(normalized)
    || normalized.split(/[\\/]/u).includes('..')) {
    throw new Error('reportDirectory must be a safe Session-relative path')
  }
  return normalized
}

/**
 * Read one written report into the bytes of a response body.
 * @param path - canonical path the report writer returned.
 * @returns the encoded PDF.
 */
async function readReportBytes(path: string): Promise<Uint8Array<ArrayBuffer>> {
  const stored = await readFile(path)
  const bytes = new Uint8Array(stored.byteLength)
  bytes.set(stored)
  return bytes
}

/**
 * Build the browser download filename of one Session report.
 * @param sessionId - the Session the report belongs to.
 * @returns one safe filename.
 */
export function sessionPdfFilename(sessionId: SessionId): string {
  return `dsh-session-${safeSessionId(sessionId)}-report.pdf`
}

/**
 * Assemble one Session report and answer the request.
 *
 * `HEAD` performs the preflight only: it creates no file and reads no
 * attachment. `GET` writes one uniquely named report into the Session
 * workspace and returns it as an attachment.
 * @param ctx - Host context carrying the agent registry, the Session query engine, and the report service.
 * @param request - the authenticated request with a required `sessionId` query.
 * @param config - the resolved report placement and size limits.
 * @returns the report response, or a sanitized status for a rejected request.
 */
export async function sessionPdfResponse(
  ctx: Context,
  request: Request,
  config: SessionPdfReportConfig,
): Promise<Response> {
  const sessionIdValue = new URL(request.url).searchParams.get('sessionId')
  if (sessionIdValue === null || sessionIdValue.length === 0) {
    return new Response('missing or invalid sessionId query parameter', { status: 400 })
  }
  const agents = ctx.get('agents')
  const reports = ctx.get('pdfReports')
  const sessionQuery = ctx.get('sessionQuery')
  if (agents === undefined || reports === undefined || sessionQuery === undefined) {
    return new Response(
      'session PDF report is unavailable: missing agent registry, Session query engine, or PDF report service',
      { status: 503 },
    )
  }
  const sessionId = brandString<SessionId>(sessionIdValue)
  const agent = agents.get(sessionId)
  if (agent === undefined) {
    return new Response('session PDF report requires a live Session', { status: 409 })
  }
  request.signal.throwIfAborted()
  let events: readonly SessionEvent[]
  try {
    events = (await sessionQuery.readSession(sessionId)).events
  } catch (error: unknown) {
    // The Session query engine rejected the read: storage, header compatibility, or replay
    // validation failed, or the Session has no readable log.
    request.signal.throwIfAborted()
    return sanitizedFailure(ctx, error, 'session PDF report failed to read the session log')
  }
  request.signal.throwIfAborted()
  const report = sessionReport(events, sessionId)
  if (report.blocks.length === 0) {
    return new Response('session PDF report has no reportable content', { status: 422 })
  }
  if (report.textChars > config.maxReportChars) {
    return new Response('session PDF report exceeds the configured text limit', { status: 413 })
  }
  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers: { 'content-type': 'application/pdf' } })
  }
  const filePath = `${config.reportDirectory}/session-report-${safeSessionId(sessionId)}-${randomUUID()}.pdf`
  let written: { readonly path: string }
  try {
    written = await reports.create(agent, {
      filePath,
      title: report.title,
      blocks: report.blocks,
      includeSkippedImagesAppendix: true,
      actor: { agent },
    }, request.signal)
  } catch (error: unknown) {
    // Assembly or write failure (path resolution, image collection, PDF encoding, or the
    // file write). An aborted request rethrows here instead.
    request.signal.throwIfAborted()
    return sanitizedFailure(ctx, error, 'session PDF report failed to write the document')
  }
  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = await readReportBytes(written.path)
  } catch (error: unknown) {
    // The written file vanished or cannot be read before the response leaves.
    request.signal.throwIfAborted()
    return sanitizedFailure(ctx, error, 'session PDF report failed to read the document')
  }
  return new Response(bytes, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${sessionPdfFilename(sessionId)}"`,
      'content-length': String(bytes.byteLength),
    },
  })
}

/**
 * Log one post-preflight failure for the operator and answer the browser with
 * its sanitized message. The response never echoes the failure: route error
 * messages may carry absolute host paths into the browser error bar, while the
 * server log records the real cause.
 * @param ctx - host context carrying the logger.
 * @param error - the caught failure, Error or not.
 * @param message - the sanitized response body.
 * @returns the 500 response for `message`.
 */
function sanitizedFailure(ctx: Context, error: unknown, message: string): Response {
  ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
  return new Response(message, { status: 500 })
}

/**
 * Reduce a Session id to the characters a filename may carry.
 * @param sessionId - the Session the report belongs to.
 * @returns the safe form.
 */
function safeSessionId(sessionId: SessionId): string {
  return String(sessionId).replace(/[^A-Za-z0-9_-]/gu, '_')
}
