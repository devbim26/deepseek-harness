/** Shared report input and result types for the pdf_report tool. */

/** One embedded image with its provenance and optional caption. */
export interface ReportImage {
  /** Tool call id whose result carried the image. */
  callId: string
  /** Decoded image bytes. */
  data: Uint8Array
  /** Encoded media type; only PNG and JPEG embed into PDFs. */
  mediaType: 'image/png' | 'image/jpeg'
  /** Optional user-facing caption printed under the image. */
  caption?: string
}

/** One skipped image with the user-actionable reason. */
export interface SkippedImage {
  /** Requested call id that produced no usable image. */
  callId: string
  /** Why the image is absent from the report. */
  reason: string
}

/** One ordered report block; the document renders blocks in array order. */
export type ReportBlock =
  | { type: 'text'; heading?: string; text: string }
  | { type: 'image'; callId: string; caption?: string }

/** Assembled report outcome. */
export interface PdfReportResult {
  /** Canonical absolute path of the written PDF. */
  path: string
  /** Encoded PDF size in bytes. */
  bytes: number
  /** Page count of the written document. */
  pages: number
  /** Images embedded in document order. */
  imagesEmbedded: number
  /** Requested images absent from the document, with reasons. */
  imagesSkipped: SkippedImage[]
}
