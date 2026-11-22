/** Scoped report writer shared by the model tool and programmatic consumers. */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FsError } from '@deepseek-ai/dsh-fs'
import { ToolArgsError, ToolContextUnavailableError } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-working-directory'
import { buildPdfReport } from './pdf.ts'
import { collectReportImages, type RequestedImage } from './session-images.ts'
import type {
  AvailableImageCall, PdfReportCreateRequest, PdfReportResult, PdfReports,
  ReportBlock, SkippedImage,
} from './types.ts'
import type { Config } from './index.ts'

/** Resolve the observation actor explicitly for tool and direct-host callers. */
function reportActor(agent: Agent, actor: object | undefined): object {
  return actor === undefined ? { agent } : actor
}

/** Local PDF report provider mounted by the tool-pdf function plugin. */
export class PdfReportRuntime extends Service implements PdfReports {
  static inject = ['fs', 'workingDirectory', 'attachments', 'agents']

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'pdfReports')
  }

  /**
   * Assemble and write one PDF report.
   * @param agent - exact live owning Agent.
   * @param request - report path, optional title, typed blocks, and policy actor.
   * @param signal - operation cancellation.
   * @returns written file metadata and image diagnostics.
   */
  async create(agent: Agent, request: PdfReportCreateRequest, signal: AbortSignal): Promise<PdfReportResult> {
    if (this.ctx.agents.get(agent.id) !== agent) {
      throw new ToolContextUnavailableError('pdf_report requires the exact live agent Session')
    }
    if (!request.filePath.toLowerCase().endsWith('.pdf')) {
      throw new ToolArgsError(['pdf_report requires an output path ending in .pdf'])
    }
    const requested: readonly RequestedImage[] = request.blocks
      .filter((block): block is Extract<ReportBlock, { type: 'image' }> => block.type === 'image')
      .map(block => ({ callId: block.callId, ...block.caption !== undefined ? { caption: block.caption } : {} }))
    const cwd = await this.ctx.workingDirectory.ensure(agent, signal)
    const options = { cwd, signal }
    const target = await this.ctx.fs.resolve(request.filePath, options)
    const before = await this.ctx.fs.stat(target, signal)
    if (before !== undefined && before.type !== 'file') {
      throw new FsError(`Cannot write ${request.filePath}: not a regular file`, 'FS_NOT_REGULAR_FILE')
    }
    const actor = reportActor(agent, request.actor)
    const intent = await this.ctx.waterfall('fs/write-intent', target, actor, () => undefined)
    if (intent?.kind === 'createIfAbsent' && before !== undefined) {
      throw new FsError(`Cannot write ${request.filePath}: the file already exists`, 'FS_ALREADY_EXISTS')
    }
    const { images, skipped, available } = await collectReportImages(
      this.ctx, agent.session, requested, this.config.maxImages, this.config.maxImageBytes, signal,
    )
    const document = await buildPdfReport(request.title, request.blocks, images)
    signal.throwIfAborted()
    const outPath = this.ctx.fs.processPath(target)
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, document.bytes)
    const after = await this.ctx.fs.stat(target, signal)
    if (after === undefined || after.type !== 'file') {
      throw new FsError(`The written report ${request.filePath} is not readable as a regular file`, 'FS_NOT_FOUND')
    }
    this.ctx.emit('fs/observed', target, { kind: 'present', version: after.version }, actor)
    return {
      path: this.ctx.fs.processPath(target),
      bytes: document.bytes.byteLength,
      pages: document.pages,
      imagesEmbedded: images.length,
      imagesSkipped: skipped as SkippedImage[],
      availableImageCalls: available as AvailableImageCall[],
    }
  }
}
