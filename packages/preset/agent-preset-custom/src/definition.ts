/** Synthesis of one stored record into a registry preset definition. */
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry/types'
import type { Config, OrchestrationEntry } from './config.ts'
import type { CustomAgentRecord } from './types.ts'

/** Cordis service each known package publishes into a preset realm. */
const SERVICE_ISOLATION: Readonly<Record<string, string>> = {
  '@deepseek-ai/dsh-agent-orchestrator': 'agentOrchestrator',
  '@deepseek-ai/dsh-tool-pdf': 'pdfReports',
  '@deepseek-ai/dsh-tool-present': 'fileDeliveries',
}

/** One rendered roster line naming a delegate agent. */
function rosterLine(delegate: CustomAgentRecord): string {
  return `- ${delegate.id} «${delegate.name}» — ${delegate.description}`
}

/** Keep one scoped service private to this preset revision. */
function isolatedRow(row: PresetDefinition['plugins'][number]): PresetDefinition['plugins'][number] {
  const service = SERVICE_ISOLATION[row.name]
  return service === undefined ? row : { ...row, isolate: { ...row.isolate, [service]: true } }
}

/** One preset plugin row before the orchestration group is assembled. */
type Row = PresetDefinition['plugins'][number]

/**
 * Split preset rows into the ones the orchestration group owns and the rest.
 *
 * PDF and present rows join the group so the engine and the report writer
 * share one realm; a package already present in the deployment is not added
 * twice.
 */
function partitionServiceRows(rows: readonly Row[]): { grouped: Row[]; rest: Row[] } {
  const grouped: Row[] = []
  const rest: Row[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (SERVICE_ISOLATION[row.name] === undefined) {
      rest.push(row)
      continue
    }
    if (seen.has(row.name)) continue
    seen.add(row.name)
    grouped.push(row)
  }
  return { grouped, rest }
}

/** Rows for the conversational engine and its stored model-facing configuration. */
function orchestrationChildren(
  record: CustomAgentRecord,
  config: OrchestrationEntry,
  delegateRecords: readonly CustomAgentRecord[],
  deploymentRows: readonly Row[],
): Row[] {
  const { grouped } = partitionServiceRows(deploymentRows)
  const children: Row[] = [
    { id: 'agent-orchestrator', name: config.engine.name, config: config.engine.config ?? {} },
    {
      id: 'orchestrate-agents',
      name: config.tool.name,
      config: {
        ...(config.tool.config ?? {}),
        delegates: delegateRecords.map(delegate => ({ id: delegate.id, name: delegate.name, description: delegate.description })),
        evaluatorPreset: config.evaluatorPreset ?? record.id,
        maxIterations: record.orchestratorMaxIterations,
        maxParallel: record.orchestratorMaxParallel,
        autoReport: record.orchestratorAutoReport,
      },
    },
  ]
  const owned = new Set(grouped.map(row => row.name))
  if (!owned.has(config.pdf.name)) {
    children.push({ id: 'orchestration-pdf', name: config.pdf.name, config: config.pdf.config ?? {} })
  }
  if (!owned.has(config.present.name)) {
    children.push({ id: 'orchestration-present', name: config.present.name, config: config.present.config ?? {} })
  }
  // The group row owns the realms for these services; a child row that
  // declared its own realm would publish the service under a private symbol
  // the group's other rows cannot see, and the engine would find no report
  // service to write the orchestration PDF with.
  return [...grouped, ...children]
}

/**
 * Build the registry definition from stored fields and the selected deployment template.
 *
 * @param record - Stored custom-agent record whose fields seed the definition.
 * @param config - Deployment configuration supplying templates and allowed rows.
 * @param delegateRecords - Stored records named by an orchestrated record's delegate ids.
 * @returns The preset definition mounted for this record revision.
 */
export function synthesizeDefinition(
  record: CustomAgentRecord,
  config: Config,
  delegateRecords: readonly CustomAgentRecord[],
): PresetDefinition {
  const base = config.instructionsPrefix === ''
    ? record.instructions
    : `${config.instructionsPrefix} ${record.instructions}`
  const orchestrated = record.isOrchestrator && record.delegates.length > 0 && config.orchestration !== undefined
  const roster = !orchestrated && record.isOrchestrator && record.delegates.length > 0 && config.delegation?.rosterTemplate
    ? `\n\n${config.delegation.rosterTemplate}\n${delegateRecords.map(rosterLine).join('\n')}`
    : ''
  const prefix = `${base}${roster}`
  const delegation = !orchestrated && record.isOrchestrator && record.delegates.length > 0 && config.delegation !== undefined
    ? [
      {
        id: 'delegation',
        name: config.delegation.name,
        config: {
          ...(config.delegation.config ?? {}),
          allowedAgentPresets: [...record.delegates],
        },
      },
      ...(config.delegation.control === undefined ? [] : [{
        id: 'delegation-control',
        name: config.delegation.control.name,
        config: config.delegation.control.config ?? {},
      }]),
    ]
    : []
  const selectedRows: Row[] = record.tools.map((key) => {
    const row = config.allowedTools[key]
    // Stored tools were validated against this same whitelist at write
    // time; a narrowed config orphaning a stored key fails loud here.
    if (row === undefined) throw new Error(`custom-agent-presets: the whitelist no longer carries the '${key}' tool`)
    return { id: `tool-${key}`, name: row.name, config: row.config }
  })
  const deploymentRows: Row[] = [...config.basePlugins, ...selectedRows]
  const { grouped, rest } = partitionServiceRows(deploymentRows)
  const orchestration = config.orchestration
  const plugins: Row[] = orchestrated && orchestration !== undefined
    ? [
      { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix } },
      ...rest,
      ...delegation,
      {
        id: 'orchestration',
        name: 'cordis:group',
        group: true,
        isolate: { agentOrchestrator: true, pdfReports: true, fileDeliveries: true },
        config: orchestrationChildren(record, orchestration, delegateRecords, deploymentRows),
      },
    ]
    : [
      { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix } },
      ...rest,
      ...grouped.map(isolatedRow),
      ...delegation,
    ]
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    order: 50,
    ...(record.hidden ? { hidden: true } : {}),
    plugins,
  }
}
