// Web e2e scenario: user-created custom agent presets. The service mounts the
// seeded record before the page loads; the manager writes go through the UI.
//
// Zero model calls: no replay fixture mounts, so a stray stream fails loud.
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/custom-agent-presets', import.meta.url))
const MENU_EXPECTED = join(SNAPSHOT_DIR, 'menu.expected.md')
const MODE = webSnapshotMode()

let scaffold: WebScaffold
let browser: Browser
let page: Page
let tripwire: ReturnType<typeof watchConsole>

beforeAll(async () => {
  scaffold = await launchWebScaffold({
    agentPresets: { default: 'standard' },
    customAgentPresets: {
      instructionsPrefix: 'You are the drawings assistant.',
      allowedTools: { 'ask-user': { name: '@deepseek-ai/dsh-tool-ask-user' } },
    },
  })
  // Seeded before the page loads: the roster carries it on first render.
  await scaffold.ctx.customAgentPresets.create({
    name: 'Сметчик', description: 'Считает объёмы по чертежам.', instructions: 'Считай объёмы работ и материалов.', tools: [],
  })
  browser = await chromium.launch()
  page = await newEnglishPage(browser)
  tripwire = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
}, 120_000)

afterAll(async () => {
  await browser?.close()
  await scaffold?.close()
})

describe('custom agent presets', () => {
  it('lists the seeded custom agent and the manager entry in the preset menu', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-custom-agent-menu'))
    await page.getByRole('button', { name: 'Standard mode' }).click()
    const menu = page.getByRole('menu')
    await menu.waitFor({ timeout: 10_000 })
    const snapshot = await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(MENU_EXPECTED, snapshot, MODE)
    expect(snapshot).toContain('Сметчик')
    expect(snapshot).toContain('New custom agent')
    await page.keyboard.press('Escape')
  })

  it('creates a custom agent through the manager and offers it in the menu', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-custom-agent-create'))
    await page.getByRole('button', { name: 'Standard mode' }).click()
    await page.getByRole('menuitem', { name: /New custom agent/ }).click()
    await page.getByRole('dialog').waitFor({ timeout: 10_000 })
    await page.getByLabel('Name').fill('Отчётчик')
    await page.getByLabel('Instructions').fill('Собирай отчёт по выполненным работам.')
    await page.getByRole('button', { name: 'Save' }).click()
    // Saved: the dialog closes itself; the next open starts a fresh form.
    await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 10_000 })
    await page.getByRole('button', { name: 'Standard mode' }).click()
    const menu = page.getByRole('menu')
    await menu.waitFor({ timeout: 10_000 })
    expect(await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd)).toContain('Отчётчик')
    await page.keyboard.press('Escape')
  })

  it('selects the seeded custom agent for the blank session', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-custom-agent-select'))
    await page.getByRole('button', { name: 'Standard mode' }).click()
    await page.getByRole('menuitem', { name: /Сметчик/ }).click()
    await page.getByRole('button', { name: 'Сметчик' }).waitFor({ timeout: 10_000 })
    // The host roster names the custom preset; the session projection records
    // the selection (unit-covered); the UI shows the chosen agent.
    const roster = await scaffold.ctx.agentPresets.remoteExportList()
    expect(roster.presets.some(preset => preset.id === 'custom/agent')).toBe(true)
  })

  it('keeps the page console clean', () => {
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
