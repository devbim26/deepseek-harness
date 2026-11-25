/**
 * Programmatic PDF report runtime: it provides `ctx.pdfReports` and registers
 * no model-facing tool. @module @deepseek-ai/dsh-tool-pdf/runtime
 */

import type { Context } from '@deepseek-ai/cordis'
import { assertPdfReportLimits, pdfReportLimitsSchema, type PdfReportLimits } from './config.ts'
import { PdfReportRuntime } from './service.ts'

/** Stable Loader identity of the runtime entry. */
export const name = 'tool-pdf-runtime'

/** Services the report runtime requires. */
export const inject = ['fs', 'workingDirectory', 'attachments', 'agents']

/** Validated assembly limits. */
export const Config = pdfReportLimitsSchema

/**
 * Mount the programmatic PDF report writer.
 *
 * The entry registers no tool: the model never sees `pdf_report` because of it,
 * and a report assembled here costs no model request and no token.
 * @param ctx - Host context carrying the filesystem, working directory, attachment store, and agent registry.
 * @param config - resolved assembly limits.
 */
export function apply(ctx: Context, config: PdfReportLimits): void {
  assertPdfReportLimits(config)
  ctx.plugin(PdfReportRuntime, config)
}
