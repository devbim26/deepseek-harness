/**
 * Deterministic conversion of one committed Session log into report blocks.
 *
 * The conversion reads the same transcript projection as the Markdown export,
 * so both exports describe the same visible Session. It performs no
 * summarization: it selects the human messages, the final reply of each turn,
 * and the images the Session already produced.
 * @module
 */

import type { ReportBlock } from '@deepseek-ai/dsh-tool-pdf/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  closesFence, collectTurns, finalReplyIndex, openingFence, trimBlankEdgeLines, type ToolEntry,
} from './transcript.ts'

/** Structural heading of a human message in the report. */
const USER_HEADING = 'User'
/** Structural heading of a final assistant reply in the report. */
const ASSISTANT_HEADING = 'Assistant'
/** ATX heading line: its hashes, its text, and optional closing hashes. */
const ATX_HEADING = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/u
/**
 * One table-row token: an escape pair, a lone backslash, a backtick run, a
 * cell separator, or a stretch of text that contains none of them.
 */
const ROW_TOKEN = /\\[\s\S]|\\|`+|\||[^\\`|]+/gu

/** One table block. */
type TableBlock = Extract<ReportBlock, { type: 'table' }>
/** One code block: the lines of one fenced passage. */
type CodeBlock = Extract<ReportBlock, { type: 'code' }>
/** One text, code, or table block: the kind a Markdown reply converts into. */
type MarkdownBlock = Extract<ReportBlock, { type: 'text' }> | TableBlock | CodeBlock
/** One image block; a Session report always names the tool and the call that produced the image. */
type CaptionedImageBlock = Extract<ReportBlock, { type: 'image' }> & { readonly caption: string }
/** One report block as the Session report emits it. */
type EmittedBlock = MarkdownBlock | CaptionedImageBlock

/** One assembled report derived from a Session log. */
export interface SessionReport {
  /** Report title printed at the top of the first page. */
  readonly title: string
  /** Ordered report blocks. */
  readonly blocks: readonly ReportBlock[]
  /** Number of text characters the report carries, including its title. */
  readonly textChars: number
}

/**
 * Assemble one report from a committed Session log.
 *
 * The result contains the human user messages, the final assistant reply of
 * every turn, and the images of the latest committed tool result per call id,
 * in log order. Reasoning, system and developer messages, injected non-human
 * context, tool output text, and intermediate assistant messages are omitted.
 * @param events - complete committed logical event snapshot in seq order.
 * @param sessionId - the Session the events belong to.
 * @returns the report title, its blocks, and the carried text size.
 */
export function sessionReport(events: readonly SessionEvent[], sessionId: SessionId): SessionReport {
  const title = reportTitle(events, sessionId)
  const turns = collectTurns(events)
  const latest = latestToolEntries(turns)
  const blocks: EmittedBlock[] = []
  for (const turn of turns) {
    const finalIndex = finalReplyIndex(turn.segments)
    for (const [index, segment] of turn.segments.entries()) {
      if (segment.kind === 'user') {
        blocks.push({ type: 'text', heading: USER_HEADING, text: segment.text })
        continue
      }
      if (segment.kind === 'assistant') {
        if (index !== finalIndex) continue
        blocks.push(...withAssistantHeading(markdownBlocks(segment.text)))
        continue
      }
      if (latest.get(segment.callId) !== segment) continue
      if ((segment.result?.imageCount ?? 0) === 0) continue
      blocks.push({ type: 'image', callId: segment.callId, caption: imageCaption(segment) })
    }
  }
  return { title, blocks, textChars: reportTextChars(title, blocks) }
}

/**
 * Mark the start of an assistant reply as the assistant's section.
 *
 * A reply that opens with its own heading keeps that heading. A reply that
 * opens with plain text, a list, or code takes the structural label on its
 * first block. A reply that opens with a table gets the label as a block of
 * its own, so the table never reads as part of the preceding human message.
 * @param blocks - the reply's blocks.
 * @returns the blocks with the assistant label applied where it fits.
 */
function withAssistantHeading(blocks: readonly MarkdownBlock[]): readonly MarkdownBlock[] {
  const first = blocks[0]
  if (first === undefined || (first.type === 'text' && first.heading !== undefined)) return blocks
  if (first.type !== 'text') return [{ type: 'text', heading: ASSISTANT_HEADING, text: '' }, ...blocks]
  return [{ type: 'text', heading: ASSISTANT_HEADING, text: first.text }, ...blocks.slice(1)]
}

