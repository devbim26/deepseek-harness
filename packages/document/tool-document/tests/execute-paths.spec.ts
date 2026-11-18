/** document_read behavior reached through execute and the public tool registry. */

import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { compose } from './support.ts'

/**
 * Stall the authorized read until the caller aborts: the pipeline rejects an
 * already-aborted signal before dispatch, so an abort mid-read is the only
 * path that reaches document_read's own abort classification.
 * @param ctx - context whose filesystem service the tool reads through.
 * @returns a promise that settles once the stalled read is in flight.
 */
function stallReads(ctx: Context): { started: Promise<void> } {
  let started: () => void
  const whenStarted = new Promise<void>((resolve) => { started = resolve })
  ctx.fs.readBytes = (target, signal) => new Promise((_resolve, reject) => {
    void target
    started()
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  return { started: whenStarted }
}

describe('document_read through execute', () => {
  it('accepts a sheet argument on a TXT attachment without changing the result', async () => {
    const { attach, execute } = await compose()
    const { hostPath } = await attach('notes.txt', new TextEncoder().encode('plain'))
    const result = await execute({ path: hostPath, sheet: 'X' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('document_read failed')
    expect(result.value).toMatchObject({ format: 'txt', text: 'plain', totalChars: 5 })
  })

  it('presents the call card from the registered tool definition', async () => {
    const { ctx } = await compose()
    const tool = ctx.tools.get('document_read')
    expect(tool?.presentCall?.({ path: '/work/quarterly report.txt' })).toEqual({
      card: 'generic',
      title: 'Document → quarterly report.txt',
      kind: 'other',
      rawInput: { path: '/work/quarterly report.txt', page: undefined, sheet: undefined },
    })
  })

  it('maps a TimeoutError abort to a timeout failure', async () => {
    const { ctx, attach, agent } = await compose()
    const { hostPath } = await attach('notes.txt', new TextEncoder().encode('text'))
    const { started } = stallReads(ctx)
    const controller = new AbortController()
    const pending = executeToolFixture(ctx, {
      signal: controller.signal,
      callId: ToolCallId('document-timeout'),
      name: 'document_read',
      arguments: { path: hostPath },
      agent,
    })
    await started
    controller.abort(new DOMException('timeout', 'TimeoutError'))
    const result = await pending
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('expected a failure')
    expect(result.error.info).toEqual({ name: 'DocumentError', code: 'TIMEOUT' })
  })

  it('rethrows a user AbortError instead of reporting a timeout', async () => {
    const { ctx, attach, agent } = await compose()
    const { hostPath } = await attach('notes.txt', new TextEncoder().encode('text'))
    const { started } = stallReads(ctx)
    const controller = new AbortController()
    const pending = executeToolFixture(ctx, {
      signal: controller.signal,
      callId: ToolCallId('document-abort'),
      name: 'document_read',
      arguments: { path: hostPath },
      agent,
    })
    await started
    controller.abort(new DOMException('stop', 'AbortError'))
    const result = await pending
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('expected a failure')
    expect(result.error.info?.code).not.toBe('TIMEOUT')
  })

  it('rethrows an abort whose reason is a plain Error', async () => {
    const { ctx, attach, agent } = await compose()
    const { hostPath } = await attach('notes.txt', new TextEncoder().encode('text'))
    const { started } = stallReads(ctx)
    const controller = new AbortController()
    const pending = executeToolFixture(ctx, {
      signal: controller.signal,
      callId: ToolCallId('document-error-abort'),
      name: 'document_read',
      arguments: { path: hostPath },
      agent,
    })
    await started
    controller.abort(new Error('stop'))
    const result = await pending
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('expected a failure')
    expect(result.error.info?.code).not.toBe('TIMEOUT')
  })

  it('authorizes the second of two attachments by its own path', async () => {
    const { attach, execute } = await compose()
    await attach('first.txt', new TextEncoder().encode('one'))
    const second = await attach('second.txt', new TextEncoder().encode('two'))
    const result = await execute({ path: second.hostPath })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('document_read failed')
    expect(result.value).toMatchObject({ text: 'two' })
  })
})
