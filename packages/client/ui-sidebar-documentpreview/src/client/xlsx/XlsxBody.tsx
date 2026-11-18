/** Complete XLSX bytes rendered as lightweight worksheet tables. */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { DocumentPreviewProps } from '../document/contract.ts'
import { LoadingIndicator } from '../LoadingIndicator.tsx'
import type {} from './locales.ts'
import css from './XlsxBody.module.css'

const MAX_ROWS = 200
const MAX_COLS = 80

interface ZipEntry {
  readonly name: string
  readonly method: number
  readonly compressedSize: number
  readonly uncompressedSize: number
  readonly offset: number
}

interface WorkbookSheetRef {
  readonly name: string
  readonly relId: string
}

interface WorksheetPreview {
  readonly name: string
  readonly rows: readonly (readonly string[])[]
  readonly truncated: boolean
}

interface WorkbookPreview {
  readonly sheets: readonly WorksheetPreview[]
}

/** Standard document inputs plus this renderer's dictionary. */
export type XlsxBodyProps = DocumentPreviewProps & PropsLocale<'sidebarXlsx'>

/** The renderer's translate seat, threaded into parsing for locale-owned cell labels. */
type XlsxTranslate = PropsLocale<'sidebarXlsx'>['t']

function u16(data: Uint8Array, offset: number): number {
  return (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8)
}

function u32(data: Uint8Array, offset: number): number {
  return ((data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8) | ((data[offset + 2] ?? 0) << 16) | ((data[offset + 3] ?? 0) << 24)) >>> 0
}

function normalizeZipName(name: string): string {
  return name.replace(/^\/+/, '').replaceAll('\\', '/')
}

function findEndOfCentralDirectory(data: Uint8Array): number {
  const min = Math.max(0, data.length - 0xffff - 22)
  for (let offset = data.length - 22; offset >= min; offset -= 1) {
    if (u32(data, offset) === 0x06054b50) return offset
  }
  throw new Error('xlsx: ZIP end of central directory not found')
}

