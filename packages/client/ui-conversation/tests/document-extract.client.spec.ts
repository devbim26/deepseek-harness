import { describe, expect, it } from 'vitest'
import type { DocumentExtractLimits } from '../src/client/document-extract.ts'
import {
  NoTextLayerError, UnsupportedDocumentError,
  extractDocumentText, extractableText, isLegacyDoc,
} from '../src/client/document-extract.ts'
import * as XLSX from 'xlsx'

const LIMITS: DocumentExtractLimits = { maxFileBytes: 1024 * 1024, maxExtractChars: 20 }

/** Parsed-format extraction asserts full content, which outgrows the suite's
 * 20-character truncation budget; truncation itself has its own test. */
const PARSED_LIMITS: DocumentExtractLimits = { maxFileBytes: 1024 * 1024, maxExtractChars: 1000 }

const fileOf = (name: string, content: string | Uint8Array<ArrayBuffer>, type = ''): File =>
  new File([content], name, { type })

/** Minimal stored-entry ZIP with CRC-32, enough for mammoth to read a .docx. */
function crc32(bytes: Uint8Array): number {
  let c = ~0
  for (const byte of bytes) {
    c ^= byte
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1))
  }
  return ~c
}

function storedZip(entries: { name: string; data: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  const u16 = (v: number): Uint8Array => new Uint8Array([v & 255, (v >> 8) & 255])
  const u32 = (v: number): Uint8Array => new Uint8Array([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255])
  let offset = 0
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const crc = crc32(entry.data)
    const local = new Uint8Array(30 + nameBytes.length)
    local.set(u32(0x04034b50), 0)
    local.set(u16(20), 4)
    local.set(u16(0), 6)
    local.set(u16(0), 8)
    local.set(u16(0), 10)
    local.set(u16(0), 12)
    local.set(u32(crc), 14)
    local.set(u32(entry.data.length), 18)
    local.set(u32(entry.data.length), 22)
    local.set(u16(nameBytes.length), 26)
    local.set(nameBytes, 30)
    parts.push(local, entry.data)
    const dir = new Uint8Array(46 + nameBytes.length)
    dir.set(u32(0x02014b50), 0)
    dir.set(u16(20), 4)
    dir.set(u16(20), 6)
    dir.set(u32(crc), 16)
    dir.set(u32(entry.data.length), 20)
    dir.set(u32(entry.data.length), 24)
    dir.set(u16(nameBytes.length), 28)
    dir.set(u32(offset), 42)
    dir.set(nameBytes, 46)
    central.push(dir)
    offset += local.length + entry.data.length
  }
  const centralBytes = central.flatMap(part => [...part])
  const end = new Uint8Array(22)
  end.set(u32(0x06054b50), 0)
  end.set(u16(entries.length), 8)
  end.set(u16(entries.length), 10)
  end.set(u32(centralBytes.length), 12)
  end.set(u32(offset), 16)
  return new Uint8Array([...parts.flatMap(part => [...part]), ...centralBytes, ...end])
}

function docxOf(paragraphs: string[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()
  const body = paragraphs.map(text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('')
  const document = encoder.encode(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  )
  return storedZip([{ name: 'word/document.xml', data: document }])
}

function xlsxOf(rows: string[][]): Uint8Array<ArrayBuffer> {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
}

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
})
