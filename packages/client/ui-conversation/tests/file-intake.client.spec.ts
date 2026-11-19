// @vitest-environment jsdom
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import {
  SlotTestRuntime, stubConfigForm, usePinnedBrowserLanguages, type SessionBehaviorOverrides,
} from '@deepseek-ai/dsh-client-test-runtime'
import type { ISession } from '@deepseek-ai/dsh-api-session-controller/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ComposerBarInjected, ComposerFileIntakeTarget } from '../src/client/contract/slots.ts'
import { apply, inject } from '../src/client/apply.ts'
import { createComposerFileIntake } from '../src/client/input/file-intake.ts'

usePinnedBrowserLanguages('zh-CN')

const ROOT = 'root-1' as SessionId

/** One mounted Conversation: content region, transcript, and composer card. */
function conversation(occurrence: 'main' | 'embedded', parent: HTMLElement = document.body) {
  const content = document.createElement('div')
  content.dataset.conversationContent = ''
  const transcript = document.createElement('p')
  const card = document.createElement('div')
  card.dataset.composerCard = ''
  const button = document.createElement('button')
  card.append(button)
  content.append(transcript, card)
  parent.append(content)
  const add = vi.fn<ComposerFileIntakeTarget['add']>()
  let accepting = true
  const target: ComposerFileIntakeTarget = { card, occurrence, accepts: () => accepting, add }
  return { content, transcript, card, button, add, target, refuse: () => { accepting = false } }
}

function filePayload(...files: File[]) {
  return {
    items: files.map(file => ({ kind: 'file', getAsFile: () => file })),
    getData: () => '',
  }
}

const image = new File([Uint8Array.of(1)], 'shot.png', { type: 'image/png' })

const registrations: (() => void)[] = []

/** A fresh route whose registrations the suite releases after each case. */
function createRoute(): ReturnType<typeof createComposerFileIntake> {
  const register = createComposerFileIntake()
  return (target) => {
    const leave = register(target)
    registrations.push(leave)
    return leave
  }
}

afterEach(() => {
  for (const leave of registrations.splice(0)) leave()
  document.body.replaceChildren()
})

describe('composer paste route', () => {
  it('routes an unaddressed paste to the main composer until another composer takes focus', () => {
    const register = createRoute()
    const main = conversation('main')
    const side = conversation('embedded')
    const leaveMain = register(main.target)
    const leaveSide = register(side.target)

    expect(fireEvent.paste(document.body, { clipboardData: filePayload(image) })).toBe(false)
    expect(main.add).toHaveBeenCalledWith([image], undefined)
    expect(side.add).not.toHaveBeenCalled()

    side.button.focus()
    main.transcript.tabIndex = -1
    main.transcript.focus()
    fireEvent.paste(document.body, { clipboardData: filePayload(image) })
    expect(side.add).toHaveBeenCalledTimes(1)
    expect(main.add).toHaveBeenCalledTimes(1)

    leaveSide()
    leaveSide()
    fireEvent.paste(document.body, { clipboardData: filePayload(image) })
    expect(main.add).toHaveBeenCalledTimes(2)
    leaveMain()
  })

  it('reports directory members and adopts a composer already holding focus at registration', () => {
    const register = createRoute()
    const main = conversation('main')
    const side = conversation('embedded')
    side.button.focus()
    register(main.target)
    register(side.target)
    const folder = new File([], 'folder')
    const payload = {
      items: [
        { kind: 'string', getAsFile: () => null },
        { kind: 'file', getAsFile: () => null },
        { kind: 'file', getAsFile: () => folder, webkitGetAsEntry: () => ({ isDirectory: true }) },
        { kind: 'file', getAsFile: () => image, webkitGetAsEntry: () => null },
      ],
      getData: () => '',
    }
    fireEvent.paste(document.body, { clipboardData: payload })
    expect(side.add).toHaveBeenCalledWith([folder, image], new Set([folder]))
    expect(main.add).not.toHaveBeenCalled()
  })

  it('leaves a paste to its editable control, an earlier handler, or the browser', () => {
    const register = createRoute()
    const main = conversation('main')
    register(main.target)
    const field = document.createElement('input')
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    document.body.append(field, editable)

    expect(fireEvent.paste(field, { clipboardData: filePayload(image) })).toBe(true)
    expect(fireEvent.paste(editable, { clipboardData: filePayload(image) })).toBe(true)
    expect(fireEvent.paste(document.body, { clipboardData: { items: [], getData: () => 'text' } })).toBe(true)
    expect(fireEvent.paste(document.body, { clipboardData: null })).toBe(true)
    const handled = (event: Event): void => { event.preventDefault() }
    document.body.addEventListener('paste', handled)
    fireEvent.paste(document.body, { clipboardData: filePayload(image) })
    document.body.removeEventListener('paste', handled)
    expect(main.add).not.toHaveBeenCalled()

    main.refuse()
    expect(fireEvent.paste(document.body, { clipboardData: filePayload(image) })).toBe(true)
    expect(main.add).not.toHaveBeenCalled()
  })

  it('never addresses a hidden, inert, detached, or modal-covered composer', () => {
    const register = createRoute()
    const main = conversation('main')
    const side = conversation('embedded')
    register(main.target)
    register(side.target)
    side.button.focus()

    side.content.setAttribute('inert', '')
    fireEvent.paste(document.body, { clipboardData: filePayload(image) })
    expect(main.add).toHaveBeenCalledTimes(1)
    side.content.removeAttribute('inert')

    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    document.body.append(menu)
    expect(fireEvent.paste(document.body, { clipboardData: filePayload(image) })).toBe(true)
    menu.remove()

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    const inside = conversation('embedded', dialog)
    document.body.append(dialog)
    register(inside.target)
    fireEvent.paste(document.body, { clipboardData: filePayload(image) })
    expect(inside.add).not.toHaveBeenCalled()
    inside.button.focus()
    fireEvent.paste(document.body, { clipboardData: filePayload(image) })
    expect(inside.add).toHaveBeenCalledTimes(1)
    dialog.remove()

    main.content.hidden = true
    expect(fireEvent.paste(document.body, { clipboardData: filePayload(image) })).toBe(true)
    main.content.remove()
    expect(fireEvent.paste(document.body, { clipboardData: filePayload(image) })).toBe(true)
    expect(main.add).toHaveBeenCalledTimes(1)
    expect(side.add).not.toHaveBeenCalled()
  })

  it('skips a composer that cannot accept files for the main composer, and leaves the paste when none can', () => {
    const register = createRoute()
    const main = conversation('main')
    const side = conversation('embedded')
    register(main.target)
    register(side.target)
    side.button.focus()
    side.refuse()

    expect(fireEvent.paste(document.body, { clipboardData: filePayload(image) })).toBe(false)
    expect(main.add).toHaveBeenCalledTimes(1)
    expect(side.add).not.toHaveBeenCalled()
    main.refuse()
    expect(fireEvent.paste(document.body, { clipboardData: filePayload(image) })).toBe(true)
    expect(main.add).toHaveBeenCalledTimes(1)
  })

  it('leaves a paste to an editable control inside a shadow root', () => {
    const register = createRoute()
    const main = conversation('main')
    register(main.target)
    const host = document.createElement('div')
    document.body.append(host)
    const field = document.createElement('textarea')
    host.attachShadow({ mode: 'open' }).append(field)

    expect(fireEvent.paste(field, { composed: true, clipboardData: filePayload(image) })).toBe(true)
    expect(main.add).not.toHaveBeenCalled()
  })

  it('removes its document listeners with the last registration', () => {
    const register = createRoute()
    const main = conversation('main')
    register(main.target)()
    fireEvent.paste(document.body, { clipboardData: filePayload(image) })
    expect(main.add).not.toHaveBeenCalled()
    const again = register(main.target)
    fireEvent.paste(document.body, { clipboardData: filePayload(image) })
    expect(main.add).toHaveBeenCalledTimes(1)
    again()
  })
})

