---
description: "Assemble PDF report files from text sections, tables, and tool-result images with the pdf_report tool, without shell or Python."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-pdf

English | [中文](README.zh.md)

## Summary

Use `pdf_report` to write a PDF report file into the Session working directory. The model passes ordered text blocks, table blocks, and image blocks that reference earlier tool calls; the tool reads those calls' images from the Session log through the durable attachment store and embeds them. Table blocks render tabular data as styled tables with a filled header row, zebra rows, and content-fitted column widths. The tool needs no shell, no Python, and no filesystem tools, which fits restricted client-facing deployments: the model assembles a report from what it already produced and delivers the file with `present`.

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

The vendored Noto Sans faces (SIL Open Font License, see `assets/fonts/LICENSE`) cover Latin, Greek, and Cyrillic text. `maxImages` bounds the embedded count and `maxImageBytes` bounds one stored image; both fail loud at load when not positive integers.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`src/index.ts` registers `pdf_report` through `defineTool`. The execute path resolves the output through `ctx.fs.resolve` with the Session working directory, takes the policy intent from the `fs/write-intent` waterfall, assembles the document, writes the bytes through the host filesystem at `ctx.fs.processPath(target)`, and records the mutation with `fs/observed` carrying the post-write version. A pre-write `stat` distinguishes create from overwrite and rejects non-regular targets; a `createIfAbsent` intent rejects an existing file.

`src/session-images.ts` folds `session.snapshotEvents()` into the latest `tool/result` per requested call id, collects its `image` content blocks, and reads each through `ctx.attachments.readImage`. A missing attachment service, a missing call result, an unsupported media type, a size or count cap violation, and an empty image list each become a per-image skip entry, so one bad image never fails the whole report.

`src/pdf.ts` is a pure assembler: A4 pages, 48pt margins, embedded subset Noto Sans faces, measured text wrapping with character-level hard breaks for overlong words, tables with content-weighted column widths and wrapped cell lines whose header repeats after page breaks, fit-to-width images, and captions. Pages break when a line, image, or reserved gap would cross the bottom margin.

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

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Local filesystem backend only** — the byte write goes through the host filesystem at the resolved local path; a remote filesystem backend would need a binary write on the `FileSystem` service first.
- **PNG and JPEG embed** — WebP, GIF, and other stored media types are skipped with reasons instead of being transcoded.
- **Fixed A4 portrait layout** — no landscape, page numbering, or headers/footers yet; the layout lives in one pure module for later extension.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The font cache is process-lifetime; `buildPdfReport` embeds per document with `subset: true`, so repeated calls reuse the decoded font bytes without re-reading the files. `scripts/gen-tool-catalog.ts` boots this package with a stubbed filesystem and attachment store to harvest the schema.

</details>
