/** Pure PDF assembly: wrapping, pagination, and image embedding. */

import { describe, expect, it } from 'vitest'
import { A4, CONTENT_WIDTH, MARGIN, buildPdfReport } from '../src/pdf.ts'
import type { ReportImage } from '../src/types.ts'

const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  char => char.charCodeAt(0),
)
// A 1x10 pixel PNG: scaled to the full page height, so its caption reserve
// crosses the bottom margin and forces the caption onto a fresh page.
const PNG_1X10 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAKCAIAAAD6sKMdAAAAD0lEQVR4nGMQSNjAQAQGANroC0EYGHvYAAAAAElFTkSuQmCC'),
  char => char.charCodeAt(0),
)
const JPEG_1X1 = Uint8Array.from(atob(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==',
), char => char.charCodeAt(0))

describe('buildPdfReport', () => {
  it('writes a valid single-page PDF with cyrillic title, heading, and body', async () => {
    const { pages, bytes } = await buildPdfReport('Отчёт по чертежам', [
      { type: 'text', heading: 'Состав', text: 'Короткий текст помещается на одной странице.\nВторой абзац.\n' },
      { type: 'text', text: 'Третий блок без заголовка.' },
    ], [])
    expect(pages).toBe(1)
    expect(bytes[0]).toBe(0x25) // '%'
    expect(bytes[1]).toBe(0x50) // 'P'
    expect(bytes[2]).toBe(0x44) // 'D'
    expect(bytes[3]).toBe(0x46) // 'F'
  })

  it('hard-breaks an overlong word across pages', async () => {
    const longWord = 'Ш'.repeat(6000)
    const { pages } = await buildPdfReport(undefined, [
      // Two words that fit alone but not together exercise the reflow path;
      // the leading overlong word starts a line, and the trailing one hard-breaks.
      { type: 'text', text: `${longWord}` },
      { type: 'text', text: `${'а'.repeat(70)} ${'б'.repeat(70)} ${longWord}` },
    ], [])
    expect(pages).toBeGreaterThan(1)
  }, 120_000)

  it('renders every requested image of one call and skips unknown call ids silently', async () => {
    const images: ReportImage[] = [
      { callId: 'call-a', data: PNG_1X1, mediaType: 'image/png', caption: 'Лист 38' },
      { callId: 'call-a', data: JPEG_1X1, mediaType: 'image/jpeg' },
    ]
    const { pages, bytes } = await buildPdfReport(undefined, [
      { type: 'image', callId: 'call-a', caption: 'Лист 38' },
      { type: 'image', callId: 'call-missing' },
    ], images)
    expect(pages).toBeGreaterThan(1)
    expect(bytes.byteLength).toBeGreaterThan(0)
  })

  it('moves a caption to a fresh page when its image fills the page', async () => {
    const images: ReportImage[] = [
      { callId: 'call-tall', data: PNG_1X10, mediaType: 'image/png' },
    ]
    const { pages } = await buildPdfReport(undefined, [
      { type: 'image', callId: 'call-tall', caption: 'Лист на целой странице' },
    ], images)
    expect(pages).toBe(2)
  })

  it('keeps the a4 geometry constants consistent', () => {
    expect(CONTENT_WIDTH).toBeCloseTo(A4.width - MARGIN * 2, 5)
  })
})
