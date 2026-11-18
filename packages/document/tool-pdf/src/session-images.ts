/**
 * Collect report images from the Session log: the latest `tool/result` of each
 * requested call id supplies its embedded image attachments, read through the
 * durable attachment store. @module @deepseek-ai/dsh-tool-pdf/session-images
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ImageBlock, ToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { AvailableImageCall, ReportImage, SkippedImage } from './types.ts'

/** An ordered image request from the calling tool: one call id and its caption. */
export interface RequestedImage {
  /** Tool call id whose result carried the images; every image of the result embeds. */
  callId: string
  /** Optional caption printed under each embedded image of the call. */
  caption?: string
}

/** Collected images plus every skip with its reason. */
export interface CollectedImages {
  /** Embedded images in requested order. */
  images: ReportImage[]
  /** Requested images absent from the document, with reasons. */
  skipped: SkippedImage[]
  /** Session calls whose results carry images, for skip feedback. */
  available: AvailableImageCall[]
}

/**
 * Read the latest image blocks per call id from the Session surface events.
 * Retried or replaced results project only through their latest committed
 * event, which is the one the model saw.
 * @param session - the calling agent's Session.
 * @param callIds - requested call ids.
 * @returns image blocks keyed by call id, in the message's block order.
 */
export function latestImageBlocks(
  session: Session,
  callIds: readonly string[],
): Map<string, readonly ImageBlock[]> {
  const wanted = new Set(callIds)
  const found = new Map<string, readonly ImageBlock[]>()
  for (const event of session.snapshotEvents()) {
    if (event.type !== 'tool/result') continue
    const message: ToolResultMessage = event.data.message
    if (!wanted.has(message.toolCallId)) continue
    found.set(message.toolCallId, message.content.filter((block): block is ImageBlock => block.type === 'image'))
  }
  return found
}

/**
 * Index every tool call whose latest result carries images, so a skip can name
 * the ids the model can actually pass.
 * @param session - the calling agent's Session.
 * @returns image-bearing call ids with image counts, in log order.
 */
export function imageCallIndex(session: Session): AvailableImageCall[] {
  const found = new Map<string, number>()
  for (const event of session.snapshotEvents()) {
    if (event.type !== 'tool/result') continue
    const message: ToolResultMessage = event.data.message
    const count = message.content.filter((block): block is ImageBlock => block.type === 'image').length
    if (count > 0) found.set(message.toolCallId, count)
  }
  return [...found].map(([callId, images]) => ({ callId, images }))
}

/**
 * Resolve the requested call ids into decoded images through the attachment
 * store, keeping every failure as a per-image skip instead of failing the call.
 * @param ctx - context owning the attachment store.
 * @param session - the calling agent's Session.
 * @param requested - ordered call ids with captions.
 * @param maxImages - ceiling on embedded images; extras are skipped.
 * @param maxImageBytes - per-image byte ceiling; larger images are skipped.
 * @param signal - cancellation for attachment reads.
 * @returns the embedded images, every skip with its reason, and the available
 *   image calls for retry feedback.
 */
export async function collectReportImages(
  ctx: Context,
  session: Session,
  requested: readonly RequestedImage[],
  maxImages: number,
  maxImageBytes: number,
  signal: AbortSignal,
): Promise<CollectedImages> {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) {
    return {
      images: [],
      skipped: requested.map(({ callId }) => ({ callId, reason: 'no attachment service is mounted' })),
      available: [],
    }
  }
  const blocks = latestImageBlocks(session, requested.map(({ callId }) => callId))
  const images: ReportImage[] = []
  const skipped: SkippedImage[] = []
  for (const { callId, caption } of requested) {
    const callBlocks = blocks.get(callId)
    if (callBlocks === undefined) {
      skipped.push({ callId, reason: 'no tool result carries this call id' })
      continue
    }
    if (callBlocks.length === 0) {
      skipped.push({ callId, reason: 'the result of this call carries no images' })
      continue
    }
    for (const block of callBlocks) {
      if (images.length >= maxImages) {
        skipped.push({ callId, reason: `the report already embeds the configured maximum of ${maxImages} images` })
        continue
      }
      if (block.attachment.mediaType !== 'image/png' && block.attachment.mediaType !== 'image/jpeg') {
        skipped.push({ callId, reason: `unsupported image media type ${block.attachment.mediaType}; only PNG and JPEG embed` })
        continue
      }
      if (block.attachment.bytes > maxImageBytes) {
        skipped.push({ callId, reason: `image exceeds the configured ${maxImageBytes}-byte limit` })
        continue
      }
      const stored = await attachments.readImage(block.attachment, signal)
      images.push({
        callId,
        data: stored.data,
        mediaType: block.attachment.mediaType,
        ...caption !== undefined ? { caption } : {},
      })
    }
  }
  return { images, skipped, available: imageCallIndex(session) }
}
