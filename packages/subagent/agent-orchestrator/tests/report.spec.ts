import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PdfReports } from '@deepseek-ai/dsh-tool-pdf/types'
import { AgentOrchestrationRunId } from '../src/index.ts'
import { createOrchestrationPdf, orchestrationReportBlocks } from '../src/report.ts'
import type { AgentOrchestrationResult } from '../src/types.ts'

const agent = {} as Agent

function result(status: AgentOrchestrationResult['status']): AgentOrchestrationResult {
  return {
    id: AgentOrchestrationRunId('orchestration-test'),
    status,
    objective: 'Inspect',
    rounds: 1,
    summary: 'summary',
    workers: [
      { assignmentId: 'complete', rounds: 1, report: { summary: 'worker summary', evidence: ['proof'], assumptions: ['assumption'], gaps: ['gap'] } },
      { assignmentId: 'failed', rounds: 1, error: 'worker error' },
      { assignmentId: 'missing', rounds: 0 },
    ],
    assumptions: ['overall assumption'],
    gaps: ['overall gap'],
    errors: ['overall error'],
  }
}

describe('orchestration reports', () => {
  it('retains all result blocks and marks incomplete outcomes', () => {
    const blocks = orchestrationReportBlocks({ title: 'Report', details: [{ label: 'House', value: '12' }] }, result('partial'))
    expect(blocks[0]).toMatchObject({ heading: 'Неполный результат', text: 'Статус: partial' })
    expect(blocks).toContainEqual(expect.objectContaining({ type: 'table', header: ['Параметр', 'Значение'] }))
    for (const heading of ['Сводка', 'Доказательства', 'Допущения', 'Пробелы', 'Общие допущения', 'Общие пробелы', 'Ошибки']) {
      expect(blocks).toContainEqual(expect.objectContaining({ heading }))
    }
    expect(blocks).toContainEqual(expect.objectContaining({ heading: 'Агент failed', text: 'worker error' }))
    expect(blocks).toContainEqual(expect.objectContaining({ heading: 'Агент missing', text: 'Результат отсутствует.' }))
    expect(orchestrationReportBlocks({ title: 'Report', details: [] }, result('complete'))[0])
      .toMatchObject({ heading: 'Сводка' })
    expect(orchestrationReportBlocks({ title: 'Report', details: [] }, result('budget-limited'))[0])
      .toMatchObject({ text: 'Статус: budget-limited' })
  })

  it('requires the report service and wraps writer failures', async () => {
    const request = { title: 'Report', details: [] }
    await expect(createOrchestrationPdf(new Context(), agent, 'reports', request, AgentOrchestrationRunId('run'), result('complete'), new AbortController().signal))
      .rejects.toMatchObject({ code: 'ORCHESTRATION_REPORT_UNAVAILABLE' })
    const ctx = new Context()
    ctx.provide('pdfReports', { create: () => Promise.reject(new Error('writer failed')) } as PdfReports)
    await expect(createOrchestrationPdf(ctx, agent, 'reports', request, AgentOrchestrationRunId('run'), result('complete'), new AbortController().signal))
      .rejects.toMatchObject({ code: 'ORCHESTRATION_REPORT_FAILED', cause: expect.objectContaining({ message: 'writer failed' }) })
  })

  it('normalizes an empty trimmed report directory and returns publication metadata', async () => {
    const ctx = new Context()
    const create: PdfReports['create'] = () => Promise.resolve({
      path: '/workspace/run.pdf', bytes: 123, pages: 2, imagesEmbedded: 0, imagesSkipped: [], availableImageCalls: [],
    })
    ctx.provide('pdfReports', { create })
    await expect(createOrchestrationPdf(ctx, agent, '/', { title: 'Report', details: [] }, AgentOrchestrationRunId('run'), result('complete'), new AbortController().signal))
      .resolves.toEqual({ path: '/workspace/run.pdf', name: 'run.pdf', bytes: 123, pages: 2 })
  })
})
