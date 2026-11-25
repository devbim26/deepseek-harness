---
description: "Package map for Host Office rendering, conversion, PDF report assembly, and the model-facing Office tools."
kind: "package-group"
---

# document/ — Office documents

English | [中文](README.zh.md)

## Summary

Render, convert, and recalculate authorized Office files on the Host, for previews and for the model's Office tools. The shared service runs LibreOffice kit. Targets with a declared native engine use it; other targets use Node WASM. Beside the Office tools, the family assembles PDF reports from model output without shell or Python.

## Table of Contents

- [Packages](#packages)
- [Working with documents](#working-with-documents)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Each package owns its configuration and lifetime rules; the subsystem reference describes their shared conversion operation.

| Package | Role | ctx key |
|---|---|---|
| [office-kit](office-kit/README.md) | Authorized Office bytes to complete PDFs, PNG images, converted files, and recalculated workbooks with bounded queues and caching; the provider resolves its own Kit entry, engine manifests, and ASAR-unpacked engine paths | `ctx.officeKit` |
| [tool-document](tool-document/README.md) | `document_read` reads text from a document attached to the conversation, one bounded, attachment-authorized window per call | — |
| [tool-office](tool-office/README.md) | `office_render`, `office_convert`, and `office_recalculate`, declared after an Office skill loads: render pages as images in the tool result, convert documents, and recalculate workbooks | — |
| [tool-pdf](tool-pdf/README.md) | `pdf_report` assembles a PDF report from ordered text, table, and tool-result image blocks and writes it into the Session working directory; the programmatic runtime writes the same reports without a model-facing tool | — |

-----

<a id="working-with-documents"></a>
## Working with documents

The family covers document work on the Host. Delivery belongs to the [deliverables group](../deliverables/README.md): the model declares a written file with `present`, and the Web client renders a delivery card at the end of the turn.

- **A PDF report:** `pdf_report` takes ordered text, table, and image blocks and writes the PDF into the Session working directory. Pass tabular data as `table` blocks with a `header` and `rows`; the tool draws a styled grid with a filled header row, zebra rows, and a header that repeats after page breaks, instead of plain text lines. It needs no shell, no Python, and no filesystem tools, so it fits restricted deployments. Use it to assemble a new report from text and data the model already produced; for an existing Office file, use the Office tools below.
- **An existing Office document:** after an [Office skill](../skill/skill-office/README.md) loads, the [Office tools](tool-office/README.md) activate. `office_convert` accepts Word, Excel, and PowerPoint documents and exports Word to pdf, docx, odt, or txt, Excel to pdf, xlsx, ods, or csv, and PowerPoint to pdf, pptx, or odp. `office_recalculate` refreshes the formulas of xls, xlsx, and ods workbooks, and `office_render` returns pages, slides, and worksheet areas as images. A converted file lands in the Office kit's private output store under the Harness home, and the model copies it to its destination with the shell.
- **A document the user attached:** `document_read` answers questions about a file attached to the conversation. It reads only attachments of the calling Session and returns one bounded window with a continuation cursor, so restricted deployments grant document reading without shell or filesystem tools; TXT and CSV extract today, and the other announced formats land as their own implementation tasks.
- **A document or workbook the model authors:** the family does not write one from text or data. The file comes from a script the model runs or from an external service that writes into the workspace.

-----

<a id="related-documentation"></a>
## Related documentation

Consumers own source authorization and presentation.

- [Document conversion](../../docs/subsystems/office-kit.md) — shared operation and generated service reference.
- [Deliverables subsystem](../../docs/subsystems/deliverables.md) — the delivered-file event and the turn summary service.
- [dsh-tool-present](../deliverables/tool-present/README.md) — the declaration that hands a written file to the user.
- [Independent kit ownership](../../.agents/notes/implemented/architecture/2026-09-14-independent-libreoffice-kit.md) — engine distribution and application integration.
- [Workspace Files](../api/workspace-files/README.md) — authorized bounded source reads.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
