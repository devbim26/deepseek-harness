/** Browser-side text extraction for picked document files: format routing,
 * per-format lazy parsers, and the truncation contract the composer applies.
 * @module @deepseek-ai/dsh-client-ui-conversation/client/document-extract
 */

/** Why a document's text is absent, resolved to product copy at render time. */
export type DocumentExtractNotice = 'docLegacy' | 'noTextLayer' | 'parseFailed'

/** Legacy Word 97 binary: no browser parser exists for it. */
export class UnsupportedDocumentError extends Error {
  constructor() {
    super('document-extract: legacy .doc has no browser parser')
    this.name = 'UnsupportedDocumentError'
  }
}

/** A parsed document whose text layer is empty, such as a scanned PDF. */
export class NoTextLayerError extends Error {
  constructor() {
    super('document-extract: document has no text layer')
    this.name = 'NoTextLayerError'
  }
}

/** Extraction knobs, resolved once per plugin from Config. */
export interface DocumentExtractLimits {
  /** Files above this many bytes never enter extraction. */
  readonly maxFileBytes: number
  /** Extracted text longer than this many characters truncates with `truncated`. */
  readonly maxExtractChars: number
}

/** One finished extraction: the clipped text and whether clipping happened. */
export interface DocumentExtractResult {
  readonly text: string
  readonly truncated: boolean
}

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'log'])
const PARSED_EXTENSIONS = new Set(['pdf', 'docx', 'xls', 'xlsx'])

const extensionOf = (file: File): string => {
  const dot = file.name.lastIndexOf('.')
  return dot === -1 ? '' : file.name.slice(dot + 1).toLowerCase()
}

/**
 * Whether the composer extracts text for this file at all.
 * @param file - the picked browser file.
 * @returns true for the supported text and parsed document extensions.
 */
export function extractableText(file: File): boolean {
  const extension = extensionOf(file)
  return TEXT_EXTENSIONS.has(extension) || PARSED_EXTENSIONS.has(extension)
}

/**
 * Whether the file is a legacy `.doc` the picker should warn about.
 * @param file - the picked browser file.
 * @returns true only for the `.doc` extension.
 */
export function isLegacyDoc(file: File): boolean {
  return extensionOf(file) === 'doc'
}

/** Truncate to the character limit, stating whether clipping happened. */
function truncate(text: string, limits: DocumentExtractLimits): DocumentExtractResult {
  return text.length <= limits.maxExtractChars
    ? { text, truncated: false }
    : { text: text.slice(0, limits.maxExtractChars), truncated: true }
}

const aborted = (signal: AbortSignal | undefined): boolean => signal?.aborted === true

/** Extract text through pdf.js; an empty layer means a scan. */
async function extractPdf(file: File, signal: AbortSignal | undefined): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const document = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const pages: string[] = []
  for (let number = 1; number <= document.numPages; number++) {
    if (aborted(signal)) throw new Error('document-extract: aborted')
    const page = await document.getPage(number)
    const content = await page.getTextContent()
    pages.push(content.items.map(item => 'str' in item ? item.str : '').join(' '))
    page.cleanup()
  }
  const text = pages.join('\n\n').trim()
  if (text === '') throw new NoTextLayerError()
  return text
}

/** Extract paragraph text through mammoth's prebuilt browser bundle: the
 * typed Node entry does not implement the `arrayBuffer` input outside
 * browser-field resolvers such as Vitest. */
async function extractDocx(file: File): Promise<string> {
  const mammoth = await import('mammoth/mammoth.browser.js')
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
  return value
}

/** Extract every sheet as CSV through SheetJS. */
async function extractSheet(file: File): Promise<string> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  return workbook.SheetNames
    .map(name => XLSX.utils.sheet_to_csv(workbook.Sheets[name]!)).join('\n\n')
}

/**
 * Extract a picked document's text. Plain-text extensions decode verbatim;
 * parsed formats load their parser lazily. Parse failures propagate as thrown
 * errors; the caller maps them to `parseFailed`.
 * @param file - the picked browser file.
 * @param limits - the byte guard and the character truncation limit.
 * @param signal - aborts between extraction stages; release removes the draft.
 * @returns the extracted text with its truncation state.
 * @throws UnsupportedDocumentError for legacy `.doc`; NoTextLayerError for an
 *   empty text layer; an ordinary Error for oversize files, aborts, and parser
 *   failures.
 */
export async function extractDocumentText(
  file: File,
  limits: DocumentExtractLimits,
  signal?: AbortSignal,
): Promise<DocumentExtractResult> {
  if (isLegacyDoc(file)) throw new UnsupportedDocumentError()
  if (file.size > limits.maxFileBytes) throw new Error(`document-extract: ${file.name} exceeds maxFileBytes`)
  if (aborted(signal)) throw new Error('document-extract: aborted')
  const extension = extensionOf(file)
  const text = TEXT_EXTENSIONS.has(extension)
    ? await file.text()
    : extension === 'pdf' ? await extractPdf(file, signal)
      : extension === 'docx' ? await extractDocx(file)
        : await extractSheet(file)
  if (aborted(signal)) throw new Error('document-extract: aborted')
  return truncate(text, limits)
}
