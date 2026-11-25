/** Shared report input and result types for the pdf_report tool. */

import type { Agent } from '@deepseek-ai/dsh-agent'

/** Inputs for one programmatic report write. */
export interface PdfReportCreateRequest {
  /** Output path ending in `.pdf`, relative to the Session working directory. */
  readonly filePath: string
  /** Optional title printed at the top of the first page. */
  readonly title?: string
  /** Ordered text, code, table, and image blocks. */
  readonly blocks: readonly ReportBlock[]
  /**
   * Append a section naming every requested image the report could not embed
   * and the reason. Without it the document keeps exactly the requested blocks.
   */
  readonly includeSkippedImagesAppendix?: boolean
  /** Opaque filesystem-policy actor; omitted uses an actor bound to this Agent. */
  readonly actor?: object | undefined
}

/** Scoped programmatic PDF report writer. */
export interface PdfReports {
  /**
   * Assemble and write one report through the same filesystem and attachment policy as `pdf_report`.
   * @param agent - exact live owning Agent.
   * @param request - output path, title, blocks, optional skipped-image appendix, and optional policy actor.
   * @param signal - cancellation for path resolution, image collection, and writing.
   * @returns canonical path, size, page count, and image outcomes.
   */
  create(agent: Agent, request: PdfReportCreateRequest, signal: AbortSignal): Promise<PdfReportResult>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    pdfReports: PdfReports
  }
}

/** One embedded image with its originating tool call and optional caption. */
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

/** One session tool call whose latest result carries images. */
export interface AvailableImageCall {
  /** Tool call id the model can pass in an image block. */
  callId: string
  /** Image blocks in that result. */
  images: number
}

/**
 * One verbatim code block. Every line prints as it is written, so no heading,
 * list, table, or inline mark is read from the code. Only programmatic callers
 * pass it; the `pdf_report` tool schema does not offer it.
 */
export interface CodeBlock {
  /** Discriminant: a code block. */
  type: 'code'
  /** Code text; `\n` or `\r\n` separates lines. */
  text: string
}

/** One ordered report block; the document renders blocks in array order. */
export type ReportBlock =
  | { type: 'text'; heading?: string; text: string }
  | CodeBlock
  | { type: 'image'; callId: string; caption?: string }
  | { type: 'table'; header: string[]; rows: string[][] }

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
  /** Session calls whose results carry images, so the model can retry a wrong id. */
  availableImageCalls: AvailableImageCall[]
}
