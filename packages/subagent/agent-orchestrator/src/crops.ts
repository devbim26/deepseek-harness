/**
 * Resolution of the crop links a worker report carries into the report's
 * images. A worker names a crop as a Markdown image link that points at the
 * durable attachment store; the Session log knows which tool call produced
 * that attachment, so the report can embed the crop itself instead of its
 * path. @module @deepseek-ai/dsh-agent-orchestrator/crops
 */
import type { Session } from '@deepseek-ai/dsh-session'
import type { ReportBlock } from '@deepseek-ai/dsh-tool-pdf/types'

/** One crop a report's link named, resolved to the call that produced it. */
export interface ResolvedCrop {
  /** Call id of the tool result whose attachment the link names. */
  readonly callId: string
  /** Link text, printed under the image. */
  readonly caption: string
}

/** Crops resolved from one text, and that text without their links. */
export interface CropResolution {
  /** Crops in the order their links appeared. */
  readonly crops: readonly ResolvedCrop[]
  /** The text with every resolved link removed. */
  readonly text: string
}

/** Markdown image link: its text and the destination it names. */
const MARKDOWN_IMAGE_LINK = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?\s*\)/g

/** Durable-store object path: `objects/<first two hex digits>/<sha256 hex>`. */
const STORED_OBJECT_PATH = /\/objects\/[0-9a-f]{2}\/([0-9a-f]{64})\/?$/i

/**
 * Read the attachment id a Markdown link destination names.
 *
 * A durable store lays an object out as `objects/<xx>/<sha256 hex>`, so the
 * link's last path segment carries the id the Session log records. A
 * destination that names no stored object — a remote address, a document, or a
 * path outside the store — resolves to nothing.
 * @param destination - the link destination as written.
 * @returns the attachment id, or `undefined` when the destination names no stored object.
 */
export function attachmentIdFromDestination(destination: string): string | undefined {
  const hash = STORED_OBJECT_PATH.exec(decodeURIComponent(destination))?.[1]
  if (hash === undefined) return undefined
  return `sha256:${hash}`
}

/**
 * Index the Session's image results by the attachment id they carry.
 *
 * The latest committed result of a call wins, matching what the model saw.
 * @param session - the Session holding the tool results.
 * @returns attachment id to call id, for every image the Session carries.
 */
export function imageCallsByAttachment(session: Session): Map<string, string> {
  const byAttachment = new Map<string, string>()
  for (const event of session.snapshotEvents()) {
    if (event.type !== 'tool/result') continue
    const message = event.data.message
    for (const block of message.content) {
      if (block.type !== 'image') continue
      byAttachment.set(String(block.attachment.attachmentId), message.toolCallId)
    }
  }
  return byAttachment
}

/**
 * Resolve the crop links of one text against the Session's images.
 *
 * A link that names a stored attachment the Session actually produced becomes
 * a crop, and its text leaves the report because the image carries the link
 * text as its caption. A link that names nothing stays in the text, so no
 * reference is lost.
 * @param session - the Session holding the tool results.
 * @param text - the report text.
 * @returns the resolved crops and the text without their links.
 */
export function resolveCropLinks(session: Session, text: string): CropResolution {
  const byAttachment = imageCallsByAttachment(session)
  const crops: ResolvedCrop[] = []
  const remaining = text.replace(MARKDOWN_IMAGE_LINK, (whole: string, alt: string, destination: string) => {
    const attachmentId = attachmentIdFromDestination(destination)
    if (attachmentId === undefined) return whole
    const callId = byAttachment.get(attachmentId)
    if (callId === undefined) return whole
    crops.push({ callId, caption: alt })
    return ''
  })
  return { crops, text: remaining }
}

/** A list marker left without its item, which a removed crop link leaves behind. */
const EMPTY_LIST_ITEM = /^\s*[-*+]\s*$/u

/**
 * Replace the crop links of one text block with the images they name.
 *
 * The text keeps its place and the images follow it, so a crop appears under
 * the paragraph that introduced it. A list item that carried only a link
 * loses its marker, so the report shows no empty bullet.
 * @param session - the Session holding the tool results.
 * @param block - the text block to expand.
 * @returns the text block without its crop links, followed by the crop images.
 */
export function expandCropLinks(session: Session, block: ReportBlock): ReportBlock[] {
  if (block.type !== 'text') return [block]
  const { crops, text } = resolveCropLinks(session, block.text)
  if (crops.length === 0) return [block]
  const images: ReportBlock[] = crops.map(crop => ({
    type: 'image',
    callId: crop.callId,
    caption: crop.caption,
  }))
  const cleaned = text.split('\n').filter(line => !EMPTY_LIST_ITEM.test(line)).join('\n')
  return [{ ...block, text: cleaned }, ...images]
}
