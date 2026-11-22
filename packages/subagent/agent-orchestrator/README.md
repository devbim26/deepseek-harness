---
description: "Foreground conversational orchestration over durable subagents: workers, evaluator, follow-ups, and an engine-written report."
kind: "package-reference"
---

# @deepseek-ai/dsh-agent-orchestrator

English | [中文](README.zh.md)

## Summary

Run several specialist subagents against one objective, let an evaluator judge their reports, and send targeted follow-ups to the same child Sessions instead of starting over. The engine keeps each worker's history and identity across rounds, refuses human questions, and turns every missing fact into an explicit gap. Finished runs carry a status of `complete`, `partial`, or `budget-limited`; failed and cancelled runs never produce a report that could be mistaken for a finished one. The service owns the round budget, the child cleanup, and the generated PDF.

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

Mount the plugin wherever a custom agent needs multi-specialist review, then call `ctx.agentOrchestrator.start()` with the exact live root Agent. A run is foreground: it resolves when every child is cleaned up.

### When to choose it

Choose this engine when one objective needs several independent specialist passes and an evaluator that can send follow-up questions back to the same workers. Choose the model-facing wrapper [dsh-tool-agent-orchestrator](../tool-agent-orchestrator/README.md) when a stored custom-agent record should expose the whole flow as one tool. Use a plain subagent instead when one delegate can answer directly.

### Minimal configuration

```yaml
plugins:
  - id: agent-orchestrator
    plugin: '@deepseek-ai/dsh-agent-orchestrator'
    config:
      provider: spawn
      maxHandoffChars: 65536
      maxSettledRuns: 32
      reportDirectory: reports
```

| Field | Default | Meaning |
|---|---|---|
| `provider` | `spawn` | Subagent provider used for workers and evaluator. |
| `maxHandoffChars` | `65536` | Maximum size of the serialized worker set handed to the evaluator. |
| `maxSettledRuns` | `32` | Process-local settled snapshots retained per service. |
| `reportDirectory` | `reports` | Session-relative directory receiving generated PDF files. |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-agent-orchestrator) is the exhaustive source for every accepted field. Round and parallelism limits are request fields, not plugin configuration: `start()` takes `maxIterations` (rounds including the first), `maxParallel` (simultaneously active workers), and the optional `report` title and details.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The engine issues no model request of its own: every model-visible word comes from the three prompts in `src/prompts.ts`, each delivered as a child's initial task.

<details>
<summary>Implementation internals — click to expand</summary>

The first round starts one child Session per assignment. A follow-up round continues the same child Session through `resumeActivation()`, so the delegate keeps its history and its identity. Workers run in parallel up to `maxParallel`; the evaluator runs once per round. The engine owns the round budget: `maxIterations` counts the first round, so 3 allows one initial round and two follow-up rounds. Every child is denied `ask_user_question` before its first model request. Only the exact live root Agent may own a run; a nested orchestration is rejected with `ORCHESTRATION_NESTED`.

| Status | Meaning | Report |
|---|---|---|
| `complete` | The evaluator accepted the collected reports. | Written |
| `partial` | The evaluator accepted the work with explicit gaps. | Written, marked incomplete |
| `budget-limited` | The last evaluator still requested follow-ups. | Written, marked incomplete |
| `failed` | The evaluator produced no usable decision, or a lifecycle step failed. | None |
| `cancelled` | The caller cancelled the run. | None |

Source map: `src/index.ts` defines the Service and validated `Config`; `src/run.ts` owns the round controller and child lifecycle; `src/prompts.ts` owns the three model-visible prompts; `src/report.ts` writes the PDF; `src/schemas.ts` parses evaluator decisions.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-tool-agent-orchestrator](../tool-agent-orchestrator/README.md) — the model-facing tool over a stored orchestration record.
- [dsh-subagent](../subagent/README.md) — the child Session lifecycle this engine drives.
- [dsh-tool-pdf](../../document/tool-pdf/README.md) — the report writer used for generated PDFs.

-----

<a id="model-experience"></a>
## Model Experience

### Worker task

#### What the model sees

The worker receives the assignment prompt followed by the autonomy statement and the report instruction: `Do not ask a human questions or wait for confirmation. Record missing facts as explicit assumptions or gaps and continue with the available evidence.` and `Return a structured report with summary, evidence, assumptions, and gaps.`

#### Token effect

One autonomy sentence and one report instruction per worker, appended to the assignment prompt.

#### KV Cache effect

The block is written once into the child's initial task, which becomes the stable prefix of every request in that child Session. Follow-up rounds reuse that prefix.

### Worker follow-up

#### What the model sees

A continuation on the same worker Session reads `Follow-up for your previous work: <question>`, optionally `New circumstances: <circumstances>`, the same autonomy statement, and `Return a new structured report that replaces your previous summary and accounts for this follow-up.`

#### Token effect

One follow-up header, the question and optional circumstances, and the autonomy and replacement instructions per follow-up round.

#### KV Cache effect

Append-only: the follow-up is appended after the worker's retained history, so the existing prefix stays reusable.

### Evaluator decision

#### What the model sees

The evaluator receives `Original objective: <objective>`, optional `Initial circumstances: <circumstances>`, `Current worker reports: <JSON>`, the autonomy statement, and the decision instruction: `Evaluate completeness. Return targeted follow-ups only for known assignment ids, or complete, partial, or blocked with a summary and explicit assumptions/gaps. Do not request more work than the remaining round budget can perform.`

#### Token effect

The dominant cost is the serialized worker set, bounded by `maxHandoffChars`; the fixed framing is five short lines. An oversized handoff fails with `ORCHESTRATION_HANDOFF_LIMIT` before any evaluator request starts.

#### KV Cache effect

The evaluator Session is reused across rounds, so each round's handoff is appended to the evaluator's retained history rather than replacing it.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Runs are foreground and process-local: a process restart does not resume them, and the owning adapter reports an unknown run as unavailable.
- Reports contain text and tables; child attachment images are not transferred into the parent Session.
- Only the exact live root Agent may own a run; a nested orchestration is rejected.
- The engine keeps at most `maxSettledRuns` settled snapshots per scoped service.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The engine deliberately owns no tool and no system-prompt section. Everything the model sees comes from the three prompts and from the child presets the caller selects. When changing a prompt, update its README block in the same change; the `verify-package-readme-model-experience` gate reads these headings.

</details>
