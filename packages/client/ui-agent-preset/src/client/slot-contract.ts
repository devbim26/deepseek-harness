/** Slot contract owned by the agent-preset surfaces. */

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Extra rows at the bottom of the agent-preset picker menu, such as the custom-agent manager entry. */
    'agentPreset.picker.actions': { kind: 'list'; scope: 'root'; owner: AgentPresetPickerActionsProps }
  }
}

/** Owner share of the picker-menu action rows. */
export interface AgentPresetPickerActionsProps {
  /** Close the picker menu before starting the contributed action. */
  readonly onDismiss: () => void
}

export {}
