/**
 * The Markdown subset a report text block renders, parsed without a
 * dependency. Every non-empty line is its own paragraph unless it opens a
 * heading, a list item, or a pipe table, and an empty line separates
 * paragraphs. Inline marks never nest, italics and links stay literal, a
 * table row cannot continue on the next line, and a pipe cannot be escaped
 * inside a table row.
 * @module @deepseek-ai/dsh-tool-pdf/markdown
 */

/** One stretch of a line sharing one emphasis; the whitespace inside it is kept. */
export interface InlineRun {
  /** The stretch's text without its markers. */
  readonly text: string
  /** The stretch was wrapped in `**` and renders in the bold face. */
  readonly bold: boolean
  /** The stretch was wrapped in `==` and renders on the yellow highlight band. */
  readonly mark: boolean
}

/** One list item. */
export interface ListItem {
  /** `•` for a bullet item; the source number with its `.` or `)` for a numbered item. */
  readonly marker: string
  /** The item text after the marker; empty for a bare marker line. */
  readonly runs: readonly InlineRun[]
}

/** One block-level fragment of a text block. */
export type TextFragment =
  | {
    readonly kind: 'heading'
    /** Heading level; a deeper source heading clamps to the third level. */
    readonly level: 1 | 2 | 3
    readonly runs: readonly InlineRun[]
  }
  | {
    readonly kind: 'paragraph'
    readonly runs: readonly InlineRun[]
    /** An empty line precedes the paragraph and the fragment before it is a paragraph too. */
    readonly spaced: boolean
  }
  | { readonly kind: 'list'; readonly items: readonly ListItem[] }
  | {
    readonly kind: 'table'
    /** Source text of the first pipe row's cells, without the outer pipes. */
    readonly header: readonly string[]
    /** Source text of the cells after the optional separator row; empty for a header-only table. */
    readonly rows: readonly (readonly string[])[]
  }

const INLINE_MARK = /\*\*(.+?)\*\*|==(.+?)==|`([^`]+)`/g
const HEADING = /^(#{1,6})\s+(.+?)\s*$/
const THEMATIC_BREAK = /^\s{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const LIST_ITEM = /^\s*([-*+]|\d{1,3}[.)])(?:\s+(.*))?$/
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/

/**
 * Split one line into runs by `**bold**`, `==highlight==`, and `` `code` ``
 * markers. The markers are removed; an unclosed marker stays literal text.
 * @param line - One line without a line break.
 * @returns The runs in order; neighbors with the same emphasis are merged.
 */
export function parseInlineRuns(line: string): InlineRun[] {
  const runs: InlineRun[] = []
  const push = (text: string, bold: boolean, mark: boolean): void => {
    if (text.length === 0) return
    const last = runs.at(-1)
    if (last !== undefined && last.bold === bold && last.mark === mark) {
      runs[runs.length - 1] = { text: last.text + text, bold, mark }
      return
    }
    runs.push({ text, bold, mark })
  }
  let end = 0
  for (const match of line.matchAll(INLINE_MARK)) {
    const start = match.index
    push(line.slice(end, start), false, false)
    // Exactly one alternative matched, so exactly one of the three text groups is present.
    const [, bold, mark, code] = match
    if (bold !== undefined) push(bold, true, false)
    else if (mark !== undefined) push(mark, false, true)
    else push(String(code), false, false)
    end = start + match[0].length
  }
  push(line.slice(end), false, false)
  return runs
}

/**
 * Remove the inline markers of one line without styling the text.
 * @param line - One line without a line break.
 * @returns The line's text with every closed marker removed.
 */
export function stripInlineMarks(line: string): string {
  return parseInlineRuns(line).map(run => run.text).join('')
}

/**
 * Tell whether a table cell renders on the highlight band: its text carries at
 * least one `==…==` mark. The band covers the whole cell, because a cell
 * prints as plain lines; the marks themselves are removed from the lines.
 * @param cell - One cell's source text.
 * @returns Whether the cell's whole area takes the highlight fill.
 */
export function isHighlightedCell(cell: string): boolean {
  return parseInlineRuns(cell.trim()).some(run => run.mark)
}

function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
}

/**
 * Parse a text block into the fragments the PDF assembler draws.
 * @param text - The text block's body; `\n` or `\r\n` separates lines.
 * @returns The fragments in document order; blank text yields none.
 */
export function parseTextBlock(text: string): TextFragment[] {
  const fragments: TextFragment[] = []
  const lines = text.split(/\r?\n/)
  let afterEmptyLine = false
  for (let index = 0; index < lines.length; index++) {
    // The loop bound keeps the index inside `lines`.
    const line = lines[index] as string
    if (line.trim() === '') {
      afterEmptyLine = true
      continue
    }
    const following = lines.slice(index + 1)
    const lead = following[0]
    const heading = HEADING.exec(line)
    const item = heading === null ? LIST_ITEM.exec(line) : null
    if (heading !== null) {
      const depth = Math.min((heading[1] as string).length, 3)
      fragments.push({
        kind: 'heading',
        level: depth === 1 || depth === 2 ? depth : 3,
        runs: parseInlineRuns((heading[2] as string).replace(/\s+#+\s*$/, '')),
      })
    } else if (line.includes('|') && lead !== undefined && (lead.includes('|') || TABLE_SEPARATOR.test(lead))) {
      const separated = TABLE_SEPARATOR.test(lead)
      const rows: string[][] = []
      for (const row of following.slice(separated ? 1 : 0)) {
        if (!row.includes('|')) break
        rows.push(tableCells(row))
      }
      fragments.push({ kind: 'table', header: tableCells(line), rows })
      index += rows.length + (separated ? 1 : 0)
    } else if (THEMATIC_BREAK.test(line)) {
      continue
    } else if (item !== null) {
      const source = item[1] as string
      const entry: ListItem = { marker: /^\d/.test(source) ? source : '•', runs: parseInlineRuns(item[2] ?? '') }
      const last = fragments.at(-1)
      if (last?.kind === 'list') fragments[fragments.length - 1] = { kind: 'list', items: [...last.items, entry] }
      else fragments.push({ kind: 'list', items: [entry] })
    } else {
      fragments.push({
        kind: 'paragraph',
        runs: parseInlineRuns(line.trim()),
        spaced: afterEmptyLine && fragments.at(-1)?.kind === 'paragraph',
      })
    }
    afterEmptyLine = false
  }
  return fragments
}
