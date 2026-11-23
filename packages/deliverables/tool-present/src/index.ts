/** Scoped tool that declares filesystem deliveries in their owning Session. */
import type {} from '@deepseek-ai/dsh-working-directory'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ToolContextUnavailableError, defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
// Type-only: pulls the delivery service merge (ctx.fileDeliveries).
import type {} from './deliveries.ts'
import { FileDeliveryRuntime } from './service.ts'

/** Stable Loader identity. */
export const name = 'tool-present'

/** Per-call delivery limit. */
export interface Config {
  /** Maximum number of files in one call. */
  maxFiles: number
}

/** Validated delivery limit. */
export const Config: z<Config> = z.object({
  maxFiles: z.number().default(8),
})

/** Services used by the scoped delivery tool. */
export const inject = ['tools', 'fs', 'agents', 'workingDirectory']

/**
 * Register present with durable file references in its tool result.
 * @param ctx - agent-scoped services.
 * @param config - maximum files per call.
 */
export function apply(ctx: Context, config: Config): void {
  if (!Number.isSafeInteger(config.maxFiles) || config.maxFiles < 1) {
    throw new Error('present requires a positive integer maxFiles')
  }
  ctx.plugin(FileDeliveryRuntime, config)
  ctx.tools.register(defineTool({
    name: 'present',
    description: 'Declare existing files as final deliverables for the user. '
      + 'Hosts may show presented files only after your turn ends, so call it once the files are final. '
      + 'If the user needs to review files earlier, such as before a tool call that waits for their answer, link them in your message instead. '
      + 'Use it when the user needs a separate file, especially Office documents, spreadsheets, and slide decks; '
      + 'prefer your final response when that suffices. The user opens the current files; their contents are not copied.',
    parameters: {
      files: {
        type: 'array', required: true,
        // 4 is the recommended per-call count; `maxFiles` is the enforced ceiling above it.
        description: 'Usually the 1-2 most important deliverables; at most 4 per call.',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            path: { type: 'string', required: true, description: 'Path of an existing regular file. Relative paths use the Session working directory.' },
            description: { type: 'string', description: 'Brief description for the user.' },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          turn: { type: 'integer', required: true },
          files: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                description: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.files.map(file => `Presented ${file.path}`).join('\n') }],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new ToolContextUnavailableError('present requires an agent Session')
      const deliveries = ctx.get('fileDeliveries')
      if (deliveries === undefined) throw new ToolContextUnavailableError('present requires the file-delivery service')
      return deliveries.present(exec.agent, args.files, exec)
    },
  }))
}
