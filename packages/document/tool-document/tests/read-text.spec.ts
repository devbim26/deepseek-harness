/** document_read over plain-text and CSV attachments, including the path guard. */

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ToolCallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { describe, expect, it } from 'vitest'
import { matchesAttachmentPath } from '../src/paths.ts'
import { renderDocument } from '../src/render.ts'
import { compose } from './support.ts'

describe('document_read text formats', () => {
  it('reads a TXT attachment and reports its size', async () => {
    const { attach, execute } = await compose()
    const text = 'Первая строка\nВторая строка'
    const { hostPath } = await attach('notes.txt', new TextEncoder().encode(text))
    const result = await execute({ path: hostPath })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('document_read failed')
    expect(result.value).toMatchObject({ format: 'txt', text, totalChars: text.length })
  })

  it('reads a CSV attachment as text', async () => {
    const { attach, execute } = await compose()
    const text = 'Позиция;Кол-во\nКирпич;100'
    const { hostPath } = await attach('смета.csv', new TextEncoder().encode(text))
    const result = await execute({ path: hostPath })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('document_read failed')
    expect(result.value).toMatchObject({ format: 'csv', text })
  })

  it('returns a character window and the next offset', async () => {
    const { attach, execute } = await compose({ maxChars: 5 })
    const { hostPath } = await attach('long.txt', new TextEncoder().encode('abcdefghij'))
    const result = await execute({ path: hostPath })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('document_read failed')
    expect(result.value).toMatchObject({ text: 'abcde', totalChars: 10, nextOffset: 5 })
  })

  it('continues from offset', async () => {
    const { attach, execute } = await compose({ maxChars: 5 })
    const { hostPath } = await attach('long.txt', new TextEncoder().encode('abcdefghij'))
    const result = await execute({ path: hostPath, offset: 5 })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('document_read failed')
    expect(result.value).toMatchObject({ text: 'fghij', totalChars: 10 })
    expect((result.value as { nextOffset?: number }).nextOffset).toBeUndefined()
  })

  it('honors an explicit limit below the configured cap', async () => {
    const { attach, execute } = await compose()
    const { hostPath } = await attach('long.txt', new TextEncoder().encode('abcdefghij'))
    const result = await execute({ path: hostPath, limit: 3 })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('document_read failed')
    expect(result.value).toMatchObject({ text: 'abc', nextOffset: 3 })
  })

  it('does not read a path that is not an attachment of this Session', async () => {
    const { root, execute } = await compose()
    const secret = join(root, 'secret.txt')
    await writeFile(secret, 'outside the attachment store')
    const result = await execute({ path: secret })
    expect(result.isError).toBe(true)
  })

  it('skips an attachment whose stored host path is unavailable', async () => {
    const { attach } = await compose()
    const { ref } = await attach('notes.txt', new TextEncoder().encode('text'))
    const matched = await matchesAttachmentPath([ref], () => undefined, async () => '/unused', '/unused')
    expect(matched).toBe(false)
  })

  it('accepts a file reference carried by a tool result', async () => {
    const { session, attach, execute } = await compose()
    const { ref, hostPath } = await attach('tool.txt', new TextEncoder().encode('tool result text'))
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('call-file'),
        content: [{ type: 'text', text: 'saved' }, { type: 'file', attachment: ref }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    const result = await execute({ path: hostPath })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('document_read failed')
    expect(result.value).toMatchObject({ text: 'tool result text' })
  })

  it('rejects an unsupported extension attached to the conversation', async () => {
    const { attach, execute } = await compose()
    const { hostPath } = await attach('photo.png', Uint8Array.from([1, 2, 3]))
    const result = await execute({ path: hostPath })
    expect(result.isError).toBe(true)
  })

  it('rejects a negative page, row, and offset', async () => {
    const { attach, execute } = await compose()
    const { hostPath } = await attach('notes.txt', new TextEncoder().encode('text'))
    expect((await execute({ path: hostPath, page: 0 })).isError).toBe(true)
    expect((await execute({ path: hostPath, row: -1 })).isError).toBe(true)
    expect((await execute({ path: hostPath, offset: -1 })).isError).toBe(true)
  })

  it('requires an agent Session', async () => {
    const { ctx } = await compose()
    const result = await executeToolFixture(ctx, {
      signal: new AbortController().signal,
      callId: ToolCallId('document-no-agent'),
      name: 'document_read',
      arguments: { path: 'any.txt' },
    })
    expect(result.isError).toBe(true)
  })

  it('decodes a windows-1251 text file', async () => {
    const { attach, execute } = await compose()
    const bytes = Uint8Array.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2])
    const { hostPath } = await attach('старый.txt', bytes)
    const result = await execute({ path: hostPath })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('document_read failed')
    expect(result.value).toMatchObject({ text: 'Привет' })
  })

  it('reports a file above maxInputBytes', async () => {
    const { attach, execute } = await compose({ maxInputBytes: 4 })
    const { hostPath } = await attach('big.txt', new TextEncoder().encode('0123456789'))
    expect((await execute({ path: hostPath })).isError).toBe(true)
  })

  it('maps a timeout signal to a document timeout', async () => {
    const { ctx, attach } = await compose()
    const { hostPath } = await attach('notes.txt', new TextEncoder().encode('text'))
    const controller = new AbortController()
    controller.abort(new DOMException('timeout', 'TimeoutError'))
    const result = await executeToolFixture(ctx, {
      signal: controller.signal,
      callId: ToolCallId('document-timeout'),
      name: 'document_read',
      arguments: { path: hostPath },
    })
    expect(result.isError).toBe(true)
  })

  it('rethrows a user abort instead of reporting a timeout', async () => {
    const { ctx, attach } = await compose()
    const { hostPath } = await attach('notes.txt', new TextEncoder().encode('text'))
    const controller = new AbortController()
    controller.abort(new DOMException('stop', 'AbortError'))
    const result = await executeToolFixture(ctx, {
      signal: controller.signal,
      callId: ToolCallId('document-abort'),
      name: 'document_read',
      arguments: { path: hostPath },
    })
    expect(result.isError).toBe(true)
  })

  it('rethrows an abort without a DOMException reason', async () => {
    const { ctx, attach } = await compose()
    const { hostPath } = await attach('notes.txt', new TextEncoder().encode('text'))
    const controller = new AbortController()
    controller.abort(new Error('stop'))
    const result = await executeToolFixture(ctx, {
      signal: controller.signal,
      callId: ToolCallId('document-error-abort'),
      name: 'document_read',
      arguments: { path: hostPath },
    })
    expect(result.isError).toBe(true)
  })

  it('renders a text value without optional location fields', () => {
    const blocks = renderDocument({ path: '/tmp/notes.txt', format: 'txt', bytes: 3, text: 'abc' })
    expect(blocks[0]?.text).toContain('Document "notes.txt"')
  })

  it('renders a sheet value with default location fields', () => {
    const blocks = renderDocument({ path: '/tmp/book.xlsx', format: 'xlsx', bytes: 3, text: '', sheet: 'Лист' })
    expect(blocks[0]?.text).toContain('sheet "Лист" rows 0-0')
  })

  it('renders a page value without a page count', () => {
    const blocks = renderDocument({ path: '/tmp/a.pdf', format: 'pdf', bytes: 3, text: 'abc', page: 1 })
    expect(blocks[0]?.text).toContain('page 1 of 1')
  })
})
