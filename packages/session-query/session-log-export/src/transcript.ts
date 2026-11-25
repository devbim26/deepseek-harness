/**
 * Shared projection of one committed Session log into turns and messages.
 *
 * The Markdown transcript and the PDF report read the same projection, so
 * both exports agree on what a Session visibly contains. The projection is
 * pure: it reads the supplied events, starts no plugin, and mutates nothing.
 * @module
 */

import type {
  AssistantMessage,
  SessionEvent,
  ToolResultMessage,
  UserMessage,
} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import type { FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

/** One committed assistant message inside a turn. */
export interface AssistantEntry {
  readonly kind: 'assistant'
  readonly text: string
  readonly toolCalls: boolean
}

/** One tool call inside a turn and its latest committed result. */
export interface ToolEntry {
  readonly kind: 'tool'
  /** Tool call id the result belongs to. */
  readonly callId: string
  /** Tool name recorded with the call. */
  readonly name: string
  /** Raw JSON arguments recorded with the call. */
  readonly arguments: string
  /** Latest committed result, absent when the call produced none. */
  result: ToolOutcome | undefined
}

/** One committed tool result. */
export interface ToolOutcome {
  /** Readable result text, with attachment labels. */
  readonly text: string
  /** Whether the tool reported a failure. */
  readonly isError: boolean
  /** Failure reason recorded with the result. */
  readonly reason: string | undefined
  /** Number of image blocks the result carried. */
  readonly imageCount: number
}

/** One human user message inside a turn. */
export interface UserSegment {
  readonly kind: 'user'
  readonly text: string
}

/** One entry of a turn. */
export type TurnEntry = AssistantEntry | ToolEntry
/** One message of a turn. */
export type TurnSegment = UserSegment | TurnEntry

/** One turn of the Session, with its messages and its tool calls. */
export interface Turn {
  readonly segments: TurnSegment[]
  readonly calls: Map<string, ToolEntry>
}

/** One fence marker of a Markdown block. */
export interface Fence {
  readonly character: string
  readonly length: number
}

/** One scanned line and whether it belongs to a code block. */
export interface ScannedLine {
  readonly text: string
  readonly code: boolean
}

/** A Markdown scan with its lines and an open fence, if any. */
export interface MarkdownScan {
  readonly lines: readonly ScannedLine[]
  readonly openFence: Fence | undefined
}

/**
 * Group the committed events into turns and their messages.
 *
 * Only append messages count: a compaction surface replacement never removes
 * earlier messages, and fork-inherited history appears once. Reasoning, system
 * and developer messages, injected non-human context, and request records are
 * omitted.
 * @param events - complete committed logical event snapshot in seq order.
 * @returns the turns in chronological order.
 */
export function collectTurns(events: readonly SessionEvent[]): Turn[] {
  const turns: Turn[] = []
  let current: Turn | undefined
  const begin = (): Turn => {
    current = { segments: [], calls: new Map() }
    turns.push(current)
    return current
  }
  const active = (): Turn => current ?? begin()
  for (const event of events) {
    switch (event.type) {
      case 'turn/start':
        begin()
        break
      case 'turn/end':
        current = undefined
        break
      case 'user/message': {
        if (event.surfaceOp !== 'append' || event.data.source.kind !== 'user') break
        const text = visibleContent(event.data.content)
        if (text !== '') active().segments.push({ kind: 'user', text })
        break
      }
      case 'assistant/message': {
        if (event.surfaceOp !== 'append') break
        const message = event.data.message
        const text = assistantText(message)
        const toolCalls = message.content.some(block => block.type === 'tool-call')
        if (trimBlankEdgeLines(text) !== '') active().segments.push({ kind: 'assistant', text, toolCalls })
        break
      }
      case 'tool/call': {
        const turn = active()
        const entry: ToolEntry = {
          kind: 'tool',
          callId: String(event.data.callId),
          name: event.data.name,
          arguments: event.data.arguments,
          result: undefined,
        }
        turn.segments.push(entry)
        turn.calls.set(entry.callId, entry)
        break
      }
      case 'tool/result': {
        if (event.surfaceOp !== 'append') break
        const turn = active()
        const callId = String(event.data.message.toolCallId)
        let entry = turn.calls.get(callId)
        if (entry === undefined) {
          entry = { kind: 'tool', callId, name: 'unknown', arguments: '', result: undefined }
          turn.segments.push(entry)
          turn.calls.set(callId, entry)
        }
        entry.result = toolResultOf(event.data)
        break
      }
      default:
        break
    }
  }
  return turns.filter(turn => turn.segments.length > 0)
}

/**
 * Locate the final reply of a turn.
 *
 * A turn's final reply is its last segment when that segment is an assistant
 * message without tool calls; a turn that ends with tool activity has none.
 * @param segments - the turn's messages.
 * @returns the index of the final reply, or -1 when the turn has none.
 */
export function finalReplyIndex(segments: readonly TurnSegment[]): number {
  const index = segments.length - 1
  const entry = segments[index]
  return entry?.kind === 'assistant' && !entry.toolCalls ? index : -1
}

/**
 * Render message content as readable text.
 *
 * Images and files become readable labels; attachment identifiers and bytes
 * never reach the text.
 * @param content - the committed message content.
 * @returns the readable text.
 */
export function visibleContent(content: UserMessage['content']): string {
  const parts: string[] = []
  for (const block of content) {
    switch (block.type) {
      case 'text':
        if (block.text !== '') parts.push(block.text)
        break
      case 'image':
        parts.push(imageLabel(block.attachment))
        break
      case 'file':
        parts.push(fileLabel(block.attachment))
        break
      default:
        break
    }
  }
  return parts.join('\n\n')
}

/**
 * Read the visible text of a committed assistant message.
 * @param message - the committed assistant message.
 * @returns the readable text.
 */
export function assistantText(message: AssistantMessage): string {
  return visibleContent(message.content)
}

/**
 * Project one committed tool result.
 * @param data - the committed tool result event data.
 * @returns the readable result and its image count.
 */
export function toolResultOf(data: {
  readonly message: ToolResultMessage
  readonly error?: { readonly name: string; readonly code: string; readonly reason?: string }
}): ToolOutcome {
  return {
    text: visibleContent(data.message.content),
    isError: data.message.isError === true,
    reason: data.error?.reason,
    imageCount: data.message.content.filter(block => block.type === 'image').length,
  }
}

/**
 * Remove blank edge lines while preserving interior blank lines and the
 * indentation of the first and last content line.
 * @param text - the text to trim.
 * @returns the trimmed text.
 */
export function trimBlankEdgeLines(text: string): string {
  const lines = text.replace(/\r\n?/gu, '\n').split('\n')
  let start = 0
  let end = lines.length
  while (start < end && lines[start]?.trim() === '') start += 1
  while (end > start && lines[end - 1]?.trim() === '') end -= 1
  return lines.slice(start, end).join('\n')
}

/**
 * Scan fenced and indented code once so fence handling and code detection
 * agree on what is code. This is a narrow Markdown block heuristic, not a
 * parser.
 * @param markdown - the Markdown text to scan.
 * @returns the scanned lines and an unclosed fence, if any.
 */
export function scanMarkdown(markdown: string): MarkdownScan {
  const lines = markdown.replace(/\r\n?/gu, '\n').split('\n')
  const scanned: ScannedLine[] = []
  let fence: Fence | undefined
  let indented = false
  for (const line of lines) {
    if (fence !== undefined) {
      scanned.push({ text: line, code: true })
      if (closesFence(line, fence)) fence = undefined
      continue
    }
    const opening = openingFence(line)
    if (opening !== undefined) {
      fence = opening
      indented = false
      scanned.push({ text: line, code: true })
      continue
    }
    if (/^(?: {4}|\t)/u.test(line)) {
      indented = true
      scanned.push({ text: line, code: true })
      continue
    }
    scanned.push({ text: line, code: indented && line.trim() === '' })
    if (line.trim() !== '') indented = false
  }
  return { lines: scanned, openFence: fence }
}

/**
 * Read the fence a line opens.
 * @param line - the candidate line.
 * @returns the fence it opens, or undefined.
 */
export function openingFence(line: string): Fence | undefined {
  const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line)
  if (opening === null) return undefined
  const marker = String(opening[1])
  const info = String(opening[2])
  if (marker.startsWith('`') && info.includes('`')) return undefined
  return { character: marker.slice(0, 1), length: marker.length }
}

