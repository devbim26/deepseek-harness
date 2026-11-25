// Web e2e scenario: the recorded orchestration result renders through the
// standard Tool detail row. The Session comes from the recorded headless
// orchestration composition, borrowed read-only by this Web scenario.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { expandOwningTurnProcess, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/agent-orchestration', import.meta.url))
const SESSION_FIXTURE = fileURLToPath(new URL('../../../snapshots/session/agent-orchestration/session.v4.jsonl', import.meta.url))
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const MODE = webSnapshotMode()
const SEED_ID = 'agent-orchestration-web-e2e'

/**
 * Read the orchestration objective from the recorded tool call, so the card
 * assertion follows the recording instead of a duplicated literal.
 * @param content - Recorded parent Session JSONL.
 * @returns The objective the model passed to `orchestrate_agents`.
 */
function recordedObjective(content: string): string {
  for (const line of content.split('\n')) {
    if (line.trim() === '') continue
    const event = JSON.parse(line) as { type?: string; data?: { name?: string; arguments?: string } }
    if (event.type !== 'tool/call' || event.data?.name !== 'orchestrate_agents') continue
    const args = JSON.parse(event.data.arguments ?? '{}') as { objective?: string }
    if (typeof args.objective === 'string' && args.objective !== '') return args.objective
  }
  throw new Error('recorded session has no orchestrate_agents call')
}

describe.skipIf(MODE === 'record')('web e2e: conversational orchestration result row', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let objective = ''

  beforeAll(async () => {
    const recorded = await readFile(SESSION_FIXTURE, 'utf8')
    objective = recordedObjective(recorded)
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, recorded, SEED_ID)
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
    await card.getByText(objective, { exact: true }).waitFor()
    await card.getByText('Completed', { exact: true }).waitFor()
    await card.getByText('Rounds', { exact: true }).waitFor()
    await card.getByText('2', { exact: true }).waitFor()
    const snapshot = await captureStableAria(page, '[data-tool="orchestrate_agents"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    await page.setViewportSize({ width: 390, height: 800 })
    expect(await row.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'])
  }, 60_000)
})
