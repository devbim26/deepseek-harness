/** Pure PDF assembly: wrapping, pagination, table layout, and image embedding. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, PDFPage, type Color, type PDFFont } from 'pdf-lib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  A4, CONTENT_WIDTH, HIGHLIGHT_FILL, HEADING_SIZES, MARGIN, buildPdfReport, fontUrlFrom, highlightBands, measureTable,
  placeWords, wrapWords, type HighlightBand, type PlacedWord, type StyledWord,
} from '../src/pdf.ts'
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
      { type: 'text', text: longWord },
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

  it('reserves the caption space of an empty caption without printing a line', async () => {
    const images: ReportImage[] = [{ callId: 'call-a', data: PNG_1X1, mediaType: 'image/png', caption: '' }]
    const draws = recordDraws()
    await buildPdfReport(undefined, [{ type: 'image', callId: 'call-a', caption: '' }], images)
    draws.stop()
    expect(draws.lines()).toEqual([])
  })

  it('keeps the a4 geometry constants consistent', () => {
    expect(CONTENT_WIDTH).toBeCloseTo(A4.width - MARGIN * 2, 5)
  })

  it('wraps a long block heading by words and starts a new page when it no longer fits', async () => {
    const draws = recordDraws()
    // 43 body lines under the title leave room for the heading gap, but not for the heading line.
    const filler = Array.from({ length: 43 }, (_, index) => `строка заполнения номер ${index + 1}`).join('\n')
    const { pages } = await buildPdfReport('Отчёт', [
      { type: 'text', text: filler },
      {
        type: 'text',
        heading: 'Состав проверенных узлов, ведомостей и спецификаций оборудования дома номер двенадцать',
        text: 'Текст раздела.',
      },
    ], [])
    draws.stop()
    expect(pages).toBe(2)
    const heading = draws.lines().filter(line => line.bold && line.size === 13)
    expect(heading).toHaveLength(2)
    expect(heading.every(line => line.y > 700 && line.x === MARGIN)).toBe(true)
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

  it('hard-breaks a cell that opens with a word wider than its column', async () => {
    const { regular, bold } = await embedFaces()
    const overlong = 'длинноеслово'.repeat(30)
    const layout = measureTable(['x', 'y'], [[overlong, 'короткий']], bold, regular)
    const cell = layout.rows[0]!.cells[0]!
    expect(cell.lines.length).toBeGreaterThan(1)
    expect(cell.lines.join('')).toBe(overlong)
    for (const line of cell.lines) {
      expect(regular.widthOfTextAtSize(line, 9)).toBeLessThanOrEqual(cell.width - 10 + 0.001)
    }
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

/** One text line the report drew. */
interface DrawnLine { value: string; x: number; y: number; size: number; bold: boolean }
/** One rectangle the report drew. */
interface DrawnRectangle { x: number; y: number; color: Color }
/** A `drawText` call as the report makes it: with a position, a size, and a face. */
type TextCall = [text: string, options: { x: number; y: number; size: number; font: PDFFont }]
/** A `drawRectangle` call as the report makes it: with a position and a fill. */
type RectangleCall = [options: { x: number; y: number; color: Color }]

/** Every text line and rectangle one report draws, read off the pdf-lib page calls. */
function recordDraws(): { lines: () => DrawnLine[]; rectangles: () => DrawnRectangle[]; stop: () => void } {
  const text = vi.spyOn(PDFPage.prototype, 'drawText')
  const rectangle = vi.spyOn(PDFPage.prototype, 'drawRectangle')
  return {
    lines: () => (text.mock.calls as TextCall[]).map(([value, { x, y, size, font }]) =>
      ({ value, x, y, size, bold: font.name.includes('Bold') })),
    rectangles: () => (rectangle.mock.calls as RectangleCall[]).map(([{ x, y, color }]) => ({ x, y, color })),
    stop: () => vi.restoreAllMocks(),
  }
}

/** A styled word; `spaced` marks the whitespace that separates it from the previous word. */
const word = (text: string, { bold = false, mark = false, spaced = false } = {}): StyledWord =>
  ({ text, bold, mark, gapBefore: spaced })