/** The real composer-bar inject over a mounted Conversation feature. */
async function intakeBench() {
  const runtime = await SlotTestRuntime.create()
  const upload = vi.fn(() => Promise.resolve({
    ok: true as const,
    value: {
      receiptId: 'root-receipt' as never,
      file: { attachmentId: 'root-file' as never, name: 'huge.bin', bytes: 1 },
    },
  }))
  runtime.fileUpload.upload = upload
  runtime.ctx.provide('configForms', {
    developerTools: {
      enabled: createSnapshotStore(true),
      setEnabled: async () => {},
    },
    get: () => stubConfigForm().scope,
  } as never)
  runtime.ctx.provide('uiWorkspace', {
    openWorkspace: async () => ROOT,
    openSession: () => {},
  } as never)
  const sessionFake = {
    loadOlder: vi.fn<ISession['loadOlder']>(() => Promise.resolve()),
    prompt: vi.fn<ISession['prompt']>(() => Promise.resolve({ ok: true, value: { accepted: true } })),
    cancel: vi.fn<ISession['cancel']>(() => Promise.resolve({ ok: true, value: { accepted: true } })),
  } satisfies SessionBehaviorOverrides
  await runtime.sessions.add({
    id: ROOT,
    summary: { title: 'R', displayTitle: 'R', cwd: '/proj' },
    session: sessionFake,
  })
  runtime.sessions.retain(ROOT)
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  runtime.ctx.provide('shortcuts', { catalog: createSnapshotStore([]) })
  await runtime.root.declare({ 'main': { kind: 'keyed', scope: 'root' } }, () => null)
  await runtime.mount({ inject: [...inject], apply })
  const composerEntry = runtime.slots.entries('conversation.composer.bar')[0]!
  const injectFace = composerEntry.inject as (sessionId: SessionId | undefined) => ComposerBarInjected
  const composer = injectFace(ROOT)
  return { runtime, composer, upload }
}

describe('intake size limit', () => {
  it('rejects an over-limit file without creating a draft', async () => {
    const b = await intakeBench()
    onTestFinished(() => b.runtime.dispose())
    // A stubbed size above the default 25MB ceiling: the bytes are never read.
    const oversized = Object.defineProperty(
      new File([], 'huge.bin', { type: 'application/octet-stream' }),
      'size',
      { value: 26214401 },
    )
    expect(b.composer.addFiles?.([oversized])).toBe('文件超出 25MB 限制')
    // No draft enters the input machine or the upload registry, and nothing uploads.
    const input = b.runtime.ctx.conversation.input.for(b.runtime.sessions.scope(ROOT)!)
    expect(input.state.getSnapshot().attachmentIds).toEqual([])
    expect(b.runtime.ctx.conversation.fileUploads.getSnapshot()).toEqual({})
    expect(b.upload).not.toHaveBeenCalled()
  })
})
