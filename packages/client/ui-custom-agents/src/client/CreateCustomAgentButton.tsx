/** The preset-picker menu row opening the custom-agent manager. */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-agent-preset SlotMap merge (the picker action slot).
import type {} from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import { IconPlusOutlineRegular, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CustomAgentsController, CustomAgentsState } from './custom-agents-store.ts'
import css from './CreateCustomAgentButton.module.css'

/** Manager handle supplied by the plugin scope. */
export interface CreateCustomAgentButtonInjected {
  hooks: {
    /** Manager snapshot bound by the renderer as useCustomAgents. */
    customAgents: SnapshotStore<CustomAgentsState>
  }
  /** The store controller; openManager hands off to the persistent overlay. */
  controller: CustomAgentsController
  /** Read the catalog when the entry first opens. */
  load: () => Promise<void>
}

type CreateCustomAgentButtonProps = PropsRuntime<'agentPreset.picker.actions'>
  & PropsLocale<'customAgents'> & InjectFace<CreateCustomAgentButtonInjected>

/**
 * Append the manager entry after the preset rows. The dialog itself mounts in
 * the companion overlay slot, outside this menu tree — a menu that closes
 * unmounts its children, and the dialog must survive it.
 * @param props - locale, manager store and controller, and the owner's onDismiss.
 * @returns the menu item.
 */
export function CreateCustomAgentButton({
  t, controller, load, onDismiss,
}: CreateCustomAgentButtonProps) {
  return (
    <MenuItemButton icon={<IconPlusOutlineRegular size={14} />} onSelect={() => {
      onDismiss()
      controller.openManager()
      void load()
    }}>
      <span className={css.copy}>{t('open')}</span>
    </MenuItemButton>
  )
}
