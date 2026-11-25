---
description: "Web Session-log ZIP export, Markdown copy, and an interactive PDF report: Host routes, the /export and /report commands, and Session Header actions."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-log-export

English | [中文](README.zh.md)

## Summary

`dsh-session-log-export` lets the Web interface export a session's complete history. The Session Header's more-actions menu offers `Copy Session as Markdown`, `Download session log`, and `Download PDF report`; the `/export` and `/report` slash commands start the ZIP download and the PDF report. The ZIP contains the session, its sub-sessions, and attachments. The PDF report renders the live session's messages, tables, and images into the session workspace and downloads it. The package owns authenticated Host routes, the Markdown transcript formatter, the report conversion, and the browser controls and feedback. The browser chooses the download destination and owns the clipboard.

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

Use this package when the Web bundle should let users export a session log. It requires Connection, the command registry, Session query and persistence, and attachments. The PDF report additionally requires the programmatic report service (`@deepseek-ai/dsh-tool-pdf/runtime`) and a live session. Mount the plugin, then choose `Copy Session as Markdown`, `Download session log`, or `Download PDF report` from the Session Header's more-actions menu, or type `/export` or `/report`; the browser copies the transcript, downloads `dsh-session-<id>.zip`, or downloads `dsh-session-<id>-report.pdf`.

### Copy Session as Markdown

`Copy Session as Markdown` copies the complete selected Session, including history that the client has not loaded, as portable Markdown. The transcript starts with the latest log-backed title. Human user messages are blockquotes in chronological order, final assistant replies remain ordinary Markdown, and earlier assistant commentary and tool activity in each turn are folded into a collapsible `<details>` section before that turn's final reply. A turn whose last committed assistant message carries tool calls has no final reply, so all of its activity stays folded. An incomplete turn renders the committed messages it has. Only append message events are exported. An unfinished assistant code fence is closed at the message boundary, and four-space or tab-indented code keeps its indentation.

The formatter reads the committed raw log, so a compaction surface replacement never removes earlier messages, and fork-inherited history appears once. The title and body come from one `readSession` snapshot. When persistence metadata reports a selected materialized artifact, the transcript adds a `Session file:` fenced text block with that exact path; without one, the block is absent. Only the selected Session and its inherited prefix are copied; descendant logs remain ZIP-only. Reasoning blocks, system and developer messages, injected user-role context whose source kind is not `user`, request headers and context, and runtime records are omitted. Images and files become readable labels; attachment bytes and authentication links never enter the transcript. Structural labels such as `Assistant`, `Tool`, and attachment placeholders are intentionally English; original message text stays unchanged. The text ends with exactly one newline.

The clipboard is one browser-wide destination, so this plugin instance runs one copy at a time. On hosts with `ClipboardItem` and `navigator.clipboard.write`, the write starts synchronously from the click with a promised `text/plain` Blob while the transcript is read; other hosts fall back to the shared clipboard helper after preparation. A request made while a copy is pending joins that operation and keeps the first click's Session. Every Session Header menu disables its copy row until the operation settles; unrelated actions remain available. Success, preparation-failure, or clipboard-failure feedback uses the root overlay toast. Disposal aborts the read and prevents later text from reaching the Blob; an operating-system clipboard write already accepted cannot be rolled back.

When `ui-message-feedback` is mounted, the same menu also offers `Feedback`, which opens its existing Session feedback dialog. Opening or dismissing that form does not export the Session or submit feedback. The feedback row follows the feedback plugin’s availability; both export actions remain independently available. [`ui-open-in-app`](../../client/ui-open-in-app/README.md) contributes its application submenu in a separated group after download and before feedback.

### Download PDF report

`Download PDF report` renders the live session into one PDF and hands it to the browser as a download. The report is a deterministic rendering of what the session already contains: the human user messages, the final assistant reply of every turn, and the images the session's own tool results produced. Reasoning, system and developer messages, injected context, tool output text, and intermediate assistant messages are omitted.

Markdown replies are converted into report blocks: headings and paragraphs become text, pipe tables become styled tables, fenced code becomes a code block that prints every line as written, and lists keep their source text. A Markdown image link keeps its alternative text; the report never resolves a link target and downloads nothing through it. Every human message and every final reply carries a structural `User` or `Assistant` heading; a reply that opens with its own heading keeps that heading. The pixels come from the images the session already stored as attachments, and every image is embedded once, taken from the latest committed result of its call.

