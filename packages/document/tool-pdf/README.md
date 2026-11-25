---
description: "Assemble PDF report files from text sections, tables, and tool-result images with the pdf_report tool or the programmatic runtime, without shell or Python."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-pdf

English | [中文](README.zh.md)

## Summary

Use `pdf_report` to write a PDF report file into the Session working directory. The model passes ordered text, table, and image blocks referencing earlier tool calls; the tool reads those images from the Session log through the durable attachment store and embeds them. Tables render with a filled header row, zebra rows, and fitted column widths. No shell, Python, or filesystem tools are needed; the model delivers the file with `present`.

The `@deepseek-ai/dsh-tool-pdf/runtime` entry provides the same writer as a service and registers no tool.

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
- name: '@deepseek-ai/dsh-tool-pdf'
  config:
    maxImages: 50
    maxImageBytes: 20971520
```

`file_path` resolves through the Session working directory and must end in `.pdf`; nested folders such as `reports/` are created on write. The tool writes the encoded document through the host filesystem at the resolved local path, so it requires a local filesystem backend; confined deployments grant the write through the same `fs/write-intent` policy slot the `write` tool uses. `blocks` render in order: a `text` block prints its optional heading and body, a `table` block draws a styled grid from its `header` and `rows` — ragged rows pad with empty cells and the header repeats after page breaks — and an `image` block embeds every image its `call_id` result carried, in result order, with the optional caption under each. Images come from the attachment store, so the producing call may be an MCP tool, another agent tool, or an upload; unsupported media types, oversized images, and unknown call ids are reported per image in `imagesSkipped` instead of failing the call, and `availableImageCalls` lists every session call whose result carries images so the model can retry a wrong id without guessing. Call `present` after the write so the host shows the delivery card.

A text block's body takes a small Markdown subset. `#`, `##`, and `###` open headings; a line that opens with `- `, `* `, `+ `, or a number is a list item; pipe rows, with or without a `---` separator row, form a table that prints like a table block; `**text**` prints bold; and `==text==` prints on a yellow band. Every non-empty line is its own paragraph and an empty line separates two paragraphs. Inline marks never nest, italics and links print as written, and a pipe cannot be escaped inside a row. The report title, a block heading, and table cells print without inline markers, and a table cell that carries the mark takes the yellow band as a whole. The tool description tells the model to mark the key facts, figures, and conclusions sparingly.

The vendored Noto Sans faces (SIL Open Font License, see `assets/fonts/LICENSE`) cover Latin, Greek, and Cyrillic text. `maxImages` bounds the embedded count and `maxImageBytes` bounds one stored image; both fail loud at load when not positive integers.

### Programmatic runtime

Mount `@deepseek-ai/dsh-tool-pdf/runtime` when a host needs to write a report without the model:

```yaml
- id: tool-pdf-runtime
  name: '@deepseek-ai/dsh-tool-pdf/runtime'
  config:
    maxImages: 50
    maxImageBytes: 20971520
```

The runtime entry provides `ctx.pdfReports` and registers no tool, so it adds nothing to the model's tool schema and costs no token. It accepts the same limits as the tool, and its writer takes the live owning agent, an output path relative to the Session working directory, a title, ordered blocks, and the policy actor that owns the write.

The request may ask for the skipped-image appendix: the writer then appends a section naming every requested image it could not embed and the reason. Without that request the document carries exactly the requested blocks.

Programmatic callers also have the `code` block: `{ type: 'code', text }` prints every line in the regular body face as it is written, keeps the leading indentation, and reads no Markdown out of it. The `pdf_report` tool schema does not offer it, so the model cannot pass one.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`src/index.ts` registers `pdf_report` through `defineTool`. The execute path resolves the output through `ctx.fs.resolve` with the Session working directory, takes the policy intent from the `fs/write-intent` waterfall, assembles the document, writes the bytes through the host filesystem at `ctx.fs.processPath(target)`, and records the mutation with `fs/observed` carrying the post-write version. A pre-write `stat` distinguishes create from overwrite and rejects non-regular targets; a `createIfAbsent` intent rejects an existing file.

`src/session-images.ts` folds `session.snapshotEvents()` into the latest `tool/result` per requested call id, collects its `image` content blocks, and reads each through `ctx.attachments.readImage`. A missing attachment service, a missing call result, an unsupported media type, a size or count cap violation, and an empty image list each become a per-image skip entry, so one bad image never fails the whole report.

`src/markdown.ts` parses a text block into headings, list items, pipe tables, and paragraphs and splits every line into bold, highlighted, and plain runs. `src/pdf.ts` wraps the runs, so one line may mix the faces; it draws the yellow band under a `==…==` run before the text, and it keeps a list marker at the margin with a hanging indent for the item text.

`src/pdf.ts` is a pure assembler: A4 pages, 48pt margins, embedded subset Noto Sans faces, measured text wrapping with character-level hard breaks for overlong words, tables with content-weighted column widths and wrapped cell lines whose header repeats after page breaks, fit-to-width images, and captions. Pages break when a line, image, or reserved gap would cross the bottom margin.

`src/service.ts` holds the writer both entries use. `src/config.ts` holds the assembly limits they validate. `src/runtime.ts` is the programmatic entry: it mounts the writer as `ctx.pdfReports` and imports neither the tool definition nor the tool registry. The skipped-image appendix is a request field on the write, so the writer appends that section only when a caller asks for it. `src/code.ts` splits the lines of a code block into plain words that keep their indentation.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-tool-present](../../deliverables/tool-present/README.md) — the delivery declaration this tool's output pairs with.
- [dsh-attachment](../../attachment/attachment/README.md) — the durable image store the tool reads from.
- [Client deployment overlay](../../bundle/web-app/README.md) — the composition that mounts this tool with restricted tools.

-----

<a id="model-experience"></a>
## Model Experience

### pdf_report

#### What the model sees

The result renders one `<path>` envelope naming the written file, its page and image counts, and one line per skipped image with the reason; the model fixes the request and retries when call ids were wrong. The call card shows the target path and the block count.

#### Token effect

Each call appends one tool result.

#### KV Cache effect

The result is bounded by the skip list length, which the image caps bound.

### Programmatic runtime

#### What the model sees

Nothing. The runtime entry registers no tool, so it adds no schema to the model's request and no token to the conversation.

#### Token effect

Zero. A report written through the runtime costs no model request and no token.

#### KV Cache effect

None. The runtime changes neither the derived request prefix nor the Session history.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Local filesystem backend only** — the byte write goes through the host filesystem at the resolved local path; a remote filesystem backend would need a binary write on the `FileSystem` service first.
- **PNG and JPEG embed** — WebP, GIF, and other stored media types are skipped with reasons instead of being transcoded.
- **Fixed A4 portrait layout** — no landscape, page numbering, or headers/footers yet; the layout lives in one pure module for later extension.
- **Inline marks never nest** — italics, links, and a mark inside another mark print as written; the text block subset has no escape for a pipe inside a table row and no code fence, so the lines between backtick fences take the subset like any other line.
- **The runtime needs a live owning agent** — the writer resolves the output against the owning agent's Session working directory, so a host without a live agent has no directory to write into.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The font cache is process-lifetime; `buildPdfReport` embeds per document with `subset: true`, so repeated calls reuse the decoded font bytes without re-reading the files. `scripts/gen-tool-catalog.ts` boots this package with a stubbed filesystem and attachment store to harvest the schema.

</details>
