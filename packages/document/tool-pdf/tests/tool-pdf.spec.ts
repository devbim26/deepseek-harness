/** End-to-end pdf_report execution over real services in a temp workspace. */

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
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { mkdtemp, mkdir, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as ToolPdf from '../src/index.ts'

const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  char => char.charCodeAt(0),
)

const cleanups: Array<() => Promise<unknown>> = []
let callNumber = 0
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
  vi.restoreAllMocks()
})

async function agent(ctx: Context, cwd: string): Promise<Agent> {
  const id = SessionId(`pdf-owner-${++callNumber}`)
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

interface Setup {
  ctx: Context
  owner: Agent
  root: string
  fiber: unknown
  execute: (args: Record<string, unknown>) => Promise<ToolExecutionResult>
}

/** Compose the real services the tool injects, over a temp workspace. */
async function compose(): Promise<Setup> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tool-pdf-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  provideWorkingDirectoryFixture(ctx, root)
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(LocalAttachmentStore, { dshHome: root })
  const fiber = ctx.plugin(ToolPdf, { maxImages: 2, maxImageBytes: 1024 })
  await fiber
  const owner = await agent(ctx, root)
  const execute = (args: Record<string, unknown>) => executeToolFixture(ctx, {
    signal: new AbortController().signal, callId: ToolCallId(`pdf-${++callNumber}`),
    name: 'pdf_report', arguments: args, agent: owner,
  })
  return { ctx, owner, root, fiber, execute }
}