The report is written into the session workspace under `reportDirectory` with a unique name, so repeated exports never overwrite each other, and the file stays there after the download. A report whose images were skipped ends with an `Images not included` section naming every skipped call and the reason.

The report reads the live session only. A closed or archived session has no live session to render, so the request fails with a clear error instead of starting an agent in the background. The export never asks the model to summarize anything, never calls the model adapter, and never publishes the file to a report panel.

### When to choose it

Choose it for a Web deployment that needs user-facing session export: a readable Markdown transcript for copying, a ZIP archive for downloading, a PDF report of the live session, or for a backend caller that already holds a complete committed logical event snapshot and needs the same Markdown conversion. Avoid it when a Host path write is needed: the browser operations keep their result in the browser, and the conversion utility performs no IO. The logs are serialized from persistence read handles, so any mounted backend is supported.

### Backend conversion

The package entry also exports `formatSessionMarkdown(events, sourcePath?)`: a pure backend utility for callers that already hold a complete committed logical event snapshot in seq order, including any inherited prefix. It reads the latest `session/title` event, returns Markdown ending in one newline, performs no IO, starts no plugin or Session, and does not mutate the events. An optional backend-resolved `sourcePath` is emitted verbatim in a dynamic fenced `Session file:` block after the title; omitted or empty paths add no block. Missing or blank titles produce `Untitled Session`. Only the supplied events are converted; descendant Session logs are not read.

```ts
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { formatSessionMarkdown } from '@deepseek-ai/dsh-session-log-export'

export function convertTranscript(events: readonly SessionEvent[], sourcePath?: string): string {
  return formatSessionMarkdown(events, sourcePath)
}
```

### Composition

```yaml
- id: session-log-download
  name: '@deepseek-ai/dsh-session-log-export'
```

The Web bundle mounts the package with Connection, `dsh-commands`, `dsh-client-ui-commands`, `dsh-client-ui-conversation`, `dsh-client-ui-context-menu`, and `dsh-client-ui-layout`. The conversation package owns the Header trigger, the context-menu service renders its shared popup, and layout declares `shell.overlay` for the download dialog and copy-feedback toast. Locale and command services supply translated copy and command acknowledgements. The PDF report additionally needs the Session query engine and the programmatic report service; mount `@deepseek-ai/dsh-tool-pdf/runtime` beside the package.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `compressionLevel` | `6` | DEFLATE level from 0 through 9 for each ZIP entry. |
| `reportDirectory` | `reports` | Session-relative directory receiving generated PDF reports. It must stay inside the session workspace; an absolute path, a drive-relative path such as `C:reports`, or a `..` segment fails at load. |
| `maxReportChars` | `200000` | Maximum number of text characters one PDF report may carry. A larger session is rejected instead of truncated. |

### Command contract

| Input | Result |
|---|---|
| `/export` | Records a human-command lifecycle; the submitting browser downloads the document-relative `api/session.export?sessionId=<id>&includeDescendants=true` (Host route `/api/session.export`) |
| `/export <path>` | An error; browser downloads choose their destination through the browser's ordinary download behavior |
| `/report` | Records a human-command lifecycle; the submitting browser downloads the document-relative `api/session.report.pdf?sessionId=<id>` (Host route `/api/session.report.pdf`) |
| `/report <argument>` | An error; the report renders the recorded session and takes no arguments |

### What to expect

The root dialog identifies the exported Session by ID and reports preparing, download started, or failed. Switching conversations keeps it visible. Different Sessions download concurrently, while their dialogs appear one at a time in initiation order; closing one reveals the next open dialog. Closing does not cancel the download or reopen its dialog on settlement. Repeated requests for the same in-flight Session share its operation and keep its original position; a new request after settlement takes a new position. One Session runs one document operation at a time: a PDF request during a ZIP download joins the running operation instead of starting a second one. The export includes the live session's newest events: the host endpoint flushes a live root session before reading, so a slash-triggered ZIP includes the `command/run` and `command/done` pair that started the download; cold persisted sessions need no flush. Each logical log uses the current generation's canonical filename inside the archive (`session.jsonl` for v0, otherwise `session.vN.jsonl`), including beneath each sub-session directory. Images use `media/<attachmentId>.<ext>`, and generic files use `files/<digest-prefix>/<digest>/<name>`. Generic-file bytes are read and compressed as bounded chunks, so exporting a large upload does not buffer it in full.

