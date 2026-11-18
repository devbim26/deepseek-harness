/** DevBIM occupants for the generic browser-brand slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { DevBimBrandMark, DevBimBrandName, DevBimHeroMark } from './Brand.tsx'
import { de, en, es, fr, ja, pt, ru, zh } from './locales.ts'

/** Required services: the UI slot registry and the copy seat. */
export const inject = ['slots', 'locale']

/** Namespace the brand dictionaries and the three occupant registrations share. */
const NS = 'ui-brand-devbim'

/**
 * Fill the brand seats as declaration-aware registration sets: the sidebar
 * pair groups under the sidebar brand-mark declaration (one declarer), and
 * the hero mark waits on the conversation hero declaration independently.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-brand-devbim: dictionaries')
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark' }, DevBimBrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name', locale: NS }, DevBimBrandName)
    }))
  ctx.slots.inject('conversation.hero.brand.mark', function* () {
    yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, DevBimHeroMark)
  })
}
