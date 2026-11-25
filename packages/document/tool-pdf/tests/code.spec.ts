/** Programmatic code block: lines print as written, no Markdown is read from them, and indentation stays. */

import { readFile } from 'node:fs/promises'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, PDFPage, type PDFFont } from 'pdf-lib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codeLines } from '../src/code.ts'
import { CONTENT_WIDTH, MARGIN, buildPdfReport, type StyledWord } from '../src/pdf.ts'

/** A `drawText` call as the report makes it: with a position, a size, and a face. */
type TextCall = [text: string, options: { x: number; y: number; size: number; font: PDFFont }]

afterEach(() => {
  vi.restoreAllMocks()
})

/** One code word: plain, and not preceded by a gap. */
function word(text: string): StyledWord {
  return { text, bold: false, mark: false, gapBefore: false }
}

/** Embed the vendored regular face for the width of an indentation. */
async function embedRegular(): Promise<PDFFont> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  return doc.embedFont(
    await readFile(new URL('../assets/fonts/NotoSans-Regular.ttf', import.meta.url)), { subset: true },
  )
}

describe('code block lines', () => {
  it('splits every line into plain words and keeps the leading indentation as one word', () => {
    expect(codeLines('const a = 1\n  if (a == 1) {\n    return **a**\n  }\n}')).toEqual([
      [word('const'), { ...word('a'), gapBefore: true }, { ...word('='), gapBefore: true }, { ...word('1'), gapBefore: true }],
      [word('  '), { ...word('if'), gapBefore: false }, { ...word('(a'), gapBefore: true },
        { ...word('=='), gapBefore: true }, { ...word('1)'), gapBefore: true }, { ...word('{'), gapBefore: true }],
      [word('    '), { ...word('return'), gapBefore: false }, { ...word('**a**'), gapBefore: true }],
      [word('  '), { ...word('}'), gapBefore: false }],
      [word('}')],
    ])
  })

  it('counts a tab as four spaces and leaves a blank line without words', () => {
    expect(codeLines('\tconst a\n\n   \n')).toEqual([
      [word('    '), { ...word('const'), gapBefore: false }, { ...word('a'), gapBefore: true }],
      [],
      [word('   ')],
      [],
    ])
  })

  it('yields one empty line for empty code', () => {
    expect(codeLines('')).toEqual([[]])
  })
})

describe('code block rendering', () => {
  it('prints every code line in the body face as written, so no Markdown comes out of it', async () => {
    const code = [
      '#!/bin/bash',
      '# install the dependencies',
      '- item',
      'a == b && c == d',
      '**bold** and `code`',
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |',
      '## heading',
    ].join('\n')
    const text = vi.spyOn(PDFPage.prototype, 'drawText')
    const rectangle = vi.spyOn(PDFPage.prototype, 'drawRectangle')
    await buildPdfReport(undefined, [{ type: 'code', text: code }, { type: 'text', text: 'Эталон' }], [])
    const calls = text.mock.calls as TextCall[]
    const reference = calls.findIndex(([drawn]) => drawn === 'Эталон')
    const bodySize = calls[reference]?.[1].size
    expect(bodySize).toBeDefined()
    const drawn = new Map<number, string[]>()
    for (const [value, { x, y, size, font }] of calls.slice(0, reference)) {
      // No heading size, no bold face, no list indent: each line starts at the margin.
      expect(size).toBe(bodySize)
      expect(font.name.includes('Bold')).toBe(false)
      if (drawn.get(y) === undefined) expect(x).toBe(MARGIN)
      drawn.set(y, [...drawn.get(y) ?? [], value])
    }
    expect([...drawn.values()].map(words => words.join(' '))).toEqual(code.split('\n'))
    // No table cell and no highlight band was drawn.
    expect(rectangle).not.toHaveBeenCalled()
  })

  it('keeps the leading indentation of a code line', async () => {
    const regular = await embedRegular()
    const text = vi.spyOn(PDFPage.prototype, 'drawText')
    await buildPdfReport(undefined, [{ type: 'code', text: 'if (a) {\n  return a\n}' }], [])
    const calls = text.mock.calls as TextCall[]
    const indented = calls.find(([drawn]) => drawn === 'return')
    if (indented === undefined) throw new Error('the indented line was not drawn')
    expect(calls.find(([drawn]) => drawn === '  ')?.[1].x).toBe(MARGIN)
    expect(indented[1].x).toBe(MARGIN + regular.widthOfTextAtSize('  ', indented[1].size))
    expect(calls.find(([drawn]) => drawn === 'if')?.[1].x).toBe(MARGIN)
    expect(calls.find(([drawn]) => drawn === '}')?.[1].x).toBe(MARGIN)
  })

  it('wraps a long code line at the content width like plain words', async () => {
    const text = vi.spyOn(PDFPage.prototype, 'drawText')
    await buildPdfReport(undefined, [{ type: 'code', text: 'word '.repeat(40).trim() }], [])
    const calls = text.mock.calls as TextCall[]
    const rightEdge = Math.max(...calls.map(([value, { x, size, font }]) =>
      x + font.widthOfTextAtSize(value, size)))
    expect(calls.length).toBe(40)
    expect(rightEdge).toBeLessThanOrEqual(CONTENT_WIDTH + MARGIN)
  })

  it('leaves one empty line for empty code and writes a valid PDF', async () => {
    const text = vi.spyOn(PDFPage.prototype, 'drawText')
    const { pages, bytes } = await buildPdfReport(undefined, [{ type: 'code', text: '' }], [])
    expect(text).not.toHaveBeenCalled()
    expect(pages).toBe(1)
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('%PDF')
  })
})
