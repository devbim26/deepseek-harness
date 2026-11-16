---
description: "Deployment-constrained, user-created agent presets: durable records mounted into the preset registry. User input becomes typed configuration only — never YAML or code the Loader executes."
kind: "package-reference"
---

# @deepseek-ai/dsh-agent-preset-custom

English | [中文](README.zh.md)

## Summary

Deployment-constrained, user-created agent presets: durable records mounted into the preset registry. User input becomes typed configuration only — never YAML or code the Loader executes.

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
- insert:
    - id: agent-preset-custom
      name: '@deepseek-ai/dsh-agent-preset-custom'
      config:
        instructionsPrefix: You are the drawings assistant of this site, powered by the {{model}} model.
        basePlugins:
          - id: agent-instructions
            name: '@deepseek-ai/dsh-agent-instructions'
            config:
              maxBytes: 65536
          - id: time-context
            name: '@deepseek-ai/dsh-time-context'
        allowedTools:
          ask-user:
            name: '@deepseek-ai/dsh-tool-ask-user'
          todo:
            name: '@deepseek-ai/dsh-tool-todo'
            label: Task list
            description: Keep a task list during long work.
```

| Field | Default | Meaning |
|---|---|---|
| `instructionsPrefix` | `''` | Site persona prepended to every custom agent's instructions. |
| `basePlugins` | `[]` | Fixed child rows every custom agent mounts, copied by the deployment from its standard preset, minus persona. |
| `allowedTools` | `{}` | Whitelist: entry key → the plugin row `{ name, config?, label?, description? }` a selecting agent mounts; the form renders one checkbox per entry, and an unchecked entry is a hard block — the agent never mounts the row. Records store keys only. |
| `maxNameChars` | `64` | Name length cap. |
| `maxDescriptionChars` | `200` | Description length cap. |
| `maxInstructionsChars` | `16384` | Instructions length cap. |
| `maxAgents` | `50` | Deployment-wide record cap. |

The client manager (`@deepseek-ai/dsh-client-ui-custom-agents`) calls the Remote surface `list | create | update | delete`. Every write re-validates the fields and the whitelist keys and fails loud with a coded `RemoteError` (`custom-agent-presets/invalid`, `/not-found`, `/limit`, `/conflict`). Updates carry the record's `version` for optimistic concurrency.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[index.ts](src/index.ts) opens the `custom_agent_presets` storage domain (json backend, one unit under the site `DSH_HOME`), re-registers every stored record at boot, and keeps each `agentPresets.register()` disposer. [definition.ts](src/definition.ts) synthesizes the registry definition: the persona row (site prefix + user instructions), the deployment's `basePlugins`, and the selected whitelisted rows. Updating disposes the previous registration first and registers the new revision; the registry retires the old revision while running Agents keep their composition. `invalidRecords: 'backup-and-skip'` quarantines a stored record that no longer parses: it is backed up, logged, and skipped, and the site stays up.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Registry](../agent-preset-registry/README.md) — the roster, revisions, and session binding these records join.
- [Storage subsystem](../../../docs/subsystems/storage.md) — the domain declaration and backend contract.
- [Storage domain](../../storage/storage-domain/README.md) — the typed domain form this service opens.

<a id="model-experience"></a>
## Model Experience

### Custom preset selection

#### What the model sees

The synthesized preset's `plugins` own the tools and prompt sections: the `persona` prefix — a `{{model}}` template plus the user's instructions — opens the prompt, and the whitelisted rows contribute their tools.

#### Token effect

Each mounted row declares its own prompt sections and tool schemas.

#### KV Cache effect

Running Agents retain the composition they started with; new sessions build their prefix from the current record.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A preset is not a security sandbox; the deployment owns the whitelist and every row inside it. Extend `allowedTools` only with a sandbox review of the added rows.
- A whitelist entry may mount an `mcp-client` row, but the deployment must keep any host-plane row with the same `serverName` disabled: per-agent mounts are the blocking mechanism, and a host-plane row would leak the tools to every agent and collide with the per-agent namespace.
- The catalog is shared per `DSH_HOME`: the site's single password gate carries no identity, so edit and delete rights are site-wide.
- A record whose stored schema no longer parses is skipped at open (backup + log); the roster shows nothing for it.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The domain name carries underscores (`custom_agent_presets`) because `UNIT_NAME_RE` forbids hyphens; the remote error codes keep the hyphenated domain spelling.

</details>
