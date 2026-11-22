---
description: "Model-facing orchestration tool that runs a stored custom-agent record's delegates and evaluator as one autonomous tool call."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-agent-orchestrator

English | [中文](README.zh.md)

## Summary

Give a stored custom-agent record one `orchestrate_agents` tool that runs its configured delegates and evaluator as an autonomous orchestration. The model supplies an objective, optional circumstances, and an optional subset of delegates; the stored record owns the delegate presets, round and parallelism limits, reporting, and result bounds. A call returns `complete`, `partial`, or `budget-limited` with a bounded summary, worker rounds, and explicit gaps. Failed and cancelled runs are tool errors. Human questions are denied for the duration of the run.

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

Mount one instance into a custom-agent record that already composes the orchestration engine. The tool then exposes the record's stored delegates as a single model call.

### When to choose it

Choose this tool when a stored custom agent should offer several specialist reviews through one tool, with the deployment deciding which delegates exist and how many rounds they may run. Choose [`dsh-agent-orchestrator`](../agent-orchestrator/README.md) directly when code owns the run rather than a stored record. Use [`dsh-tool-subagent`](../tool-subagent/README.md) instead when one delegate should answer a task directly.

### Minimal configuration

```yaml
plugins:
  - id: tool-agent-orchestrator
    plugin: '@deepseek-ai/dsh-tool-agent-orchestrator'
    config:
      delegates:
        - id: reviewer
          name: Reviewer
          description: Reviews the objective for correctness and missing evidence.
      maxIterations: 3
      maxParallel: 3
      autoReport: true
```

| Field | Default | Meaning |
|---|---|---|
| `delegates` | required | One to ten unique `{ id, name, description }` records this preset may run; each `id` names a stored delegate preset. |
| `evaluatorPreset` | none | Preset for the evaluator child; omission uses the owning orchestrator record. |
| `maxIterations` | `3` | Worker and evaluator rounds, including the first, from 1 to 10. |
| `maxParallel` | `3` | Simultaneously active workers, from 1 to 10. |
| `autoReport` | `true` | Whether a successful domain outcome creates and delivers a PDF report. |
| `maxSummaryChars` | `4000` | Maximum characters of the summary returned to the model. |
| `maxGapCount` | `32` | Maximum gap entries returned to the model. |
| `maxGapChars` | `500` | Maximum characters per returned gap entry. |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-agent-orchestrator) is the exhaustive source for every accepted field. None of these fields are model-writable.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin registers one tool and owns nothing else. At execution it resolves the orchestration engine and the file-delivery service from the caller's preset, with the global service as fallback, then starts a foreground run and maps its result onto the bounded tool result. Configuration is validated at load: empty or duplicate delegate ids and names fail the plugin mount with `ORCHESTRATION_INVALID_REQUEST` instead of failing the first call.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Config schema, delegate selection, tool definition, guard lifetime, result mapping |
| [`src/error.ts`](src/error.ts) | Coded tool failures: invalid request, failed run, cancelled run |
| [`src/types.ts`](src/types.ts) | Model-safe result, worker, status, and PDF metadata types |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-agent-orchestrator](../agent-orchestrator/README.md) — the engine this tool drives.
- [dsh-tool-subagent](../tool-subagent/README.md) — single-delegate delegation with the same completion-notice model.
- [dsh-agent-preset-registry](../../preset/agent-preset-registry/README.md) — the scoped services that resolve the engine and delivery surface.
- [dsh-tool-pdf](../../document/tool-pdf/README.md) — the report writer the engine uses.

-----

<a id="model-experience"></a>
## Model Experience

### Tool definition

#### What the model sees

Every request in the owning Session carries `orchestrate_agents` with its description and the three parameters below.

##### The tool description

```markdown
Run the configured delegates and evaluator as one autonomous orchestration. The delegates work in parallel up to the stored limit, the evaluator can send targeted follow-ups on the same agent conversations, and the tool returns a consolidated result. Use this for a task that benefits from several specialist reviews; do not use it for a single delegate or a task you can complete directly.
```

##### The parameter descriptions

```markdown
- `objective`: Complete user objective for the orchestration.
- `circumstances`: Optional facts and constraints available at the start. Missing facts belong in the resulting gaps, not in a question to the user.
- `assignments`: Optional subset of the configured delegates with a specific initial task for each. Omit to run every configured delegate.
```

#### Token effect

Fixed: the description and the three parameter descriptions per request in the owning Session.

#### KV Cache effect

Prefix-stable: the definition is part of the tool prefix, so it is written once and reused by every request in that Session.

### Tool result

#### What the model sees

The rendered text is `<status>: <summary>`, followed by `PDF: <path>` when the run produced a report. The structured value also carries the run id, its rounds, each worker's assignment id and round count, and the bounded gap list.

#### Token effect

`summary` is truncated to `maxSummaryChars`; the gap list to `maxGapCount` entries of `maxGapChars` each. A run without a report omits the PDF line.

#### KV Cache effect

Appended after the retained conversation; the existing prefix stays reusable.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These constraints follow from the engine and the stored-record ownership model; none of them are a general orchestration backlog.

- **Runs are process-local and foreground** — a process restart does not resume them, and the call occupies its tool execution until every child is cleaned up.
- **Reports carry text and tables** — child attachment images are not transferred into the parent Session.
- **Only the exact live root may own a run** — a nested orchestration is rejected by the engine.
- **Stored choices win** — model arguments cannot add a delegate, change a preset, raise a limit, or disable reporting.
- **Automatic reporting needs the delivery service** — an enabled `autoReport` without `fileDeliveries` fails the call with `ToolContextUnavailableError` instead of returning a report nobody can open.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The tool deliberately keeps no state: every call resolves its services, starts one run, and disposes it in `finally`. When an outcome or limit changes, update the Model Experience blocks and the Known Limitations bullets in the same change; both gates read these headings. Delegate ids double as preset ids, so a stored record and its preset catalog must stay in step.

</details>