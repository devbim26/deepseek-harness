/**
 * Verbatim lines of the programmatic code block: the words of each source
 * line keep its leading indentation and carry no emphasis, so the PDF
 * assembler reads no Markdown out of code.
 * @module @deepseek-ai/dsh-tool-pdf/code
 */

import type { StyledWord } from './pdf.ts'

/**
 * Split a code block into the words of each of its lines. A tab counts as
 * four spaces, and the leading indentation of a line is one word: the first
 * word of the line follows it without a gap.
 * @param text - the code block's text; `\n` or `\r\n` separates lines.
 * @returns the words of every line in source order; a blank line has none.
 */
export function codeLines(text: string): StyledWord[][] {
  return text.split(/\r?\n/).map((source) => {
    const expanded = source.replaceAll('\t', '    ')
    const leading = expanded.length - expanded.trimStart().length
    const words: StyledWord[] = []
    let spaced = false
    if (leading > 0) words.push({ text: expanded.slice(0, leading), bold: false, mark: false, gapBefore: false })
    for (const piece of expanded.slice(leading).split(/\s+/)) {
      if (piece.length > 0) {
        words.push({ text: piece, bold: false, mark: false, gapBefore: spaced })
        spaced = true
      }
    }
    return words
  })
}
