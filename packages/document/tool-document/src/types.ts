/** Formats `document_read` extracts. */
export type DocumentFormat = 'pdf' | 'docx' | 'doc' | 'xlsx' | 'xls' | 'txt' | 'csv'

/** A bounded extraction window and the document location it covers. */
export interface DocumentWindow {
  /** Extracted text of the requested unit. */
  text: string
  /** Characters in the complete selected unit; absent for workbooks. */
  totalChars?: number
  /** PDF page count. */
  pages?: number
  /** One-based PDF page the window covers. */
  page?: number
  /** Workbook sheet names. */
  sheets?: string[]
  /** Selected workbook sheet. */
  sheet?: string
  /** Selected sheet's used range in A1 notation. */
  range?: string
  /** Zero-based first data row of the selected sheet. */
  row?: number
  /** Data rows the sheet window covers. */
  rows?: number
  /** Data rows in the selected sheet's used range. */
  totalRows?: number
}

/** Canonical result of one document_read call. */
export interface DocumentReadValue {
  /** Resolved document path. */
  path: string
  /** Detected document format. */
  format: DocumentFormat
  /** Document size in bytes. */
  bytes: number
  /** Extracted text window. */
  text: string
  /** Characters in the complete selected unit. */
  totalChars?: number
  /** PDF page count. */
  pages?: number
  /** One-based PDF page. */
  page?: number
  /** Workbook sheet names. */
  sheets?: string[]
  /** Selected workbook sheet. */
  sheet?: string
  /** Selected sheet's used range in A1 notation. */
  range?: string
  /** Zero-based first data row of the selected sheet. */
  row?: number
  /** Data rows in this window. */
  rows?: number
  /** Data rows in the selected sheet's used range. */
  totalRows?: number
  /** Character offset of the next text window. */
  nextOffset?: number
  /** Next PDF page. */
  nextPage?: number
  /** Next worksheet row. */
  nextRow?: number
}
