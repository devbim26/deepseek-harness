/**
 * Model-facing document reading: extract text from an uploaded PDF, Word,
 * spreadsheet, or plain-text file and return one bounded window. @module
 * @deepseek-ai/dsh-tool-document
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { FsError } from '@deepseek-ai/dsh-fs'
import { ToolArgsError, ToolContextUnavailableError, defineTool } from '@deepseek-ai/dsh-tools'
import { DocumentError } from './errors.ts'
import { extractDocument, formatOf, type WindowRequest } from './extract/index.ts'
import { authorizeAttachmentPath } from './paths.ts'
import { renderDocument } from './render.ts'
import type { DocumentFormat, DocumentReadValue, DocumentWindow } from './types.ts'

export type { DocumentReadValue } from './types.ts'

/** Extraction bounds; every value is deployment-configurable. */
export interface Config {
  /** Maximum accepted source bytes. */
  maxInputBytes: number
  /** Maximum characters in one returned window. */
  maxChars: number
  /** Maximum workbook rows in one returned window. */
  maxRows: number
  /** Extraction deadline in milliseconds. */
  timeoutMs: number
}

/** Validated extraction bounds. */
export const Config: z<Partial<Config>, Config> = z.object({
  maxInputBytes: z.natural().min(1).default(52_428_800),
  maxChars: z.natural().min(1).max(1_000_000).default(20_000),
  maxRows: z.natural().min(1).max(100_000).default(500),
  timeoutMs: z.natural().min(1).default(30_000),
})

/** Stable Loader identity. */
export const name = 'tool-document'

/** Required services; the Office kit is read at call time. */
export const inject = ['tools', 'fs', 'attachments']

function requestOf(args: {
  page?: number
  sheet?: string
  row?: number
  offset?: number
  limit?: number
}, config: Config): WindowRequest {
  const page = args.page ?? 1
  if (!Number.isSafeInteger(page) || page < 1) throw new ToolArgsError(['document_read requires page to be a positive integer'])
  const row = args.row ?? 0
  if (!Number.isSafeInteger(row) || row < 0) throw new ToolArgsError(['document_read requires row to be a non-negative integer'])
  const offset = args.offset ?? 0
  if (!Number.isSafeInteger(offset) || offset < 0) throw new ToolArgsError(['document_read requires offset to be a non-negative integer'])
  const limit = args.limit === undefined ? config.maxChars : Math.min(args.limit, config.maxChars)
  if (!Number.isSafeInteger(limit) || limit < 1) throw new ToolArgsError(['document_read requires limit to be a positive integer'])
  return {
    page, row, offset, limit, maxRows: config.maxRows, maxBytes: config.maxInputBytes,
    ...args.sheet === undefined ? {} : { sheet: args.sheet },
  }
}

/**
 * Build the canonical document_read value from one extraction window and its continuation cursors.
 * @param target - authorized document target.
 * @param format - detected document format.
 * @param bytes - document size in bytes.
 * @param extracted - window returned by the format extractor.
 * @param request - the request that selected the window.
 * @returns the canonical value with nextPage, nextOffset, or nextRow when more content remains.
 */
function valueOf(
  target: FsTarget, format: DocumentFormat, bytes: number, extracted: DocumentWindow, request: WindowRequest,
): DocumentReadValue {
  const value: DocumentReadValue = {
    path: target.displayPath,
    format,
    bytes,
    text: extracted.text,
    ...extracted.totalChars === undefined ? {} : { totalChars: extracted.totalChars },
    ...extracted.pages === undefined ? {} : { pages: extracted.pages },
    ...extracted.page === undefined ? {} : { page: extracted.page },
    ...extracted.sheets === undefined ? {} : { sheets: extracted.sheets },
    ...extracted.sheet === undefined ? {} : { sheet: extracted.sheet },
    ...extracted.range === undefined ? {} : { range: extracted.range },
    ...extracted.row === undefined ? {} : { row: extracted.row },
    ...extracted.rows === undefined ? {} : { rows: extracted.rows },
    ...extracted.totalRows === undefined ? {} : { totalRows: extracted.totalRows },
  }
  if (value.page !== undefined && value.pages !== undefined && value.page < value.pages) value.nextPage = value.page + 1
  if (value.totalChars !== undefined) {
    const offset = request.offset
    if (offset + value.text.length < value.totalChars) value.nextOffset = offset + value.text.length
  }
  if (value.row !== undefined && value.rows !== undefined && value.totalRows !== undefined
    && value.row + value.rows < value.totalRows) value.nextRow = value.row + value.rows
  return value
}