/**
 * Read whether a line closes a fence.
 * @param line - the candidate line.
 * @param fence - the open fence.
 * @returns whether the line closes it.
 */
export function closesFence(line: string, fence: Fence): boolean {
  const closing = new RegExp(`^ {0,3}${fence.character}{${String(fence.length)},}\\s*$`, 'u')
  return closing.test(line)
}

/**
 * Close a message that ended inside a code fence so the next message or
 * generated closer cannot be swallowed by that block.
 * @param markdown - the Markdown text.
 * @returns the text with a closing fence appended when one is missing.
 */
export function closeUnfinishedFence(markdown: string): string {
  const scan = scanMarkdown(markdown)
  if (scan.openFence === undefined) return markdown
  const content = markdown.replace(/\n+$/u, '')
  return `${content}\n${scan.openFence.character.repeat(scan.openFence.length)}`
}

/**
 * Label one image attachment for a human-readable transcript.
 * @param ref - the committed image reference.
 * @returns the readable label.
 */
export function imageLabel(ref: ImageAttachmentRef): string {
  return `[Image: ${labelName(ref.name)} (${String(ref.width)}×${String(ref.height)}, ${String(ref.bytes)} bytes)]`
}

/**
 * Label one file attachment for a human-readable transcript.
 * @param ref - the committed file reference.
 * @returns the readable label.
 */
export function fileLabel(ref: FileAttachmentRef): string {
  return `[File: ${labelName(ref.name)} (${String(ref.bytes)} bytes)]`
}

/**
 * Normalize an attachment name for a readable label.
 * @param name - the committed attachment name.
 * @returns the label text.
 */
export function labelName(name: string | undefined): string {
  const normalized = name?.replace(/\s+/gu, ' ').replace(/\]/gu, '\\]').trim() ?? ''
  return normalized === '' ? 'attachment' : normalized
}
