import { describe, expect, it } from 'vitest'
import { slugForName, validateInput } from '../src/validate.ts'
import { standardConfig } from './harness.ts'

describe('slugForName', () => {
  it('slugifies Latin names and falls back to agent', () => {
    expect(slugForName('Сметчик')).toBe('agent')
    expect(slugForName('Report Helper')).toBe('report-helper')
    expect(slugForName('  --A!!B--  ')).toBe('a-b')
  })
})

describe('validateInput', () => {
  const base = { name: 'Сметчик', description: 'Считает объёмы.', instructions: 'Считай объёмы работ.', tools: ['todo'], isOrchestrator: false, delegates: [], hidden: false }

  it('accepts a valid input and trims fields', async () => {
    await expect(validateInput({ ...base, name: '  Сметчик  ' }, standardConfig)).resolves.toMatchObject({ name: 'Сметчик', tools: ['todo'] })
  })

  it('rejects empty name, over-limit name, over-limit instructions, and unknown tools with coded errors', async () => {
    await expect(validateInput({ ...base, name: '   ' }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/invalid' })
    await expect(validateInput({ ...base, name: 'x'.repeat(65) }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/invalid' })
    await expect(validateInput({ ...base, instructions: 'x'.repeat(16385) }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/limit' })
    await expect(validateInput({ ...base, tools: ['shell'] }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/invalid' })
  })

  it('rejects over-limit descriptions and empty instructions', async () => {
    await expect(validateInput({ ...base, description: 'x'.repeat(201) }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/invalid' })
    await expect(validateInput({ ...base, instructions: '   ' }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/invalid' })
  })

  it('resolves omitted orchestration values from deployment defaults', async () => {
    await expect(validateInput(base, standardConfig)).resolves.toMatchObject({
      orchestratorMaxIterations: 3,
      orchestratorMaxParallel: 3,
      orchestratorAutoReport: true,
    })
  })

  it('rejects unsafe or out-of-range orchestration values', async () => {
    for (const orchestratorMaxIterations of [0, 11, 1.5, Number.POSITIVE_INFINITY]) {
      await expect(validateInput({ ...base, orchestratorMaxIterations }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/invalid' })
    }
    for (const orchestratorMaxParallel of [0, 11, 1.5, Number.POSITIVE_INFINITY]) {
      await expect(validateInput({ ...base, orchestratorMaxParallel }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/invalid' })
    }
    // @ts-expect-error -- autoReport must arrive as a boolean on the wire.
    await expect(validateInput({ ...base, orchestratorAutoReport: 'yes' }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/invalid' })
  })

  it('passes the delegation fields through, trimming and deduplicating delegates', async () => {
    await expect(validateInput({ ...base, isOrchestrator: true, delegates: ['custom/a', 'custom/a', ' custom/b '] }, standardConfig))
      .resolves.toMatchObject({ isOrchestrator: true, delegates: ['custom/a', 'custom/b'], hidden: false })
  })

  it('rejects malformed delegation input with coded errors', async () => {
    // @ts-expect-error -- delegates must arrive as a list on the wire; this call probes the runtime rejection.
    await expect(validateInput({ ...base, delegates: 'custom/a' }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/invalid' })
    await expect(validateInput({ ...base, delegates: ['  '] }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/invalid' })
    // @ts-expect-error -- isOrchestrator must arrive as a boolean on the wire; this call probes the runtime rejection.
    await expect(validateInput({ ...base, isOrchestrator: 'yes' }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/invalid' })
    // @ts-expect-error -- hidden must arrive as a boolean on the wire; this call probes the runtime rejection.
    await expect(validateInput({ ...base, hidden: 1 }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/invalid' })
  })
})
