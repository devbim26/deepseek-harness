/** Crop links of a worker report: resolution against the Session's own images. */
import { describe, expect, it } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { ToolCallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, type SessionId } from '@deepseek-ai/dsh-session'
import type { ReportBlock } from '@deepseek-ai/dsh-tool-pdf/types'
import {
  attachmentIdFromDestination, expandCropLinks, imageCallsByAttachment, resolveCropLinks,
} from '../src/crops.ts'

const CROP_ID = AttachmentId('sha256:2ce011773d667ee9ec337a8f9f1cb5721a850a0a37530aba2f94d44839f0f805')
const OTHER_ID = AttachmentId('sha256:1be63d54a6332f30e433ebf917ce8f99c9811dca09148663498c568c4f41874a')
const STORE = 'C:/Users/Lenovo/.dsh/attachments/v1/objects'
const CROP_LINK = `${STORE}/2c/${CROP_ID.slice(7)}`
const OTHER_LINK = `${STORE}/1b/${OTHER_ID.slice(7)}`

/** One Session carrying two image results. */
function session(): Session {
  const id = 'crop-session' as SessionId
  const created = Session.create(id, [], {
    version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd: '/workspace', isSeeded: false,
  })
  created.append('turn/start', { turn: 1 })
  for (const [callId, attachmentId] of [['call-a', CROP_ID], ['call-b', OTHER_ID]] as const) {
    created.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: ToolCallId(callId),
        content: [
          { type: 'text', text: 'crop ready' },
          {
            type: 'image',
            attachment: { attachmentId, mediaType: 'image/png', bytes: 12, width: 2, height: 2 },
          },
        ],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
  }
  return created
}

describe('attachmentIdFromDestination', () => {
  it('reads the id a durable-store path names', () => {
    expect(attachmentIdFromDestination(CROP_LINK)).toBe(CROP_ID)
  })

  it('resolves nothing for a destination outside the store', () => {
    expect(attachmentIdFromDestination('https://example.com/crop.png')).toBeUndefined()
    expect(attachmentIdFromDestination('C:/Users/Lenovo/Documents/plan.md')).toBeUndefined()
    expect(attachmentIdFromDestination(`${STORE}/2c/not-a-hash`)).toBeUndefined()
  })
})

describe('imageCallsByAttachment', () => {
  it('maps every stored image to the call that produced it', () => {
    const calls = imageCallsByAttachment(session())
    expect(calls.get(CROP_ID)).toBe('call-a')
    expect(calls.get(OTHER_ID)).toBe('call-b')
  })
})

describe('resolveCropLinks', () => {
  it('resolves a link that names a stored image and drops it from the text', () => {
    const { crops, text } = resolveCropLinks(session(), `Кроп:\n\n![C01 — АИ 7](<${CROP_LINK}>)`)
    expect(crops).toEqual([{ callId: 'call-a', caption: 'C01 — АИ 7' }])
    expect(text).not.toContain('![')
    expect(text).toContain('Кроп:')
  })

  it('keeps a link whose attachment the Session never produced', () => {
    const unknown = `${STORE}/ff/${'a'.repeat(64)}`
    const link = `![C02](<${unknown}>)`
    const { crops, text } = resolveCropLinks(session(), link)
    expect(crops).toEqual([])
    expect(text).toContain(link)
  })

  it('keeps a link that names no stored attachment', () => {
    const link = '![C03](https://example.com/crop.png)'
    const { crops, text } = resolveCropLinks(session(), link)
    expect(crops).toEqual([])
    expect(text).toContain(link)
  })
})

describe('expandCropLinks', () => {
  it('replaces a text block with its text and the crop images', () => {
    const blocks = expandCropLinks(session(), {
      type: 'text',
      heading: 'Доказательства',
      text: `Кроп:\n\n![C01](<${CROP_LINK}>)`,
    })
    expect(blocks[0]).toEqual({ type: 'text', heading: 'Доказательства', text: 'Кроп:\n\n' })
    expect(blocks[1]).toEqual({ type: 'image', callId: 'call-a', caption: 'C01' })
  })

  it('removes the marker of a list item that carried only a link', () => {
    const blocks = expandCropLinks(session(), {
      type: 'text',
      heading: 'Доказательства',
      text: `- ![C01](<${CROP_LINK}>)`,
    })
    expect(blocks[0]).toEqual({ type: 'text', heading: 'Доказательства', text: '' })
    expect(blocks[1]).toEqual({ type: 'image', callId: 'call-a', caption: 'C01' })
  })

  it('keeps a block without links and a block that is not text', () => {
    const text: ReportBlock = { type: 'text', heading: 'Сводка', text: 'без ссылок' }
    expect(expandCropLinks(session(), text)).toEqual([text])
    const table: ReportBlock = { type: 'table', header: ['A', 'B'], rows: [['1', '2']] }
    expect(expandCropLinks(session(), table)).toEqual([table])
  })

  it('resolves every crop of one text in link order', () => {
    const { crops } = resolveCropLinks(session(), `![A](<${CROP_LINK}>)\n\n![B](<${OTHER_LINK}>)`)
    expect(crops.map(crop => crop.callId)).toEqual(['call-a', 'call-b'])
  })
})
