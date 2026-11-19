import { describe, expect, it } from 'vitest'
import type { DocumentExtractLimits } from '../src/client/document-extract.ts'
import {
  NoTextLayerError, UnsupportedDocumentError,
  extractDocumentText, extractableText, isLegacyDoc,
} from '../src/client/document-extract.ts'
import { docxOf, xlsxOf } from './document-fixtures.client.ts'

const LIMITS: DocumentExtractLimits = { maxFileBytes: 1024 * 1024, maxExtractChars: 20 }

/** Parsed-format extraction asserts full content, which outgrows the suite's
 * 20-character truncation budget; truncation itself has its own test. */
const PARSED_LIMITS: DocumentExtractLimits = { maxFileBytes: 1024 * 1024, maxExtractChars: 1000 }

const fileOf = (name: string, content: string | Uint8Array<ArrayBuffer>, type = ''): File =>
  new File([content], name, { type })

/** One-page PDF whose content stream draws `Hello NW`; pdf.js recovers the approximate xref. */
const MINIMAL_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 44>>stream
BT /F1 18 Tf 20 50 Td (Hello NW) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 6>>
%%EOF`

describe('extractableText', () => {
  it('accepts the supported extensions regardless of MIME', () => {
    for (const name of ['a.txt', 'b.md', 'c.csv', 'd.log', 'e.pdf', 'f.docx', 'g.xls', 'h.xlsx']) {
      expect(extractableText(fileOf(name, '')), name).toBe(true)
    }
  })

  it('rejects unknown and legacy-doc extensions', () => {
    expect(extractableText(fileOf('a.doc', ''))).toBe(false)
    expect(extractableText(fileOf('a.bin', ''))).toBe(false)
    expect(extractableText(fileOf('noext', ''))).toBe(false)
    expect(isLegacyDoc(fileOf('a.doc', ''))).toBe(true)
    expect(isLegacyDoc(fileOf('a.docx', ''))).toBe(false)
  })
})

describe('extractDocumentText', () => {
  it('extracts plain text files verbatim', async () => {
    const result = await extractDocumentText(fileOf('notes.txt', 'первая строка\nвторая'), LIMITS)
    expect(result).toEqual({ text: 'первая строка\nвторая', truncated: false })
  })

  it('truncates at maxExtractChars and states it', async () => {
    const result = await extractDocumentText(fileOf('big.txt', 'x'.repeat(50)), LIMITS)
    expect(result.truncated).toBe(true)
    expect(result.text).toHaveLength(20)
  })

  it('rejects files above maxFileBytes before parsing', async () => {
    const TIGHT: DocumentExtractLimits = { maxFileBytes: 4, maxExtractChars: 20 }
    await expect(extractDocumentText(fileOf('huge.txt', 'много байтов'), TIGHT)).rejects.toThrow('exceeds maxFileBytes')
  })

  it('extracts xlsx sheets as CSV', async () => {
    const result = await extractDocumentText(fileOf('вед.xlsx', xlsxOf([['Позиция', 'Объем'], ['Стена', '120']])), PARSED_LIMITS)
    expect(result.text).toContain('Позиция')
    expect(result.text).toContain('120')
  })

  it('extracts docx paragraph text', async () => {
    const result = await extractDocumentText(fileOf('тз.docx', docxOf(['Пункт первый', 'Пункт второй'])), PARSED_LIMITS)
    expect(result.text).toContain('Пункт первый')
    expect(result.text).toContain('Пункт второй')
  })

  // The lazy pdf.js bundle's first load pays the Vite transform of a large
  // module, which exceeds Vitest's 5s default on a cold cache.
  it('extracts a minimal PDF text layer', async () => {
    const result = await extractDocumentText(fileOf('doc.pdf', MINIMAL_PDF), LIMITS)
    expect(result.text).toContain('Hello NW')
  }, 30000)

  it('throws NoTextLayerError for a PDF without extractable text', async () => {
    const empty = MINIMAL_PDF.replace('(Hello NW) Tj', '(   ) Tj')
    await expect(extractDocumentText(fileOf('scan.pdf', empty), LIMITS)).rejects.toBeInstanceOf(NoTextLayerError)
  }, 30000)

  it('throws UnsupportedDocumentError for legacy .doc', async () => {
    await expect(extractDocumentText(fileOf('old.doc', 'bytes'), LIMITS)).rejects.toBeInstanceOf(UnsupportedDocumentError)
  })

  it('stops early when aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(extractDocumentText(fileOf('a.txt', 'text'), LIMITS, controller.signal)).rejects.toThrow()
  })

  it('stops when the signal aborts mid-extraction', async () => {
    const controller = new AbortController()
    /** Trips the signal inside `text()`, so the abort lands after the parse await and before the final check. */
    class LateAbortFile extends File {
      override text(): Promise<string> {
        controller.abort()
        return super.text()
      }
    }
    await expect(extractDocumentText(new LateAbortFile(['text'], 'late.txt'), LIMITS, controller.signal))
      .rejects.toThrow('document-extract: aborted')
  })
})
