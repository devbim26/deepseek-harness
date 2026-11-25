import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition, CommandInvocation } from '@deepseek-ai/dsh-commands'
import * as SessionLogDownload from '../src/index.ts'

describe('/export and /report Web download commands', () => {
  it('registers one pathless command each and removes them with the plugin fiber', async () => {
    const descriptors = new Map<string, CommandDefinition>()
    const ctx = new Context()
    ctx.provide('commands', {
      register(next: CommandDefinition) {
        descriptors.set(next.name, next)
        return () => { descriptors.delete(next.name) }
      },
    } as never)
    ctx.provide('connection', {
      fetch: { register: () => () => Promise.resolve() },
    } as never)
    const fiber = await ctx.plugin(SessionLogDownload)

    expect(descriptors.get('export')).toMatchObject({
      name: 'export',
      description: 'Download this Session log as a ZIP archive',
    })
    expect(descriptors.get('report')).toMatchObject({
      name: 'report',
      description: 'Download a PDF report of this Session',
    })
    expect(descriptors.get('report')?.definitionId).not.toBe(descriptors.get('export')?.definitionId)

    const invoke = (name: string, rawInput: string) =>
      descriptors.get(name)?.handler({ rawInput } as CommandInvocation)
    await expect(invoke('export', '')).resolves.toEqual({
      kind: 'success', text: 'Session log download requested.',
    })
    await expect(invoke('export', ' output.zip')).resolves.toEqual({
      kind: 'error', text: 'The Web /export command does not accept a path.',
    })
    await expect(invoke('report', '')).resolves.toEqual({
      kind: 'success', text: 'Session PDF report download requested.',
    })
    await expect(invoke('report', ' report.pdf')).resolves.toEqual({
      kind: 'error', text: 'The Web /report command does not accept arguments.',
    })

    await fiber.dispose()
    expect(descriptors.size).toBe(0)
  })
})
