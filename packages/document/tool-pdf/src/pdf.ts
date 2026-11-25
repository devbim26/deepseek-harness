/**
 * Pure A4 PDF assembly: ordered text, table, and image blocks on paginated
 * pages with embedded Cyrillic-capable fonts. A text block takes the Markdown
 * subset of `./markdown.ts`; a code block prints its lines as written. No
 * filesystem, service, or Session access.
 * @module @deepseek-ai/dsh-tool-pdf/pdf
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import fontkit from '@pdf-lib/fontkit'
import {
  PDFDocument, rgb, type Color, type PDFFont, type PDFImage, type PDFPage,
} from 'pdf-lib'
import { codeLines } from './code.ts'
import { isHighlightedCell, parseTextBlock, stripInlineMarks, type InlineRun } from './markdown.ts'
import type { ReportBlock, ReportImage } from './types.ts'

/** A4 portrait in PDF points. */
export const A4 = { width: 595.28, height: 841.89 } as const

/** Page margin in points on every side. */
export const MARGIN = 48

/** Usable horizontal space between the margins. */
export const CONTENT_WIDTH = A4.width - MARGIN * 2

/** Assembled document. */
export interface PdfDocument {
  /** Encoded PDF bytes. */
  bytes: Uint8Array
  /** Total page count. */
  pages: number
}

const TEXT_COLOR = rgb(0.13, 0.15, 0.18)
const MUTED_COLOR = rgb(0.45, 0.48, 0.52)

const TITLE_SIZE = 20
const HEADING_SIZE = 13
const BODY_SIZE = 11
const CAPTION_SIZE = 9

/** Vertical space between blocks and after the title. */
const BLOCK_GAP = 14
/** Body line height. */
const BODY_LEADING = 16

const CELL_SIZE = 9
const CELL_LEADING = 12
const CELL_PAD_X = 5
const CELL_PAD_Y = 3
/** Narrowest column before the final scale-to-fit normalization. */
const MIN_COLUMN_WIDTH = 36
const HEADER_FILL = rgb(0.10, 0.23, 0.36)
const ZEBRA_FILL = rgb(0.93, 0.95, 0.97)
const WHITE = rgb(1, 1, 1)
const GRID_COLOR = rgb(0.60, 0.60, 0.60)
const GRID_WIDTH = 0.5
/** Content length cap per measured cell, so one long cell cannot hog the width. */
const MEASURE_CAP = 80
/** Yellow band drawn under `==…==` text in a text block and the fill of a table cell that carries such a mark. */
export const HIGHLIGHT_FILL = rgb(1, 0.93, 0.42)
/** Horizontal padding of a highlight band beyond its marked words. */
const HIGHLIGHT_PAD_X = 1.5
/** A highlight band's extent below the baseline, as a fraction of the font size. */
const HIGHLIGHT_DESCENT = 0.2
/** A highlight band's height, as a fraction of the font size. */
const HIGHLIGHT_HEIGHT = 1.05
/** Bold size of each Markdown heading level inside a text block. */
export const HEADING_SIZES = { 1: 15, 2: 13, 3: 12 } as const
/** Indent of a list item's text from the margin; a wider marker pushes it further. */
const LIST_INDENT = 18
/** Least space between a list marker and the item text. */
const LIST_MARKER_GAP = 4
/** Vertical space between a list and the fragments above and below it. */
const LIST_GAP = 6

type FontFile = 'NotoSans-Regular.ttf' | 'NotoSans-Bold.ttf'

const fontCache = new Map<FontFile, Promise<Uint8Array>>()

/**
 * Locate one vendored font from the calling module's layout. The fonts ship at
 * the package root (`assets/fonts`), while the calling module may be a source
 * file (`src`), Host tsc output one level deeper (`lib/types`), or the bundled
 * loader entry (`lib`) — so climb to the nearest ancestor holding the fonts
 * rather than fixing a relative hop.
 * @param file - vendored Noto Sans face.
 * @param moduleUrl - `import.meta.url` of the calling module.
 * @returns the font's URL.
 * @throws Error when no ancestor carries `assets/fonts`.
 */