The PDF report reads the live session's committed log once, through the Session query engine and the same complete-log read as the Markdown copy. The request runs a preflight first: a missing session id, a session without a live agent, a session without reportable content, and a session above `maxReportChars` are each rejected before any file is written. The preflight writes nothing; the report is written once, per request, under a unique name.

Attachment collection reads declared content fields of built-in Session events and completed assistant stream blocks, including flat V4 tool-role messages. Unknown event payloads and unrelated fields remain unchanged in the exported log but do not cause attachment reads.

### Failures

The dialog shows a preparation error when the preflight fails before ZIP streaming starts — for example an unreachable or misconfigured host endpoint. A descendant or attachment read failure after the browser accepts the GET is reported by the browser download manager, not by the dialog. A Markdown preparation failure reports a toast asking the user to retry the Session read; a clipboard write failure reports a separate toast asking the user to check clipboard permission. Neither reports success for a partial or missing transcript, and no pending toast is shown.

The PDF report answers with a sanitized status instead of a partial document: a missing session id is a bad request, a session without a live agent is a conflict, a session without reportable content is an empty report, a session above `maxReportChars` is too large, and a missing Session query engine or report service is unavailable. A log read that fails, like a failure while writing or reading the document, is a server error without host paths.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the package wires the export control and points at the code that realizes it; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design split

The package has two halves. The Host half ([`src/index.ts`](src/index.ts)) registers the `/export` and `/report` commands and contributes the exact `GET`/`HEAD /api/session.export`, `/api/session.markdown`, and `/api/session.report.pdf` Fetch routes to Connection; [`src/archive.ts`](src/archive.ts) builds the bounded ZIP stream, [`src/markdown.ts`](src/markdown.ts) renders the Markdown transcript, and [`src/session-report.ts`](src/session-report.ts) converts a committed log into report blocks. The browser half ([`src/client/index.ts`](src/client/index.ts)) provides the shared download and Markdown copy controllers and UI, and observes `command/executed` so only the submitting browser starts a download.

The shared context-menu package declares the captured `sessionHeader` target, independent of Session-row and title context actions; the conversation package owns its Header trigger. This package contributes export and optional feedback rows that observe controller, availability, and locale sources. Its download dialog and copy toast mount in the root overlay independently of the Header lifetime.

### Download flow

Both entry paths issue a `HEAD` preflight to the document-relative `api/session.export?...`, then hand the GET route to the browser download manager without buffering the ZIP in JavaScript. One controller owns one in-flight download per session, collapses concurrent gestures into that operation, and cancels the preflight on plugin disposal. The root component selects the earliest open entry from the controller’s Session-keyed snapshot using each operation’s initiation order; no separate dialog queue is maintained. Disposal waits for all preflights to settle and prevents a late response from starting a browser save; a download already handed to the browser remains browser-owned.

The Host route is a feature-owned exact Fetch contribution. Connection applies its Host/Origin and browser-session checks and bridges the streaming `Response`; this package owns query validation, live-session flushes, handle-based log reads and attachment reads, ZIP generation, and HTTP status semantics.

### Markdown copy flow

The Header asks the Markdown copy controller for the clicked Session. During the click, the controller requests the deferred `ClipboardItem` write while it loads the document-relative `api/session.markdown?sessionId=<id>` route; other hosts fall back to the shared clipboard helper after preparation. The Host route reads the complete live-preferred logical log through `ctx.sessionQuery.readSession` and passes those events to the pure formatter. It separately asks `ctx.get('sessionPersistence')?.stat` for the selected materialized artifact path and passes that optional path to the formatter; a metadata-read failure is a sanitized preparation failure. The read is a detached export observation: it creates no Agent, retains no Session, and writes no Session data. It answers 404 for an absent Session and a sanitized 500 for every other read failure.

The controller holds one pending operation and one `shell.overlay` toast entry. A second Header request joins the pending operation, so the clipboard and its notice always describe the first click's Session. Both the preparation promise and the admitted clipboard write are observed; every rejection is contained. Disposal aborts the read, prevents later text from reaching the promised Blob, suppresses notices, and awaits admitted clipboard work.

