import { describe, expect, it } from 'vitest'
import { synthesizeDefinition } from '../src/definition.ts'
import { standardConfig } from './harness.ts'
import type { CustomAgentRecord } from '../src/types.ts'

function record(overrides: Partial<CustomAgentRecord> = {}): CustomAgentRecord {
  return {
    id: 'custom/agent', slug: 'agent', name: 'Agent', description: '', instructions: 'Work.',
    tools: [], isOrchestrator: false, delegates: [], orchestratorMaxIterations: 3,
    orchestratorMaxParallel: 3, orchestratorAutoReport: true, hidden: false, version: 1,
    updatedAt: '2026-11-22T00:00:00.000Z', ...overrides,
  }
}

describe('custom agent definition synthesis', () => {
  it('isolates and deduplicates service rows outside orchestration while retaining ordinary plugins', () => {
    const definition = synthesizeDefinition(record({ hidden: true }), {
      ...standardConfig,
      instructionsPrefix: '',
      basePlugins: [
        { id: 'pdf-first', name: '@deepseek-ai/dsh-tool-pdf', isolate: { custom: true } },
        { id: 'pdf-duplicate', name: '@deepseek-ai/dsh-tool-pdf' },
        { id: 'todo', name: '@deepseek-ai/dsh-tool-todo' },
      ],
    }, [])
    expect(definition.hidden).toBe(true)
    expect(definition.plugins.filter(row => row.name === '@deepseek-ai/dsh-tool-pdf')).toEqual([
      expect.objectContaining({ id: 'pdf-first', isolate: { custom: true, pdfReports: true } }),
    ])
    expect(definition.plugins).toContainEqual(expect.objectContaining({ id: 'todo', name: '@deepseek-ai/dsh-tool-todo' }))
    expect(definition.plugins[0]).toMatchObject({ config: { prefix: 'Work.' } })
  })

  it('resolves orchestration and legacy delegation defaults', () => {
    const worker = record({ id: 'custom/worker', name: 'Worker' })
    const lead = record({ id: 'custom/lead', isOrchestrator: true, delegates: [worker.id] })
    const orchestrated = synthesizeDefinition(lead, {
      ...standardConfig,
      orchestration: {
        engine: { name: 'engine' }, tool: { name: 'tool' }, pdf: { name: 'pdf' }, present: { name: 'present' },
      },
    }, [worker])
    expect(orchestrated.plugins.some(row => row.name === 'cordis:group')).toBe(true)
    const explicit = synthesizeDefinition(lead, {
      ...standardConfig,
      basePlugins: [{ id: 'base-pdf', name: 'pdf' }, { id: 'base-present', name: 'present' }],
      orchestration: {
        engine: { name: 'engine', config: { provider: 'spawn' } },
        tool: { name: 'tool', config: { maxGapCount: 1 } }, pdf: { name: 'pdf' }, present: { name: 'present' },
        evaluatorPreset: 'custom/evaluator',
      },
    }, [worker])
    expect(explicit.plugins.some(row => row.name === 'cordis:group')).toBe(true)
    const legacy = synthesizeDefinition(lead, {
      ...standardConfig,
      orchestration: undefined,
      delegation: { name: 'legacy', control: { name: 'control' } },
    }, [worker])
    expect(legacy.plugins).toContainEqual(expect.objectContaining({ id: 'delegation', name: 'legacy' }))
    expect(legacy.plugins).toContainEqual(expect.objectContaining({ id: 'delegation-control', name: 'control' }))
  })

  it('fails loudly when a stored tool leaves the deployment whitelist', () => {
    expect(() => synthesizeDefinition(record({ tools: ['missing'] }), { ...standardConfig, allowedTools: {} }, []))
      .toThrow("the whitelist no longer carries the 'missing' tool")
  })
})
