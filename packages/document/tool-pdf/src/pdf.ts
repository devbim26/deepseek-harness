/**
 * Pure A4 PDF assembly: ordered text, table, and image blocks on paginated
 * pages with embedded Cyrillic-capable fonts. No filesystem, service, or
 * Session access.
 * @module @deepseek-ai/dsh-tool-pdf/pdf
 */

import { readFile } from 'node:fs/promises'
import fontkit from '@pdf-lib/fontkit'
import {
  PDFDocument, rgb, type Color, type PDFFont, type PDFImage, type PDFPage,
} from 'pdf-lib'
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

type FontFile = 'NotoSans-Regular.ttf' | 'NotoSans-Bold.ttf'

const fontCache = new Map<FontFile, Promise<Uint8Array>>()

/**
 * Read one vendored font once per process.
 * @param file - vendored Noto Sans face.
 * @returns the raw TrueType bytes.
 */
function fontBytes(file: FontFile): Promise<Uint8Array> {
  let cached = fontCache.get(file)
  if (cached === undefined) {
    cached = readFile(new URL(`../assets/fonts/${file}`, import.meta.url))
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
          color: fill, borderColor: GRID_COLOR, borderWidth: GRID_WIDTH,
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

/** One laid-out table row: wrapped cell lines per column and the drawn height. */
export interface TableRowLayout {
  /** Per column: the wrapped lines of one cell and the column's resolved width. */
  cells: Array<{ lines: string[]; width: number }>
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
 * column widths sum to the content width.
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
    const wrapped = fitted.map((width, j) => ({
      lines: wrapToWidth(column(cells, j), font, CELL_SIZE, width - CELL_PAD_X * 2),
      width,
    }))
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
 * embedded Noto Sans faces for Cyrillic text.
 * @param title - first-page title; omitted starts with the first block.
 * @param blocks - ordered text, table, and image blocks.
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
    for (const line of wrapText(title, bold, TITLE_SIZE)) {
      cursor.drawLine(line, bold, TITLE_SIZE, TITLE_SIZE + 6)
    }
    cursor.reserve(BLOCK_GAP)
  }
  for (const block of blocks) {
    if (block.type === 'text') {
      if (block.heading !== undefined && block.heading.trim().length > 0) {
        cursor.reserve(BLOCK_GAP)
        for (const line of wrapText(block.heading, bold, HEADING_SIZE)) {
          cursor.drawLine(line, bold, HEADING_SIZE, HEADING_SIZE + 5)
        }
      }
      for (const paragraph of block.text.split(/\r?\n/)) {
        for (const line of wrapText(paragraph, regular, BODY_SIZE)) {
          cursor.drawLine(line, regular, BODY_SIZE, BODY_LEADING)
        }
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