describe('styled text layout', () => {
  it('wraps styled words to the width and keeps each word emphasis across the break', async () => {
    const { regular, bold } = await embedFaces()
    const words = [word('ааа'), word('ббб', { bold: true, spaced: true }), word('ввв', { mark: true, spaced: true })]
    const width = regular.widthOfTextAtSize('ааа', 11) + regular.widthOfTextAtSize(' ', 11) + bold.widthOfTextAtSize('ббб', 11)
    expect(wrapWords(words, regular, bold, 11, width)).toEqual([words.slice(0, 2), [words[2]]])
    expect(wrapWords([word('ааа'), word('ббб')], regular, bold, 11, width)).toEqual([[word('ааа'), word('ббб')]])
    expect(wrapWords([], regular, bold, 11, width)).toEqual([[]])
  })

  it('starts an overlong word on its own line and hard-breaks it with its emphasis', async () => {
    const { regular, bold } = await embedFaces()
    const overlong = word('длинноеслово'.repeat(30), { mark: true })
    const lines = wrapWords([word('короткое'), overlong], regular, bold, 11, 120)
    expect(lines[0]).toEqual([word('короткое')])
    expect(lines.slice(1).length).toBeGreaterThan(1)
    for (const line of lines.slice(1)) {
      expect(line).toHaveLength(1)
      expect(line[0]).toMatchObject({ mark: true, bold: false })
    }
    expect(lines.slice(1).flatMap(line => line.map(entry => entry.text)).join('')).toBe(overlong.text)
  })

  it('measures bold words in the bold face and adds one regular space only where the source had whitespace', async () => {
    const { regular, bold } = await embedFaces()
    const placed = placeWords([word('аа'), word('бб', { bold: true }), word('бб', { bold: true, spaced: true })], regular, bold, 11, 7)
    const boldWidth = bold.widthOfTextAtSize('бб', 11)
    expect(placed.map(entry => entry.x)).toEqual([7, 7 + regular.widthOfTextAtSize('аа', 11), 7 + regular.widthOfTextAtSize('аа', 11) + boldWidth + regular.widthOfTextAtSize(' ', 11)])
    expect(placed[1]?.width).toBe(boldWidth)
    expect(placeWords([], regular, bold, 11, 7)).toEqual([])
  })

  it('merges neighboring marked words into one band and returns none for an unmarked line', () => {
    const marked = (x: number, width: number): PlacedWord => ({ word: word('x', { mark: true }), x, width })
    const plain = (x: number, width: number): PlacedWord => ({ word: word('x'), x, width })
    const rounded = (bands: HighlightBand[]) => bands.map(({ x, y, width, height }) => [
      x.toFixed(4), y.toFixed(4), width.toFixed(4), height.toFixed(4),
    ])
    expect(rounded(highlightBands([marked(10, 20), marked(36, 10), plain(52, 30), marked(88, 5)], 100, 11))).toEqual([
      ['8.5000', '97.8000', '39.0000', '11.5500'],
      ['86.5000', '97.8000', '8.0000', '11.5500'],
    ])
    expect(highlightBands([plain(10, 20)], 100, 11)).toEqual([])
    expect(highlightBands([], 100, 11)).toEqual([])
  })
})