function readZipEntries(data: Uint8Array): readonly ZipEntry[] {
  const eocd = findEndOfCentralDirectory(data)
  const count = u16(data, eocd + 10)
  let offset = u32(data, eocd + 16)
  const decoder = new TextDecoder('utf-8')
  const entries: ZipEntry[] = []
  for (let i = 0; i < count; i += 1) {
    if (u32(data, offset) !== 0x02014b50) throw new Error('xlsx: invalid ZIP central directory')
    const method = u16(data, offset + 10)
    const compressedSize = u32(data, offset + 20)
    const uncompressedSize = u32(data, offset + 24)
    const nameLength = u16(data, offset + 28)
    const extraLength = u16(data, offset + 30)
    const commentLength = u16(data, offset + 32)
    const localOffset = u32(data, offset + 42)
    const name = normalizeZipName(decoder.decode(data.subarray(offset + 46, offset + 46 + nameLength)))
    entries.push({ name, method, compressedSize, uncompressedSize, offset: localOffset })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function blobPartOf(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer as ArrayBuffer
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([blobPartOf(bytes)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function inflateZlib(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([blobPartOf(bytes)]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function readZipText(data: Uint8Array, entries: readonly ZipEntry[], name: string): Promise<string | undefined> {
  const entry = entries.find(candidate => candidate.name === name)
  if (entry === undefined) return undefined
  if (u32(data, entry.offset) !== 0x04034b50) throw new Error('xlsx: invalid ZIP local header')
  const nameLength = u16(data, entry.offset + 26)
  const extraLength = u16(data, entry.offset + 28)
  const start = entry.offset + 30 + nameLength + extraLength
  const compressed = data.subarray(start, start + entry.compressedSize)
  let bytes: Uint8Array
  if (entry.method === 0) bytes = compressed
  else if (entry.method === 8) {
    try { bytes = await inflateRaw(compressed) }
    catch { bytes = await inflateZlib(compressed) }
  } else throw new Error(`xlsx: unsupported ZIP compression method ${entry.method}`)
  if (entry.uncompressedSize !== 0 && bytes.length === 0) throw new Error('xlsx: empty inflated entry')
  return new TextDecoder('utf-8').decode(bytes)
}

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml')
}

function textOf(node: Element | null | undefined): string {
  return node?.textContent ?? ''
}

function parseSharedStrings(xml: string | undefined): readonly string[] {
  if (xml === undefined) return []
  const doc = parseXml(xml)
  return [...doc.getElementsByTagName('si')].map(si => [...si.getElementsByTagName('t')].map(textOf).join(''))
}

function parseWorkbookSheets(xml: string): readonly WorkbookSheetRef[] {
  const doc = parseXml(xml)
  return [...doc.getElementsByTagName('sheet')].map(sheet => ({
    name: sheet.getAttribute('name') ?? 'Sheet',
    relId: sheet.getAttribute('r:id') ?? sheet.getAttribute('id') ?? '',
  })).filter(sheet => sheet.relId !== '')
}

function parseWorkbookRelationships(xml: string | undefined): Map<string, string> {
  const result = new Map<string, string>()
  if (xml === undefined) return result
  const doc = parseXml(xml)
  for (const rel of doc.getElementsByTagName('Relationship')) {
    const id = rel.getAttribute('Id')
    const target = rel.getAttribute('Target')
    if (id === null || target === null) continue
    result.set(id, normalizeZipName(target.startsWith('/') ? target : `xl/${target}`))
  }
  return result
}

function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Za-z]+/u)?.[0] ?? 'A'
  let value = 0
  for (const letter of letters.toUpperCase()) value = value * 26 + letter.charCodeAt(0) - 64
  return value - 1
}

function rowIndex(ref: string): number {
  return Math.max(0, Number.parseInt(ref.match(/\d+/u)?.[0] ?? '1', 10) - 1)
}

function columnName(index: number): string {
  let n = index + 1
  let name = ''
  while (n > 0) {
    const r = (n - 1) % 26
    name = String.fromCharCode(65 + r) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

function cellValue(cell: Element, sharedStrings: readonly string[], t: XlsxTranslate): string {
  const type = cell.getAttribute('t')
  if (type === 'inlineStr') return [...cell.getElementsByTagName('t')].map(textOf).join('')
  const raw = textOf(cell.getElementsByTagName('v')[0])
  if (type === 's') return sharedStrings[Number.parseInt(raw, 10)] ?? raw
  if (type === 'b') return t(raw === '1' ? 'booleanTrue' : 'booleanFalse')
  return raw
}

function parseWorksheet(xml: string, name: string, sharedStrings: readonly string[], t: XlsxTranslate): WorksheetPreview {
  const doc = parseXml(xml)
  const rows: string[][] = []
  let maxCol = 0
  let truncated = false
  for (const cell of doc.getElementsByTagName('c')) {
    const ref = cell.getAttribute('r') ?? 'A1'
    const row = rowIndex(ref)
    if (row >= MAX_ROWS) { truncated = true; continue }
    const col = columnIndex(ref)
    if (col >= MAX_COLS) continue
    const rowCells = rows[row] ?? (rows[row] = [])
    rowCells[col] = cellValue(cell, sharedStrings, t)
    maxCol = Math.max(maxCol, col + 1)
  }
  const dense = rows.map(row => Array.from({ length: maxCol }, (_, index) => row[index] ?? ''))
  return { name, rows: dense, truncated }
}

async function parseWorkbook(data: Uint8Array, t: XlsxTranslate): Promise<WorkbookPreview> {
  const entries = readZipEntries(data)
  const workbookXml = await readZipText(data, entries, 'xl/workbook.xml')
  if (workbookXml === undefined) throw new Error('xlsx: workbook.xml is missing')
  const sharedStrings = parseSharedStrings(await readZipText(data, entries, 'xl/sharedStrings.xml'))
  const relationships = parseWorkbookRelationships(await readZipText(data, entries, 'xl/_rels/workbook.xml.rels'))
  const sheets: WorksheetPreview[] = []
  for (const sheet of parseWorkbookSheets(workbookXml)) {
    const target = relationships.get(sheet.relId)
    if (target === undefined) continue
    const sheetXml = await readZipText(data, entries, target)
    if (sheetXml !== undefined) sheets.push(parseWorksheet(sheetXml, sheet.name, sharedStrings, t))
  }
  return { sheets }
}

/** Render a complete XLSX workbook as simple worksheet tables. */
export function XlsxBody({ content, t }: XlsxBodyProps): ReactNode {
  const data = content.kind === 'bytes' ? content.data : undefined
  const [state, setState] = useState<{ readonly data: Uint8Array; readonly workbook?: WorkbookPreview; readonly failed?: true }>()
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (data === undefined) return
    let disposed = false
    void parseWorkbook(data, t)
      .then((workbook) => { if (!disposed) { setState({ data, workbook }); setActive(0) } })
      .catch(() => { if (!disposed) setState({ data, failed: true }) })
    return () => { disposed = true }
  }, [data, t])

  const sheet = useMemo(() => state?.workbook?.sheets[active], [state?.workbook, active])
  if (data === undefined) return <p className={css.status} role="alert">{t('unsupported')}</p>
  if (state?.data !== data) return <p className={css.status}><LoadingIndicator label={t('loading')} /></p>
  if (state.failed === true) return <p className={css.status} role="alert">{t('failed')}</p>
  if (state.workbook === undefined || state.workbook.sheets.length === 0 || sheet === undefined) {
    return <p className={css.status}>{t('empty')}</p>
  }
  const colCount = Math.max(1, ...sheet.rows.map(row => row.length))
  return (
    <div className={css.frame} data-xlsx-preview>
      <div className={css.tabs} role="tablist" aria-label={t('sheetLabel')}>
        {state.workbook.sheets.map((candidate, index) => (
          <button
            key={`${candidate.name}-${index}`}
            type="button"
            className={css.tab}
            role="tab"
            aria-selected={index === active}
            onClick={() => { setActive(index) }}
          >
            {candidate.name}
          </button>
        ))}
      </div>
      {sheet.truncated && <p className={css.notice}>{t('rowsTruncated', { count: String(MAX_ROWS) })}</p>}
      <div className={css.tableWrap}>
        <table className={css.table}>
          <thead>
            <tr>
              <th className={css.corner} />
              {Array.from({ length: colCount }, (_, index) => <th key={index} className={css.colHeader}>{columnName(index)}</th>)}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, rowNumber) => (
              <tr key={rowNumber}>
                <th className={css.rowHeader}>{rowNumber + 1}</th>
                {Array.from({ length: colCount }, (_, colNumber) => <td key={colNumber} className={css.cell}>{row[colNumber] ?? ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
