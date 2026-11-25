# Agent Note: conversational agent orchestration

Status: implemented

English | [中文](2026-11-22-conversational-agent-orchestration.zh.md)

## Problem

Delegation existed only as a prompt-only tool: an orchestrator agent received a roster of delegate names in its persona and called `subagent` itself. The roster had to be written into the deployment prompt, the orchestrator decided which delegates to run and how to judge their answers, and the resulting report was assembled by the model through `pdf_report` and `report_publish`. Nothing in that path verified that a delegate existed, bounded the number of rounds, stopped the model from asking a human a question, or produced a report whose contents came from the delegates rather than from the orchestrator's own summary.

The subagent runtime also could not continue a child conversation: `sendMessage` returned only a message id, so a caller could not read the child's answer or ask it a follow-up on the same Session. A programmatic report writer and a programmatic file delivery did not exist either; both were reachable only as model tools.

## Decision

**The orchestration engine owns the workers, the evaluator, and the report; the model-facing tool and the Remote adapter only carry stored intent into it.**

`@deepseek-ai/dsh-agent-orchestrator` is a scoped service (`ctx.agentOrchestrator`) that runs one foreground run: workers execute in parallel up to a stored limit, an evaluator judges the collected reports and may request targeted follow-ups on the same worker Sessions, and the engine writes the report itself through `ctx.pdfReports`. `@deepseek-ai/dsh-tool-agent-orchestrator` exposes that engine to the model as `orchestrate_agents`: the model supplies an objective, optional circumstances, and an optional subset of stored delegates, while delegates, evaluator preset, iteration and parallelism limits, automatic reporting, and result bounds come from the deployment config and the stored record.

`@deepseek-ai/dsh-subagent` gained `SubagentRuntime.resumeActivation()`: it continues a durable child on the same Session, returns the result of the new round rather than the accumulated history, and accepts a per-round output schema plus an optional local setup hook that runs after the child's preset is restored and before its first accepted prompt. The engine uses that hook to deny `ask_user_question` in every child before its first model request; the model-facing tool adds the same denial for the root scope and lifts it in a `finally` block.

`@deepseek-ai/dsh-agent-preset-custom` owns the stored side: a new optional `orchestration` template mounts the engine, the tool, the PDF writer, and the file delivery inside one isolate group, deduplicating PDF and present by package name against the deployment's base rows and selected tools. The legacy `delegation` template stays for deployments that still mount the prompt-only tool. The service also gained a separate `CustomAgentOrchestrations` Remote (`orchestrationStart`, `orchestrationStatus`, `orchestrationCancel`) that resolves the exact live root Agent, verifies its composed preset against the stored orchestrator record, and takes delegates and limits only from that record.

## Alternatives considered

**Let the orchestrator model keep composing the report through `pdf_report` and `report_publish`.** Rejected: the report then describes what the orchestrator chose to write, so an unfinished or partial run looks like a finished report. The engine knows the status of every worker and the evaluator's decision, so it writes the report and marks partial and budget-limited outcomes as incomplete.

**Give the model the delegate list, the evaluator prompt, and the limits as tool arguments.** Rejected: the model would choose which delegates run and how many rounds they get, and a deployment could no longer state that a stored orchestrator runs at most three rounds over at most three parallel workers. Those values now live in the deployment config and the stored record; the tool exposes only the objective, circumstances, and the delegate subset.

**Let the Remote adapter own the run and let the engine own only the workers.** Rejected: then two owners would decide the round budget and the terminal status, and a caller could not tell an unavailable run from a failed one. The engine owns the run and its terminal outcomes; the adapter owns admission, authorization, and the mapping of one run onto a Session.

**Keep asking the human a question when a delegate lacks data.** Rejected: an unattended check has no human to answer, so a question ends the run. Children record the missing fact as a gap and continue; the guard that denies the question is installed before the first model request, because a later guard would leave one request unguarded.

## Consequences

- A stored orchestrator record carries `orchestratorMaxIterations`, `orchestratorMaxParallel`, and `orchestratorAutoReport`; legacy records and omitted wire fields resolve to the configured defaults of 3, 3, and true without a domain version bump.
- Complete, partial, and budget-limited runs are successful outcomes with an explicit status; failed and cancelled runs are errors and never produce a success report. Partial and budget-limited reports start with "Неполный результат" and list the gaps.
- The run is foreground and process-local. After a process restart the Remote reports the run as unavailable rather than as a stale success, and the NW Checks journal marks an unfinished run as interrupted instead of resuming it.
- PDF reports contain text and tables; child attachment images are not transferred into the parent Session.
- The interactive session report ([interactive session PDF report](../feature/2026-11-24-session-pdf-report-export.md)) is a separate path: it renders the live session's own records for a human, reaches neither the engine nor the model adapter, and publishes nothing.
- The NW client site runs the orchestrator through the direct engine path: the Checks plugin calls the same Remote methods in-process, publishes the returned PDF through the `reportPublisher` service of the Reports plugin, and delivers it to Telegram only after a numeric `message_id` confirms the delivery.