describe('buildPdfReport styled text', () => {
  afterEach(() => vi.restoreAllMocks())

  it('draws one highlight band per marked stretch and prints the words without their markers', async () => {
    const { bold } = await embedFaces()
    const draws = recordDraws()
    const { pages } = await buildPdfReport(undefined, [{
      type: 'text',
      text: 'Итог: ==три замечания== и ==один пропуск==.\nЖирный **итог**, код `x-1`.',
    }], [])
    draws.stop()
    expect(draws.rectangles().filter(rectangle => rectangle.color === HIGHLIGHT_FILL)).toHaveLength(2)
    expect(pages).toBe(1)
    const lines = draws.lines()
    expect(lines.map(line => line.value)).toEqual([
      'Итог:', 'три', 'замечания', 'и', 'один', 'пропуск', '.', 'Жирный', 'итог', ',', 'код', 'x-1.',
    ])
    expect(lines.filter(line => line.bold).map(line => line.value)).toEqual(['итог'])
    // The comma followed the bold word without whitespace in the source, so it keeps touching it.
    expect(lines[9]?.x).toBe(lines[8]!.x + bold.widthOfTextAtSize('итог', 11))
    expect(lines[10]!.x).toBeGreaterThan(lines[9]!.x)
  })

  it('draws no band for a report without marks', async () => {
    const draws = recordDraws()
    await buildPdfReport('Отчёт', [
      { type: 'text', heading: 'Состав', text: 'Обычный текст.\nЕщё строка.' },
      { type: 'table', header: ['A', 'B'], rows: [['1', '2']] },
    ], [])
    draws.stop()
    expect(draws.rectangles().some(rectangle => rectangle.color === HIGHLIGHT_FILL)).toBe(false)
  })

  it('renders headings, a numbered list with a hanging indent, and a pipe table from one text block', async () => {
    const draws = recordDraws()
    const { pages } = await buildPdfReport(undefined, [{
      type: 'text',
      text: [
        '# Раздел',
        '## Подраздел',
        '### Пункт',
        '- первый',
        '10. десятый',
        '11. одиннадцатый',
        '-',
        '| ID | Лист |',
        '| --- | --- |',
        '| **W-1** | ==38== |',
        'После таблицы.',
        '- узкий маркер',
      ].join('\n'),
    }], [])
    draws.stop()
    expect(pages).toBe(1)
    const lines = draws.lines()
    expect(lines.slice(0, 3).map(line => [line.value, line.size, line.bold])).toEqual([
      ['Раздел', HEADING_SIZES[1], true],
      ['Подраздел', HEADING_SIZES[2], true],
      ['Пункт', HEADING_SIZES[3], true],
    ])
    expect(lines.map(line => line.value)).toEqual([
      'Раздел', 'Подраздел', 'Пункт', '•', 'первый', '10.', 'десятый', '11.', 'одиннадцатый', '•',
      'ID', 'Лист', 'W-1', '38', 'После', 'таблицы.', '•', 'узкий', 'маркер',
    ])
    for (const marker of ['•', '10.', '11.']) {
      expect(lines.filter(line => line.value === marker).every(line => line.x === MARGIN)).toBe(true)
    }
    // A list shares one indent; two-digit markers widen it past a bullet's, and never onto the marker.
    const { regular } = await embedFaces()
    const x = (value: string): number => lines.find(line => line.value === value)!.x
    expect(x('первый')).toBe(x('десятый'))
    expect(x('десятый')).toBe(x('одиннадцатый'))
    expect(x('узкий')).toBeGreaterThan(MARGIN)
    expect(x('узкий')).toBeLessThan(x('десятый'))
    expect(x('десятый')).toBeGreaterThanOrEqual(MARGIN + regular.widthOfTextAtSize('10.', 11) + 4)
  })

  it('spaces a paragraph across an empty line but keeps a paragraph close to its heading', async () => {
    const inked = (draws: ReturnType<typeof recordDraws>) => draws.lines().filter(line => line.value.length > 0)
    const spaced = recordDraws()
    await buildPdfReport(undefined, [{ type: 'text', text: 'A\nB\n\nC' }], [])
    spaced.stop()
    const tight = recordDraws()
    await buildPdfReport(undefined, [{ type: 'text', text: '## H\n\nB' }], [])
    tight.stop()
    expect(inked(spaced).map(line => line.value)).toEqual(['A', 'B', 'C'])
    expect(inked(spaced)[1]!.y).toBe(inked(spaced)[0]!.y - 16)
    expect(inked(spaced)[2]!.y).toBe(inked(spaced)[1]!.y - 32)
    expect(inked(tight).map(line => line.value)).toEqual(['H', 'B'])
    // The heading's leading, less the body's smaller rise above its baseline.
    expect(inked(tight)[1]!.y).toBe(inked(tight)[0]!.y - ((HEADING_SIZES[2] + 5) - (HEADING_SIZES[2] - 11)))
  })

  it('fills a table cell that carries a mark, never a header cell, and strips the cell markers', async () => {
    const draws = recordDraws()
    const { pages } = await buildPdfReport(undefined, [
      {
        type: 'table',
        header: ['==Параметр==', 'Значение', 'Статус'],
        rows: [['==Итог==', '5', 'OK'], ['Прочее `x`', '1', 'PART(==нет маркировки==)']],
      },
      { type: 'text', text: 'a | b\n---\n| ==в== | г |' },
    ], [])
    draws.stop()
    expect(pages).toBe(1)
    // One whole-cell fill and one cell marked inside longer text; the header cell stays dark.
    expect(draws.rectangles().filter(rectangle => rectangle.color === HIGHLIGHT_FILL)).toHaveLength(3)
    const values = draws.lines().map(line => line.value)
    expect(values.slice(0, 6)).toEqual(['Параметр', 'Значение', 'Статус', 'Итог', '5', 'OK'])
    expect(values.slice(6, -4).join('')).toBe('Прочее x1PART(нет маркировки)')
    expect(values.slice(-4)).toEqual(['a', 'b', 'в', 'г'])
  })

  it('flows a text block that fills the page onto the next one', async () => {
    const filler = Array.from({ length: 47 }, (_, index) => `строка номер ==${index + 1}==`).join('\n')
    const draws = recordDraws()
    const { pages } = await buildPdfReport(undefined, [{ type: 'text', text: filler }], [])
    draws.stop()
    expect(pages).toBe(2)
    expect(draws.rectangles().filter(rectangle => rectangle.color === HIGHLIGHT_FILL)).toHaveLength(47)
  })

  it('wraps a long list item onto further lines that keep the indent and carry no marker', async () => {
    const draws = recordDraws()
    await buildPdfReport(undefined, [{ type: 'text', text: `- ${'очень длинный пункт списка '.repeat(30)}` }], [])
    draws.stop()
    const lines = draws.lines()
    expect(lines[0]?.value).toBe('•')
    expect(lines.filter(line => line.x === MARGIN)).toHaveLength(1)
    expect(lines.length).toBeGreaterThan(2)
    // The first word of every wrapped line starts at the item indent.
    const lineStarts = lines.slice(1).filter((line, index, rest) => index === 0 || line.y !== rest[index - 1]!.y)
    expect(lineStarts.length).toBeGreaterThan(1)
    for (const line of lineStarts) expect(line.x).toBe(MARGIN + 18)
  })
})

