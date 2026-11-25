/**
 * Pure backend converter for one complete committed Session log. The Session
 * Markdown copy Host route uses it, and the package entry exports it for
 * callers that already hold the logical events. The raw log is authoritative:
 * compaction surface replacements never remove earlier messages, and
 * fork-inherited history appears once. Reasoning, system and developer
 * messages, injected non-human context, request headers, and runtime records
 * are omitted.
 * @module
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  closeUnfinishedFence,
  collectTurns,
  finalReplyIndex,
  scanMarkdown,
  trimBlankEdgeLines,
  type AssistantEntry,
  type ToolEntry,
} from './transcript.ts'

/** Heading used when the log carries no title and the Session has no name. */
const UNTITLED_SESSION_MARKDOWN_TITLE = 'Untitled Session'

/**
 * Render one complete committed Session log as Markdown. This is a pure backend
 * utility: it needs no mounted plugin, reads no storage, and does not mutate the
 * supplied events. The latest `session/title` event supplies the heading; the
 * rest of the transcript is derived only from the supplied logical events.
 * @param events - complete committed logical event snapshot in seq order, including any inherited prefix.
 * @param sourcePath - optional backend-resolved path to the selected Session artifact; emitted verbatim in a fenced text block.
 * @returns Markdown ending in exactly one newline; an empty log returns the heading and optional source metadata only.
 */
export function formatSessionMarkdown(events: readonly SessionEvent[], sourcePath?: string): string {
  const title = events.findLast(event => event.type === 'session/title')?.data.title
  const sections = [`# ${normalizedTitle(title)}`]
  if (sourcePath !== undefined && sourcePath !== '') {
    sections.push(`Session file:

${fenced(sourcePath, 'text', false)}`)
  }
  for (const turn of collectTurns(events)) {
    const finalIndex = finalReplyIndex(turn.segments)
    const end = finalIndex < 0 ? turn.segments.length : finalIndex
    let pending: (AssistantEntry | ToolEntry)[] = []
    for (const segment of turn.segments.slice(0, end)) {
      if (segment.kind === 'user') {
        if (pending.length > 0) {
          sections.push(collapsibleSection(pending))
          pending = []
        }
        sections.push(quote(segment.text))
      } else {
        pending.push(segment)
      }
    }
    if (pending.length > 0) sections.push(collapsibleSection(pending))
    const final = turn.segments[finalIndex]
    const finalText = final?.kind === 'assistant'
      ? closeUnfinishedFence(trimBlankEdgeLines(final.text))
      : ''
    if (finalText !== '') sections.push(finalText)
  }
  return `${sections.join('\n\n').trimEnd()}\n`
}

function normalizedTitle(title: string | undefined): string {
  const line = title?.replace(/\r\n?|\n/gu, ' ').trim() ?? ''
  return line === '' ? UNTITLED_SESSION_MARKDOWN_TITLE : line
}

function collapsibleSection(entries: readonly (AssistantEntry | ToolEntry)[]): string {
  const summary = entries.length === 1 ? '1 previous message' : `${String(entries.length)} previous messages`
  const body = entries.map(renderEntry).join('\n\n')
  return `<details><summary>${summary}</summary>\n\n${body}\n\n</details>`
}

function renderEntry(entry: AssistantEntry | ToolEntry): string {
  if (entry.kind === 'assistant') {
    const text = escapeWrapperTagsOutsideFences(
      closeUnfinishedFence(trimBlankEdgeLines(entry.text)),
    )
    return `**Assistant**\n\n${text}`
  }
  const heading = `**Tool: \`${escapeWrapperTags(entry.name)}\`**`
  const argumentsText = entry.arguments === ''
    ? '(no arguments)'
    : fenced(jsonArguments(entry.arguments), 'json')
  const result = entry.result
  const resultHeading = result?.isError === true ? '**Result (error)**' : '**Result**'
  let resultBody = ''
  if (result === undefined) {
    resultBody = '(no result recorded)'
  } else if (result.reason !== undefined && result.reason !== '') {
    resultBody = `Error: ${escapeWrapperTags(result.reason)}`
    if (result.text !== '') resultBody += `\n\n${fenced(result.text)}`
  } else if (result.text === '') {
    resultBody = '(no output)'
  } else {
    resultBody = fenced(result.text)
  }
  return `${heading}\n\n${argumentsText}\n\n${resultHeading}\n\n${resultBody}`
}

function quote(text: string): string {
  const normalized = text.replace(/\r\n?/gu, '\n').replace(/\n+$/u, '')
  return normalized.split('\n').map(line => line === '' ? '>' : `> ${line}`).join('\n')
}

function jsonArguments(argumentsText: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(argumentsText)
  } catch {
    return argumentsText
  }
  return JSON.stringify(parsed, null, 2)
}

function fenced(text: string, language = '', trimTrailing = true): string {
  const content = trimTrailing ? text.replace(/\n+$/u, '') : text
  let longest = 0
  for (const match of content.matchAll(/`+/gu)) longest = Math.max(longest, match[0].length)
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}${language}\n${content}\n${fence}`
}

// Arbitrary commentary inside a generated details section must not close the
// wrapper. Fenced and indented code keep their exact text.
function escapeWrapperTagsOutsideFences(markdown: string): string {
  return scanMarkdown(markdown).lines
    .map(line => line.code ? line.text : escapeWrapperTags(line.text))
    .join('\n')
}

function escapeWrapperTags(text: string): string {
  return text.replace(/<(?=\/?(?:details|summary)(?=[\s/>]))/giu, '&lt;')
}
