/** Pure PDF assembly: wrapping, pagination, table layout, and image embedding. */

import { readFile } from 'node:fs/promises'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, type PDFFont } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { A4, CONTENT_WIDTH, MARGIN, buildPdfReport, measureTable } from '../src/pdf.ts'
import type { ReportImage } from '../src/types.ts'

const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  char => char.charCodeAt(0),
)
// A 1x10 pixel PNG: scaled to the full page height, so its caption reserve
// crosses the bottom margin and forces the caption onto a fresh page.
const PNG_1X10 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAKCAIAAAD6sKMdAAAAD0lEQVR4nGMQSNjAQAQGANroC0EYGHvYAAAAAElFTkSuQmCC'),
  char => char.charCodeAt(0),
)
const JPEG_1X1 = Uint8Array.from(atob(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==',
), char => char.charCodeAt(0))

describe('buildPdfReport', () => {
  it('writes a valid single-page PDF with cyrillic title, heading, and body', async () => {
    const { pages, bytes } = await buildPdfReport('Отчёт по чертежам', [
      { type: 'text', heading: 'Состав', text: 'Короткий текст помещается на одной странице.\nВторой абзац.\n' },
      { type: 'text', text: 'Третий блок без заголовка.' },
    ], [])
    expect(pages).toBe(1)
    expect(bytes[0]).toBe(0x25) // '%'
    expect(bytes[1]).toBe(0x50) // 'P'
    expect(bytes[2]).toBe(0x44) // 'D'
    expect(bytes[3]).toBe(0x46) // 'F'
  })

  it('hard-breaks an overlong word across pages', async () => {
    const longWord = 'Ш'.repeat(6000)
    const { pages } = await buildPdfReport(undefined, [
      // Two words that fit alone but not together exercise the reflow path;
      // the leading overlong word starts a line, and the trailing one hard-breaks.
      { type: 'text', text: `${longWord}` },
      { type: 'text', text: `${'а'.repeat(70)} ${'б'.repeat(70)} ${longWord}` },
    ], [])
    expect(pages).toBeGreaterThan(1)
  }, 120_000)

  it('renders every requested image of one call and skips unknown call ids silently', async () => {
    const images: ReportImage[] = [
      { callId: 'call-a', data: PNG_1X1, mediaType: 'image/png', caption: 'Лист 38' },
      { callId: 'call-a', data: JPEG_1X1, mediaType: 'image/jpeg' },
    ]
    const { pages, bytes } = await buildPdfReport(undefined, [
      { type: 'image', callId: 'call-a', caption: 'Лист 38' },
      { type: 'image', callId: 'call-missing' },
    ], images)
    expect(pages).toBeGreaterThan(1)
    expect(bytes.byteLength).toBeGreaterThan(0)
  })

  it('moves a caption to a fresh page when its image fills the page', async () => {
    const images: ReportImage[] = [
      { callId: 'call-tall', data: PNG_1X10, mediaType: 'image/png' },
    ]
    const { pages } = await buildPdfReport(undefined, [
      { type: 'image', callId: 'call-tall', caption: 'Лист на целой странице' },
    ], images)
    expect(pages).toBe(2)
  })

  it('keeps the a4 geometry constants consistent', () => {
    expect(CONTENT_WIDTH).toBeCloseTo(A4.width - MARGIN * 2, 5)
  })
})

/** Embed the vendored Noto Sans faces for table layout measurement. */
async function embedFaces(): Promise<{ regular: PDFFont; bold: PDFFont }> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const regular = await doc.embedFont(
    await readFile(new URL('../assets/fonts/NotoSans-Regular.ttf', import.meta.url)), { subset: true },
  )
  const bold = await doc.embedFont(
    await readFile(new URL('../assets/fonts/NotoSans-Bold.ttf', import.meta.url)), { subset: true },
  )
  return { regular, bold }
}

