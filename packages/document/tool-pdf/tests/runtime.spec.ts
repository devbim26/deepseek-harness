/** Programmatic PDF runtime entry: service mount, tool isolation, and the skipped-image appendix. */

import { Context } from '@deepseek-ai/cordis'
import { ToolCallId, createToolResultMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { provideWorkingDirectoryFixture, unsupportedInbox, unsupportedModel } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildPdfReport } from '../src/pdf.ts'
import { blocksWithSkippedImages } from '../src/service.ts'
import * as ToolPdfRuntime from '../src/runtime.ts'
import type { ReportBlock } from '../src/types.ts'

vi.mock('../src/pdf.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/pdf.ts')>()
  return { ...actual, buildPdfReport: vi.fn(actual.buildPdfReport) }
})

const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  char => char.charCodeAt(0),
)

const cleanups: Array<() => Promise<unknown>> = []
let callNumber = 0
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
  vi.mocked(buildPdfReport).mockClear()
  vi.restoreAllMocks()
})

/** Register one live Agent owning a Session in the temp workspace. */
async function agent(ctx: Context, cwd: string): Promise<Agent> {
  const id = SessionId(`pdf-runtime-owner-${++callNumber}`)
  let scope: Scope
  const session = Session.create(id, [], {
    version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd, isSeeded: false,
  })
  const value: Agent = {
    id,
    options: {},
    session,
    model: unsupportedModel(),
    inbox: unsupportedInbox(),
    status: 'idle',
    get ctx() { return scope.ctx },
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, value) }, { inject: ['tools'] }))
  await ctx.agents.register(value)
  return value
}

/** Compose the real services the runtime entry injects, over a temp workspace. */
async function compose(): Promise<{ ctx: Context; owner: Agent; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tool-pdf-runtime-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  provideWorkingDirectoryFixture(ctx, root)
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(LocalAttachmentStore, { dshHome: root })
  await ctx.plugin(ToolPdfRuntime, { maxImages: 2, maxImageBytes: 1024 })
  const owner = await agent(ctx, root)
  return { ctx, owner, root }
}

describe('PDF report runtime entry', () => {
  it('provides the report service without any model-facing tool and removes it on dispose', async () => {
    const { ctx, owner } = await compose()
    expect(ctx.get('pdfReports')).toBeDefined()
    // A tool registry is mounted, so a tool registered by the entry would be visible here.
    expect(ctx.tools.get('pdf_report', owner)).toBeUndefined()
    expect(ctx.tools.schemas(owner).map(schema => schema.name)).not.toContain('pdf_report')

    await ctx.fiber.dispose()

    expect(ctx.get('pdfReports')).toBeUndefined()
  })

  it('rejects invalid assembly limits when it mounts', () => {
    const ctx = new Context()
    const mount = (limits: { maxImages: number; maxImageBytes: number }): void => {
      ToolPdfRuntime.apply(ctx, limits)
    }
    expect(() => { mount({ maxImages: 0, maxImageBytes: 1 }) }).toThrow('positive integer maxImages')
    expect(() => { mount({ maxImages: 1.5, maxImageBytes: 1 }) }).toThrow('positive integer maxImages')
    expect(() => { mount({ maxImages: 1, maxImageBytes: 0 }) }).toThrow('positive integer maxImageBytes')
    expect(() => { mount({ maxImages: 1, maxImageBytes: -1 }) }).toThrow('positive integer maxImageBytes')
  })

  it('refuses an Agent object that is not the registered owner of its Session', async () => {
    const { ctx, owner } = await compose()
    const request = { filePath: 'imposter.pdf', blocks: [{ type: 'text' as const, text: 'x' }] }
    await expect(ctx.pdfReports.create({ ...owner }, request, new AbortController().signal))
      .rejects.toThrow('pdf_report requires the exact live agent Session')
  })
})

describe('skipped-image appendix', () => {
  const blocks: readonly ReportBlock[] = [{ type: 'text', text: 'Отчёт.' }]

  it('keeps the requested blocks when the appendix is not requested', () => {
    const skipped = [{ callId: 'call-missing', reason: 'no tool result carries this call id' }]
    expect(blocksWithSkippedImages(blocks, skipped, false)).toBe(blocks)
  })

  it('names every skipped image and its reason', () => {
    const skipped = [
      { callId: 'call-missing', reason: 'no tool result carries this call id' },
      { callId: 'call-webp', reason: 'unsupported image media type image/webp; only PNG and JPEG embed' },
    ]
    expect(blocksWithSkippedImages(blocks, skipped, true)).toEqual([
      { type: 'text', text: 'Отчёт.' },
      {
        type: 'text',
        heading: 'Images not included',
        text: 'call-missing: no tool result carries this call id\n'
          + 'call-webp: unsupported image media type image/webp; only PNG and JPEG embed',
      },
    ])
  })

  it('appends the appendix to the rendered document only when the request asks for it', async () => {
    const { ctx, owner } = await compose()
    const attachments = ctx.get('attachments')
    if (attachments === undefined) throw new Error('attachment store missing')
    const ref: ImageAttachmentRef = await attachments.saveImage({
      data: PNG_1X1, mediaType: 'image/png', name: 'sheet.png',
    })
    owner.session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('call-sheets'),
        content: [{ type: 'image', attachment: ref }] satisfies ContentBlock[],
        isError: false,
      }),
    }, { surfaceOp: 'append' })

    await ctx.pdfReports.create(owner, {
      filePath: 'without-appendix.pdf',
      blocks: [{ type: 'image', callId: 'call-sheets' }],
    }, new AbortController().signal)
    const without = vi.mocked(buildPdfReport).mock.calls.at(-1)?.[1]
    expect(without).toHaveLength(1)

    await ctx.pdfReports.create(owner, {
      filePath: 'with-appendix.pdf',
      blocks: [{ type: 'image', callId: 'call-missing' }],
      includeSkippedImagesAppendix: true,
    }, new AbortController().signal)
    const withAppendix = vi.mocked(buildPdfReport).mock.calls.at(-1)?.[1]
    expect(withAppendix?.at(-1)).toEqual({
      type: 'text',
      heading: 'Images not included',
      text: 'call-missing: no tool result carries this call id',
    })
  })

  it('writes a valid PDF through the runtime entry', async () => {
    const { ctx, owner, root } = await compose()
    const result = await ctx.pdfReports.create(owner, {
      filePath: 'reports/direct.pdf',
      title: 'Прямой запуск',
      blocks: [{ type: 'text', text: 'Без model turn.' }],
    }, new AbortController().signal)
    expect(result.pages).toBe(1)
    const written = await readFile(join(root, 'reports', 'direct.pdf'))
    expect(written.subarray(0, 4).toString('latin1')).toBe('%PDF')
  })
})
