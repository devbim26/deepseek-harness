/**
 * Attachment-path authorization for document_read: the requested path must be
 * one of the calling Session's generic-file attachments. @module
 * @deepseek-ai/dsh-tool-document/paths
 */

import { basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { DocumentError } from './errors.ts'

/**
 * Collect every generic-file attachment referenced by the Session's logged messages.
 * @param session - calling agent Session.
 * @returns distinct file references in log order.
 */
export function sessionFileReferences(session: Session): FileAttachmentRef[] {
  const seen = new Set<string>()
  const refs: FileAttachmentRef[] = []
  const collect = (blocks: readonly ContentBlock[]): void => {
    for (const block of blocks) {
      if (block.type !== 'file') continue
      const id = String(block.attachment.attachmentId)
      if (seen.has(id)) continue
      seen.add(id)
      refs.push(block.attachment)
    }
  }
  for (const event of session.snapshotEvents()) {
    if (event.type === 'user/message') collect(event.data.content)
    else if (event.type === 'tool/result') collect(event.data.message.content)
  }
  return refs
}

/**
 * Test whether one Session attachment stores the requested path.
 * @param refs - Session file references.
 * @param hostPathOf - resolves one reference to its stored host path.
 * @param processPathOf - resolves one host path to the execution-world path.
 * @param wanted - requested execution-world path.
 * @returns true when a reference stores the requested path.
 */
export async function matchesAttachmentPath(
  refs: readonly FileAttachmentRef[],
  hostPathOf: (ref: FileAttachmentRef) => string | undefined,
  processPathOf: (hostPath: string) => Promise<string>,
  wanted: string,
): Promise<boolean> {
  for (const ref of refs) {
    const hostPath = hostPathOf(ref)
    if (hostPath === undefined) continue
    if (await processPathOf(hostPath) === wanted) return true
  }
  return false
}

/**
 * Resolve a requested path only when it matches a generic-file attachment of the Session.
 * @param ctx - context owning the attachment store and filesystem.
 * @param session - calling agent Session.
 * @param requested - absolute path from the attachment handle.
 * @param signal - cancellation for filesystem resolution.
 * @returns the resolved target of the authorized attachment.
 * @throws a DocumentError with code NOT_AN_ATTACHMENT for every other path.
 */
export async function authorizeAttachmentPath(
  ctx: Context, session: Session, requested: string, signal: AbortSignal,
): Promise<FsTarget> {
  const target = await ctx.fs.resolve(requested, { signal })
  const wanted = ctx.fs.processPath(target)
  const matched = await matchesAttachmentPath(
    sessionFileReferences(session),
    ref => ctx.attachments.fileHostPath(ref),
    async hostPath => ctx.fs.processPath(await ctx.fs.resolve(hostPath, { signal })),
    wanted,
  )
  if (matched) return target
  throw new DocumentError(
    `document_read reads only documents attached to this conversation; "${basename(requested)}" is not one of them.`,
    'NOT_AN_ATTACHMENT',
  )
}
