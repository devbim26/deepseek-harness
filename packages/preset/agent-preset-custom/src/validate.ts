/** Input validation: every rule rejects with a coded, actionable RemoteError. */
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { Config } from './config.ts'
import type { CustomAgentInput } from './types.ts'

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

/**
 * Derive the ASCII slug for a name: Latin letters and digits only, `-`-separated.
 * @param name - the display name to slugify.
 * @returns the slug, or `'agent'` when the name carries no ASCII letters.
 */
export function slugForName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  return slug === '' || !SLUG_RE.test(slug) ? 'agent' : slug
}

const invalid = (reason: string) => new RemoteError('custom-agent-presets/invalid', reason, { reason })
const limit = (reason: string) => new RemoteError('custom-agent-presets/limit', reason, { reason })

/**
 * Validate one submitted field set against the deployment policy.
 * @param input - the client-submitted fields.
 * @param config - the service config carrying the whitelist and limits.
 * @returns the trimmed, deduplicated fields to store.
 */
export async function validateInput(input: CustomAgentInput, config: Config): Promise<Pick<CustomAgentInput, 'name' | 'description' | 'instructions' | 'tools' | 'isOrchestrator' | 'delegates' | 'hidden'>> {
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
  return {
    name, description, instructions, tools: [...new Set(input.tools)],
    isOrchestrator: input.isOrchestrator,
    delegates: [...new Set(input.delegates.map((id: string) => id.trim()))],
    hidden: input.hidden,
  }
}