/**
 * Register document_read with the extraction bounds.
 * @param ctx - agent-scoped services.
 * @param config - validated extraction bounds.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'document_read',
    description: 'Read text from a document the user attached to this conversation. Supports PDF, DOCX, DOC, '
      + 'XLSX, XLS, TXT, and CSV. Pass the absolute path from the attachment handle line in the user message. '
      + 'PDF: page selects one page (default 1); a page without a text layer, such as a scan, reports that no '
      + 'text exists. Workbook: sheet selects a worksheet and row selects the first data row; cells are '
      + 'tab-separated, and formulas follow values as (=formula). Other documents: offset and limit select a '
      + 'character window. Follow nextPage, nextOffset, or nextRow to continue a long document.',
    parameters: {
      path: {
        type: 'string', required: true,
        description: 'Absolute saved path of an uploaded document, as shown in its attachment handle.',
      },
      page: { type: 'integer', description: 'One-based PDF page; defaults to 1.' },
      sheet: { type: 'string', description: 'Workbook worksheet name; defaults to the first sheet.' },
      row: { type: 'integer', description: 'Zero-based first data row of the selected worksheet.' },
      offset: { type: 'integer', description: 'Character offset inside the selected page or document text.' },
      limit: { type: 'integer', description: 'Maximum characters to return; capped by configuration.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          format: {
            type: 'string', required: true,
            enum: ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'txt', 'csv'],
          },
          bytes: { type: 'integer', required: true },
          text: { type: 'string', required: true },
          totalChars: { type: 'integer' },
          pages: { type: 'integer' },
          page: { type: 'integer' },
          sheets: { type: 'array', items: { type: 'string' } },
          sheet: { type: 'string' },
          range: { type: 'string' },
          row: { type: 'integer' },
          rows: { type: 'integer' },
          totalRows: { type: 'integer' },
          nextOffset: { type: 'integer' },
          nextPage: { type: 'integer' },
          nextRow: { type: 'integer' },
        },
      },
      render: (_args, value) => renderDocument(value),
    },
    presentCall: args => ({
      card: 'generic' as const,
      title: `Document → ${args.path.split(/[\\/]/u).at(-1) ?? args.path}`,
      kind: 'other' as const,
      rawInput: { path: args.path, page: args.page, sheet: args.sheet },
    }),
    async execute(args, exec) {
      if (exec.agent === undefined) throw new ToolContextUnavailableError('document_read requires an agent Session')
      const signal = AbortSignal.any([exec.signal, AbortSignal.timeout(config.timeoutMs)])
      let target: FsTarget
      let value: DocumentReadValue
      try {
        signal.throwIfAborted()
        target = await authorizeAttachmentPath(ctx, exec.agent.session, args.path, signal)
        const format = formatOf(target.displayPath)
        const request = requestOf(args, config)
        const bytes = await ctx.fs.readBytes(target, signal, config.maxInputBytes).catch((error: unknown) => {
          if (error instanceof FsError && error.code === 'FS_TOO_LARGE') {
            throw new DocumentError(`The document exceeds the ${config.maxInputBytes}-byte limit.`, 'TOO_LARGE')
          }
          throw error
        })
        const window = await extractDocument(ctx, exec.agent, target, format, bytes, request, signal)
        value = valueOf(target, format, bytes.byteLength, window, request)
      } catch (error) {
        if (error instanceof DocumentError) throw error
        if (signal.aborted && signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError') {
          throw new DocumentError(`Document extraction exceeded ${config.timeoutMs} ms.`, 'TIMEOUT')
        }
        throw error
      }
      return value
    },
  }))
}
