/** Document-extraction failure class. @module @deepseek-ai/dsh-tool-document/errors */

import { HarnessError } from '@deepseek-ai/dsh-error'

const DOCUMENT_ERROR_CODES = [
  'UNSUPPORTED_FORMAT',
  'TOO_LARGE',
  'UNREADABLE',
  'NO_TEXT_LAYER',
  'NOT_AN_ATTACHMENT',
  'CONVERTER_UNAVAILABLE',
  'TIMEOUT',
  'INVALID_SELECTION',
] as const

/** Stable document failure codes. */
export type DocumentErrorCode = typeof DOCUMENT_ERROR_CODES[number]

/** A classified extraction failure with a stable machine-routing code. */
export class DocumentError extends HarnessError {
  /** Stable machine-routing failure code. */
  override readonly code: DocumentErrorCode

  /**
   * @param message - human-readable failure description without document contents.
   * @param code - stable machine-routing code.
   * @param options - optional chained cause.
   */
  constructor(message: string, code: DocumentErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'DocumentError'
    this.code = code
  }
}
