/** Synthesis of one stored record into a registry preset definition. */
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import type { Config } from './config.ts'
import type { CustomAgentRecord } from './types.ts'

/** One rendered roster line naming a delegate agent. */
function rosterLine(delegate: CustomAgentRecord): string {
  return `- ${delegate.id} «${delegate.name}» — ${delegate.description}`
}

/**
 * Build the registry definition: the site persona plus the user instructions,
 * the deployment's fixed base rows, the whitelisted tool rows the record
 * selected, and — for an orchestrator with delegates — the deployment's
 * delegation row narrowed to those delegates plus a roster of them appended
 * to the persona. User data enters as plain configuration values only —
 * nothing here parses user text as configuration.
 * @param record - the stored record.
 * @param config - the service config (prefix, base rows, whitelist, delegation row).
 * @param delegateRecords - the stored records behind `record.delegates`, in order; empty for a non-orchestrator.
 * @returns the definition handed to `agentPresets.register`.
 */
export function synthesizeDefinition(
  record: CustomAgentRecord,
  config: Config,
  delegateRecords: readonly CustomAgentRecord[],
): PresetDefinition {
  const base = config.instructionsPrefix === ''
    ? record.instructions
    : `${config.instructionsPrefix} ${record.instructions}`
  const roster = record.isOrchestrator && record.delegates.length > 0 && config.delegation?.rosterTemplate
    ? `\n\n${config.delegation.rosterTemplate}\n${delegateRecords.map(rosterLine).join('\n')}`
    : ''
  const prefix = `${base}${roster}`
  const delegation = record.isOrchestrator && record.delegates.length > 0 && config.delegation !== undefined
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
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    order: 50,
    ...(record.hidden ? { hidden: true } : {}),
    plugins: [
      { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix } },
      ...config.basePlugins,
      ...record.tools.map((key) => {
        const row = config.allowedTools[key]
        // Stored tools were validated against this same whitelist at write
        // time; a narrowed config orphaning a stored key fails loud here.
        if (row === undefined) throw new Error(`custom-agent-presets: the whitelist no longer carries the '${key}' tool`)
        return { id: `tool-${key}`, name: row.name, config: row.config }
      }),
      ...delegation,
    ],
  }
}