export function fontUrlFrom(file: FontFile, moduleUrl: string | URL): URL {
  let directory = new URL('.', moduleUrl)
  for (;;) {
    const font = new URL(`assets/fonts/${file}`, directory)
    if (existsSync(font)) return font
    const parent = new URL('..', directory)
    if (parent.href === directory.href) {
      throw new Error(`pdf_report font ${file} is missing: no ancestor of ${decodeURI(String(moduleUrl))} carries assets/fonts`)
    }
    directory = parent
  }
}

/**
 * Read one vendored font once per process.
 * @param file - vendored Noto Sans face.
 * @returns the raw TrueType bytes.
 */
function fontBytes(file: FontFile): Promise<Uint8Array> {
  let cached = fontCache.get(file)
  if (cached === undefined) {
    cached = readFile(fontUrlFrom(file, import.meta.url))
    fontCache.set(file, cached)
  }
  return cached
}

/** Cursor over the growing document: the current page and the next baseline. */
class PageCursor {
  private page: PDFPage
  private y: number

  /**
   * @param doc - owning document, for page creation.
   * @param firstPage - the already-added first page.
   * @param y - first baseline, below the title when one was drawn.
   */
  constructor(private readonly doc: PDFDocument, firstPage: PDFPage, y: number) {
    this.page = firstPage
    this.y = y
  }

  /**
   * Draw one text line, starting a new page when the baseline leaves the margin.
   * @param line - the pre-wrapped line.
   * @param font - embedded face for measurement and drawing.
   * @param size - point size.
   * @param leading - vertical advance consumed even when a page breaks first.
   * @param color - fill color.
   */
  drawLine(line: string, font: PDFFont, size: number, leading: number, color = TEXT_COLOR): void {
    if (this.y - leading < MARGIN) this.newPage()
    if (line.length > 0) {
      this.page.drawText(line, { x: MARGIN, y: this.y - size, size, font, color })
    }
    this.y -= leading
  }

  /**
   * Draw one wrapped line of styled words, starting a new page when the line
   * leaves the margin. The highlight bands are drawn first, so the words lie
   * on them.
   * @param words - One line as `wrapWords` returned it.
   * @param regular - Embedded regular face for non-bold words and for the marker.
   * @param bold - Embedded bold face for bold words.
   * @param size - Point size.
   * @param leading - Vertical advance consumed even when a page breaks first.
   * @param line - A marker drawn at the margin beside the words, and the words' indent from the margin.
   */
  drawWords(
    words: readonly StyledWord[],
    regular: PDFFont,
    bold: PDFFont,
    size: number,
    leading: number,
    line: { marker?: string; indent?: number } = {},
  ): void {
    if (this.y - leading < MARGIN) this.newPage()
    const baseline = this.y - size
    const placed = placeWords(words, regular, bold, size, MARGIN + (line.indent ?? 0))
    for (const band of highlightBands(placed, baseline, size)) {
      this.page.drawRectangle({ ...band, color: HIGHLIGHT_FILL })
    }
    if (line.marker !== undefined) {
      this.page.drawText(line.marker, { x: MARGIN, y: baseline, size, font: regular, color: TEXT_COLOR })
    }
    for (const { word, x } of placed) {
      this.page.drawText(word.text, { x, y: baseline, size, font: word.bold ? bold : regular, color: TEXT_COLOR })
    }
    this.y -= leading
  }

  /**
   * Draw one embedded image fit into its computed box, breaking the page first.
   * @param embedded - the embedded image.
   * @param width - drawn width.
   * @param height - drawn height.
   */
  drawImage(embedded: PDFImage, width: number, height: number): void {
    if (this.y - height < MARGIN) this.newPage()
    this.page.drawImage(embedded, { x: MARGIN, y: this.y - height, width, height })
    this.y -= height
  }