describe('measureTable', () => {
  it('resolves column widths to the content width and wraps every cell line into its column', async () => {
    const { regular, bold } = await embedFaces()
    const layout = measureTable(
      ['Наименование', 'Кол-во', 'Цена'],
      [
        ['Кабель ВВГнг(А)-LS 4х16, прокладка по лотку', '120', '450.00'],
        ['Щит квартирный на 24 модуля', '1', '3100.00'],
      ],
      bold, regular,
    )
    expect(layout.header.cells).toHaveLength(3)
    expect(layout.header.cells.map(cell => cell.width).reduce((sum, width) => sum + width, 0))
      .toBeCloseTo(CONTENT_WIDTH, 5)
    for (const cell of layout.header.cells) {
      for (const line of cell.lines) {
        expect(bold.widthOfTextAtSize(line, 9)).toBeLessThanOrEqual(cell.width - 10 + 0.001)
      }
    }
    for (const row of layout.rows) {
      for (const cell of row.cells) {
        for (const line of cell.lines) {
          expect(regular.widthOfTextAtSize(line, 9)).toBeLessThanOrEqual(cell.width - 10 + 0.001)
        }
      }
    }
  })

  it('pads the header and short rows to the longest row instead of dropping cells', async () => {
    const { regular, bold } = await embedFaces()
    const layout = measureTable(['A', 'B', 'C'], [['x'], ['x', 'y', 'z', 'доп']], bold, regular)
    expect(layout.header.cells).toHaveLength(4)
    expect(layout.rows[0]?.cells).toHaveLength(4)
    expect(layout.rows[1]?.cells).toHaveLength(4)
    expect(layout.header.height).toBeGreaterThan(0)
    for (const row of layout.rows) expect(row.height).toBeGreaterThan(0)
  })

  it('gives every column at least the minimum width before scaling', async () => {
    const { regular, bold } = await embedFaces()
    const layout = measureTable(
      ['x', 'y'],
      [['короткий', 'Очень длинная однотокеновая ячейка: ' + 'длинноеслово'.repeat(20)]],
      bold, regular,
    )
    const widths = layout.header.cells.map(cell => cell.width)
    expect(widths[0]).toBeGreaterThan(0)
    expect(widths[1]).toBeGreaterThan(0)
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(CONTENT_WIDTH, 5)
  })
})

describe('buildPdfReport tables', () => {
  it('renders a table block with its header row on a single page', async () => {
    const { pages, bytes } = await buildPdfReport('Смета', [
      { type: 'text', heading: 'Позиции', text: 'Состав работ.' },
      { type: 'table', header: ['Наименование', 'Кол-во', 'Сумма'], rows: [
        ['Монтаж розетки', '12', '7 200.00'],
        ['Прокладка кабеля', '85', '38 250.00'],
      ] },
    ], [])
    expect(pages).toBe(1)
    expect(bytes[0]).toBe(0x25) // '%'
    expect(bytes[1]).toBe(0x50) // 'P'
    expect(bytes[2]).toBe(0x44) // 'D'
    expect(bytes[3]).toBe(0x46) // 'F'
  })

  it('breaks long tables across pages between body rows', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => [
      `Позиция сметы номер ${i + 1}`, `${i + 1}`, `${(i + 1) * 100}.00`,
    ])
    const { pages } = await buildPdfReport(undefined, [
      { type: 'table', header: ['Наименование', 'Кол-во', 'Сумма'], rows },
    ], [])
    expect(pages).toBeGreaterThan(1)
  })

  it('moves a whole table to a fresh page when its header no longer fits', async () => {
    // 45 body lines leave between one block gap and one 15pt header row of
    // space: the pre-table gap reserve still fits, but the header row itself
    // crosses the bottom margin, so the table header page-breaks first.
    const filler = Array.from({ length: 45 }, (_, i) => `строка заполнения страницы номер ${i + 1}`).join('\n')
    const { pages } = await buildPdfReport(undefined, [
      { type: 'text', text: filler },
      { type: 'table', header: ['Наименование', 'Кол-во'], rows: [['Позиция', '1']] },
    ], [])
    expect(pages).toBe(2)
  })

  it('renders a table with ragged rows and empty cells without failing', async () => {
    const { pages } = await buildPdfReport(undefined, [
      { type: 'table', header: ['Параметр', 'Значение'], rows: [['Высота', '3.0'], [''], ['Примечание']] },
    ], [])
    expect(pages).toBe(1)
  })
})
