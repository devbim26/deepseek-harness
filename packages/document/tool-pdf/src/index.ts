/**
 * Scoped tool that assembles a PDF report file in the Session workspace from
 * ordered text blocks and images captured by earlier tool calls, without
 * shell or Python. @module @deepseek-ai/dsh-tool-pdf
 */

import type {} from '@deepseek-ai/dsh-working-directory'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ToolArgsError, ToolContextUnavailableError, defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type { ReportBlock } from './types.ts'
import { assertPdfReportLimits, pdfReportLimitsSchema } from './config.ts'
import { PdfReportRuntime } from './service.ts'

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
export const Config: z<Config> = pdfReportLimitsSchema

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
  assertPdfReportLimits(config)
  ctx.plugin(PdfReportRuntime, config)
  ctx.tools.register(defineTool({
    name: 'pdf_report',
    description: 'Assemble a PDF report file in the working directory from text sections, tables, and images '
      + 'that earlier tool calls returned, such as drawing sheet images. Blocks render in order. '
      + 'Every image block carries the call id of your own earlier tool call whose result showed the image: '
      + 'the id attached to that tool call entry in this conversation, for example a drawing get_crop call. '
      + 'If you no longer see which call carried an image, request the crop again and pass the fresh call id. '
      + 'Pass tabular data as table blocks: they render as styled tables with a header row, zebra rows, '
      + 'and column widths fitted to the content, never as plain text. '
      + 'Mark the key facts, figures, and conclusions with ==...== so they print on a yellow band: '
      + 'inside text, or in a table cell, which then takes the band as a whole. '
      + 'Mark sparingly and never a whole sentence. '
      + 'After the file is written, declare it to the user with the present tool. Use it when the user asks '
      + 'for a PDF document; prefer your final response when plain text suffices.',
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
                text: {
                  type: 'string', required: true,
                  description: 'Body text. Every line is its own paragraph and an empty line separates paragraphs. '
                    + 'It renders a small Markdown subset: #, ##, and ### headings, "- " and "1. " list items, '
                    + 'pipe tables with a --- separator row, **bold**, and ==text== on a yellow band.',
                },
              },
            },
            {
              type: 'object', additionalProperties: false,
              properties: {
                type: { type: 'string', required: true, description: 'Discriminant: a table block.' },
                header: {
                  type: 'array', required: true,
                  description: 'Column titles without inline markers; their count fixes the column layout.',
                  items: { type: 'string' },
                },
                rows: {
                  type: 'array', required: true,
                  description: 'Body rows of cell text; shorter rows pad with empty cells.',
                  items: {
                    type: 'array',
                    items: {
                      type: 'string',
                      description: 'Cell text without inline markers; a cell that carries ==...== prints on the yellow band.',
                    },
                  },
                },
              },
            },
            {
              type: 'object', additionalProperties: false,
              properties: {
                type: { type: 'string', required: true, description: 'Discriminant: an image block.' },
                call_id: {
                  type: 'string', required: true,
                  description: 'The call id of your earlier tool call in this conversation whose result carried '
                    + 'the images; every image of that result embeds.',
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
          availableImageCalls: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                callId: { type: 'string', required: true },
                images: { type: 'integer', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const lines = [
          `Assembled PDF report: ${value.pages} page(s), ${value.imagesEmbedded} image(s) embedded, ${value.bytes} bytes.`,
          ...value.imagesSkipped.map(skip => `${skip.callId}: ${skip.reason}`),
        ]
        if (value.imagesSkipped.length > 0 && value.availableImageCalls.length > 0) {
          lines.push(`Available image calls: ${
            value.availableImageCalls.map(call => `${call.callId} (${call.images} image${call.images === 1 ? '' : 's'})`).join(', ')}`)
        }
        return [{
          type: 'text',
          text: `<path>${value.path}</path>\n<type>file</type>\n<content>\n${lines.join('\n')}\n</content>`,
        }]
      },
    },
    presentCall: args => ({
      card: 'generic' as const,
      title: `PDF report → ${args.file_path}`,
      kind: 'other' as const,
      rawInput: { file_path: args.file_path, blocks: args.blocks.length },
    }),
    async execute(args, exec) {
      if (exec.agent === undefined) throw new ToolContextUnavailableError('pdf_report requires an agent Session')
      const blocks: readonly ReportBlock[] = validateBlocks(args.blocks)
      const reports = ctx.get('pdfReports')
      if (reports === undefined) throw new ToolContextUnavailableError('pdf_report requires the PDF report service')
      return reports.create(exec.agent, {
        filePath: args.file_path,
        ...(args.title === undefined ? {} : { title: args.title }),
        blocks,
        actor: exec,
      }, exec.signal)
    },
  }))
}
