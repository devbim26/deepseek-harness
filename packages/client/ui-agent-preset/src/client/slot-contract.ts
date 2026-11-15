/** Slot contract owned by the agent-preset surfaces. */

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Extra rows at the bottom of the agent-preset picker menu, such as the custom-agent manager entry. */
    'agentPreset.picker.actions': { kind: 'list'; scope: 'root'; owner: AgentPresetPickerActionsProps }
    /** Persistent overlays mounted beside the picker, outside the menu tree: entries survive menu close. */
    'agentPreset.picker.overlays': { kind: 'list'; scope: 'root' }
  }
}

/** Owner share of the picker-menu action rows. */
export interface AgentPresetPickerActionsProps {
  /** Close the picker menu before starting the contributed action. */
  readonly onDismiss: () => void
}

export {}
