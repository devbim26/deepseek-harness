/**
 * Pure A4 PDF assembly: ordered text and image blocks on paginated pages with
 * embedded Cyrillic-capable fonts. No filesystem, service, or Session access.
 * @module @deepseek-ai/dsh-tool-pdf/pdf
 */

import { readFile } from 'node:fs/promises'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
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
  if (paragraph.length === 0) return ['']
  const lines: string[] = []
  let line = ''
  const pushLine = (): void => {
    lines.push(line)
    line = ''
  }
  for (const word of paragraph.split(/\s+/).filter(word => word.length > 0)) {
    const candidate = line.length === 0 ? word : `${line} ${word}`
    if (font.widthOfTextAtSize(candidate, size) <= CONTENT_WIDTH) {
      line = candidate
      continue
    }
    if (line.length > 0) pushLine()
    if (font.widthOfTextAtSize(word, size) <= CONTENT_WIDTH) {
      line = word
      continue
    }
    lines.push(...hardBreak(word, font, size))
  }
  pushLine()
  return lines
}

/**
 * Hard-break one overlong word into measured chunks.
 * @param word - the word that a single line cannot fit.
 * @param font - embedded face for measurement.
 * @param size - point size.
 * @returns the chunks, each fitting one line.
 */
function hardBreak(word: string, font: PDFFont, size: number): string[] {
  const chunks: string[] = []
  let chunk = ''
  for (const char of word) {
    const candidate = chunk + char
    if (chunk.length > 0 && font.widthOfTextAtSize(candidate, size) > CONTENT_WIDTH) {
      chunks.push(chunk)
      chunk = char
      continue
    }
    chunk = candidate
  }
  chunks.push(chunk)
  return chunks
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
 * @param blocks - ordered text and image blocks.
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
    for (const image of images.filter(candidate => candidate.callId === block.callId)) {
      await drawImage(cursor, doc, image, regular)
    }
  }
  return { bytes: await doc.save(), pages: doc.getPageCount() }
}
