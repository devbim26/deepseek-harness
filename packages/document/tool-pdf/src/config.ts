/**
 * Shared PDF report assembly limits for the model-facing tool and the
 * programmatic runtime entry. @module @deepseek-ai/dsh-tool-pdf/config
 */

import z from '@deepseek-ai/schemastery'

/** Per-report assembly limits. */
export interface PdfReportLimits {
  /** Maximum images embedded in one report. */
  readonly maxImages: number
  /** Maximum stored bytes accepted for one embedded image. */
  readonly maxImageBytes: number
}

/** Validated assembly limits. */
export const pdfReportLimitsSchema: z<PdfReportLimits> = z.object({
  maxImages: z.number().default(50),
  maxImageBytes: z.number().default(20 * 1024 * 1024),
})

/**
 * Reject limits that cannot produce a report.
 * @param config - resolved assembly limits.
 * @throws Error when a limit is not a positive safe integer.
 */
export function assertPdfReportLimits(config: PdfReportLimits): void {
  if (!Number.isSafeInteger(config.maxImages) || config.maxImages < 1) {
    throw new Error('pdf_report requires a positive integer maxImages')
  }
  if (!Number.isSafeInteger(config.maxImageBytes) || config.maxImageBytes < 1) {
    throw new Error('pdf_report requires a positive integer maxImageBytes')
  }
}
