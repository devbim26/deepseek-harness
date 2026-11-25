/** Interactive Session PDF report: the Header action and the `/report` command over the real Web composition. */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createAssistantMessage, createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SESSION = 'session-pdf-report-e2e'
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

describe('web e2e: interactive Session PDF report', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    const handle = await scaffold.ctx.agents.create({
      sessionId: SessionId(SESSION),
      meta: { cwd: scaffold.workspaceCwd },
      agentOptions: scaffold.ctx.agentDefaultModel.currentSelection(),
    })
    const attachments = scaffold.ctx.attachments
    const image = await attachments.saveImage({ data: PNG_1X1, mediaType: 'image/png', name: 'sheet.png' })
    const session = handle.agent.session
    session.append('turn/start', { turn: 1 })
    const user = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Покажи кроп листа 38' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('session/title', { title: 'Отчёт по чертежам', messageSeqs: [user.seq], source: { kind: 'fallback' } })
    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: ToolCallId('call-crop-38'),
      name: 'get_crop',
      arguments: '{"sheet":38}',
    })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('call-crop-38'),
        content: [{ type: 'image', attachment: image }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      stream: [],
      message: createAssistantMessage({
        content: [{
          type: 'text',
          text: '## Состав\n\n| ID | Лист | Статус |\n| --- | --- | --- |\n| W-1 | 38 | OK |\n\nГотово.',
        }],
        source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      }),
    }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.addInitScript((id) => {
      localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: id }))
    }, SESSION)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    // The title also names the Session in the Sessions tree; the breadcrumb proves it is the open one.
    await page.getByLabel('Session hierarchy').getByText('Отчёт по чертежам', { exact: true }).waitFor({ timeout: 30_000 })
    await page.getByText('Готово.', { exact: true }).waitFor({ timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    try { await browser?.close() } finally { await scaffold?.close() }
  })

  it('downloads a PDF report of the live Session from the Session Header', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-session-pdf-report'))
    const tripwire = watchConsole(page)
    const assistantMessages = scaffold.ctx.agents.get(SessionId(SESSION))?.session.snapshotEvents()
      .filter(event => event.type === 'assistant/message').length ?? 0

    const headResponse = page.waitForResponse(response =>
      response.request().method() === 'HEAD'
      && new URL(response.url()).pathname === '/api/session.report.pdf', { timeout: 30_000 })
    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 })
    await page.getByRole('button', { name: 'More actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Download PDF report', exact: true }).click()

    const head = await headResponse
    expect(head.status()).toBe(200)
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^dsh-session-.+-report\.pdf$/u)
    const downloaded = await readFile(await download.path())
    expect(downloaded.subarray(0, 4).toString('latin1')).toBe('%PDF')

    const dialog = page.getByRole('dialog', { name: 'PDF report download started' })
    await dialog.waitFor({ timeout: 30_000 })
    await dialog.getByText('Close', { exact: true }).click()

    const written = await readdir(join(scaffold.workspaceCwd, 'reports'))
    expect(written).toHaveLength(1)
    expect(written[0]).toMatch(/^session-report-.+\.pdf$/u)
    const stored = await readFile(join(scaffold.workspaceCwd, 'reports', written[0]!))
    expect(stored.subarray(0, 4).toString('latin1')).toBe('%PDF')

    // The export is a human command: the Session log gained no assistant message.
    const after = scaffold.ctx.agents.get(SessionId(SESSION))?.session.snapshotEvents()
      .filter(event => event.type === 'assistant/message').length ?? 0
    expect(after).toBe(assistantMessages)
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it('downloads a second report through the /report command', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-session-pdf-report-command'))
    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 })
    const input = page.locator('[data-composer-input]').first()
    await input.fill('/report')
    await page.getByRole('option').filter({ hasText: /report/i }).first().waitFor({ timeout: 10_000 })
    await input.press('Enter')

    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^dsh-session-.+-report\.pdf$/u)
    const dialog = page.getByRole('dialog', { name: 'PDF report download started' })
    await dialog.waitFor({ timeout: 30_000 })
    await dialog.getByText('Close', { exact: true }).click()

    const written = await readdir(join(scaffold.workspaceCwd, 'reports'))
    expect(written).toHaveLength(2)
    expect(new Set(written).size).toBe(2)
  }, 120_000)
})
