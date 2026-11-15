/** The preset-picker menu row opening the custom-agent manager. */
import { useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-agent-preset SlotMap merge (the picker action slot).
import type {} from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import { IconPlusOutlineRegular, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CustomAgentsController, CustomAgentsState } from './custom-agents-store.ts'
import { CustomAgentsModal } from './CustomAgentsModal.tsx'
import css from './CreateCustomAgentButton.module.css'

/** Manager handle supplied by the plugin scope. */
export interface CreateCustomAgentButtonInjected {
  hooks: {
    /** Manager snapshot bound by the renderer as useCustomAgents. */
    customAgents: SnapshotStore<CustomAgentsState>
  }
  /** The store controller the modal calls for CRUD. */
  controller: CustomAgentsController
  /** Read the catalog when the entry first opens. */
  load: () => Promise<void>
}

type CreateCustomAgentButtonProps = PropsRuntime<'agentPreset.picker.actions'>
  & PropsLocale<'customAgents'> & InjectFace<CreateCustomAgentButtonInjected>

/**
 * Append the manager entry after the preset rows.
 * @param props - locale, manager store and controller, and the owner's onDismiss.
 * @returns the menu item with the manager modal.
 */
export function CreateCustomAgentButton({
  t, useCustomAgents, controller, load, onDismiss,
}: CreateCustomAgentButtonProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <MenuItemButton icon={<IconPlusOutlineRegular size={14} />} onSelect={() => {
        onDismiss()
        setOpen(true)
        void load()
      }}>
        <span className={css.copy}>{t('open')}</span>
      </MenuItemButton>
      {open && (
        <CustomAgentsModal
          t={t}
          useCustomAgents={useCustomAgents}
          controller={controller}
          onClose={() => { setOpen(false) }}
        />
      )}
    </>
  )
}
