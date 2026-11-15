/** Image collection from the Session log through the attachment store. */

import { Context } from '@deepseek-ai/cordis'
import { ToolCallId, createToolResultMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectReportImages, latestImageBlocks, type RequestedImage } from '../src/session-images.ts'

const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  char => char.charCodeAt(0),
)

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

/** One context with the local attachment store under a fresh home. */
async function storeContext(): Promise<Context> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-tool-pdf-attachments-'))
  cleanups.push(() => rm(home, { recursive: true, force: true }))
  const ctx = new Context()
  await ctx.plugin(LocalAttachmentStore, { dshHome: home })
  return ctx
}

/** One Session with the given tool results committed in order. */
function sessionWithResults(results: Array<{ callId: ToolCallId; content: ContentBlock[] }>): Session {
  const id = SessionId('pdf-images-fixture')
  const session = Session.create(id, [], {
    version: SESSION_FORMAT_VERSION, id, createdAt: 0, isSeeded: false,
  })
  for (const [index, result] of results.entries()) {
    session.append('tool/result', {
      turn: 1, step: index + 1, message: createToolResultMessage({
        callId: result.callId, content: result.content, isError: false,
      }),
    }, { surfaceOp: 'append' })
  }
  return session
}

/** A stored PNG ref and its decoded ref metadata. */
async function savePng(ctx: Context): Promise<ImageAttachmentRef> {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) throw new Error('attachment store missing')
  return attachments.saveImage({ data: PNG_1X1, mediaType: 'image/png', name: 'sheet.png' })
}

const SIGNAL = new AbortController().signal

describe('latestImageBlocks', () => {
  it('keeps the latest result per call id and collects image blocks in order', () => {
    const session = sessionWithResults([
      { callId: ToolCallId('call-1'), content: [{ type: 'text', text: 'preamble' }] },
      { callId: ToolCallId('call-2'), content: [{ type: 'text', text: 'earlier' }] },
      { callId: ToolCallId('call-2'), content: [{
        type: 'image',
        attachment: { attachmentId: 'a2' as ImageAttachmentRef['attachmentId'], mediaType: 'image/png', bytes: 1, width: 1, height: 1 },
      }] },
    ])
    const blocks = latestImageBlocks(session, ['call-1', 'call-2'])
    expect(blocks.get('call-1')).toEqual([])
    expect(blocks.get('call-2')).toHaveLength(1)
  })
})

describe('collectReportImages', () => {
  it('reads every image of the requested calls through the attachment store', async () => {
    const ctx = await storeContext()
    const ref = await savePng(ctx)
    const session = sessionWithResults([
      { callId: ToolCallId('call-a'), content: [{ type: 'image', attachment: ref }] },
      { callId: ToolCallId('call-b'), content: [{ type: 'image', attachment: ref }, { type: 'image', attachment: ref }] },
    ])
    const requested: RequestedImage[] = [
      { callId: 'call-a', caption: 'Лист 38' },
      { callId: 'call-b' },
    ]
    const { images, skipped } = await collectReportImages(ctx, session, requested, 50, 1024, SIGNAL)
    expect(skipped).toEqual([])
    expect(images).toHaveLength(3)
    expect(images[0]).toMatchObject({ callId: 'call-a', mediaType: 'image/png', caption: 'Лист 38' })
    expect(images[0].data.byteLength).toBeGreaterThan(0)
  })

  it('skips unknown call ids, imageless results, unsupported media, and oversize images', async () => {
    const ctx = await storeContext()
    const ref = await savePng(ctx)
    const webpRef: ImageAttachmentRef = { ...ref, mediaType: 'image/webp' }
    const bigRef: ImageAttachmentRef = { ...ref, bytes: 4096 }
    const session = sessionWithResults([
      { callId: ToolCallId('call-text'), content: [{ type: 'text', text: 'no images here' }] },
      { callId: ToolCallId('call-webp'), content: [{ type: 'image', attachment: webpRef }] },
      { callId: ToolCallId('call-big'), content: [{ type: 'image', attachment: bigRef }] },
      { callId: ToolCallId('call-other'), content: [{ type: 'image', attachment: ref }] },
    ])
    const requested: RequestedImage[] = [
      { callId: 'call-missing' },
      { callId: 'call-text' },
      { callId: 'call-webp' },
      { callId: 'call-big' },
      { callId: 'call-a' },
    ]
    const { images, skipped } = await collectReportImages(ctx, session, requested, 50, 1024, SIGNAL)
    expect(images).toEqual([])
    expect(skipped).toEqual([
      { callId: 'call-missing', reason: 'no tool result carries this call id' },
      { callId: 'call-text', reason: 'the result of this call carries no images' },
      { callId: 'call-webp', reason: 'unsupported image media type image/webp; only PNG and JPEG embed' },
      { callId: 'call-big', reason: 'image exceeds the configured 1024-byte limit' },
      { callId: 'call-a', reason: 'no tool result carries this call id' },
    ])
  })

  it('enforces the embedded image ceiling per call', async () => {
    const ctx = await storeContext()
    const ref = await savePng(ctx)
    const session = sessionWithResults([
      { callId: ToolCallId('call-many'), content: [
        { type: 'image', attachment: ref },
        { type: 'image', attachment: ref },
        { type: 'image', attachment: ref },
      ] },
    ])
    const { images, skipped } = await collectReportImages(
      ctx, session, [{ callId: 'call-many' }], 2, 1024, SIGNAL,
    )
    expect(images).toHaveLength(2)
    expect(skipped).toEqual([
      { callId: 'call-many', reason: 'the report already embeds the configured maximum of 2 images' },
    ])
  })

  it('skips every request when no attachment service is mounted', async () => {
    const ctx = new Context()
    const session = sessionWithResults([{ callId: ToolCallId('call-a'), content: [{ type: 'text', text: 'x' }] }])
    const { images, skipped } = await collectReportImages(ctx, session, [{ callId: 'call-a' }], 50, 1024, SIGNAL)
    expect(images).toEqual([])
    expect(skipped).toEqual([{ callId: 'call-a', reason: 'no attachment service is mounted' }])
  })
})
