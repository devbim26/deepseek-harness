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
| `delegation` | — | Delegation row for orchestrators (`name` + base `config` + optional `rosterTemplate` + optional `control`); the field's absence disables the manager's orchestrator flag. The service adds `allowedAgentPresets` from the record and appends a delegate roster (`rosterTemplate` lead-in + one `- <id> «<name>» — <description>` line per delegate) to the orchestrator's persona; an omitted or empty `rosterTemplate` leaves the persona without roster text. `control` (`name` + base `config`) mounts one extra orchestrator-only row beside the delegation row — typically `@deepseek-ai/dsh-tool-subagent-control` for the shared `list_agents` / `wait_agent` / `send_message` / `interrupt_agent` tools. |
| `orchestration` | — | Conversational orchestration template for orchestrators: the `engine`, `tool`, `pdf`, and `present` rows, plus an optional `evaluatorPreset`. It takes precedence over `delegation`. The mounted group owns the engine, the `orchestrate_agents` tool, the PDF writer, and the file delivery, and the PDF and present rows are deduplicated by package name against `basePlugins` and the record's selected tools. The persona also carries the stored delegate roster with a fixed lead-in naming `orchestrate_agents`, so the model learns the stored delegate ids without the user writing them into the instructions. |
| `orchestratorDefaults` | `{ maxIterations: 3, maxParallel: 3, autoReport: true }` | Values materialized for legacy records and omitted wire fields. |
| `orchestratorCeilings` | `{ maxIterations: 10, maxParallel: 10 }` | Maximum stored iteration and parallelism values; a value above the ceiling is rejected. |
| `maxNameChars` | `64` | Name length cap. |
| `maxDescriptionChars` | `200` | Description length cap. |
| `maxInstructionsChars` | `16384` | Instructions length cap. |
| `maxAgents` | `50` | Deployment-wide record cap. |

An orchestrator is a record with `isOrchestrator: true` and a non-empty `delegates` list (ids of existing ordinary agents, never the agent itself). Synthesis mounts the `delegation` row with `allowedAgentPresets: delegates` and, when `rosterTemplate` is set, appends the delegate roster to the persona — the model learns whom it can launch without the instructions naming them. With `orchestration` configured, the roster is appended for every orchestrated record too, with the fixed lead-in `Delegates available to orchestrate_agents`, which also states that assignments accept only the stored delegate ids. The deployment-authored `control` row mounts beside the delegation row, giving the orchestrator the shared child-control tools. A list emptied by the deletion cascade leaves both rows unmounted while the flag survives. An agent referenced by another record's `delegates` cannot become an orchestrator; deleting an agent cascades the reference cleanup, and updating one remounts referencing orchestrators so their roster mirrors the current name and description (their stored records keep their versions). `hidden` removes the preset from pickers (`agentPresets/list` carries the flag) while the definition stays mounted and launchable by orchestrators.

The client manager (`@deepseek-ai/dsh-client-ui-custom-agents`) calls the Remote surface `list | create | update | delete`. Every write re-validates the fields and the whitelist keys and fails loud with a coded `RemoteError` (`custom-agent-presets/invalid`, `/not-found`, `/limit`, `/conflict`). Updates carry the record's `version` for optimistic concurrency.

A deployment that configures `orchestration` gets a second Remote surface, `customAgentOrchestrations`, with `orchestrationStart`, `orchestrationStatus`, and `orchestrationCancel`. It accepts the objective, optional circumstances, an optional delegate subset, and report display metadata; the delegates, the evaluator preset, the iteration and parallelism limits, and the reporting flag come from the stored record. The adapter resolves the exact live root Agent, verifies its composed preset against the stored orchestrator, and starts the run through the engine service of that Agent's own preset revision. The caller's signal governs admission only: the run continues after the call returns, and an unknown run is reported as unavailable rather than as a stale success.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[index.ts](src/index.ts) opens the `custom_agent_presets` storage domain (json backend, one unit under the site `DSH_HOME`), re-registers every stored record at boot, and keeps each `agentPresets.register()` disposer. [definition.ts](src/definition.ts) synthesizes the registry definition: the persona row (site prefix + user instructions + the delegate roster for orchestrators), the deployment's `basePlugins`, and the selected whitelisted rows. Mounting resolves the delegate records from the same table and fails loud on a missing one. Updating disposes the previous registration first and registers the new revision, then remounts referencing orchestrators; the registry retires the old revision while running Agents keep their composition. `invalidRecords: 'backup-and-skip'` quarantines a stored record that no longer parses: it is backed up, logged, and skipped, and the site stays up.

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

The synthesized preset's `plugins` own the tools and prompt sections: the `persona` prefix — a `{{model}}` template plus the user's instructions — opens the prompt, and the whitelisted rows contribute their tools. An orchestrator's prefix additionally carries the delegate roster: the deployment's `rosterTemplate` lead-in followed by one `- <id> «<name>» — <description>` line per delegate, so the `subagent` tool's `agent_preset` enum reads as named roles rather than bare ids. An orchestrated preset (the conversational `orchestration` template) carries the same roster with the fixed lead-in `Delegates available to orchestrate_agents`, which also states that assignments accept only the stored delegate ids.

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
