import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL('./fixtures/loader/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/loader/orchestration.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

interface Log {
  header: SessionHeader
  events: SessionEvent[]
  content: string
}

async function jsonlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return jsonlFiles(path)
    return entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : []
  }))
  return paths.flat()
}

async function readLog(path: string): Promise<Log> {
  const content = await readFile(path, 'utf8')
  const [header, ...rows] = content.trimEnd().split('\n')
  return {
    header: JSON.parse(header!) as SessionHeader,
    events: rows.map(row => JSON.parse(row) as SessionEvent),
    content,
  }
}

describe('orchestrate_agents through the production headless profile', () => {
  it('runs worker and evaluator follow-ups on their durable Sessions', async () => {
    let logs: Log[] = []
    const { stderr } = await runLoaderSmoke({
      label: 'agent orchestration Loader composition smoke',
      tempDirPrefix: 'agent-orchestrator-composition-e2e-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      env: { DEEPSEEK_API_KEY: '' },
      inspect: async (cwd) => {
        const files = await jsonlFiles(join(cwd, '.sessions'))
        logs = await Promise.all(files.map(readLog))
      },
    })
    expect(stderr).not.toContain('UNHANDLED')
    expect(logs).toHaveLength(3)
    const parent = logs.find(log => log.header.parentSession === undefined)!
    const worker = logs.find(log => log.content.includes('Follow-up for your previous work:'))!
    const evaluator = logs.find(log => log !== parent && log !== worker)!
    expect(parent.header.id).toBeDefined()
    expect(worker.header.parentSession).toBe(parent.header.id)
    expect(evaluator.header.parentSession).toBe(parent.header.id)
    expect(parent.content).toContain('orchestrate_agents')
    expect(parent.content).toContain('complete: consolidated')
    expect(parent.content).toContain('PARENT_COMPLETE')
    expect(worker.events.filter(event => event.type === 'turn/start')).toHaveLength(2)
    expect(evaluator.events.filter(event => event.type === 'turn/start')).toHaveLength(2)
    expect(worker.content).toContain('Check the second fact')
    expect(worker.content).toContain('WORKER_ROUND_2')
    expect(worker.content).toContain('Do not ask a human questions or wait for confirmation')
    expect(evaluator.content).toContain('consolidated')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
