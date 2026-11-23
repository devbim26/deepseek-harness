/** Pure conversational-orchestration detail derivation from recorded arguments and result metadata. */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallBlock } from './tool-call-model.ts'
import type { ToolDetailsModel } from '../components/ToolDetails.tsx'
import { detailBadge, detailRecord, nonempty } from './detail-model-shared.ts'
import { parsedToolCall } from './raw-tool-call.ts'
import { recordedAbsolutePath } from './recorded-path.ts'

type Translate = TranslateNS<'conversation'>

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/**
 * Derive the compact orchestration result while declining malformed replay data.
 * @param block - Running or settled `orchestrate_agents` block.
 * @param t - Conversation dictionary translator.
 * @returns Status, rounds, and optional openable PDF, or null for the generic card.
 */
export function agentOrchestrationCardModel(block: ToolCallBlock, t: Translate): ToolDetailsModel | null {
  if (!('kind' in block) || block.isError) return null
  const call = parsedToolCall(block)
  if (call?.name !== 'orchestrate_agents' || !nonempty(call.args.objective)) return null
  const meta: unknown = block.meta
  if (!detailRecord(meta) || meta.kind !== 'agent-orchestration' || !nonempty(meta.id)
    || (meta.status !== 'complete' && meta.status !== 'partial' && meta.status !== 'budget-limited')
    || typeof meta.rounds !== 'number' || !Number.isSafeInteger(meta.rounds) || meta.rounds < 0) return null
  const status = meta.status
  const rounds = meta.rounds
  let pdf: { name: string; path: string } | undefined
  if (meta.pdf !== undefined) {
    if (!detailRecord(meta.pdf) || !nonempty(meta.pdf.name)
      || !positiveInteger(meta.pdf.bytes) || !positiveInteger(meta.pdf.pages)) return null
    const path = recordedAbsolutePath(meta.pdf, 'path')
    if (path === undefined) return null
    pdf = { name: meta.pdf.name, path }
  }
  const badge = status === 'complete' ? detailBadge(status, t)
    : { label: t(status === 'partial' ? 'detail.orchestration.partial' : 'detail.orchestration.budgetLimited'), tone: 'warning' as const }
  return {
    items: [
      { title: call.args.objective, badge, fields: [{ label: t('detail.goal.rounds'), value: String(rounds) }] },
      ...pdf === undefined ? [] : [{ title: pdf.name, fields: [], location: { path: pdf.path } }],
    ],
  }
}
