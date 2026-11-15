/** Synthesis of one stored record into a registry preset definition. */
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import type { Config } from './config.ts'
import type { CustomAgentRecord } from './types.ts'

/**
 * Build the registry definition: the site persona plus the user instructions,
 * the deployment's fixed base rows, and the whitelisted tool rows the record
 * selected. User data enters as plain configuration values only — nothing
 * here parses user text as configuration.
 * @param record - the stored record.
 * @param config - the service config (prefix, base rows, whitelist).
 * @returns the definition handed to `agentPresets.register`.
 */
export function synthesizeDefinition(record: CustomAgentRecord, config: Config): PresetDefinition {
  const prefix = config.instructionsPrefix === ''
    ? record.instructions
    : `${config.instructionsPrefix} ${record.instructions}`
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    order: 50,
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
    ],
  }
}