/**
 * Read the report title from the latest committed title event.
 * @param events - the committed events.
 * @param sessionId - the Session the events belong to.
 * @returns the title, or a fallback naming the Session.
 */
function reportTitle(events: readonly SessionEvent[], sessionId: SessionId): string {
  const title = events.findLast(event => event.type === 'session/title')?.data.title
  const line = title?.replace(/\r\n?|\n/gu, ' ').trim() ?? ''
  return line === '' ? `Session report ${String(sessionId)}` : line
}

/**
 * Index the latest tool entry per call id, so a retried call contributes its
 * images once.
 * @param turns - the projected turns.
 * @returns the last entry of every call id.
 */
function latestToolEntries(turns: ReturnType<typeof collectTurns>): Map<string, ToolEntry> {
  const latest = new Map<string, ToolEntry>()
  for (const turn of turns) {
    for (const segment of turn.segments) {
      if (segment.kind === 'tool') latest.set(segment.callId, segment)
    }
  }
  return latest
}

/**
 * Build the caption of one embedded image.
 *
 * The caption names the tool and the call id the image came from; it states
 * nothing the Session did not record.
 * @param entry - the tool entry that produced the image.
 * @returns the caption.
 */
function imageCaption(entry: ToolEntry): string {
  return `${entry.name} / ${entry.callId}`
}

/**
 * Count the text characters one report carries.
 * @param title - the report title.
 * @param blocks - the report blocks.
 * @returns the number of characters.
 */
function reportTextChars(title: string, blocks: readonly EmittedBlock[]): number {
  let total = title.length
  for (const block of blocks) {
    if (block.type === 'text') {
      total += (block.heading?.length ?? 0) + block.text.length
      continue
    }
    if (block.type === 'image') {
      total += block.caption.length
      continue
    }
    if (block.type === 'code') {
      total += block.text.length
      continue
    }
    for (const cell of block.header) total += cell.length
    for (const row of block.rows) for (const cell of row) total += cell.length
  }
  return total
}

/**
 * Convert one Markdown reply into report blocks.
 *
 * Headings and paragraphs become text blocks, pipe tables become table
 * blocks, fenced code becomes code blocks that print every line as written,
 * and lists keep their source text. Markdown image links keep their
 * alternative text; no destination is resolved and no image is downloaded.
 * @param markdown - the reply text.
 * @returns the report blocks in document order.
 */
export function markdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/gu, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let pendingHeading: string | undefined
  let index = 0
  const flushHeading = (): void => {
    if (pendingHeading === undefined) return
    blocks.push({ type: 'text', text: pendingHeading })
    pendingHeading = undefined
  }
  while (index < lines.length) {
    const line = lineAt(lines, index)
    if (line.trim() === '') {
      index += 1
      continue
    }
    const fence = openingFence(line)
    if (fence !== undefined) {
      const start = index + 1
      index += 1
      // An unclosed fence runs to the end of the reply.
      while (index < lines.length && !closesFence(lineAt(lines, index), fence)) index += 1
      const text = trimBlankEdgeLines(lines.slice(start, index).join('\n'))
      index += 1
      flushHeading()
      // A fence without content yields no block.
      if (text !== '') blocks.push({ type: 'code', text })
      continue
    }
    const heading = ATX_HEADING.exec(line)
    if (heading !== null) {
      flushHeading()
      const text = String(heading[1])
      // An ATX heading without text (`##`) labels nothing and yields no block.
      pendingHeading = text.trim() === '' ? undefined : text
      index += 1
      continue
    }
    const table = readTable(lines, index)
    if (table !== undefined) {
      flushHeading()
      blocks.push(table.block)
      index = table.next
      continue
    }
    if (isListLine(line)) {
      const start = index
      while (index < lines.length && isListLine(lineAt(lines, index))) index += 1
      blocks.push(textBlock(pendingHeading, lines.slice(start, index).map(replaceImageLinks).join('\n')))
      pendingHeading = undefined
      continue
    }
    const start = index
    // The paragraph stops where readTable sees a table, so every line the
    // loop stops at is consumed by the table branch and the index always advances.
    while (index < lines.length && isParagraphLine(lineAt(lines, index)) && readTable(lines, index) === undefined) {
      index += 1
    }
    blocks.push(textBlock(pendingHeading, lines.slice(start, index).map(replaceImageLinks).join('\n')))
    pendingHeading = undefined
  }
  flushHeading()
  return blocks
}

