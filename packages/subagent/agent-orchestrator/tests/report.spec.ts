import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SESSION_FORMAT_VERSION, Session, type SessionId } from '@deepseek-ai/dsh-session'
import type { PdfReports } from '@deepseek-ai/dsh-tool-pdf/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createOrchestrationPdf, orchestrationReportBlocks } from '../src/report.ts'
import type { AgentOrchestrationResult, AgentOrchestrationRunId } from '../src/types.ts'

/** A Session with no committed events, so no report text names a crop. */
function emptySession(): Session {
  const id = 'orchestration-report' as SessionId
  return Session.create(id, [], {
    version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd: '/workspace', isSeeded: false,
  })
}

const session = emptySession()
const agent = { session } as Agent

function result(status: AgentOrchestrationResult['status']): AgentOrchestrationResult {
  return {
    id: brandString<AgentOrchestrationRunId>('orchestration-test'),
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
    const blocks = orchestrationReportBlocks({ title: 'Report', details: [{ label: 'House', value: '12' }] }, result('partial'), session)
    expect(blocks[0]).toMatchObject({ heading: 'Неполный результат', text: 'Статус: partial' })
    expect(blocks).toContainEqual(expect.objectContaining({ type: 'table', header: ['Параметр', 'Значение'] }))
    for (const heading of ['Сводка', 'Доказательства', 'Допущения', 'Пробелы', 'Общие допущения', 'Общие пробелы', 'Ошибки']) {
      expect(blocks).toContainEqual(expect.objectContaining({ heading }))
    }
    expect(blocks).toContainEqual(expect.objectContaining({ heading: 'Агент failed', text: 'worker error' }))
    expect(blocks).toContainEqual(expect.objectContaining({ heading: 'Агент missing', text: 'Результат отсутствует.' }))
    expect(orchestrationReportBlocks({ title: 'Report', details: [] }, result('complete'), session)[0])
      .toMatchObject({ heading: 'Сводка' })
    expect(orchestrationReportBlocks({ title: 'Report', details: [] }, result('budget-limited'), session)[0])
      .toMatchObject({ text: 'Статус: budget-limited' })
  })

  it('renders every listed value as a list item and keeps a value that opens a Markdown structure as written', () => {
    const table = '| ID | Лист |\n| --- | --- |\n| W-1 | 38 |'
    const withEvidence: AgentOrchestrationResult = {
      ...result('complete'),
      workers: [{
        assignmentId: 'worker', rounds: 1,
        report: { summary: 'worker summary', evidence: ['proof', table, 'a | b', '## Своя секция'], assumptions: [], gaps: [] },
      }],
    }
    const blockOf = (heading: string) => orchestrationReportBlocks({ title: 'Report', details: [] }, withEvidence, session)
      .find(block => block.type === 'text' && block.heading === heading)
    expect(blockOf('Доказательства')).toEqual({
      type: 'text', heading: 'Доказательства', text: `- proof\n\n${table}\n\n- a | b\n\n## Своя секция`,
    })
    expect(blockOf('Допущения')).toBeUndefined()
    expect(blockOf('Пробелы')).toBeUndefined()
  })

  it('requires the report service and wraps writer failures', async () => {
    const request = { title: 'Report', details: [] }
    await expect(createOrchestrationPdf(new Context(), agent, 'reports', request, brandString<AgentOrchestrationRunId>('run'), result('complete'), new AbortController().signal))
      .rejects.toMatchObject({ code: 'ORCHESTRATION_REPORT_UNAVAILABLE' })
    const ctx = new Context()
    ctx.provide('pdfReports', { create: () => Promise.reject(new Error('writer failed')) } as PdfReports)
    await expect(createOrchestrationPdf(ctx, agent, 'reports', request, brandString<AgentOrchestrationRunId>('run'), result('complete'), new AbortController().signal))
      .rejects.toMatchObject({ code: 'ORCHESTRATION_REPORT_FAILED', cause: expect.objectContaining({ message: 'writer failed' }) })
  })

  it('normalizes an empty trimmed report directory and returns publication metadata', async () => {
    const ctx = new Context()
    const create: PdfReports['create'] = () => Promise.resolve({
      path: '/workspace/run.pdf', bytes: 123, pages: 2, imagesEmbedded: 0, imagesSkipped: [], availableImageCalls: [],
    })
    ctx.provide('pdfReports', { create })
    await expect(createOrchestrationPdf(ctx, agent, '/', { title: 'Report', details: [] }, brandString<AgentOrchestrationRunId>('run'), result('complete'), new AbortController().signal))
      .resolves.toEqual({ path: '/workspace/run.pdf', name: 'run.pdf', bytes: 123, pages: 2 })
  })
})
