/**
 * Format dispatch for document_read. Each format extracts one bounded unit;
 * later formats are added by their own implementation tasks. @module
 * @deepseek-ai/dsh-tool-document/extract
 */

import { extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { DocumentError } from '../errors.ts'
import type { DocumentFormat, DocumentWindow } from '../types.ts'
import { readPlainText } from './text.ts'

/** Extraction bounds and unit selection for one call. */
export interface WindowRequest {
  /** One-based PDF page. */
  page?: number
  /** Workbook worksheet name. */
  sheet?: string
  /** Zero-based first data row of the selected worksheet. */
  row?: number
  /** Character offset inside the selected page or document. */
  offset: number
  /** Maximum characters in the returned window. */
  limit: number
  /** Maximum worksheet rows in the returned window. */
  maxRows: number
  /** Maximum bytes accepted from a converted legacy document. */
  maxBytes: number
}

/**
 * Map a stored document leaf name to its extraction format.
 * @param displayPath - resolved document path.
 * @returns the supported format.
 * @throws a DocumentError with code UNSUPPORTED_FORMAT for every other extension.
 */
export function formatOf(displayPath: string): DocumentFormat {
  switch (extname(displayPath).toLowerCase()) {
    case '.txt': return 'txt'
    case '.csv': return 'csv'
    default:
      throw new DocumentError(
        `"${displayPath}" is not a supported document; supported formats are PDF, DOCX, DOC, XLSX, XLS, TXT, and CSV.`,
        'UNSUPPORTED_FORMAT',
      )
  }
}

function slice(text: string, offset: number, limit: number): DocumentWindow {
  const start = Math.min(offset, text.length)
  return { text: text.slice(start, start + limit), totalChars: text.length }
}

/**
 * Extract one window from an authorized document.
 * @param ctx - context owning optional conversion services.
 * @param agent - calling agent, used for conversion ownership.
 * @param target - authorized document target.
 * @param format - detected format.
 * @param bytes - complete document bytes.
 * @param request - unit selection and bounds.
 * @param signal - cancellation for extraction and conversion.
 * @returns the extracted window.
 */
export async function extractDocument(
  ctx: Context, agent: Agent, target: FsTarget, format: DocumentFormat, bytes: Uint8Array,
  request: WindowRequest, signal: AbortSignal,
): Promise<DocumentWindow> {
  void ctx
  void agent
  void target
  void signal
  switch (format) {
    case 'txt':
    case 'csv':
      return slice(readPlainText(bytes), request.offset, request.limit)
    default:
      throw new DocumentError(`"${target.displayPath}" cannot be extracted.`, 'UNSUPPORTED_FORMAT')
  }
}
