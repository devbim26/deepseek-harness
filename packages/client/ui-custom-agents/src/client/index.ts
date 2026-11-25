/** Custom-agent manager surface: a reusable create entry and the dialog host. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ui-agent-preset Events merge (the custom-agents/changed event).
import type {} from '@deepseek-ai/dsh-client-ui-agent-preset/client'
// Type-only: pulls the ui-layout SlotMap merge (the shell.overlay entry).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the slots Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { AgentActions } from './AgentActions.tsx'
import type { AgentActionsInjected, AgentActionsProps } from './AgentActions.tsx'
import { CreateCustomAgentButton } from './CreateCustomAgentButton.tsx'
import type { CreateCustomAgentButtonInjected } from './CreateCustomAgentButton.tsx'
import { CustomAgentsOverlay } from './CustomAgentsOverlay.tsx'
import type { CustomAgentsOverlayInjected } from './CustomAgentsOverlay.tsx'
import { CustomAgentsController } from './custom-agents-store.ts'
import { en, ru, zh, type CustomAgentsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Custom-agent manager copy. */
    customAgents: CustomAgentsKey
  }
  interface SlotFactoryMap {
    /**
     * The custom-agent manager entry. A page renders it wherever people create
     * agents; the dialog it opens mounts through `shell.overlay`.
     */
    'customAgents.createButton': { scope: 'root'; locale: 'customAgents'; inject: CreateCustomAgentButtonInjected }
    /**
     * Row actions for one stored agent. A page that lists agents renders them
     * beside each row; edit opens the manager dialog on that agent, remove
     * confirms and deletes through the manager controller.
     */
    'customAgents.agentActions': { scope: 'root'; props: AgentActionsProps; locale: 'customAgents'; inject: AgentActionsInjected }
  }
}

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.customAgentPresets']

/**
 * Mount the manager entry as a reusable Factory and its dialog in the
 * frame-wide overlay.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('customAgents', { zh, en, ru }), 'ui-custom-agents: dictionaries')
  const controller = new CustomAgentsController(ctx)
  ctx.slots.registerFactory({
    name: 'customAgents.createButton',
    scope: 'root',
    locale: 'customAgents',
    inject: (): CreateCustomAgentButtonInjected => ({ controller }),
  }, CreateCustomAgentButton)
  ctx.slots.registerFactory({
    name: 'customAgents.agentActions',
    scope: 'root',
    locale: 'customAgents',
    inject: (): AgentActionsInjected => ({ controller }),
  }, AgentActions)
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'custom-agents-dialog',
    locale: 'customAgents',
    inject: (): CustomAgentsOverlayInjected => ({ hooks: { customAgents: controller.store }, controller }),
  }, CustomAgentsOverlay))
}