describe('fontUrlFrom', () => {
  const fontName = 'NotoSans-Regular.ttf' as const

  it('resolves the font beside the calling module without climbing', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-pdf-font-'))
    try {
      mkdirSync(join(root, 'assets/fonts'), { recursive: true })
      writeFileSync(join(root, 'assets/fonts', fontName), '')
      const moduleUrl = pathToFileURL(join(root, 'mod.js'))
      expect(fontUrlFrom(fontName, moduleUrl)).toBeInstanceOf(URL)
      expect(fontUrlFrom(fontName, moduleUrl).href.endsWith(`assets/fonts/${fontName}`)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('climbs to the ancestor package that carries the fonts', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-pdf-font-'))
    try {
      // The Host tsc layout: the module lives two levels under the package root.
      mkdirSync(join(root, 'assets/fonts'), { recursive: true })
      writeFileSync(join(root, 'assets/fonts', fontName), '')
      const moduleUrl = pathToFileURL(join(root, 'lib/types/mod.js'))
      expect(fontUrlFrom(fontName, moduleUrl).href.endsWith(`assets/fonts/${fontName}`)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a layout whose ancestors carry no fonts', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-pdf-font-'))
    try {
      expect(() => fontUrlFrom(fontName, pathToFileURL(join(root, 'mod.js'))))
        .toThrow(/assets\/fonts/u)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