/**
 * Read one reply line. An index past the last line reads as an empty line, so
 * a lookahead never yields undefined.
 * @param lines - the reply lines.
 * @param index - zero-based line position.
 * @returns the line, or an empty line past the end.
 */
function lineAt(lines: readonly string[], index: number): string {
  return lines[index] ?? ''
}

/**
 * Build one text block with an optional heading.
 * @param heading - the heading the block carries.
 * @param text - the block body.
 * @returns the block.
 */
function textBlock(heading: string | undefined, text: string): MarkdownBlock {
  return heading === undefined
    ? { type: 'text', text }
    : { type: 'text', heading, text }
}

/**
 * Read whether a line starts a list item.
 * @param line - the candidate line.
 * @returns whether the line is a list item.
 */
function isListLine(line: string): boolean {
  return /^ {0,3}(?:[-*+]|\d+[.)])\s+/u.test(line)
}

/**
 * Read whether a line continues a paragraph.
 *
 * A paragraph ends at a blank line and at any line that starts a heading, a
 * fence, or a list.
 * @param line - the candidate line.
 * @returns whether the line continues the current paragraph.
 */
function isParagraphLine(line: string): boolean {
  if (line.trim() === '') return false
  if (/^ {0,3}#{1,6}\s/u.test(line)) return false
  if (openingFence(line) !== undefined) return false
  if (isListLine(line)) return false
  return true
}

/**
 * Read a Markdown table at one line: a pipe header row, a delimiter row, and
 * at least one body row.
 * @param lines - the reply lines.
 * @param start - the line the table starts at.
 * @returns the table block and the line after it, or undefined when the lines
 *   do not form a table.
 */
function readTable(
  lines: readonly string[],
  start: number,
): { readonly block: TableBlock; readonly next: number } | undefined {
  const header = lineAt(lines, start)
  if (!header.includes('|') || !isTableDelimiter(lineAt(lines, start + 1))) return undefined
  const headerCells = splitRow(header).map(replaceImageLinks)
  if (headerCells.length === 0) return undefined
  const rows: string[][] = []
  let index = start + 2
  while (index < lines.length) {
    const row = lineAt(lines, index)
    if (row.trim() === '' || !row.includes('|')) break
    rows.push(splitRow(row).map(replaceImageLinks))
    index += 1
  }
  if (rows.length === 0) return undefined
  return { block: { type: 'table', header: headerCells, rows }, next: index }
}

/**
 * Read whether a line is a table delimiter row.
 * @param line - the candidate line.
 * @returns whether the line separates a table header from its body.
 */
function isTableDelimiter(line: string): boolean {
  if (!line.includes('|')) return false
  const cells = splitRow(line)
  return cells.length > 0 && cells.every(cell => /^:?-+:?$/u.test(cell.replace(/\s+/gu, '')))
}

/**
 * Split one table row into its cells.
 *
 * Escaped pipes and pipes inside inline code do not separate cells. The
 * optional outer pipes are dropped; an empty cell between two separators is
 * kept.
 * @param line - the row text.
 * @returns the cell texts.
 */
function splitRow(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let span = 0
  for (const match of line.matchAll(ROW_TOKEN)) {
    const token = match[0]
    if (token === '|' && span === 0) {
      cells.push(current)
      current = ''
      continue
    }
    current += token
    if (token.startsWith('`')) {
      // A backtick run opens a code span; only a run of the same length closes it.
      if (span === 0) span = token.length
      else if (token.length === span) span = 0
    }
  }
  cells.push(current)
  const trimmed = cells.map(cell => cell.trim())
  if (trimmed[0] === '') trimmed.shift()
  if (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') trimmed.pop()
  return trimmed.map(cell => cell.replace(/\\\|/gu, '|'))
}

/**
 * Replace Markdown image links with their alternative text.
 *
 * The destination is dropped: the report embeds the pixels the Session stored,
 * never a linked resource.
 * @param text - the text to rewrite.
 * @returns the rewritten text.
 */
function replaceImageLinks(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, (_match, alt: string) => alt.trim() === '' ? 'Image' : alt)
    .replace(/!\[([^\]]*)\]\[[^\]]*\]/gu, (_match, alt: string) => alt.trim() === '' ? 'Image' : alt)
}
