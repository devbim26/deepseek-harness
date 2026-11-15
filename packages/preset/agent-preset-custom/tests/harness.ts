/** Test harness: the real preset registry stack plus a memory-backed storage domain. */
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import Storage from '@deepseek-ai/dsh-storage'
import StorageJson from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { harness as presetHarness } from '../../agent-preset-registry/tests/harness.ts'
import CustomAgentPresets from '../src/index.ts'
import type { Context } from '@deepseek-ai/cordis'

/** Deployment-authored defaults the specs assert against. */
export const standardConfig = {
  instructionsPrefix: 'You are the drawings assistant.',
  basePlugins: [] as readonly object[],
  allowedTools: {
    'ask-user': { name: '@deepseek-ai/dsh-tool-ask-user' },
    todo: { name: '@deepseek-ai/dsh-tool-todo', config: { allowParallelInProgress: true } },
  },
  maxNameChars: 64,
  maxDescriptionChars: 200,
  maxInstructionsChars: 16384,
  maxAgents: 50,
}

export type HarnessConfig = typeof standardConfig

/**
 * Boot the preset-registry test stack, add a storage domain facility over the
 * memory backend, and mount the custom-agent service.
 * @param config - config overrides merged over {@link standardConfig}.
 * @param storage - `jsonRoot` swaps the memory backend for a json backend rooted there.
 * @returns the booted context and its `customAgentPresets` service.
 */
export async function harness(
  config: Partial<HarnessConfig> = {},
  storage: { jsonRoot?: string } = {},
): Promise<{ ctx: Context }> {
  const ctx = await presetHarness()
  const backendName = storage.jsonRoot !== undefined ? 'json' : 'memory'
  if (storage.jsonRoot !== undefined) {
    await ctx.plugin(StorageJson, { root: storage.jsonRoot })
  } else {
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  }
  const facility = new DomainFacility(ctx, { backend: backendName, routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(CustomAgentPresets, { ...standardConfig, ...config })
  return { ctx }
}
