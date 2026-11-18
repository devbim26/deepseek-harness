---
description: "Read documents attached to the conversation through the document_read tool: one authorized, bounded text window per call."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-document

English | [中文](README.zh.md)

## Summary

Use `document_read` to read the text of a document the user attached to the conversation. The model passes the attachment path from its handle line and receives one bounded window with a continuation cursor, so a long document costs repeated small reads instead of one huge result. The requested path must be a file attachment of the calling Session, so restricted deployments can answer document questions without shell or filesystem tools. TXT and CSV extract today; the PDF, Word, and workbook extractors are deferred work.

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

Mount the plugin next to a filesystem service and the attachment store:

```yaml
- name: '@deepseek-ai/dsh-tool-document'
  config:
    maxInputBytes: 52428800
    maxChars: 20000
    maxRows: 500
    timeoutMs: 30000
```

`path` must name a file attachment of the calling Session — an upload or a tool-result file — and every other path fails with `NOT_AN_ATTACHMENT`. TXT and CSV decode as UTF-8 with a windows-1251 fallback for legacy Russian files, normalize line endings and blank runs, and read as a character window: `offset` starts the window (default 0), `limit` caps it (default and ceiling `maxChars`), and `nextOffset` in the result names the next window while text remains. A source larger than `maxInputBytes` fails with `TOO_LARGE`; an extraction longer than `timeoutMs` fails with `TIMEOUT`. Every bound is a positive integer and fails loud at load when it is not.

| Field | Default | Meaning |
|---|---|---|
| `maxInputBytes` | `52428800` | Largest accepted source document |
| `maxChars` | `20000` | Characters in one returned window; the ceiling for `limit` |
| `maxRows` | `500` | Workbook rows in one returned window |
| `timeoutMs` | `30000` | Extraction deadline per call |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-document) is the exhaustive source for every accepted field.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`src/index.ts` registers `document_read` through `defineTool`. The execute path requires an agent Session, races the caller's signal with the `timeoutMs` deadline, authorizes the path, reads the bytes through `ctx.fs.readBytes` under `maxInputBytes`, dispatches on the extension, and folds the extracted window into the canonical value with `nextOffset`, `nextPage`, or `nextRow` cursors.

`src/paths.ts` collects every `file` content block from the Session's logged `user/message` and `tool/result` events, resolves each attachment's stored host path, and accepts the request only when it matches one of them by the filesystem's process path.

`src/extract/` dispatches by extension: `text.ts` decodes UTF-8 with a windows-1251 fallback and `normalize.ts` folds CRLF, trailing spaces, and long blank runs. Extensions without an extractor fail as `UNSUPPORTED_FORMAT`; the page, sheet, and row request fields and their result fields already exist for the deferred extractors. `src/render.ts` renders the `<path>` file envelope, the metadata line, the window text, and the continuation hint; `src/errors.ts` carries the stable failure codes.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-attachment](../../attachment/attachment/README.md) — the durable store whose stored file paths the tool authorizes.
- [dsh-tool-office](../tool-office/README.md) — render, convert, and recalculate authorized Office files.
- [dsh-tool-fs](../../fs/tool-fs/README.md) — the `read` and `grep` pair for workspace files that are not attachments.

-----

<a id="model-experience"></a>
## Model Experience

### document_read

#### What the model sees

The result renders one `<path>` file envelope with a metadata line (format, byte size, window position), the window text, and a continuation hint that names the exact next `offset`, `page`, or `row` argument. Failures arrive as classified codes: `NOT_AN_ATTACHMENT` for a path outside the Session's attachments, `UNSUPPORTED_FORMAT` for an extension without an extractor, `TOO_LARGE`, and `TIMEOUT`.

#### Token effect

Each call appends one tool result whose text is capped by `maxChars`.

#### KV Cache effect

Continuation cursors append each next window as a new tool result at the end of the transcript, so reading a long document adds suffix turns and never edits earlier results.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **TXT and CSV extract today** — PDF, DOCX, DOC, XLSX, and XLS are announced by the tool schema but land as their own implementation tasks; until then they fail with `UNSUPPORTED_FORMAT`.
- **Attachment paths only** — the tool reads documents attached to the calling Session and never arbitrary workspace paths; workspace files belong to `read` and `grep`.
- **One window per call** — a long document always needs follow-up calls; the continuation cursor keeps every read bounded.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
