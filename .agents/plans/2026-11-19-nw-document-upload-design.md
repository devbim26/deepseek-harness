# North Waterfront client document upload — Design

> **Status:** user-approved 2026-11-19. Implementation plan to follow in a separate file.

**Goal:** the north-waterfront (NW) client site gets file upload through the composer "+" menu: the client attaches PDF, DOC/DOCX, TXT/MD/CSV, XLS/XLSX and other files, and the agent can work with the documents' **content**, not just their names.

**Approved approach:** A — text extraction in the browser at pick time; extracted text rides in the user message next to the file card. No core (api/core), session-format, or SDK schema changes.

## Background

- The base web app already ships the full attachment chain: the composer "+" opens the command popup with an "Add file" row (`ui-conversation`), drafts upload through the `file-upload` host service (enabled on NW), and `ui-attachment` renders the draft rail and drop overlay.
- The NW overlay disables `ui-attachment` with the comment "Chat attachments are dead weight without fs tools". That rationale is stale: the NW agent now has `read`/`grep`, and the sandboxed filesystem permits reads in every mode, including the attachment store path the model-visible file handle names.
- Gap the design closes: the fs `read` tool decodes text only. PDF/DOCX/XLSX are binary, so a plainly attached document is visible to the model (name, size, saved path) but its content stays unreadable. The LibreOffice-backed office stack needs shell, which the client site never grants.

## Design

### Extraction (browser, at pick time)

- `ui-conversation` (the draft owner, same plugin that owns uploads) gains a document-extract module. `createDrafts` starts extraction in the background for every non-image file, in parallel with the upload.
- Formats: PDF via pdf.js, DOCX via mammoth, XLS/XLSX via SheetJS — each loaded with a dynamic `import()` so the startup bundle stays lean. TXT/MD/CSV decode as plain text.
- `.doc` (Word 97 binary) has no browser parser: the card immediately shows "пересохраните в .docx"; the file still attaches as a plain file attachment.
- Types outside the extraction list attach verbatim with no extraction attempt (today's behavior); the picker's `accept` stays open.
- The file itself always uploads verbatim, exactly as today; extraction is additive.

### Message assembly

- `serializeAttachments()` emits, per document draft with extracted text, the `{type:'file', receiptId}` block followed by a text block headed `Содержимое файла <имя>`; truncation is stated in the block. Order is deterministic; failure of one document's extraction degrades to the file block alone.
- Both the file and the text land in the durable `UserMessage.content`, satisfying model-visible ⟺ logged without persistence changes.

### Limits and failure handling (config on `ui-conversation`, values pinned by the NW overlay)

- `maxFileBytes` (default 25 MiB on NW): over the limit the draft enters an error state and cannot be sent; the rest of the message sends.
- `maxExtractChars` (default 50 000 on NW): larger extractions truncate with an explicit marker.
- Scanned PDF (empty text layer): card reports "текст не извлечён (скан?)"; the file sends as a plain attachment.
- Parse errors: the file sends without text; the card shows the reason. Send is never blocked by an extraction failure.

### NW overlay (`client-north-waterfront.patch.yml`)

- Re-enable `ui-attachment`; rewrite the stale "dead weight" comment (fs tools exist now; documents deliver their text into the message).
- Same-id `ui-conversation` config override: `maxFileBytes`, `maxExtractChars`.
- Persona prefixes (standard preset and custom-agent builder): the agent knows clients attach documents, the content arrives in the message, and truncated content can be requested again.
- Drag-and-drop onto the composer flows through the same intake path and gains the feature for free.

## Components and files

| Location | Change |
|---|---|
| `packages/client/ui-conversation/src/client/document-extract.ts` (new) | Format routing, per-format lazy parsers, truncation; pure module |
| `packages/client/ui-conversation` draft model, `serializeAttachments` | Extraction state on file drafts; file+text block emission |
| `packages/client/ui-conversation` `Config` | `maxFileBytes`, `maxExtractChars` |
| `packages/client/ui-attachment` `FileCard` | Extraction card states (extracting / done / truncated / no-text / error / .doc hint) |
| `packages/bundle/web-app/client-north-waterfront.patch.yml` | Overlay changes above |
| `DEPLOY-CLIENT-SITE.md`, package READMEs (bilingual pairs) | Documentation |

Dependencies added to `ui-conversation`: `pdfjs-dist`, `mammoth`, `xlsx` (Apache-2.0/BSD-2/Apache-2.0).

## Out of scope

- Server-side extraction or any `tool-fs`/office-stack changes; `.doc` content parsing; image attachment behavior (unchanged); new session events or `SESSION_FORMAT_VERSION` movement.

## Testing and verification

- Unit tests (100% per-file coverage applies): format routing and truncation in `document-extract.ts`; `serializeAttachments` pair emission and failure degradation; card states.
- Recorded-session snapshot covering a document attachment message (model-visible change); TypeScript and Python SDK expected outputs in the same change when affected.
- `pnpm run build:artifacts` then `build:check` before completion; live check on the NW site via `dsh-web-north-waterfront.cmd` (upload PDF/DOCX/XLSX/TXT, confirm the agent cites content).
