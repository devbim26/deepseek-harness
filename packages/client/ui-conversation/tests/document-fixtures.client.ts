/** Byte-exact document fixtures for extraction specs: stored-entry ZIP
 * containers for .docx and SheetJS workbooks for .xlsx, both readable by the
 * real parsers.
 */
import * as XLSX from 'xlsx'

/** CRC-32 of a byte sequence, as the ZIP central directory stores it. */
function crc32(bytes: Uint8Array): number {
  let c = ~0
  for (const byte of bytes) {
    c ^= byte
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1))
  }
  return ~c
}

/** Minimal stored-entry ZIP with CRC-32, enough for mammoth to read a .docx. */
export function storedZip(entries: { name: string; data: Uint8Array }[]): Uint8Array<ArrayBuffer> {
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

/** One .docx holding a paragraph per string, readable by mammoth. */
export function docxOf(paragraphs: string[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()
  const body = paragraphs.map(text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('')
  const document = encoder.encode(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  )
  return storedZip([{ name: 'word/document.xml', data: document }])
}

/** One single-sheet .xlsx of the given rows, readable by SheetJS. */
export function xlsxOf(rows: string[][]): Uint8Array<ArrayBuffer> {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
}
