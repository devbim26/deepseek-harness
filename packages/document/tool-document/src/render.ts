/** Model-facing result rendering for document_read. @module @deepseek-ai/dsh-tool-document/render */

import { basename } from 'node:path'
import type { DocumentReadValue } from './types.ts'

function describe(value: DocumentReadValue): string {
  const head = `Document "${basename(value.path)}" (${value.format}, ${value.bytes} bytes)`
  if (value.page !== undefined) {
    return `${head}: page ${value.page} of ${value.pages ?? value.page}, ${value.text.length} of ${value.totalChars ?? value.text.length} characters.`
  }
  if (value.sheet !== undefined) {
    const sheets = (value.sheets ?? []).map(sheet => JSON.stringify(sheet)).join(', ')
    const first = value.row ?? 0
    const last = first + Math.max((value.rows ?? 0) - 1, 0)
    return `${head}: sheets ${sheets}; sheet ${JSON.stringify(value.sheet)} rows ${first}-${last} of ${value.totalRows ?? 0}, range ${value.range ?? 'A1'}.`
  }
  return `${head}: ${value.text.length} of ${value.totalChars ?? value.text.length} characters.`
}

function continuation(value: DocumentReadValue): string {
  if (value.nextOffset !== undefined) return `\n\nMore text remains on this page or document: call document_read with offset=${value.nextOffset}.`
  if (value.nextPage !== undefined) return `\n\nMore pages remain: call document_read with page=${value.nextPage}.`
  if (value.nextRow !== undefined) return `\n\nMore rows remain: call document_read with row=${value.nextRow} and the same sheet.`
  return ''
}

/**
 * Render the model-facing content of one document window.
 * @param value - canonical document_read result.
 * @returns the file envelope, metadata line, text, and continuation hint.
 */
export function renderDocument(value: DocumentReadValue): { type: 'text'; text: string }[] {
  return [{
    type: 'text',
    text: `<path>${value.path}</path>\n<type>file</type>\n<content>\n`
      + `${describe(value)}\n${value.text}${continuation(value)}\n</content>`,
  }]
}