  /**
   * Draw a pre-measured table with a filled header row, zebra body rows, and a
   * grid, breaking pages between body rows and repeating the header after each
   * break.
   * @param layout - the pre-measured wrapped rows.
   * @param bold - embedded bold face for the header row.
   * @param regular - embedded regular face for body cells.
   */
  drawTable(layout: TableLayout, bold: PDFFont, regular: PDFFont): void {
    const drawRow = (row: TableRowLayout, fill: Color, font: PDFFont, textColor: Color): void => {
      const top = this.y
      let x = MARGIN
      for (const cell of row.cells) {
        this.page.drawRectangle({
          x, y: top - row.height, width: cell.width, height: row.height,
          color: cell.highlight && row !== layout.header ? HIGHLIGHT_FILL : fill,
          borderColor: GRID_COLOR, borderWidth: GRID_WIDTH,
        })
        for (const [k, line] of cell.lines.entries()) {
          this.page.drawText(line, {
            x: x + CELL_PAD_X,
            y: top - CELL_PAD_Y - CELL_SIZE - CELL_LEADING * k,
            size: CELL_SIZE, font, color: textColor,
          })
        }
        x += cell.width
      }
      this.y = top - row.height
    }
    if (this.y - layout.header.height < MARGIN) this.newPage()
    drawRow(layout.header, HEADER_FILL, bold, WHITE)
    for (const [index, row] of layout.rows.entries()) {
      if (this.y - row.height < MARGIN) {
        this.newPage()
        drawRow(layout.header, HEADER_FILL, bold, WHITE)
      }
      drawRow(row, index % 2 === 0 ? WHITE : ZEBRA_FILL, regular, TEXT_COLOR)
    }
    this.y -= BLOCK_GAP
  }

  /**
   * Reserve vertical space before a drawn or skipped element.
   * @param height - the space to reserve.
   */
  reserve(height: number): void {
    if (this.y - height < MARGIN) this.newPage()
    this.y -= height
  }

  /** Start a fresh page at the top margin. */
  private newPage(): void {
    this.page = this.doc.addPage([A4.width, A4.height])
    this.y = A4.height - MARGIN
  }
}

/**
 * Wrap one paragraph into lines that fit the content width. Words wider than a
 * full line are hard-broken by character, so long paths and URLs still render.
 * @param paragraph - one paragraph; newlines separate paragraphs upstream.
 * @param font - embedded face for measurement.
 * @param size - point size.
 * @returns the wrapped lines; an empty paragraph yields one empty line.
 */
export function wrapText(paragraph: string, font: PDFFont, size: number): string[] {
  return wrapToWidth(paragraph, font, size, CONTENT_WIDTH)
}

/**
 * Wrap one paragraph into lines that fit the given width, hard-breaking
 * overlong words by character.
 * @param paragraph - one paragraph.
 * @param font - embedded face for measurement.
 * @param size - point size.
 * @param width - maximum line width in points.
 * @returns the wrapped lines; an empty paragraph yields one empty line.
 */
function wrapToWidth(paragraph: string, font: PDFFont, size: number, width: number): string[] {
  if (paragraph.length === 0) return ['']
  const lines: string[] = []
  let line = ''
  const pushLine = (): void => {
    lines.push(line)
    line = ''
  }
  for (const word of paragraph.split(/\s+/).filter(word => word.length > 0)) {
    const candidate = line.length === 0 ? word : `${line} ${word}`
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      line = candidate
      continue
    }
    if (line.length > 0) pushLine()
    if (font.widthOfTextAtSize(word, size) <= width) {
      line = word
      continue
    }
    lines.push(...hardBreak(word, font, size, width))
  }
  pushLine()
  return lines
}

/**
 * Hard-break one overlong word into measured chunks.
 * @param word - the word that a single line cannot fit.
 * @param font - embedded face for measurement.
 * @param size - point size.
 * @param width - maximum line width in points.
 * @returns the chunks, each fitting one line.
 */
function hardBreak(word: string, font: PDFFont, size: number, width: number): string[] {
  const chunks: string[] = []
  let chunk = ''
  for (const char of word) {
    const candidate = chunk + char
    if (chunk.length > 0 && font.widthOfTextAtSize(candidate, size) > width) {
      chunks.push(chunk)
      chunk = char
      continue
    }
    chunk = candidate
  }
  chunks.push(chunk)
  return chunks
}

/** One wrappable word of a styled line, carrying the emphasis of the run it came from. */
export interface StyledWord {
  /** The word's text without whitespace. */
  text: string
  /** The word renders in the bold face. */
  bold: boolean
  /** The word renders on a highlight band. */
  mark: boolean
  /** Whitespace separated this word from the previous one in the source line. */
  gapBefore: boolean
}

/** A word placed on its line. */
export interface PlacedWord {
  readonly word: StyledWord
  /** Distance from the line's left edge to the word's first glyph. */
  readonly x: number
  /** The word's advance width in its own face. */
  readonly width: number
}

