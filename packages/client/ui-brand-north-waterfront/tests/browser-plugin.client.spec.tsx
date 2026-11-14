// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import {
  NorthWaterfrontBrandMark, NorthWaterfrontBrandName, NorthWaterfrontHeroMark,
} from '../src/client/Brand.tsx'
import { apply as hostApply } from '../src/index.ts'

afterEach(() => {
  cleanup()
  document.body.removeAttribute('data-ds-dark-theme')
})

const SIDEBAR_HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
] as const

const HERO_HOLE = 'conversation.hero.brand.mark'

const BRAND_HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'conversation.hero.brand.mark',
] as const

/** Flush every pending microtask chain behind the two independent inject sets. */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

async function bench(initial: readonly string[] = [...SIDEBAR_HOLES, HERO_HOLE]) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  // LocaleRuntime's inject requires the settings transport; the brand plugin
  // only exercises dictionary registration and slot occupancy here.
  ctx.provide('remote', {} as never)
  ctx.provide('configForms', { get: () => stubConfigForm().scope } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  const slots = ctx.get('slots') as SlotRegistry
  const registerWith = (holes: readonly string[]) => slots.register({
    name: 'root',
    children: Object.fromEntries(holes.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  const declareHoles = () => registerWith([...SIDEBAR_HOLES, HERO_HOLE])
  const disposeHoles = initial.length > 0 ? registerWith(initial) : undefined
  return { ctx, slots, declareHoles, disposeHoles }
}

describe('north-waterfront browser-brand plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares exactly the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('registers the brand dictionaries under the shared namespace', async () => {
    const subject = await bench([])
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    const t = subject.ctx.locale.bind('ui-brand-north-waterfront')
    expect(t('mark.initials')).toBe('NW')
    expect(t('name.lead')).toBe('north-')
    expect(t('name.accent')).toBe('waterfront')
  })

  it('fills every brand seat once declared and removes every occupant on teardown', async () => {
    const before = await bench()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of BRAND_HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    before.disposeHoles?.()
    for (const hole of BRAND_HOLES) expect(before.slots.entries(hole)).toHaveLength(0)
    before.declareHoles()
    await settle()
    for (const hole of BRAND_HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    await fiber.dispose()
    for (const hole of BRAND_HOLES) expect(before.slots.entries(hole)).toHaveLength(0)

    const after = await bench([])
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of BRAND_HOLES) expect(after.slots.entries(hole)).toHaveLength(0)
    after.declareHoles()
    await settle()
    for (const hole of BRAND_HOLES) expect(after.slots.entries(hole)).toHaveLength(1)
  })

  it('keeps the hero occupant while the sidebar declaration is absent', async () => {
    const subject = await bench([HERO_HOLE])
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    expect(subject.slots.entries(HERO_HOLE)).toHaveLength(1)
    for (const hole of SIDEBAR_HOLES) expect(subject.slots.entries(hole)).toHaveLength(0)
  })

  it('renders a text badge with no image assets at every requested size', async () => {
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    const t = subject.ctx.locale.bind('ui-brand-north-waterfront')
    const mark = render(<NorthWaterfrontBrandMark size={34} t={t} />)
    expect(mark.container.querySelectorAll('img')).toHaveLength(0)
    const badge = mark.container.firstElementChild
    expect(badge?.textContent).toBe('NW')
    expect(badge?.getAttribute('style')).toContain('width: 34px')
    expect(badge?.getAttribute('style')).toContain('height: 34px')
    mark.rerender(<NorthWaterfrontBrandMark size={24} t={t} />)
    expect(mark.container.firstElementChild?.getAttribute('style')).toContain('width: 24px')
    mark.unmount()

    const hero = render(<NorthWaterfrontHeroMark size={34} className="host-hero" t={t} />)
    expect(hero.container.firstElementChild?.getAttribute('class')).toContain('host-hero')
    expect(hero.container.firstElementChild?.textContent).toBe('NW')
  })

  it('renders the wordmark with the accented waterfront half', async () => {
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    const t = subject.ctx.locale.bind('ui-brand-north-waterfront')
    const name = render(<NorthWaterfrontBrandName t={t} />)
    expect(name.container.textContent).toBe('north-waterfront')
    expect(name.container.querySelector('span > span')?.textContent).toBe('waterfront')
  })
})
