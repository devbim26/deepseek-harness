// Web e2e scenario: the recorded orchestration result renders through the
// standard Tool detail row. The Session comes from the keyless real-composition
// smoke, so the persisted tool result carries the production presentationMeta.
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession, watchConsole, webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { expandOwningTurnProcess, newEnglishPage, saveFailureShot } from './support.ts'

const driver = fileURLToPath(new URL('../../../packages/subagent/tool-agent-orchestrator/tests/fixtures/loader/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../packages/subagent/tool-agent-orchestrator/tests/fixtures/loader/orchestration.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./expected/agent-orchestration.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const SEED_ID = 'agent-orchestration-web-e2e'

async function jsonlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return jsonlFiles(path)
    return entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : []
  }))
  return paths.flat()
}

describe.skipIf(MODE === 'record')('web e2e: conversational orchestration result row', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let fixture = ''

  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-web-orchestration-'))
    try {
      await runLoaderSmoke({
        label: 'agent orchestration web fixture',
        tempDirPrefix: 'agent-orchestration-web-fixture-',
        binScript: driver,
        libBinScript: driver,
        configPath,
        tsconfigPath: repoTsconfig,
        env: { DEEPSEEK_API_KEY: '', DSH_SNAPSHOT: '' },
        processTimeoutMs: 120_000,
        inspect: async (cwd) => {
          for (const file of await jsonlFiles(join(cwd, '.sessions'))) {
            const content = await readFile(file, 'utf8')
            const header = JSON.parse(content.split('\n')[0] as string) as { parentSession?: string }
            if (header.parentSession === undefined) fixture = content
            for (const line of content.split('\n').slice(1)) {
              if (line.trim() === '') continue
              const event = JSON.parse(line) as { type?: string; data?: unknown }
              if (event.type === 'tool/call' || event.type === 'tool/result') {
                console.log('ORCHESTRATION EVENT', event.type, JSON.stringify(event.data))
              }
            }
          }
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
    expect(fixture).not.toBe('')
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, fixture, SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    const row = page.locator('[data-tool="orchestrate_agents"]')
    await expandOwningTurnProcess(page, row)
    await row.waitFor({ timeout: 15_000 })
  }, 300_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('shows the recorded status, rounds, and objective in the expanded row', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-agent-orchestration'))
    const row = page.locator('[data-tool="orchestrate_agents"]')
    await row.getByRole('button', { expanded: false }).first().click()
    // The objective opens both the collapsed row summary and the expanded card;
    // the card owns the status badge and the rounds field.
    const card = row.getByRole('listitem')
    await card.getByText('Verify Loader composition', { exact: true }).waitFor()
    await card.getByText('Completed', { exact: true }).waitFor()
    await card.getByText('Rounds', { exact: true }).waitFor()
    await card.getByText('2', { exact: true }).waitFor()
    const snapshot = await captureStableAria(page, '[data-tool="orchestrate_agents"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    await page.setViewportSize({ width: 390, height: 800 })
    expect(await row.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)
})
