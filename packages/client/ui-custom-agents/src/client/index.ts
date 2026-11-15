/** Custom-agent manager surface: the preset-picker entry and its modal. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ui-agent-preset SlotMap and Events merges (the picker
// action slot and the custom-agents/changed refresh event).
import type {} from '@deepseek-ai/dsh-client-ui-agent-preset/client'
// Type-only: pulls the slots Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { CreateCustomAgentButton } from './CreateCustomAgentButton.tsx'
import { CustomAgentsController } from './custom-agents-store.ts'
import { en, ru, zh, type CustomAgentsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Custom-agent manager copy. */
    customAgents: CustomAgentsKey
  }
}

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.customAgentPresets']

/**
 * Mount the manager entry into the preset picker's action slot.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('customAgents', { zh, en, ru }), 'ui-custom-agents: dictionaries')
  const controller = new CustomAgentsController(ctx)
  ctx.slots.inject('agentPreset.picker.actions', () => ctx.slots.register({
    name: 'agentPreset.picker.actions',
    id: 'create-custom-agent',
    locale: 'customAgents',
    inject: () => ({ hooks: { customAgents: controller.store }, controller, load: () => controller.load() }),
  }, CreateCustomAgentButton))
}
