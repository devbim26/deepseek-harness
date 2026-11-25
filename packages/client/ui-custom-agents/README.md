---
description: "Custom-agent manager: create, edit, and remove user-defined agent presets through a create button a page renders. The dialog mounts in the frame-wide overlay, so it opens over any page and outlives the page that opened it. The form also offers the deployment-gated orchestrator flag with its delegate checklist and the picker-visibility toggle."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-custom-agents

English | [中文](README.zh.md)

## Summary

Custom-agent manager: create, edit, and remove user-defined agent presets through a create button a page renders. The dialog mounts in the frame-wide overlay, so it opens over any page and outlives the page that opened it. The form also offers the deployment-gated orchestrator flag with its delegate checklist and the picker-visibility toggle.

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

The row contributes two reusable Component Factories. `customAgents.createButton` is the "New custom agent" button: a page renders it wherever people create agents with `renderFactorySlot('customAgents.createButton', {})`. `customAgents.agentActions` is the icon-only edit and remove pair for one roster row, stacked: a page renders it beside each listed agent with the row's `id`, `version`, and `name`; edit opens the manager dialog on that agent, remove arms on the first press and deletes on the confirming press through the same controller. The preset picker adds no row of its own. The button opens the manager dialog, which the row hosts in `shell.overlay`, so the dialog opens over any main panel and outlives the page that opened it. Copy is locale-owned (`customAgents` namespace; zh, en, ru).

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[custom-agents-store.ts](src/client/custom-agents-store.ts) holds the catalog state and the dialog's open flag; the dialog host reads the one store, so an open dialog survives the page that opened it unmounting. Writes go through the typed `customAgentPresets` remote and emit the client-side `custom-agents/changed` event, which `ui-agent-preset`'s roster refresh subscribes to. [CustomAgentsModal.tsx](src/client/CustomAgentsModal.tsx) renders the roster in a scrollable left pane, the fields — including the deployment-gated orchestrator flag and the picker-visibility toggle — in the center, and the tool checkboxes plus the delegate checklist in the right pane strictly from the service-reported policy — the form can only offer what the deployment whitelist carries.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Custom preset service](../../preset/agent-preset-custom/README.md) — the durable records and validation behind this surface.
- [Agent-preset surfaces](../ui-agent-preset/README.md) — the picker that offers the agents this manager creates.
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

A page hosts the entry by rendering the Factory; it never mounts the dialog itself. Keep any path that opens a dialog through `openManager()` on the controller, which lives in the plugin scope; the overlay entry reads the same store.

</details>
