/**
 * Collect report images from the Session log: the latest `tool/result` of each
 * requested call id supplies its embedded image attachments, read through the
 * durable attachment store. @module @deepseek-ai/dsh-tool-pdf/session-images
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ImageBlock, ToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ReportImage, SkippedImage } from './types.ts'

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
 * Resolve the requested call ids into decoded images through the attachment
 * store, keeping every failure as a per-image skip instead of failing the call.
 * @param ctx - context owning the attachment store.
 * @param session - the calling agent's Session.
 * @param requested - ordered call ids with captions.
 * @param maxImages - ceiling on embedded images; extras are skipped.
 * @param maxImageBytes - per-image byte ceiling; larger images are skipped.
 * @param signal - cancellation for attachment reads.
 * @returns the embedded images and every skip with its reason.
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
  return { images, skipped }
}