/** A highlight band rectangle in page coordinates. */
export interface HighlightBand {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Split inline runs into words, keeping where the source line had whitespace. */
function wordsOf(runs: readonly InlineRun[]): StyledWord[] {
  const words: StyledWord[] = []
  let spaced = false
  for (const run of runs) {
    for (const [index, piece] of run.text.split(/(\s+)/).entries()) {
      if (index % 2 === 1) spaced = true
      else if (piece.length > 0) {
        words.push({ text: piece, bold: run.bold, mark: run.mark, gapBefore: spaced })
        spaced = false
      }
    }
  }
  return words
}

/**
 * Wrap styled words into lines that fit the given width. A word wider than a
 * full line is hard-broken by character, and every chunk keeps the word's
 * emphasis on a line of its own.
 * @param words - The words of one paragraph, heading, or list item.
 * @param regular - Embedded regular face; a non-bold word is measured in it.
 * @param bold - Embedded bold face; a bold word is measured in it.
 * @param size - Point size.
 * @param width - Maximum line width in points.
 * @returns The lines of words; no words yield one empty line.
 */
export function wrapWords(
  words: readonly StyledWord[],
  regular: PDFFont,
  bold: PDFFont,
  size: number,
  width: number,
): StyledWord[][] {
  const space = regular.widthOfTextAtSize(' ', size)
  const lines: StyledWord[][] = []
  let line: StyledWord[] = []
  let used = 0
  for (const word of words) {
    const font = word.bold ? bold : regular
    const wordWidth = font.widthOfTextAtSize(word.text, size)
    if (line.length > 0) {
      const candidate = used + (word.gapBefore ? space : 0) + wordWidth
      if (candidate <= width) {
        line.push(word)
        used = candidate
        continue
      }
      lines.push(line)
      line = []
      used = 0
    }
    if (wordWidth <= width) {
      line = [word]
      used = wordWidth
      continue
    }
    for (const chunk of hardBreak(word.text, font, size, width)) {
      lines.push([{ ...word, text: chunk }])
    }
  }
  if (line.length > 0 || lines.length === 0) lines.push(line)
  return lines
}

/**
 * Place the words of one line from a left edge. Every word is measured in its
 * own face, and neighbors keep one regular space only where the source had
 * whitespace.
 * @param words - The words of one wrapped line.
 * @param regular - Embedded regular face; a non-bold word is measured in it.
 * @param bold - Embedded bold face; a bold word is measured in it.
 * @param size - Point size.
 * @param x - Left edge of the first word in page coordinates.
 * @returns The placed words from left to right.
 */
export function placeWords(
  words: readonly StyledWord[],
  regular: PDFFont,
  bold: PDFFont,
  size: number,
  x: number,
): PlacedWord[] {
  const space = regular.widthOfTextAtSize(' ', size)
  const placed: PlacedWord[] = []
  let cursor = x
  for (const [index, word] of words.entries()) {
    if (index > 0 && word.gapBefore) cursor += space
    const width = (word.bold ? bold : regular).widthOfTextAtSize(word.text, size)
    placed.push({ word, x: cursor, width })
    cursor += width
  }
  return placed
}

/**
 * Merge the marked words of one placed line into highlight bands: neighboring
 * marked words, with the spaces between them, form one band.
 * @param placed - The words of one line as `placeWords` returned them.
 * @param baseline - The line's text baseline in page coordinates.
 * @param size - Point size of the line.
 * @returns The bands from left to right; an unmarked line yields none.
 */
export function highlightBands(
  placed: readonly PlacedWord[],
  baseline: number,
  size: number,
): HighlightBand[] {
  const band = (start: number, end: number): HighlightBand => ({
    x: start - HIGHLIGHT_PAD_X,
    width: end - start + HIGHLIGHT_PAD_X * 2,
    y: baseline - size * HIGHLIGHT_DESCENT,
    height: size * HIGHLIGHT_HEIGHT,
  })
  const bands: HighlightBand[] = []
  let start: number | undefined
  let end = 0
  for (const { word, x, width } of placed) {
    if (word.mark) {
      if (start === undefined) start = x
      end = x + width
      continue
    }
    if (start === undefined) continue
    bands.push(band(start, end))
    start = undefined
  }
  if (start !== undefined) bands.push(band(start, end))
  return bands
}

/** One laid-out table row: wrapped cell lines per column and the drawn height. */
export interface TableRowLayout {
  /**
   * Per column: the wrapped lines of one cell, the column's resolved width,
   * and whether the cell takes the highlight fill.
   */
  cells: Array<{ lines: string[]; width: number; highlight: boolean }>
  /** Drawn height in points. */
  height: number
}

/** Pre-measured table geometry: one header row and the body rows. */
export interface TableLayout {
  /** Header row, drawn with the filled background. */
  header: TableRowLayout
  /** Body rows in document order. */
  rows: TableRowLayout[]
}

/**
 * Measure a table for drawing: fit column widths to the content weights and
 * wrap every cell into lines that fit its column. Ragged rows pad with empty
 * cells to the column count, which the header and the longest row fix. The
 * column widths sum to the content width. The inline markers of a cell are
 * removed from its lines, and a cell that carries a `==…==` mark takes the
 * highlight fill as a whole.
 * @param header - column titles; at least one.
 * @param rows - body rows of cell text.
 * @param bold - embedded bold face for header measurement.
 * @param regular - embedded regular face for body measurement.
 * @returns the layout the table drawing consumes.
 */
export function measureTable(
  header: readonly string[],
  rows: readonly (readonly string[])[],
  bold: PDFFont,
  regular: PDFFont,
): TableLayout {
  const columnCount = Math.max(header.length, ...rows.map(row => row.length))
  const column = (row: readonly string[], index: number): string => row[index] ?? ''
  const weights = Array.from({ length: columnCount }, (_, j) =>
    Math.max(header[j]?.length ?? 0, 8)
    + rows.slice(0, 4).reduce((sum, row) => sum + Math.min(column(row, j).length, MEASURE_CAP), 0))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const widths = weights
    .map(weight => Math.max(MIN_COLUMN_WIDTH, CONTENT_WIDTH * weight / total))
  const scale = CONTENT_WIDTH / widths.reduce((sum, width) => sum + width, 0)
  const fitted = widths.map(width => width * scale)
  const rowHeight = (cells: readonly string[][]): number =>
    CELL_PAD_Y * 2 + CELL_SIZE
    + CELL_LEADING * (Math.max(...cells.map(lines => lines.length)) - 1)
  const rowLayout = (cells: readonly string[], font: PDFFont): TableRowLayout => {
    const wrapped = fitted.map((width, j) => {
      const cell = column(cells, j)
      return {
        lines: wrapToWidth(stripInlineMarks(cell), font, CELL_SIZE, width - CELL_PAD_X * 2),
        width,
        highlight: isHighlightedCell(cell),
      }
    })
    return { cells: wrapped, height: rowHeight(wrapped.map(cell => cell.lines)) }
  }
  return {
    header: rowLayout(header, bold),
    rows: rows.map(row => rowLayout(row, regular)),
  }
}

/**
 * Embed one image and draw it fit to the content width with its caption below.
 * @param cursor - page cursor to draw on.
 * @param doc - owning document, for image embedding.
 * @param image - the decoded image bytes, media type, and caption.
 * @param regular - embedded regular face for the caption.
 */
async function drawImage(
  cursor: PageCursor,
  doc: PDFDocument,
  image: ReportImage,
  regular: PDFFont,
): Promise<void> {
  const embedded: PDFImage = image.mediaType === 'image/jpeg'
    ? await doc.embedJpg(image.data)
    : await doc.embedPng(image.data)
  const scale = Math.min(CONTENT_WIDTH / embedded.width, (A4.height - MARGIN * 2) / embedded.height)
  cursor.drawImage(embedded, embedded.width * scale, embedded.height * scale)
  if (image.caption !== undefined) {
    cursor.reserve(CAPTION_SIZE + 8)
    for (const line of wrapText(image.caption, regular, CAPTION_SIZE).slice(0, 3)) {
      cursor.drawLine(line, regular, CAPTION_SIZE, CAPTION_SIZE + 4, MUTED_COLOR)
    }
  }
  cursor.reserve(BLOCK_GAP)
}

/**
 * Assemble the report PDF: the optional title, every block in document order,
 * embedded Noto Sans faces for Cyrillic text. The title, a block heading, and
 * the table cells print without inline markers. Inside a text block every
 * fragment after the first leaves the gap of its kind above it, and an empty
 * line separates only two paragraphs. A code block prints every line in the
 * regular body face as it is written, leading indentation included.
 * @param title - first-page title; omitted starts with the first block.
 * @param blocks - ordered text, code, table, and image blocks.
 * @param images - decoded images in requested order; an image block embeds
 *   every entry carrying its call id, in this order.
 * @returns the encoded PDF and its page count.
 */
export async function buildPdfReport(
  title: string | undefined,
  blocks: readonly ReportBlock[],
  images: readonly ReportImage[],
): Promise<PdfDocument> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const regular = await doc.embedFont(await fontBytes('NotoSans-Regular.ttf'), { subset: true })
  const bold = await doc.embedFont(await fontBytes('NotoSans-Bold.ttf'), { subset: true })
  const cursor = new PageCursor(doc, doc.addPage([A4.width, A4.height]), A4.height - MARGIN)
  if (title !== undefined && title.trim().length > 0) {
    for (const line of wrapText(stripInlineMarks(title), bold, TITLE_SIZE)) {
      cursor.drawLine(line, bold, TITLE_SIZE, TITLE_SIZE + 6)
    }
    cursor.reserve(BLOCK_GAP)
  }
  for (const block of blocks) {
    if (block.type === 'code') {
      for (const line of codeLines(block.text)) {
        for (const wrapped of wrapWords(line, regular, bold, BODY_SIZE, CONTENT_WIDTH)) {
          cursor.drawWords(wrapped, regular, bold, BODY_SIZE, BODY_LEADING)
        }
      }
      continue
    }
    if (block.type === 'text') {
      let started = false
      if (block.heading !== undefined && block.heading.trim().length > 0) {
        cursor.reserve(BLOCK_GAP)
        for (const line of wrapText(stripInlineMarks(block.heading), bold, HEADING_SIZE)) {
          cursor.drawLine(line, bold, HEADING_SIZE, HEADING_SIZE + 5)
        }
        started = true
      }
      for (const fragment of parseTextBlock(block.text)) {
        if (fragment.kind === 'heading') {
          if (started) cursor.reserve(BLOCK_GAP)
          const size = HEADING_SIZES[fragment.level]
          const words = wordsOf(fragment.runs).map(word => ({ ...word, bold: true }))
          for (const line of wrapWords(words, regular, bold, size, CONTENT_WIDTH)) {
            cursor.drawWords(line, regular, bold, size, size + 5)
          }
        } else if (fragment.kind === 'paragraph') {
          if (fragment.spaced) cursor.reserve(BODY_LEADING)
          for (const line of wrapWords(wordsOf(fragment.runs), regular, bold, BODY_SIZE, CONTENT_WIDTH)) {
            cursor.drawWords(line, regular, bold, BODY_SIZE, BODY_LEADING)
          }
        } else if (fragment.kind === 'list') {
          if (started) cursor.reserve(LIST_GAP)
          const indent = Math.max(LIST_INDENT, ...fragment.items.map(item =>
            regular.widthOfTextAtSize(item.marker, BODY_SIZE) + LIST_MARKER_GAP))
          for (const item of fragment.items) {
            const lines = wrapWords(wordsOf(item.runs), regular, bold, BODY_SIZE, CONTENT_WIDTH - indent)
            for (const [index, line] of lines.entries()) {
              cursor.drawWords(line, regular, bold, BODY_SIZE, BODY_LEADING,
                { indent, ...index === 0 ? { marker: item.marker } : {} })
            }
          }
          cursor.reserve(LIST_GAP)
        } else {
          if (started) cursor.reserve(BLOCK_GAP)
          cursor.drawTable(measureTable(fragment.header, fragment.rows, bold, regular), bold, regular)
        }
        started = true
      }
      continue
    }
    if (block.type === 'table') {
      cursor.reserve(BLOCK_GAP)
      cursor.drawTable(measureTable(block.header, block.rows, bold, regular), bold, regular)
      continue
    }
    for (const image of images.filter(candidate => candidate.callId === block.callId)) {
      await drawImage(cursor, doc, image, regular)
    }
  }
  return { bytes: await doc.save(), pages: doc.getPageCount() }
}
