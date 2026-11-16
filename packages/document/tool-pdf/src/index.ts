/**
 * Scoped tool that assembles a PDF report file in the Session workspace from
 * ordered text blocks and images captured by earlier tool calls, without
 * shell or Python. @module @deepseek-ai/dsh-tool-pdf
 */

import { writeFile } from 'node:fs/promises'
import type {} from '@deepseek-ai/dsh-working-directory'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { FsError } from '@deepseek-ai/dsh-fs'
import { ToolArgsError, ToolContextUnavailableError, defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type { ReportBlock, SkippedImage } from './types.ts'
import { buildPdfReport } from './pdf.ts'
import { collectReportImages, type RequestedImage } from './session-images.ts'

/** Stable Loader identity. */
export const name = 'tool-pdf'

/** Per-call assembly limits. */
export interface Config {
  /** Maximum images embedded in one report. */
  maxImages: number
  /** Maximum stored bytes accepted for one embedded image. */
  maxImageBytes: number
}

/** Validated assembly limits. */
export const Config: z<Config> = z.object({
  maxImages: z.number().default(50),
  maxImageBytes: z.number().default(20 * 1024 * 1024),
})

/** Services used by the report tool. */
export const inject = ['tools', 'fs', 'workingDirectory', 'attachments', 'agents']

/** Raw block as the schema DSL infers it, before discriminant narrowing. */
interface RawBlock {
  type: string
  heading?: string
  text?: string
  call_id?: string
  caption?: string
  header?: string[]
  rows?: string[][]
}

/**
 * Validate the block list the schema DSL cannot express: at least one block, a
 * known discriminant per block, non-empty text, a non-empty call id, and a
 * table header with at least one row.
 * @param blocks - the schema-validated raw blocks.
 * @returns the validated blocks with narrow discriminants and camelCase fields.
 */
function validateBlocks(blocks: readonly RawBlock[]): readonly ReportBlock[] {
  if (blocks.length === 0) {
    throw new ToolArgsError(['pdf_report requires at least one text, table, or image block'])
  }
  return blocks.map((block): ReportBlock => {
    if (block.type === 'text') {
      if (block.text === undefined || block.text.trim().length === 0) {
        throw new ToolArgsError(['pdf_report requires non-empty text in every text block'])
      }
      return { type: 'text', ...block.heading !== undefined ? { heading: block.heading } : {}, text: block.text }
    }
    if (block.type === 'table') {
      if (block.header === undefined || block.header.length === 0) {
        throw new ToolArgsError(['pdf_report requires a non-empty header in every table block'])
      }
      if (block.rows === undefined || block.rows.length === 0) {
        throw new ToolArgsError(['pdf_report requires at least one row in every table block'])
      }
      return { type: 'table', header: block.header, rows: block.rows }
    }
    if (block.type === 'image') {
      if (block.call_id === undefined || block.call_id.trim().length === 0) {
        throw new ToolArgsError(['pdf_report requires a non-empty call_id in every image block'])
      }
      return { type: 'image', callId: block.call_id, ...block.caption !== undefined ? { caption: block.caption } : {} }
    }
    throw new ToolArgsError([`pdf_report does not support block type ${JSON.stringify(block.type)}`])
  })
}

/**
 * Register pdf_report with the workspace file write in its tool result.
 * @param ctx - agent-scoped services.
 * @param config - validated assembly limits.
 */
export function apply(ctx: Context, config: Config): void {
  if (!Number.isSafeInteger(config.maxImages) || config.maxImages < 1) {
    throw new Error('pdf_report requires a positive integer maxImages')
  }
  if (!Number.isSafeInteger(config.maxImageBytes) || config.maxImageBytes < 1) {
    throw new Error('pdf_report requires a positive integer maxImageBytes')
  }
  ctx.tools.register(defineTool({
    name: 'pdf_report',
    description: 'Assemble a PDF report file in the working directory from text sections, tables, and images '
      + 'that earlier tool calls returned, such as drawing sheet images. Blocks render in order; '
      + 'pass the tool call id of each image result. Pass tabular data as table blocks: they render as '
      + 'styled tables with a header row, zebra rows, and column widths fitted to the content, '
      + 'never as plain text. After the file is written, declare it to the user '
      + 'with the present tool. Use it when the user asks for a PDF document; prefer your final response '
      + 'when plain text suffices.',
    parameters: {
      file_path: {
        type: 'string', required: true,
        description: 'Output path ending in .pdf, relative to the Session working directory.',
      },
      title: { type: 'string', description: 'Report title printed at the top of the first page.' },
      blocks: {
        type: 'array', required: true,
        description: 'Ordered report blocks; the document renders them in this order.',
        items: {
          oneOf: [
            {
              type: 'object', additionalProperties: false,
              properties: {
                type: { type: 'string', required: true, description: 'Discriminant: a text block.' },
                heading: { type: 'string', description: 'Section heading printed above the text.' },
                text: { type: 'string', required: true, description: 'Body text; newlines start new paragraphs.' },
              },
            },
            {
              type: 'object', additionalProperties: false,
              properties: {
                type: { type: 'string', required: true, description: 'Discriminant: a table block.' },
                header: {
                  type: 'array', required: true,
                  description: 'Column titles; their count fixes the column layout.',
                  items: { type: 'string' },
                },
                rows: {
                  type: 'array', required: true,
                  description: 'Body rows of cell text; shorter rows pad with empty cells.',
                  items: { type: 'array', items: { type: 'string' } },
                },
              },
            },
            {
              type: 'object', additionalProperties: false,
              properties: {
                type: { type: 'string', required: true, description: 'Discriminant: an image block.' },
                call_id: {
                  type: 'string', required: true,
                  description: 'Tool call id whose result carried the images; every image of that result embeds.',
                },
                caption: { type: 'string', description: 'Caption printed under each embedded image of the call.' },
              },
            },
          ],
        },
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
          pages: { type: 'integer', required: true },
          imagesEmbedded: { type: 'integer', required: true },
          imagesSkipped: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                callId: { type: 'string', required: true },
                reason: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `<path>${value.path}</path>\n<type>file</type>\n<content>\n`
          + `Assembled PDF report: ${value.pages} page(s), ${value.imagesEmbedded} image(s) embedded, ${value.bytes} bytes.\n`
          + value.imagesSkipped.map(skip => `${skip.callId}: ${skip.reason}`).join('\n')
          + `${value.imagesSkipped.length === 0 ? '' : '\n'}</content>`,
      }],
    },
    presentCall: args => ({
      card: 'generic' as const,
      title: `PDF report → ${args.file_path}`,
      kind: 'other' as const,
      rawInput: { file_path: args.file_path, blocks: args.blocks.length },
    }),
    async execute(args, exec) {
      if (exec.agent === undefined) throw new ToolContextUnavailableError('pdf_report requires an agent Session')
      if (!args.file_path.toLowerCase().endsWith('.pdf')) {
        throw new ToolArgsError(['pdf_report requires an output path ending in .pdf'])
      }
      const blocks: readonly ReportBlock[] = validateBlocks(args.blocks)
      const requested: readonly RequestedImage[] = blocks
        .filter((block): block is Extract<ReportBlock, { type: 'image' }> => block.type === 'image')
        .map(block => ({ callId: block.callId, ...block.caption !== undefined ? { caption: block.caption } : {} }))
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const options = { cwd, signal: exec.signal }
      const target = await ctx.fs.resolve(args.file_path, options)
      const before = await ctx.fs.stat(target, exec.signal)
      if (before !== undefined && before.type !== 'file') {
        throw new FsError(`Cannot write ${args.file_path}: not a regular file`, 'FS_NOT_REGULAR_FILE')
      }
      const intent = await ctx.waterfall('fs/write-intent', target, exec, () => undefined)
      if (intent?.kind === 'createIfAbsent' && before !== undefined) {
        throw new FsError(`Cannot write ${args.file_path}: the file already exists`, 'FS_ALREADY_EXISTS')
      }
      const { images, skipped } = await collectReportImages(
        ctx, exec.agent.session, requested, config.maxImages, config.maxImageBytes, exec.signal,
      )
      const document = await buildPdfReport(args.title, blocks, images)
      exec.signal.throwIfAborted()
      // The filesystem service models text writes only; the resolved local target
      // receives the encoded PDF bytes directly through the host filesystem.
      await writeFile(ctx.fs.processPath(target), document.bytes)
      const after = await ctx.fs.stat(target, exec.signal)
      if (after === undefined || after.type !== 'file') {
        throw new FsError(`The written report ${args.file_path} is not readable as a regular file`, 'FS_NOT_FOUND')
      }
      ctx.emit('fs/observed', target, { kind: 'present', version: after.version }, exec)
      return {
        path: ctx.fs.processPath(target),
        bytes: document.bytes.byteLength,
        pages: document.pages,
        imagesEmbedded: images.length,
        imagesSkipped: skipped as SkippedImage[],
      }
    },
  }))
}
