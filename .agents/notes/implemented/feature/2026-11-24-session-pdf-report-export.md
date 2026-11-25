# Agent Note: interactive session PDF report

Status: implemented

English | [中文](2026-11-24-session-pdf-report-export.zh.md)

## Problem

A PDF report reached the product through two paths, and both of them spend a model turn to produce it. The model-facing `pdf_report` tool lets the model compose a curated document from text, tables, and images it already produced. The conversational orchestrator writes its own report after its workers and evaluator settle, so the report states what the run actually found. Both paths answer "what did the agent decide to write", and both require the model to be involved before a file exists.

The Web session export already offers two human actions, a ZIP archive and a Markdown transcript. A user who wants a document of the current session — the questions asked, the answers given, the crops the session produced — had no way to get one without asking the model to summarize the conversation again. The answer was already in the session log, and restating it in a prompt costs a request, tokens, and a second turn whose wording the user does not control.

A natural-language trigger ("создай отчёт") was not an option. Recognizing it means guessing which phrasing means the export and which means a request for the agent to write something new; the same sentence means different things in different sessions. The existing export actions are explicit, and the session export already owns the browser dialog, the download, and the human-command plane.

## Decision

**A third reporting path renders the live session's own records, and the user selects it explicitly.**

`@deepseek-ai/dsh-tool-pdf/runtime` is a new plugin entry of the PDF package. It provides the existing writer as the service `ctx.pdfReports` and registers no tool, so no preset, agent, or model request gains a schema or a token because of it. The scoped `pdf_report` tool keeps its own entry and its own isolate realms; the orchestrator keeps writing its reports through the same writer.

`@deepseek-ai/dsh-session-log-export` owns the new path. The Session Header offers `Download PDF report`, and the human command `/report` starts the same operation; neither is reachable through ordinary prose. The Host route `GET /api/session.report.pdf?sessionId=<id>` resolves the live agent that owns the session, reads its committed log once through `ctx.sessionQuery.readSession`, and converts it into report blocks: the human user messages, the final assistant reply of every turn, and the images the session's own tool results produced. Markdown replies become text, pipe tables become styled tables, fenced code becomes a code block that prints every line as written, and lists keep their source text. A Markdown image link keeps its alternative text; the report never resolves a link target. The pixels come from the images the session already stored as attachments.

The report is written through the shared writer into the session workspace under a unique name, so repeated exports never overwrite each other, and the file stays there after the download. `HEAD` performs the preflight only and writes nothing.

Both exports read one shared transcript projection, so the Markdown transcript and the PDF report describe the same visible session instead of drifting apart.

## Alternatives considered

**Let the model answer "создай отчёт" and assemble the report from its own summary.** Rejected: the document would describe what the model chose to write rather than what the session recorded, it would cost a request and tokens, and the recognition of the trigger would be a guess about natural language. The user asked for the recorded session, and the recorded session is what the export renders.

**Read the live session's events through `Session.snapshotEvents()`.** Rejected: the [synchronous Session event read decision](../architecture/2026-09-09-deprecate-synchronous-session-event-reads.md) prohibits new calls to the deprecated synchronous historical readers and new wrappers around them. `ctx.sessionQuery.readSession` is the explicit asynchronous read of one complete committed log, the Markdown copy already uses it, and the live agent still owns the directory the report is written into.

**Serve the report of a closed, stored session through `ctx.sessionQuery` instead of refusing it.** Rejected: the report is written into the session working directory, and that directory belongs to the live agent that owns the session. A stored session has a recorded directory, but a report built from it belongs to no running session, and the workspace a user expects to find the file in is the live one. The live-only rule stays explicit: a closed session is refused rather than silently started.

**Publish the report into the client site’s reports panel and send it to Telegram.** Rejected: both destinations need the quarter and the house, which this export never receives and must not guess. The autonomous checks keep publishing their own reports through the publication service, and the interactive export stays a download.

**Mount the existing `pdf_report` tool and call it from the Host.** Rejected: the tool's input is model-shaped and its result is a tool result; a Host path would pay for a model turn and would put the document in model history. The programmatic runtime is the same writer without the tool around it.

**Add a second export package next to `dsh-session-log-export`.** Rejected: the export already owns the Session Header actions, the shared dialog, the human commands, and the document-relative routes. A second package would split one user-visible surface across two owners and duplicate the FIFO download state.

## Consequences

- The direct export costs no model request, no token, and no session message: the session log gains only the `command/run` and `command/done` pair of the human command.
- The report is a rendering, not a summary. It reproduces the recorded messages and images and adds no conclusions of its own.
- The export reads a live session only. A closed or archived session is refused with a clear status instead of starting an agent in the background.
- The log read is the Markdown copy's read: one asynchronous complete-log observation through the Session query engine. The export adds no synchronous Session event read.
- The file stays in the session workspace and reaches the user as a browser download. Nothing is published to a report panel and nothing is sent to a chat.
- A report above the configured text limit is refused rather than truncated, and a report without content is refused rather than written empty.
- The PDF package now has two entries: the model-facing tool and the programmatic runtime. The runtime is the entry a Host mounts; the tool stays the entry an agent preset mounts.
- Fenced code reaches the writer as a programmatic `code` block, so the Markdown subset of a text block is never read out of code. The `pdf_report` tool schema is unchanged, and the model cannot pass a code block.
- The shared transcript projection is the single definition of a visible session for both exports; a change to what a session shows lands in one place.

## Testing

The composition test mounts the session store, the command plane, the export package, the PDF runtime, the agent registry, the tool registry, the session projections, the system prompt, the working directory, the local filesystem, and the local attachment store through the Loader. It runs `/report` against a live agent and asserts that the session log gained no assistant message and no step, that no model adapter is mounted at all, that the runtime registered no `pdf_report` tool, that the `HEAD` preflight wrote no file, and that the `GET` wrote one report into the workspace. A real Session query engine needs a persistence backend this composition does not mount, so the composition answers the route's complete-log read from a stub over that live session. The route suite stubs the engine on its own and covers every status, a log read that fails, a written document that cannot be read back, and an aborted request before the read and during the write.

The browser scenario drives the shipped Web composition: the Session Header action and the `/report` command each produce one download, the downloaded file starts with the PDF signature, the workspace holds one report per export, and the session log shows no assistant message.