describe('pdf_report', () => {
  it('writes a text-only report into the workspace and observes the mutation', async () => {
    const { ctx, root, execute } = await compose()
    const observations: unknown[] = []
    ctx.on('fs/observed', (target) => {
      observations.push(target)
      return undefined
    })
    const result = await execute({
      file_path: 'отчёт.pdf',
      title: 'Отчёт по чертежам',
      blocks: [{ type: 'text', heading: 'Состав', text: 'Текст отчёта.' }],
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('pdf_report failed')
    const value = result.value as { path: string; pages: number; imagesEmbedded: number; imagesSkipped: unknown[] }
    expect(value.path).toBe(await realpath(join(root, 'отчёт.pdf')))
    expect(value.pages).toBe(1)
    expect(value.imagesEmbedded).toBe(0)
    expect(value.imagesSkipped).toEqual([])
    const written = await readFile(join(root, 'отчёт.pdf'))
    expect(written.subarray(0, 4).toString('latin1')).toBe('%PDF')
    expect(observations).toHaveLength(1)
  })

  it('embeds images from a prior tool result stored as attachments', async () => {
    const { ctx, owner, execute } = await compose()
    const attachments = ctx.get('attachments')
    if (attachments === undefined) throw new Error('attachment store missing')
    const ref: ImageAttachmentRef = await attachments.saveImage({
      data: PNG_1X1, mediaType: 'image/png', name: 'sheet.png',
    })
    owner.session.append('tool/result', {
      turn: 1, step: 1, message: createToolResultMessage({
        callId: ToolCallId('call-sheets'),
        content: [{ type: 'text', text: 'sheets' }, { type: 'image', attachment: ref }] satisfies ContentBlock[],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    const result = await execute({
      file_path: 'report.pdf',
      blocks: [
        { type: 'text', text: 'Состав документа.' },
        { type: 'image', call_id: 'call-sheets', caption: 'Лист 38' },
      ],
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('pdf_report failed')
    expect(result.value).toMatchObject({ imagesEmbedded: 1, imagesSkipped: [], pages: 1 })
  })

  it('reports skipped images instead of failing when a call id is unknown', async () => {
    const { execute } = await compose()
    const result = await execute({
      file_path: 'report.pdf',
      blocks: [{ type: 'image', call_id: 'call-missing' }],
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('pdf_report failed')
    expect(result.value).toMatchObject({
      imagesEmbedded: 0,
      imagesSkipped: [{ callId: 'call-missing', reason: 'no tool result carries this call id' }],
    })
  })

  it('lists available image calls when a requested id carries no image', async () => {
    const { ctx, owner, execute } = await compose()
    const attachments = ctx.get('attachments')
    if (attachments === undefined) throw new Error('attachment store missing')
    const ref: ImageAttachmentRef = await attachments.saveImage({
      data: PNG_1X1, mediaType: 'image/png', name: 'sheet.png',
    })
    owner.session.append('tool/result', {
      turn: 1, step: 1, message: createToolResultMessage({
        callId: ToolCallId('call-text'),
        content: [{ type: 'text', text: 'no images here' }] satisfies ContentBlock[],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    owner.session.append('tool/result', {
      turn: 1, step: 1, message: createToolResultMessage({
        callId: ToolCallId('call-sheets'),
        content: [{ type: 'image', attachment: ref }, { type: 'image', attachment: ref }] satisfies ContentBlock[],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    const result = await execute({
      file_path: 'report.pdf',
      blocks: [{ type: 'image', call_id: 'call-missing' }],
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('pdf_report failed')
    expect(result.value).toMatchObject({
      imagesEmbedded: 0,
      imagesSkipped: [{ callId: 'call-missing', reason: 'no tool result carries this call id' }],
      availableImageCalls: [{ callId: 'call-sheets', images: 2 }],
    })
  })

  it('creates nested output folders before writing', async () => {
    const { root, execute } = await compose()
    const result = await execute({
      file_path: 'reports/nested/отчёт.pdf',
      blocks: [{ type: 'text', text: 'Текст отчёта.' }],
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('pdf_report failed')
    const written = await readFile(join(root, 'reports', 'nested', 'отчёт.pdf'))
    expect(written.subarray(0, 4).toString('latin1')).toBe('%PDF')
  })

  it('fails the call for a non-pdf output path, an empty block list, and blank text', async () => {
    const { execute } = await compose()
    expect((await execute({ file_path: 'report.docx', blocks: [{ type: 'text', text: 'x' }] })).isError).toBe(true)
    expect((await execute({ file_path: 'report.pdf', blocks: [] })).isError).toBe(true)
    expect((await execute({ file_path: 'report.pdf', blocks: [{ type: 'text', text: '   ' }] })).isError).toBe(true)
  })

  it('requires an agent session', async () => {
    const { ctx } = await compose()
    const result = await executeToolFixture(ctx, {
      signal: new AbortController().signal, callId: ToolCallId(`pdf-root-${++callNumber}`),
      name: 'pdf_report', arguments: { file_path: 'a.pdf', blocks: [{ type: 'text', text: 'x' }] },
    })
    expect(result.isError).toBe(true)
  })

  it('honors a createIfAbsent policy intent over an existing file', async () => {
    const { ctx, execute } = await compose()
    expect((await execute({ file_path: 'exists.pdf', blocks: [{ type: 'text', text: 'first' }] })).isError).toBe(false)
    await ctx.plugin(Object.assign((inner: Context) => {
      inner.on('fs/write-intent', async (_target, _actor, next) => {
        void next()
        return { kind: 'createIfAbsent' }
      })
    }, { inject: [] }))
    const second = await execute({ file_path: 'exists.pdf', blocks: [{ type: 'text', text: 'second' }] })
    expect(second.isError).toBe(true)
  })

  it('validates assembly limits loudly at apply time', () => {
    expect(() => ToolPdf.apply(new Context(), { maxImages: 0, maxImageBytes: 1 })).toThrow('positive integer maxImages')
    expect(() => ToolPdf.apply(new Context(), { maxImages: 1, maxImageBytes: 0 })).toThrow('positive integer maxImageBytes')
  })

  it('rejects blank call ids and unsupported block discriminants', async () => {
    const { execute } = await compose()
    expect((await execute({ file_path: 'a.pdf', blocks: [{ type: 'image', call_id: '  ' }] })).isError).toBe(true)
    expect((await execute({ file_path: 'a.pdf', blocks: [{ type: 'divider', text: 'x' }] })).isError).toBe(true)
  })

  it('writes tabular data as a styled table and rejects tables without header or rows', async () => {
    const { root, execute } = await compose()
    const ok = await execute({
      file_path: 'смета.pdf',
      blocks: [
        { type: 'text', text: 'Состав работ.' },
        { type: 'table', header: ['Наименование', 'Кол-во', 'Сумма'], rows: [
          ['Монтаж розетки', '12', '7 200.00'],
          ['Прокладка кабеля', '85'],
        ] },
      ],
    })
    expect(ok.isError).toBe(false)
    if (ok.isError) throw new Error('pdf_report failed')
    expect(ok.value).toMatchObject({ pages: 1, imagesEmbedded: 0 })
    const written = await readFile(join(root, 'смета.pdf'))
    expect(written.subarray(0, 4).toString('latin1')).toBe('%PDF')
    expect((await execute({ file_path: 'a.pdf', blocks: [{ type: 'table', rows: [['x']] }] })).isError).toBe(true)
    expect((await execute({ file_path: 'a.pdf', blocks: [{ type: 'table', header: [] , rows: [['x']] }] })).isError).toBe(true)
    expect((await execute({ file_path: 'a.pdf', blocks: [{ type: 'table', header: ['A'] }] })).isError).toBe(true)
    expect((await execute({ file_path: 'a.pdf', blocks: [{ type: 'table', header: ['A'], rows: [] }] })).isError).toBe(true)
  })

  it('rejects a non-file target path', async () => {
    const { root, execute } = await compose()
    await mkdir(join(root, 'folder.pdf'))
    const result = await execute({ file_path: 'folder.pdf', blocks: [{ type: 'text', text: 'x' }] })
    expect(result.isError).toBe(true)
  })

  it('fails when the written report is not readable as a regular file', async () => {
    const { ctx, execute } = await compose()
    const realStat = ctx.fs.stat.bind(ctx.fs)
    let calls = 0
    vi.spyOn(ctx.fs, 'stat').mockImplementation((target, signal) => {
      calls += 1
      return calls === 2 ? Promise.resolve(undefined) : realStat(target, signal)
    })
    const result = await execute({ file_path: 'gone.pdf', blocks: [{ type: 'text', text: 'x' }] })
    expect(result.isError).toBe(true)
  })

  it('renders a generic call card naming the target path', async () => {
    const { owner } = await compose()
    const tool = owner.ctx.tools.get('pdf_report', owner)
    if (tool === undefined || tool.presentCall === undefined) throw new Error('pdf_report definition missing')
    const view = tool.presentCall({ file_path: 'a.pdf', blocks: [{ type: 'text', text: 'x' }] })
    expect(view).toMatchObject({ card: 'generic', kind: 'other' })
    expect(view?.title).toContain('a.pdf')
  })
})
