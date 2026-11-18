/** Plain-text and CSV decoding. @module @deepseek-ai/dsh-tool-document/extract/text */

import { normalizeText } from './normalize.ts'

/**
 * Decode UTF-8 text, falling back to windows-1251 for legacy Russian files.
 * @param bytes - complete document bytes.
 * @returns decoded text.
 * @throws when neither UTF-8 nor windows-1251 can represent the bytes.
 */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    /* v8 ignore next -- TextDecoder with fatal:true throws only TypeError; the rethrow guards a future runtime change */
    if (!(error instanceof TypeError)) throw error
    return new TextDecoder('windows-1251').decode(bytes)
  }
}

/**
 * Decode and normalize a plain-text or CSV document.
 * @param bytes - complete document bytes.
 * @returns normalized text.
 */
export function readPlainText(bytes: Uint8Array): string {
  return normalizeText(decodeText(bytes))
}
