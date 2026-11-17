---
description: "Custom-agent manager: create, edit, and remove user-defined agent presets from the preset picker. The dialog lives outside the menu tree so it survives the menu closing."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-custom-agents

English | [中文](README.zh.md)

## Summary

Custom-agent manager: create, edit, and remove user-defined agent presets from the preset picker. The dialog lives outside the menu tree so it survives the menu closing.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

```yaml
- id: ui-custom-agents
  name: '@deepseek-ai/dsh-client-ui-custom-agents'
```

The row mounts two entries over the agent-preset picker's child slots: the `agentPreset.picker.actions` menu row ("New custom agent") and the `agentPreset.picker.overlays` dialog host. The owner (`ui-agent-preset`) renders overlays beside the menu, outside it, so a dialog opened from the menu row survives the menu closing. Copy is locale-owned (`customAgents` namespace; zh, en, ru).

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[custom-agents-store.ts](src/client/custom-agents-store.ts) holds the catalog state and the dialog's open flag; the menu entry and the overlay both read the one store, so state survives either surface unmounting. Writes go through the typed `customAgentPresets` remote and emit the client-side `custom-agents/changed` event, which `ui-agent-preset`'s roster refresh subscribes to. [CustomAgentsModal.tsx](src/client/CustomAgentsModal.tsx) renders the roster in a scrollable left pane, the fields in the center, and the tool checkboxes in the right pane strictly from the service-reported policy — the form can only offer what the deployment whitelist carries.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Custom preset service](../../preset/agent-preset-custom/README.md) — the durable records and validation behind this surface.
- [Agent-preset surfaces](../ui-agent-preset/README.md) — the picker that hosts this manager's entries.
- [Slots](../ui-slots/README.md) — the slot contracts this package fills.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the records it writes: the presets those records synthesize own what the model sees.

#### KV Cache effect

None from this package; each synthesized preset's plugins own their prompt sections and tool schemas.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The roster in an open window does not push changes made elsewhere; the picker refreshes on reconnect and after local writes.
- Only zh, en, and ru dictionaries ship; the remaining locales fall back and can be added mechanically.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The dialog cannot be opened from a component mounted inside the picker menu: closing the menu unmounts the menu's children. Keep any future write path that opens a dialog through `openManager()` on the controller, which lives in the plugin scope.

</details>
