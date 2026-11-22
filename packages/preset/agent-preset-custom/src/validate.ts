/** Input validation: every rule rejects with a coded, actionable RemoteError. */
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { Config } from './config.ts'
import type { CustomAgentInput, ResolvedCustomAgentInput } from './types.ts'

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

/**
 * Derive the ASCII slug for a name.
 *
 * @param name - User-supplied display name.
 * @returns A lowercase ASCII slug, or `agent` when the name yields none.
 */
export function slugForName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  return slug === '' || !SLUG_RE.test(slug) ? 'agent' : slug
}

const invalid = (reason: string) => new RemoteError('custom-agent-presets/invalid', reason, { reason })
const limit = (reason: string) => new RemoteError('custom-agent-presets/limit', reason, { reason })

/**
 * Validate one submitted field set against deployment policy and resolve omitted orchestration values.
 *
 * @param input - Submitted fields before trimming, deduplication, and defaulting.
 * @param config - Deployment limits and defaults every field is checked against.
 * @returns The normalized field set stored with the record.
 * @throws RemoteError with `custom-agent-presets/invalid` or `custom-agent-presets/limit`.
 */
export async function validateInput(input: CustomAgentInput, config: Config): Promise<ResolvedCustomAgentInput> {
  const name = input.name.trim()
  if (name === '') throw invalid('The name must not be empty')
  if (name.length > config.maxNameChars) throw invalid(`The name exceeds ${config.maxNameChars} characters`)
  const description = input.description.trim()
  if (description.length > config.maxDescriptionChars) throw invalid(`The description exceeds ${config.maxDescriptionChars} characters`)
  const instructions = input.instructions.trim()
  if (instructions === '') throw invalid('The instructions must not be empty')
  if (instructions.length > config.maxInstructionsChars) throw limit(`The instructions exceed ${config.maxInstructionsChars} characters`)
  const allowed = new Set(Object.keys(config.allowedTools))
  const unknown = input.tools.filter(tool => !allowed.has(tool))
  if (unknown.length > 0) throw invalid(`Unknown tools: ${unknown.join(', ')}`)
  if (typeof input.isOrchestrator !== 'boolean' || typeof input.hidden !== 'boolean') {
    throw invalid('isOrchestrator and hidden must be booleans')
  }
  if (!Array.isArray(input.delegates)) throw invalid('Delegates must be a list of agent ids')
  if (input.delegates.some((id: unknown) => typeof id !== 'string' || id.trim() === '')) {
    throw invalid('Delegates must be non-empty agent ids')
  }
  const orchestratorMaxIterations = input.orchestratorMaxIterations ?? config.orchestratorDefaults.maxIterations
  const orchestratorMaxParallel = input.orchestratorMaxParallel ?? config.orchestratorDefaults.maxParallel
  const orchestratorAutoReport = input.orchestratorAutoReport ?? config.orchestratorDefaults.autoReport
  if (!Number.isSafeInteger(orchestratorMaxIterations)
    || orchestratorMaxIterations < 1 || orchestratorMaxIterations > config.orchestratorCeilings.maxIterations) {
    throw invalid(`orchestratorMaxIterations must be a safe integer from 1 to ${config.orchestratorCeilings.maxIterations}`)
  }
  if (!Number.isSafeInteger(orchestratorMaxParallel)
    || orchestratorMaxParallel < 1 || orchestratorMaxParallel > config.orchestratorCeilings.maxParallel) {
    throw invalid(`orchestratorMaxParallel must be a safe integer from 1 to ${config.orchestratorCeilings.maxParallel}`)
  }
  if (typeof orchestratorAutoReport !== 'boolean') throw invalid('orchestratorAutoReport must be a boolean')
  return {
    name, description, instructions, tools: [...new Set(input.tools)],
    isOrchestrator: input.isOrchestrator,
    delegates: [...new Set(input.delegates.map((id: string) => id.trim()))],
    orchestratorMaxIterations,
    orchestratorMaxParallel,
    orchestratorAutoReport,
    hidden: input.hidden,
  }
}