### PDF report flow

The report route resolves the live agent that owns the requested session and reads its committed log once through `ctx.sessionQuery.readSession`; it makes no synchronous Session event read. [`src/transcript.ts`](src/transcript.ts) holds the projection both exports share — turns, messages, and the latest result per tool call — so the Markdown transcript and the PDF report describe the same visible session. The conversion in [`src/session-report.ts`](src/session-report.ts) selects the human messages, the final reply of each turn, and the tool results that carry images, and turns the Markdown of a reply into report blocks.

The route then calls the programmatic report service (`ctx.pdfReports`) with the live agent as the owner of the file, the report title, the blocks, and a request to append the skipped-image appendix. The service resolves the path against the session working directory, reads the images from the durable attachment store, writes the document, and reports which images it could not embed. The route reads the written file back and returns it as an attachment.

`HEAD` stops after the preflight: it resolves the agent, converts the log, and checks the size, but writes nothing and reads no attachment. `GET` repeats the preflight against the current log and writes the report once. Both entry paths issue the `HEAD` preflight to the document-relative `api/session.report.pdf?...` and hand the GET route to the browser download manager, so the document never passes through JavaScript.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the Web control to the host endpoint and the surrounding command and session surfaces.

- [dsh-client-connection](../../client/connection/README.md) — the authenticated Fetch-route carrier used by the Host endpoint.
- [Commands subsystem reference](../../../docs/subsystems/commands.md) — the human-command registry the `/export` command registers on.
- [dsh-client-ui-commands](../../client/ui-commands/README.md) — the browser command surface that renders and acknowledges `/export`.
- [Session Query package map](../README.md) — the retrieval family this package belongs to.

-----

<a id="model-experience"></a>
## Model Experience

### Human export and copy controls

#### What the model sees

Nothing. `/export` and `/report` stay on the human-command plane, and neither the ZIP download nor the PDF report enters model history. The Markdown copy action is also human-only: it reads the committed log, writes the browser clipboard, and appends no Session event. The PDF report asks no model to summarize anything: it renders the messages and images the session already recorded.

#### Token effect

Zero. The commands create no model turn, and none of the three export controls changes a request.

#### KV Cache effect

None. The log-only command lifecycle, the browser downloads, and the clipboard write do not change the derived request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when this package is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **Browser download, not a Host-path writer** — the browser chooses the local destination; no Host path or native folder action is returned.
- **Preflight reports only pre-stream failures** — a descendant or attachment failure after the browser accepts the GET is reported by the browser download manager, not by the dialog.
- **Markdown contains committed history only** — an unsettled live token chunk has no committed text, so it is absent from the copied transcript. Compaction and fork inheritance follow the raw log rather than the current model context.
- **Markdown copy is the selected Session only** — descendant Session logs are exported by the ZIP download, not by the Markdown copy.
- **The PDF report needs a live session** — a closed or archived session has no live agent to render, so the report is refused instead of starting an agent. Exporting a stored session without a live one is not implemented.
- **The PDF report publishes nothing** — the file stays in the session workspace and reaches the user as a browser download. It is not copied into a report panel and not sent to a chat, because those destinations need a quarter and a house that this export never receives.
- **The PDF report is a rendering, not a summary** — the report reproduces the recorded messages and images. It adds no conclusions, and its prose is the session's own text.
- **Transcript text is buffered in memory** — the complete Markdown string and its Blob are held before the clipboard accepts them. Browser clipboard limits can reject a large export; this package does not add a byte cap or truncate the requested complete transcript.
- **Accepted clipboard writes cannot be rolled back** — disposal stops pending preparation and feedback, but an operating-system write that already succeeded remains on the clipboard.
- **The source path is observed metadata, not an atomic log claim** — `stat` identifies the selected materialized artifact at export time. Live committed events can be ahead of that file, and an unmaterialized Session has no source-path block.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open design questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked pages.

#### Future: export destinations beyond the browser

The download is deliberately browser-scoped; a Host-path or native folder export would need a new endpoint contract and a decision on where the ZIP lands.

#### Future: the PDF report for a stored session

The report reads a live session because the live agent owns the working directory the report is written into. A stored session could be rendered by resolving its recorded directory instead, at the cost of a report that no longer belongs to a running session.

</details>
