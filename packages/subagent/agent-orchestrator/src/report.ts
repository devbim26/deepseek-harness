/** Conversion of terminal orchestration values into the shared PDF report service. */
import { basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ReportBlock } from '@deepseek-ai/dsh-tool-pdf/types'
import type {} from '@deepseek-ai/dsh-tool-pdf/types'
import { expandCropLinks } from './crops.ts'
import { AgentOrchestratorError } from './error.ts'
import type {
  AgentOrchestrationPdf, AgentOrchestrationReportRequest,
  AgentOrchestrationResult, AgentOrchestrationRunId,
} from './types.ts'

/** A value that opens a Markdown structure prints as that structure, not as a list item. */
const STRUCTURED_VALUE = /^\s*(?:\||#|[-*+]\s|\d{1,3}[.)]\s)/

/**
 * Build the list block of a report's strings. Each value becomes one list item
 * unless it opens a Markdown structure; an empty line between the values keeps
 * neighboring pipe characters from joining into one table.
 * @param heading - Section heading printed above the list.
 * @param values - The report strings in their order.
 * @returns The list block, or no block when there is no value.
 */
function listBlock(heading: string, values: readonly string[]): ReportBlock[] {
  if (values.length === 0) return []
  return [{
    type: 'text',
    heading,
    text: values.map(value => STRUCTURED_VALUE.test(value) ? value : `- ${value}`).join('\n\n'),
  }]
}

/**
 * Convert a terminal run into report blocks retaining status, evidence, assumptions, and gaps.
 *
 * A worker names its crops as Markdown image links; the blocks carry those
 * links as the images they name, resolved against the Session's own results.
 *
 * @param request - Report request supplying the title and detail rows.
 * @param result - Terminal orchestration result.
 * @param session - Session holding the tool results the crops come from.
 * @returns Blocks for the shared PDF report service.
 */
export function orchestrationReportBlocks(
  request: AgentOrchestrationReportRequest,
  result: AgentOrchestrationResult,
  session: Session,
): ReportBlock[] {
  const incomplete = result.status === 'partial' || result.status === 'budget-limited'
  const blocks: ReportBlock[] = [
    ...incomplete ? [{ type: 'text' as const, heading: 'Неполный результат', text: `Статус: ${result.status}` }] : [],
    ...request.details.length === 0 ? [] : [{
      type: 'table' as const,
      header: ['Параметр', 'Значение'],
      rows: request.details.map(detail => [detail.label, detail.value]),
    }],
    { type: 'text', heading: 'Сводка', text: result.summary },
  ]
  for (const worker of result.workers) {
    blocks.push({
      type: 'text',
      heading: `Агент ${worker.assignmentId}`,
      text: worker.report?.summary ?? worker.error ?? 'Результат отсутствует.',
    })
    blocks.push(...listBlock('Доказательства', worker.report?.evidence ?? []))
    blocks.push(...listBlock('Допущения', worker.report?.assumptions ?? []))
    blocks.push(...listBlock('Пробелы', worker.report?.gaps ?? []))
  }
  blocks.push(...listBlock('Общие допущения', result.assumptions))
  blocks.push(...listBlock('Общие пробелы', result.gaps))
  blocks.push(...listBlock('Ошибки', result.errors))
  return blocks.flatMap(block => expandCropLinks(session, block))
}

/**
 * Create the run-owned PDF and return non-binary publication metadata.
 *
 * @param ctx - Context resolving the `pdfReports` service.
 * @param agent - Root Agent acting on the report.
 * @param reportDirectory - Session-relative directory receiving the file.
 * @param request - Report request supplying the title and detail rows.
 * @param id - Run id naming the PDF file.
 * @param result - Terminal orchestration result to render.
 * @param signal - Abort signal governing PDF creation.
 * @returns Publication metadata for the written PDF.
 * @throws AgentOrchestratorError with `ORCHESTRATION_REPORT_UNAVAILABLE` or `ORCHESTRATION_REPORT_FAILED`.
 */
export async function createOrchestrationPdf(
  ctx: Context,
  agent: Agent,
  reportDirectory: string,
  request: AgentOrchestrationReportRequest,
  id: AgentOrchestrationRunId,
  result: AgentOrchestrationResult,
  signal: AbortSignal,
): Promise<AgentOrchestrationPdf> {
  const reports = ctx.get('pdfReports')
  if (reports === undefined) {
    throw new AgentOrchestratorError('orchestration PDF requires the pdfReports service', 'ORCHESTRATION_REPORT_UNAVAILABLE')
  }
  const directory = reportDirectory.replace(/[\\/]+$/, '')
  const filePath = `${directory === '' ? '.' : directory}/${id}.pdf`
  try {
    const written = await reports.create(agent, {
      filePath,
      title: request.title,
      blocks: orchestrationReportBlocks(request, result, agent.session),
      actor: { agent },
    }, signal)
    return { path: written.path, name: basename(written.path), bytes: written.bytes, pages: written.pages }
  } catch (error: unknown) {
    throw new AgentOrchestratorError('orchestration PDF creation failed', 'ORCHESTRATION_REPORT_FAILED', { cause: error })
  }
}
