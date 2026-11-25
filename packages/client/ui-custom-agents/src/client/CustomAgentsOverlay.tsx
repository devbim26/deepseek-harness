/** The persistent manager-dialog host: renders the modal while the store says open. */
// Type-only: pulls the ui-layout SlotMap merge (the shell.overlay entry).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { CustomAgentsModal } from './CustomAgentsModal.tsx'
import type { CustomAgentsController, CustomAgentsState } from './custom-agents-store.ts'

/** Overlay handle supplied by the plugin scope. */
export interface CustomAgentsOverlayInjected {
  hooks: {
    /** Manager snapshot bound by the renderer as useCustomAgents. */
    customAgents: SnapshotStore<CustomAgentsState>
  }
  /** The store controller owning the dialog's open state. */
  controller: CustomAgentsController
}

type CustomAgentsOverlayProps = PropsRuntime<'shell.overlay'>
  & PropsLocale<'customAgents'> & InjectFace<CustomAgentsOverlayInjected>

/**
 * Mount the manager dialog in the frame-wide overlay. The layer sits outside
 * every main panel, so the dialog outlives the page that opened it.
 * @param props - locale, manager store, and the controller.
 * @returns the modal while open, otherwise nothing.
 */
export function CustomAgentsOverlay({
  t, useCustomAgents, controller,
}: CustomAgentsOverlayProps) {
  const state = useCustomAgents(value => value)
  if (!state.modalOpen) return null
  return (
    <CustomAgentsModal
      // One instance per open: the form can never inherit the previous
      // open's editing state, whatever path closed it last time.
      key={state.openSeq}
      t={t}
      useCustomAgents={useCustomAgents}
      controller={controller}
      onClose={() => { controller.closeManager() }}
    />
  )
}
