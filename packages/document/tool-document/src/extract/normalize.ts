/** Text normalization shared by the document extractors. @module @deepseek-ai/dsh-tool-document/extract/normalize */

/**
 * Normalize extracted text: CRLF, trailing spaces, and long blank runs.
 * @param text - raw extracted text.
 * @returns the normalized text without leading or trailing whitespace.
 */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+$/gmu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}
