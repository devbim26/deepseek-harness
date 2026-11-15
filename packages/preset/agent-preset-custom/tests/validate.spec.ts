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
  const base = { name: 'Сметчик', description: 'Считает объёмы.', instructions: 'Считай объёмы работ.', tools: ['todo'] }

  it('accepts a valid input and trims fields', async () => {
    await expect(validateInput({ ...base, name: '  Сметчик  ' }, standardConfig)).resolves.toMatchObject({ name: 'Сметчик', tools: ['todo'] })
  })

  it('rejects empty name, over-limit name, over-limit instructions, and unknown tools with coded errors', async () => {
    await expect(validateInput({ ...base, name: '   ' }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/invalid' })
    await expect(validateInput({ ...base, name: 'x'.repeat(65) }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/invalid' })
    await expect(validateInput({ ...base, instructions: 'x'.repeat(16385) }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/limit' })
    await expect(validateInput({ ...base, tools: ['shell'] }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/invalid' })
  })
})
