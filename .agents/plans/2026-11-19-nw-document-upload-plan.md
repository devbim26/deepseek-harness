# NW Client Document Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The north-waterfront client site accepts PDF/DOCX/XLS(X)/TXT/MD/CSV uploads through the composer "+" menu, and the agent works with the documents' extracted text, which rides in the user message next to the file block.

**Architecture:** Browser-side extraction at pick time inside `ui-conversation` (the draft owner), a per-draft extraction store mirrored on the existing `fileUploads` wiring chain (service store → composer-bar inject hooks → InputBar → attachments-slot owner props), and a text block emitted by `serializeAttachments` after each document's file block. The NW overlay re-enables `ui-attachment` and pins limits plus persona guidance.

**Tech Stack:** Vitest specs (`tests/*.client.spec.ts`), schemastery Config, pdfjs-dist (legacy build), mammoth, xlsx (SheetJS), cordis patch YAML.

**Approved design:** `.agents/plans/2026-11-19-nw-document-upload-design.md` (user-approved 2026-11-19).

## Global Constraints

- Branch: `add-documents`. Do not push; commit locally only.
- Repo root: `C:\Users\Lenovo\Desktop\проект SOFT_2\Models FIN\Harness`. Run all commands from the repo root (Git Bash).
- On this machine pre-commit lefthook steps (`whitespace (staged)`, `vendor manifest guard`) crash intermittently with msys `0xc0000142` — a runner crash, not a check failure. When that happens: verify the invariant manually (single trailing newline: `tail -c 2 <file> | od -c`; no `vendor/` files staged) and retry once; only then use `--no-verify` and disclose it in the final report.
- New TypeScript under `packages/*/*/src` is subject to the CI per-file 100% coverage gate; every branch of new code needs a spec.
- Client UI copy is locale-owned: every new key is added to all 8 dictionaries in `packages/client/ui-conversation/src/client/locales.ts` (zh is the key-set source of truth: `ConversationKey = keyof typeof zh`).
- No `as unknown` casts; closed unions switch on discriminant tags; files end with exactly one trailing newline; English copy in sentence case.
- New npm dependencies go in `packages/client/ui-conversation/package.json` `dependencies` with caret ranges: `"pdfjs-dist": "^5.4.2"`, `"mammoth": "^1.9.1"`, `"xlsx": "^0.18.5"` (or latest stable at install time).
- ESM only (`import()` the heavy parsers lazily; never import them at module top level).
- The working tree has unrelated modified files (`DEPLOY-CLIENT-SITE.md`, `dsh-web-north-waterfront.cmd`, `nw-models.cmd`, `packages/bundle/web-app/devbim.patch.yml`, `client-north-waterfront.patch.yml` are already `M`): stage only files a task lists, never `git add -A`.
- The failing-check escalation rule (AGENTS.md) applies: retry unchanged with the narrowest host escalation when the sandbox causes the failure.

## File Structure

| File | Responsibility |
|---|---|
| `packages/client/ui-conversation/src/client/document-extract.ts` (new) | Pure format routing + extraction + truncation; typed failures |
| `packages/client/ui-conversation/src/client/contract/slots.ts` | `ComposerFileAttachment.extraction`, `DraftExtraction(s)`, owner-props additions |
| `packages/client/ui-conversation/src/client/service.ts` (ConversationController) | Extraction store, lifecycle, message assembly |
| `packages/client/ui-conversation/src/client/apply.ts` | Config fields, absent-store constant, injected hooks, header formatter |
| `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx` | Send gate + held-text explanation + slot owner props |
| `packages/client/ui-conversation/src/client/locales.ts` | New `file.*` keys in all 8 dictionaries |
| `packages/client/ui-attachment/src/FileCard.tsx`, `src/client/ComposerAttachments.tsx`, `src/client/labels.ts` | Card extraction states |
| `packages/bundle/web-app/client-north-waterfront.patch.yml` | Enable `ui-attachment`, limits, persona, comment |
| `DEPLOY-CLIENT-SITE.md`, package READMEs | Documentation |

---

### Task 1: `document-extract.ts` — extraction module with tests

**Files:**
- Modify: `packages/client/ui-conversation/package.json` (`dependencies`)
- Create: `packages/client/ui-conversation/src/client/document-extract.ts`
- Create: `packages/client/ui-conversation/tests/document-extract.client.spec.ts`

**Interfaces:**
- Produces (consumed by Task 2):
  - `type DocumentExtractNotice = 'docLegacy' | 'noTextLayer' | 'parseFailed'`
  - `class UnsupportedDocumentError extends Error` (thrown for `.doc`)
  - `class NoTextLayerError extends Error` (thrown for an empty text layer)
  - `interface DocumentExtractLimits { readonly maxFileBytes: number; readonly maxExtractChars: number }`
  - `interface DocumentExtractResult { readonly text: string; readonly truncated: boolean }`
  - `function extractableText(file: File): boolean` — true for txt/md/csv/log/pdf/docx/xls/xlsx
  - `function isLegacyDoc(file: File): boolean` — true for `.doc`
  - `function extractDocumentText(file: File, limits: DocumentExtractLimits, signal?: AbortSignal): Promise<DocumentExtractResult>`

- [ ] **Step 1: Add the three dependencies**

In `packages/client/ui-conversation/package.json`, add to `dependencies` (alphabetical order):

```json
"dependencies": {
  "@deepseek-ai/schemastery": "workspace:~",
  "mammoth": "^1.9.1",
  "pdfjs-dist": "^5.4.2",
  "xlsx": "^0.18.5"
}
```

Run: `pnpm install`
Expected: lockfile updates, no resolution errors.

- [ ] **Step 2: Write the failing spec**

Create `packages/client/ui-conversation/tests/document-extract.client.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { DocumentExtractLimits } from '../src/client/document-extract.ts'
import {
  NoTextLayerError, UnsupportedDocumentError,
  extractDocumentText, extractableText, isLegacyDoc,
} from '../src/client/document-extract.ts'
import * as XLSX from 'xlsx'

const LIMITS: DocumentExtractLimits = { maxFileBytes: 1024 * 1024, maxExtractChars: 20 }

const fileOf = (name: string, content: string | Uint8Array, type = ''): File =>
  new File([content], name, { type })

/** Minimal stored-entry ZIP with CRC-32, enough for mammoth to read a .docx. */
function crc32(bytes: Uint8Array): number {
  let c = ~0
  for (const byte of bytes) {
    c ^= byte
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1))
  }
  return ~c
}

function storedZip(entries: { name: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  const u16 = (v: number): Uint8Array => new Uint8Array([v & 255, (v >> 8) & 255])
  const u32 = (v: number): Uint8Array => new Uint8Array([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255])
  let offset = 0
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const crc = crc32(entry.data)
    const local = new Uint8Array(30 + nameBytes.length)
    local.set(u32(0x04034b50), 0)
    local.set(u16(20), 4)
    local.set(u16(0), 6)
    local.set(u16(0), 8)
    local.set(u16(0), 10)
    local.set(u16(0), 12)
    local.set(u32(crc), 14)
    local.set(u32(entry.data.length), 18)
    local.set(u32(entry.data.length), 22)
    local.set(u16(nameBytes.length), 26)
    local.set(nameBytes, 30)
    parts.push(local, entry.data)
    const dir = new Uint8Array(46 + nameBytes.length)
    dir.set(u32(0x02014b50), 0)
    dir.set(u16(20), 4)
    dir.set(u16(20), 6)
    dir.set(u32(crc), 16)
    dir.set(u32(entry.data.length), 20)
    dir.set(u32(entry.data.length), 24)
    dir.set(u16(nameBytes.length), 28)
    dir.set(u32(offset), 42)
    dir.set(nameBytes, 46)
    central.push(dir)
    offset += local.length + entry.data.length
  }
  const centralBytes = central.flatMap(part => [...part])
  const end = new Uint8Array(22)
  end.set(u32(0x06054b50), 0)
  end.set(u16(entries.length), 8)
  end.set(u16(entries.length), 10)
  end.set(u32(centralBytes.length), 12)
  end.set(u32(offset), 16)
  return new Uint8Array([...parts.flatMap(part => [...part]), ...centralBytes, ...end])
}

function docxOf(paragraphs: string[]): Uint8Array {
  const encoder = new TextEncoder()
  const body = paragraphs.map(text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('')
  const document = encoder.encode(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  )
  return storedZip([{ name: 'word/document.xml', data: document }])
}

function xlsxOf(rows: string[][]): Uint8Array {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
}

/** One-page PDF whose content stream draws `Hello NW`; pdf.js recovers the approximate xref. */
const MINIMAL_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 44>>stream
BT /F1 18 Tf 20 50 Td (Hello NW) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 6>>
%%EOF`

describe('extractableText', () => {
  it('accepts the supported extensions regardless of MIME', () => {
    for (const name of ['a.txt', 'b.md', 'c.csv', 'd.log', 'e.pdf', 'f.docx', 'g.xls', 'h.xlsx']) {
      expect(extractableText(fileOf(name, '')), name).toBe(true)
    }
  })

  it('rejects unknown and legacy-doc extensions', () => {
    expect(extractableText(fileOf('a.doc', ''))).toBe(false)
    expect(extractableText(fileOf('a.bin', ''))).toBe(false)
    expect(isLegacyDoc(fileOf('a.doc', ''))).toBe(true)
    expect(isLegacyDoc(fileOf('a.docx', ''))).toBe(false)
  })
})

describe('extractDocumentText', () => {
  it('extracts plain text files verbatim', async () => {
    const result = await extractDocumentText(fileOf('notes.txt', 'первая строка\nвторая'), LIMITS)
    expect(result).toEqual({ text: 'первая строка\nвторая', truncated: false })
  })

  it('truncates at maxExtractChars and states it', async () => {
    const result = await extractDocumentText(fileOf('big.txt', 'x'.repeat(50)), LIMITS)
    expect(result.truncated).toBe(true)
    expect(result.text).toHaveLength(20)
  })

  it('extracts xlsx sheets as CSV', async () => {
    const result = await extractDocumentText(fileOf('вед.xlsx', xlsxOf([['Позиция', 'Объем'], ['Стена', '120']])), LIMITS)
    expect(result.text).toContain('Позиция')
    expect(result.text).toContain('120')
  })

  it('extracts docx paragraph text', async () => {
    const result = await extractDocumentText(fileOf('тз.docx', docxOf(['Пункт первый', 'Пункт второй'])), LIMITS)
    expect(result.text).toContain('Пункт первый')
    expect(result.text).toContain('Пункт второй')
  })

  it('extracts a minimal PDF text layer', async () => {
    const result = await extractDocumentText(fileOf('doc.pdf', MINIMAL_PDF), LIMITS)
    expect(result.text).toContain('Hello NW')
  })

  it('throws NoTextLayerError for a PDF without extractable text', async () => {
    const empty = MINIMAL_PDF.replace('(Hello NW) Tj', '(   ) Tj')
    await expect(extractDocumentText(fileOf('scan.pdf', empty), LIMITS)).rejects.toBeInstanceOf(NoTextLayerError)
  })

  it('throws UnsupportedDocumentError for legacy .doc', async () => {
    await expect(extractDocumentText(fileOf('old.doc', 'bytes'), LIMITS)).rejects.toBeInstanceOf(UnsupportedDocumentError)
  })

  it('stops early when aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(extractDocumentText(fileOf('a.txt', 'text'), LIMITS, controller.signal)).rejects.toThrow()
  })
})
```

- [ ] **Step 3: Run the spec to verify it fails**

Run: `pnpm vitest run packages/client/ui-conversation/tests/document-extract.client.spec.ts`
Expected: FAIL — module `../src/client/document-extract.ts` not found.

- [ ] **Step 4: Implement `document-extract.ts`**

Create `packages/client/ui-conversation/src/client/document-extract.ts`:

```ts
/** Browser-side text extraction for picked document files: format routing,
 * per-format lazy parsers, and the truncation contract the composer applies.
 * @module @deepseek-ai/dsh-client-ui-conversation/client/document-extract
 */

/** Why a document's text is absent, resolved to product copy at render time. */
export type DocumentExtractNotice = 'docLegacy' | 'noTextLayer' | 'parseFailed'

/** Legacy Word 97 binary: no browser parser exists for it. */
export class UnsupportedDocumentError extends Error {
  constructor() {
    super('document-extract: legacy .doc has no browser parser')
    this.name = 'UnsupportedDocumentError'
  }
}

/** A parsed document whose text layer is empty, such as a scanned PDF. */
export class NoTextLayerError extends Error {
  constructor() {
    super('document-extract: document has no text layer')
    this.name = 'NoTextLayerError'
  }
}

/** Extraction knobs, resolved once per plugin from Config. */
export interface DocumentExtractLimits {
  /** Files above this many bytes never enter extraction. */
  readonly maxFileBytes: number
  /** Extracted text longer than this many characters truncates with `truncated`. */
  readonly maxExtractChars: number
}

/** One finished extraction: the clipped text and whether clipping happened. */
export interface DocumentExtractResult {
  readonly text: string
  readonly truncated: boolean
}

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'log'])
const PARSED_EXTENSIONS = new Set(['pdf', 'docx', 'xls', 'xlsx'])

const extensionOf = (file: File): string => {
  const dot = file.name.lastIndexOf('.')
  return dot === -1 ? '' : file.name.slice(dot + 1).toLowerCase()
}

/**
 * Whether the composer extracts text for this file at all.
 * @param file - the picked browser file.
 * @returns true for the supported text and parsed document extensions.
 */
export function extractableText(file: File): boolean {
  const extension = extensionOf(file)
  return TEXT_EXTENSIONS.has(extension) || PARSED_EXTENSIONS.has(extension)
}

/**
 * Whether the file is a legacy `.doc` the picker should warn about.
 * @param file - the picked browser file.
 * @returns true only for the `.doc` extension.
 */
export function isLegacyDoc(file: File): boolean {
  return extensionOf(file) === 'doc'
}

/** Truncate to the character limit, stating whether clipping happened. */
function truncate(text: string, limits: DocumentExtractLimits): DocumentExtractResult {
  return text.length <= limits.maxExtractChars
    ? { text, truncated: false }
    : { text: text.slice(0, limits.maxExtractChars), truncated: true }
}

const aborted = (signal: AbortSignal | undefined): boolean => signal?.aborted === true

/** Extract text through pdf.js; an empty layer means a scan. */
async function extractPdf(file: File, signal: AbortSignal | undefined): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const document = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise
  const pages: string[] = []
  for (let number = 1; number <= document.numPages; number++) {
    if (aborted(signal)) throw new Error('document-extract: aborted')
    const page = await document.getPage(number)
    const content = await page.getTextContent()
    pages.push(content.items.map(item => 'str' in item ? item.str : '').join(' '))
    page.cleanup()
  }
  const text = pages.join('\n\n').trim()
  if (text === '') throw new NoTextLayerError()
  return text
}

/** Extract paragraph text through mammoth. */
async function extractDocx(file: File): Promise<string> {
  const mammoth = await import('mammoth')
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
  return value
}

/** Extract every sheet as CSV through SheetJS. */
async function extractSheet(file: File): Promise<string> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  return workbook.SheetNames
    .map(name => XLSX.utils.sheet_to_csv(workbook.Sheets[name])).join('\n\n')
}

/**
 * Extract a picked document's text. Plain-text extensions decode verbatim;
 * parsed formats load their parser lazily. Parse failures propagate as thrown
 * errors; the caller maps them to `parseFailed`.
 * @param file - the picked browser file.
 * @param limits - the byte guard and the character truncation limit.
 * @param signal - aborts between extraction stages; release removes the draft.
 * @returns the extracted text with its truncation state.
 * @throws UnsupportedDocumentError for legacy `.doc`; NoTextLayerError for an
 *   empty text layer; an ordinary Error for oversize files, aborts, and parser
 *   failures.
 */
export async function extractDocumentText(
  file: File,
  limits: DocumentExtractLimits,
  signal?: AbortSignal,
): Promise<DocumentExtractResult> {
  if (isLegacyDoc(file)) throw new UnsupportedDocumentError()
  if (file.size > limits.maxFileBytes) throw new Error(`document-extract: ${file.name} exceeds maxFileBytes`)
  if (aborted(signal)) throw new Error('document-extract: aborted')
  const extension = extensionOf(file)
  const text = TEXT_EXTENSIONS.has(extension)
    ? await file.text()
    : extension === 'pdf' ? await extractPdf(file, signal)
      : extension === 'docx' ? await extractDocx(file)
        : await extractSheet(file)
  if (aborted(signal)) throw new Error('document-extract: aborted')
  return truncate(text, limits)
}
```

- [ ] **Step 5: Run the spec to verify it passes**

Run: `pnpm vitest run packages/client/ui-conversation/tests/document-extract.client.spec.ts`
Expected: PASS (all cases). If the minimal PDF trips on xref recovery, keep the fixture — pdf.js reconstructs broken xref tables; only a thrown parse error needs a fixture fix.

- [ ] **Step 6: Commit**

```bash
git add packages/client/ui-conversation/package.json pnpm-lock.yaml packages/client/ui-conversation/src/client/document-extract.ts packages/client/ui-conversation/tests/document-extract.client.spec.ts
git commit -m "feat(client): browser document text extraction module"
```

---

### Task 2: Draft extraction lifecycle and message assembly in the service

**Files:**
- Modify: `packages/client/ui-conversation/src/client/contract/slots.ts:55-59` (`ComposerFileAttachment`), draft-attachment types block (`DraftFileUpload`, ~line 68-83), `ComposerAttachmentsOwnerProps` (~line 85-100)
- Modify: `packages/client/ui-conversation/src/client/service.ts` (`createDrafts` ~330-348, `serializeAttachments` ~270-283, release paths ~199, `retryFileUpload` region ~353-360)
- Modify: `packages/client/ui-conversation/src/client/locales.ts` (all 8 dictionaries)
- Test: extend `packages/client/ui-conversation/tests/draft-hub.client.spec.ts` or `service-orchestration.client.spec.ts` (whichever already constructs the ConversationController with a fileUploads double — read both and extend the one covering `createDrafts`/`sendSession`)

**Interfaces:**
- Consumes from Task 1: the five exported names.
- Produces (consumed by Tasks 3-4):
  - `ComposerFileAttachment` gains `extraction?: { text: string; truncated: boolean }`
  - `type DraftExtraction = { readonly status: 'extracting' } | { readonly status: 'done' } | { readonly status: 'failed'; readonly notice: DocumentExtractNotice }`
  - `type DraftExtractions = Readonly<Record<string, DraftExtraction>>`
  - ConversationController input gains `maxFileBytes: number`, `maxExtractChars: number`, `documentContentText: (name: string, truncated: boolean) => string`
  - The service exposes `readonly fileExtractions: SnapshotStore<DraftExtractions>` (subscribe/getSnapshot/update, mirroring `fileUploads`)

- [ ] **Step 1: Extend the slot contract**

In `contract/slots.ts`, add to the existing imports from `../service.ts` or a new relative import of `../document-extract.ts`:

```ts
import type { DocumentExtractNotice } from './document-extract.ts'
```

Extend `ComposerFileAttachment`:

```ts
/** Browser-owned generic file whose bytes upload to the Host as soon as it is picked. */
export interface ComposerFileAttachment {
  kind: 'file'
  id: DraftAttachmentId
  file: File
  /** Extracted document text, present once extraction finished; `truncated` states clipping. */
  extraction?: { text: string; truncated: boolean }
}
```

Add next to `DraftFileUploads`:

```ts
/** Extraction lifecycle of one file draft, parallel to its upload. */
export type DraftExtraction =
  | { readonly status: 'extracting' }
  | { readonly status: 'done' }
  | { readonly status: 'failed'; readonly notice: DocumentExtractNotice }

/** Per-draft extraction states keyed by draft attachment id. */
export type DraftExtractions = Readonly<Record<string, DraftExtraction>>
```

Add to `ComposerAttachmentsOwnerProps` after the `uploads` member:

```ts
  /** Current per-draft extraction states for file-kind attachments. */
  extractions: DraftExtractions
```

- [ ] **Step 2: Add the extraction store and lifecycle to the service**

In the service class next to the `fileUploads` store (mirror `stores.ts:159` wherever that field lives — service or its stores object):

```ts
  /** Per-draft document-text extraction states, parallel to `fileUploads`. */
  readonly fileExtractions: SnapshotStore<DraftExtractions> = createSnapshotStore<DraftExtractions>({})
```

Mirror the reset in the navigation cleanup where `this.fileUploads.set({})` runs (~service.ts:199):

```ts
    this.fileExtractions.set({})
```

Constructor input gains the three new members (next to `maxConcurrentFileUploads`) and stores them:

```ts
  private readonly maxFileBytes: number
  private readonly maxExtractChars: number
  private readonly documentContentText: (name: string, truncated: boolean) => string
  private readonly extractionControllers = new Map<DraftAttachmentId, AbortController>()
```

Extend `createDrafts`'s file-draft branch:

```ts
      const attachment: ComposerFileAttachment = {
        kind: 'file',
        id: randomUUID() as DraftAttachmentId,
        file,
      }
      this.draftAttachments.set(attachment.id, attachment)
      this.beginFileUpload(sessionId, attachment)
      this.beginExtraction(attachment)
      return attachment
```

Add the lifecycle methods (next to `retryFileUpload`):

```ts
  /**
   * Start background text extraction for one file draft. Legacy `.doc`
   * immediately reports `docLegacy`; unsupported types get no entry at all.
   * @param attachment - the file draft to extract.
   */
  private beginExtraction(attachment: ComposerFileAttachment): void {
    if (isLegacyDoc(attachment.file)) {
      this.fileExtractions.update(draft => ({ ...draft, [attachment.id]: { status: 'failed', notice: 'docLegacy' } }))
      return
    }
    if (!extractableText(attachment.file)) return
    this.fileExtractions.update(draft => ({ ...draft, [attachment.id]: { status: 'extracting' } }))
    const controller = new AbortController()
    this.extractionControllers.set(attachment.id, controller)
    void extractDocumentText(attachment.file, { maxFileBytes: this.maxFileBytes, maxExtractChars: this.maxExtractChars }, controller.signal)
      .then((result) => {
        attachment.extraction = { text: result.text, truncated: result.truncated }
        this.fileExtractions.update(draft => ({ ...draft, [attachment.id]: { status: 'done' } }))
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const notice: DocumentExtractNotice = error instanceof UnsupportedDocumentError
          ? 'docLegacy'
          : error instanceof NoTextLayerError ? 'noTextLayer' : 'parseFailed'
        this.fileExtractions.update(draft => ({ ...draft, [attachment.id]: { status: 'failed', notice } }))
      })
  }

  /** Abort one in-flight extraction and drop its state entry. */
  private dropExtraction(id: DraftAttachmentId): void {
    this.extractionControllers.get(id)?.abort()
    this.extractionControllers.delete(id)
    const rest: Record<string, DraftExtraction> = { ...this.fileExtractions.getSnapshot() }
    delete rest[id]
    this.fileExtractions.set(rest)
  }
```

Call `this.dropExtraction(id)` inside `releaseDraftAttachment` and in `releaseDraftAttachments`' per-attachment loop (next to wherever the upload state for the released draft is dropped — read `releaseDraftAttachment` and mirror it).

- [ ] **Step 3: Emit the text block in `serializeAttachments`**

Replace the `serializeAttachments` body (~service.ts:270-283) — the flatMap becomes a map over per-attachment arrays, flattened once:

```ts
    const serializeAttachments = (): Promise<Parameters<SessionFace['prompt']>[0]> => Promise.all(
      attachments.map(async (attachment) => {
        if (attachment.kind === 'file') {
          const fileBlock = { type: 'file' as const, receiptId: uploadFor(attachment).receiptId }
          const extraction = attachment.extraction
          if (extraction === undefined) return [fileBlock]
          return [fileBlock, {
            type: 'text' as const,
            text: `${this.documentContentText(attachment.file.name, extraction.truncated)}\n${extraction.text}`,
          }]
        }
        const receiptId = imageReceipts.get(attachment.id)
        return [receiptId === undefined
          ? { type: 'image' as const, ...await this.encodeImage(attachment.file) }
          : { type: 'file' as const, receiptId }]
      }),
    ).then(groups => groups.flat())
```

- [ ] **Step 4: Add the locale keys to all 8 dictionaries**

In `locales.ts`, add to `zh`, `en`, `ja`, `es`, `fr`, `de`, `ru`, `pt` next to the existing `file.*` keys (zh first — it is the key-set source of truth):

zh:
```ts
  'file.extracting': '正在提取文本…',
  'file.stillExtracting': '文档文本正在提取，完成后请发送',
  'file.extractFailed': '未能提取文本；文件仍会原样附带',
  'file.tooLarge': '文件超出 {size} 限制',
  'file.unsupportedDoc': '不支持旧版 .doc；请另存为 .docx 后重新添加',
  'file.noTextLayer': '没有文本层（扫描件？）；文件仍会原样附带',
  'file.contentHeader': '附件文件“{name}”的内容',
  'file.contentTruncated': '文本已按限制截断',
```
en:
```ts
  'file.extracting': 'Extracting text…',
  'file.stillExtracting': 'Document text is being extracted; send after it finishes',
  'file.extractFailed': 'Text extraction failed; the file is attached as-is',
  'file.tooLarge': 'File exceeds the {size} limit',
  'file.unsupportedDoc': 'Legacy .doc is not supported; save as .docx and re-attach',
  'file.noTextLayer': 'No text layer (scanned PDF?); the file is attached as-is',
  'file.contentHeader': 'Content of the attached file "{name}"',
  'file.contentTruncated': 'text truncated at the limit',
```
ru:
```ts
  'file.extracting': 'Извлекаю текст…',
  'file.stillExtracting': 'Текст документа извлекается; отправьте после завершения',
  'file.extractFailed': 'Не удалось извлечь текст; файл будет приложен как есть',
  'file.tooLarge': 'Файл превышает лимит {size}',
  'file.unsupportedDoc': 'Старый формат .doc не поддерживается; пересохраните в .docx и приложите заново',
  'file.noTextLayer': 'Нет текстового слоя (скан?); файл будет приложен как есть',
  'file.contentHeader': 'Содержимое приложенного файла «{name}»',
  'file.contentTruncated': 'текст усечён по лимиту',
```
ja, es, fr, de, pt: translate the eight strings in the same style as the neighboring `file.uploading` entries in each dictionary.

- [ ] **Step 5: Extend the service spec**

In the spec covering `createDrafts`/`sendSession` (draft-hub or service-orchestration — extend whichever already constructs the ConversationController), add cases; construct the controller with `maxFileBytes: 1024 * 1024`, `maxExtractChars: 20`, and `documentContentText: (name, truncated) => truncated ? `«${name}» (усечён)` : `«${name}»``. Move the three builders (`storedZip`, `docxOf`, `xlsxOf`) into a new shared helper `tests/document-fixtures.client.ts` and have both this spec and Task 1's spec import them.

Cases:
1. Picking `вед.xlsx` (real bytes) creates a draft whose extraction store entry reaches `done`, and `sendSession` emits `[file block, text block]` with the header line followed by the sheet CSV.
2. Picking `notes.txt`, then `releaseDraftAttachment`, then `sendSession` emits only the file block (no crash, no stale entry).
3. A draft with `extraction: { text: 'x'.repeat(30), truncated: true }` emits the truncated header variant.
4. A draft whose extraction failed (garbage `.docx` bytes `Uint8Array([1,2,3])`) emits only the file block, and the store entry is `failed` with `parseFailed`.

Run: `pnpm vitest run packages/client/ui-conversation/tests`
Expected: PASS — the new cases pass against Steps 1-4, and the pre-existing `file-intake`, `draft-document`, and `config.host` specs stay green.

- [ ] **Step 6: Run the package suite and commit**

Run: `pnpm vitest run packages/client/ui-conversation/tests`
Expected: PASS, including the pre-existing `file-intake`, `draft-document`, and `config.host` specs.

```bash
git add packages/client/ui-conversation/src/client/contract/slots.ts packages/client/ui-conversation/src/client/service.ts packages/client/ui-conversation/src/client/locales.ts packages/client/ui-conversation/tests
git commit -m "feat(client): extract attached document text into the user message"
```

---

### Task 3: Config, send gate, and intake size rejection

**Files:**
- Modify: `packages/client/ui-conversation/src/client/apply.ts` (Config ~67-74, absent constant ~90-100, inject hooks ~489-499 and ~565-576, controller input ~597-602)
- Modify: `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx` (~98-121 gate, ~473-488 slot props)
- Test: extend `packages/client/ui-conversation/tests/config.host.spec.ts` and the InputBar spec (`input-bar.client.spec.tsx`)

**Interfaces:**
- Consumes from Task 2: `DraftExtractions`, `conversation.fileExtractions`.
- Produces: Config fields `maxFileBytes` (default `26214400`), `maxExtractChars` (default `50000`); injected hook `fileExtractions` → InputBar prop `useFileExtractions`; attachments-slot owner prop `extractions`.

- [ ] **Step 1: Config fields**

In `apply.ts` extend the client `Config` interface and schema (client `apply.ts:67-74`):

```ts
export interface Config {
  /** Maximum generic-file uploads allowed to run concurrently in browser Workers. */
  maxConcurrentFileUploads?: number
  /** Files above this many bytes are rejected at intake. */
  maxFileBytes?: number
  /** Extracted document text truncates at this many characters. */
  maxExtractChars?: number
}

export const Config: z<Config> = z.object({
  maxConcurrentFileUploads: z.natural().min(1).default(2),
  maxFileBytes: z.natural().min(1).default(26214400),
  maxExtractChars: z.natural().min(1).default(50000),
})
```

In `apply(ctx, config)` (~line 162) read them and build the header formatter next to the existing `maxConcurrentFileUploads` read:

```ts
  const maxFileBytes = config.maxFileBytes as number
  const maxExtractChars = config.maxExtractChars as number
  const documentContentText = (name: string, truncated: boolean): string =>
    truncated ? `${t('file.contentHeader', { name })} (${t('file.contentTruncated')})` : t('file.contentHeader', { name })
```

(`t` is the conversation-namespace translator already resolved in `apply` — mirror however `t('file.sessionUnavailable')` reaches `addFiles`.)

Extend the `ConversationController` plugin input (~line 597-602):

```ts
  ctx.plugin(ConversationController, {
    input: inputHub,
    blocks: composerBlocks,
    maxConcurrentFileUploads,
    maxFileBytes,
    maxExtractChars,
    documentContentText,
  })
```

- [ ] **Step 2: Inject the hook**

Next to `ABSENT_FILE_UPLOADS` (~apply.ts:90-100):

```ts
const EMPTY_DRAFT_EXTRACTIONS: DraftExtractions = {}
const ABSENT_DRAFT_EXTRACTIONS = {
  getSnapshot: () => EMPTY_DRAFT_EXTRACTIONS,
  subscribe: () => () => {},
}
```

In the composer-bar inject, the no-session branch gains `fileExtractions: ABSENT_DRAFT_EXTRACTIONS` inside `hooks`; the session-bound branch gains `fileExtractions: conversation.fileExtractions`. Extend the injected-hooks type (wherever `ComposerBarInjected`'s `hooks` face declares `fileUploads` — same object) with `fileExtractions: Pick<SnapshotStore<DraftExtractions>, 'getSnapshot' | 'subscribe'>`.

- [ ] **Step 3: Send gate and slot props in InputBar**

In `InputBar.tsx` destructure `useFileExtractions` next to `useFileUploads` (props type flows from the inject face), then replace the gate block (~line 98-104) and the held-text block (~line 118-121):

```ts
  const extractions = useFileExtractions(snapshot => snapshot)
  // Uploads and document-text extraction both hold the send gate; failed
  // uploads keep it too (retry or remove, never a silent drop). A failed
  // extraction never holds the gate: the file sends without its text.
  const extracting = attachments.some(attachment => attachment.kind === 'file'
    && extractions[attachment.id]?.status === 'extracting')
  const uploadsPending = attachments.some(attachment => attachment.kind === 'file'
    ? uploads[attachment.id]?.status !== 'ready' || extractions[attachment.id]?.status === 'extracting'
    : uploads[attachment.id] !== undefined && uploads[attachment.id]?.status !== 'ready')
```

```ts
  const failedUpload = attachments.map(attachment => uploads[attachment.id]).find(upload => upload?.status === 'error')
  const uploadsHeldText = failedUpload?.status === 'error'
    ? (failedUpload.reason === undefined ? t('file.uploadFailed') : attachmentErrorText(t, failedUpload.reason, imageLimits))
    : extracting ? t('file.stillExtracting') : t('file.stillUploading')
```

In the attachments `renderSlot` call (~line 473-488) add `extractions,` after `uploads,`.

- [ ] **Step 4: Intake size rejection**

In `addFiles` (`apply.ts:508`), inside the per-file loop before the image check:

```ts
            if (!directory && file.size > maxFileBytes) return t('file.tooLarge', { size: fileSizeText(maxFileBytes) })
```

Import `fileSizeText` from `@deepseek-ai/dsh-client-ui-primitives` (the primitive `FileCard` already uses).

**Spec note:** the design's "the draft enters an error state" is implemented as intake-time rejection — no draft is created for an oversize file. This matches the existing image-size intake precedent (client pre-check from the `imageLimits` projection) and achieves the same outcome: the file never sends while the rest of the message does.

- [ ] **Step 5: Specs**

- `config.host.spec.ts`: assert the schema defaults (`maxFileBytes` 26214400, `maxExtractChars` 50000) and that `Config({ maxFileBytes: 0 })` is invalid.
- `input-bar.client.spec.tsx`: with a file draft whose extraction entry is `extracting`, submit is held and the explanation line shows `file.stillExtracting`; after the entry flips to `done`, submit proceeds. Mirror the existing upload-gate case in that spec for harness usage.
- `file-intake.client.spec.ts`: an over-limit file (stub a `File` with `size` above the configured limit) is rejected with the `file.tooLarge` message and creates no draft.

Run: `pnpm vitest run packages/client/ui-conversation/tests`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/client/ui-conversation/src/client/apply.ts packages/client/ui-conversation/src/client/skeleton/InputBar.tsx packages/client/ui-conversation/tests
git commit -m "feat(client): extraction limits, send gate, and intake size rejection"
```

---

### Task 4: File-card extraction states in ui-attachment

**Files:**
- Modify: `packages/client/ui-attachment/src/FileCard.tsx`, `src/client/ComposerAttachments.tsx`, `src/client/labels.ts`, `src/FileCard.module.css` (reuse the failed-meta class; no new tokens)
- Test: extend `packages/client/ui-attachment/tests/composer-attachments.client.spec.tsx` and `attachment-rail.client.spec.tsx` as needed

**Interfaces:**
- Consumes from Tasks 2-3: owner prop `extractions: DraftExtractions`; locale keys `file.extracting`, `file.extractFailed`, `file.unsupportedDoc`, `file.noTextLayer`.
- Produces: `FileCardState = 'uploading' | 'ready' | 'error' | 'extracting'`; `FileCardLabels` gains `extracting: string` and `notice?: string` (the single notice channel).

- [ ] **Step 1: FileCard**

In `FileCard.tsx` extend the state union and add the notice line:

```ts
export type FileCardState = 'uploading' | 'ready' | 'error' | 'extracting'
```

Props gain `notice?: string`; rendering: `meta` becomes

```ts
  const meta = state === 'uploading'
    ? labels.uploading
    : state === 'extracting'
      ? labels.extracting
      : state === 'error'
        ? labels.failed
        : labels.notice ?? [extension, fileSizeText(bytes)].filter(part => part !== '').join(' ')
```

with `labels.extracting: string` and `labels.notice?: string` added to `FileCardLabels`, and the `notice` prop dropped from the FileCard props list (the label object is the single channel). The icon branch treats `extracting` like `uploading` (spinner); the progress bar stays upload-only; the notice renders with the existing `css.metaFailed` treatment, folded into both existing body branches so a `ready`-with-notice card shows it.

- [ ] **Step 2: Labels**

In `src/client/labels.ts` extend `fileCardLabels`:

```ts
export function fileCardLabels(
  t: TranslateNS<'conversation'>,
  name: string,
  notice: DocumentExtractNotice | undefined,
): FileCardLabels {
  return {
    label: t('file.pending'),
    remove: t('file.remove', { name }),
    uploading: t('file.uploading'),
    extracting: t('file.extracting'),
    failed: t('file.uploadFailed'),
    retry: t('file.retry', { name }),
    notice: notice === undefined ? undefined
      : notice === 'docLegacy' ? t('file.unsupportedDoc')
        : notice === 'noTextLayer' ? t('file.noTextLayer') : t('file.extractFailed'),
  }
}
```

Import `type { DocumentExtractNotice } from '@deepseek-ai/dsh-client-ui-conversation/client'` (the type re-export must exist — add `export type { DocumentExtractNotice, DraftExtraction, DraftExtractions }` to `ui-conversation/src/client/index.ts` if missing).

- [ ] **Step 3: ComposerAttachments mapping**

In `ComposerAttachments.tsx`: pick up `extractions` from props (add to the prop-pick union and destructure), then in the file-draft branch (~line 70-85):

```ts
                const upload = uploads[attachment.id]
                const extraction = extractions[attachment.id]
                const state = upload === undefined || upload.status === 'uploading'
                  ? 'uploading'
                  : upload.status === 'error' ? 'error'
                    : extraction?.status === 'extracting' ? 'extracting' : 'ready'
                <FileCard
                  name={attachment.file.name || t('file.label')}
                  bytes={attachment.file.size}
                  state={state}
                  {...upload?.status === 'uploading' && upload.total !== undefined && upload.total > 0
                    ? { progress: upload.loaded / upload.total } : {}}
                  labels={fileCardLabels(t, attachment.file.name, extraction?.status === 'failed' ? extraction.notice : undefined)}
                  onRemove={() => { onRemoveAttachment(attachment.id) }}
                  onRetry={() => { onRetryFile(attachment.id) }}
                />
```

The notice reaches the card only through `labels.notice` built by `fileCardLabels`.

- [ ] **Step 4: Specs**

Extend `composer-attachments.client.spec.tsx`: a file draft with an `extracting` entry renders the spinner card with the extracting label; a `failed/docLegacy` entry renders the ready card with the unsupported-doc notice; `done` renders the normal size meta.

Run: `pnpm vitest run packages/client/ui-attachment/tests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/ui-attachment/src packages/client/ui-attachment/tests packages/client/ui-conversation/src/client/index.ts
git commit -m "feat(client): show document extraction states on attachment cards"
```

---

### Task 5: NW overlay, persona, and deploy doc

**Files:**
- Modify: `packages/bundle/web-app/client-north-waterfront.patch.yml` (~line 206-221, ~line 256-353, ~line 365-369 region of `agent-preset-custom` instructionsPrefix)
- Modify: `DEPLOY-CLIENT-SITE.md` (new section; the file already has unrelated uncommitted edits — append only, do not revert them)

- [ ] **Step 1: Re-enable `ui-attachment` with an honest comment**

Replace the block at `client-north-waterfront.patch.yml:206-221` (the comment plus `- id: ui-attachment / disabled: true`) with:

```yaml
# Client-side workspace file surfaces: the preset below drops the agent's fs
# write tools, so the panels and pickers would be dead doors into the serving
# machine's workspace. The `workspace-files` and `file-upload` HOST services
# stay enabled: session-controller waits on them, and disabling either left
# the whole chat inactive.
- id: directory-picker
  disabled: true
# ui-file-actions stays enabled: its file context menus (Download, Copy path)
# are pure UI over the workspace-files read service the client already has, so
# the client can save presented reports (a PDF card has no intrinsic download
# button). It adds no file listing and no fs tools.
# ui-attachment is enabled: the composer "+" menu's add-file row is the client
# upload path. Documents (PDF/DOCX/XLS(X)/TXT/MD/CSV) extract their text in
# the browser at pick time, and the text rides in the user message next to the
# file block; other types attach verbatim. `ui-file-drag` stays enabled for
# the document-preview panel's drag service.
```

(the `ui-attachment` disable row is deleted; nothing is inserted in its place — the base web-app row at `cordis.patch.yml:365` applies.)

- [ ] **Step 2: Pin the limits**

Add a same-id override near the `workspace-controller` block:

```yaml
# Same-id override of the base `ui-conversation` row's whole config (a patch
# replaces the targeted row's config, so every key is restated; the base row
# declares none). Document upload limits for the public client site: 25 MiB
# per file, 50 000 characters of extracted text per document.
- id: ui-conversation
  config:
    maxFileBytes: 26214400
    maxExtractChars: 50000
```

- [ ] **Step 3: Persona guidance in both prefixes**

Append one sentence-block to the `preset-standard` persona `prefix` (line ~267) AND to `agent-preset-custom` `instructionsPrefix` (line ~369), identical text:

```
Clients may attach documents through the composer add-file action (PDF, Word, Excel, plain text); each attached document's extracted text arrives in the same message as a "Content of the attached file" block — treat it as client-provided source material and cite the file name when you rely on it. When that block says the text was truncated, say so and ask for the missing part as plain text; you cannot read the original binary attachment with read unless it is plain text.
```

- [ ] **Step 4: Deploy doc section**

Append to `DEPLOY-CLIENT-SITE.md` a section `## Загрузка документов клиентом` (Russian, matching the file's existing language) documenting: the "+" menu's add-file row, supported formats, the 25 MiB / 50 000-character limits, the `.doc` re-save hint, scanned-PDF behavior, and that extracted text is what the agent reads.

- [ ] **Step 5: Validate the config and commit**

Run: `pnpm dsh web --patch packages/bundle/web-app/client-north-waterfront.patch.yml --port 3082` — wait for the boot/patch load to complete (a browser tab may open; close it). Stop the server (Ctrl+C). If boot fails on the patch, fix the YAML and repeat. `verify-cordis-config` also runs inside the build gate later.

```bash
git add packages/bundle/web-app/client-north-waterfront.patch.yml DEPLOY-CLIENT-SITE.md
git commit -m "feat(nw): client document upload through the composer add-file row"
```

---

### Task 6: READMEs and doc gates

**Files:**
- Modify: `packages/client/ui-conversation/README.md`, `packages/client/ui-attachment/README.md`, plus their `README.*.md` siblings per the bilingual-pairing rule
- Reference: `docs/AGENTS.md` (one physical line per paragraph, budgets)

- [ ] **Step 1: Update the two READMEs**

`ui-conversation/README.md`: document the new Config fields (`maxFileBytes`, `maxExtractChars`), the extraction lifecycle parallel to uploads, and the file+text block emission contract. `ui-attachment/README.md`: document the card extraction states. Keep each fact in one place; follow the existing README structure; run the pairing tool:

Run: `pnpm run verify-translation-pairing --write packages/client/ui-conversation/README.md packages/client/ui-attachment/README.md`
Expected: sibling READMEs regenerated/updated; no pairing errors on re-run.

- [ ] **Step 2: Doc gates**

Run: `pnpm run test:docs`
Expected: PASS (doc-quick aggregate). If `verify-doc-budgets` flags a ceiling, condense the added prose instead of raising the ceiling.

- [ ] **Step 3: Commit**

```bash
git add packages/client/ui-conversation/README*.md packages/client/ui-attachment/README*.md
git commit -m "docs(client): document extraction limits, lifecycle, and card states"
```

---

### Task 7: Build, full local verification, snapshot ownership note

- [ ] **Step 1: Full package suites**

Run: `pnpm vitest run packages/client/ui-conversation/tests packages/client/ui-attachment/tests`
Expected: PASS.

- [ ] **Step 2: Build and aggregate check**

Run: `pnpm run build:artifacts`
Expected: success (tsc emits lib/types; tsdown bundles the web client including the lazily imported parsers).

Run: `pnpm run build:check`
Expected: success (aggregate typecheck against the fresh build output).

- [ ] **Step 3: Focused lint/coverage on touched packages**

Run: `pnpm run lint`
Expected: PASS.

Run: `pnpm vitest run --coverage.enabled packages/client/ui-conversation/tests packages/client/ui-attachment/tests`
Expected: PASS with per-file 100% coverage on both packages' `src` (the CI gate measures `packages/*/*/src`; the scoped run measures exactly these files — any uncovered branch needs a spec before completion).

- [ ] **Step 4: Live NW smoke**

Start: `dsh-web-north-waterfront.cmd` (or `pnpm dsh web --port 3081 --patch packages/bundle/web-app/client-north-waterfront.patch.yml`). In a browser: open a session, "+" → Добавить файл, pick a real PDF, DOCX, XLSX, and TXT; confirm cards show extracting → ready, the message carries the content blocks (check the session log/user message), and the agent cites document content in its answer. Also pick a >25 MiB file (rejection toast) and a `.doc` (re-save hint).

- [ ] **Step 5: Recorded-session snapshot (owner-local, needs key)**

The model-visible message shape changes, so the `file-upload-round` snapshot (`snapshots/web/file-upload-round/`, `recording: live`) needs an owner refresh that captures a document attachment message with its content block. Run `pnpm run test:snapshot:record` scoped to that scenario per `snapshots/AGENTS.md` — requires `DEEPSEEK_API_KEY` and drives the real web UI. Review every JSONL/prompt/UI diff before commit. When the refreshed session carries the new text block, check whether any SDK-facing expected output (`snapshots/sdk/`, TypeScript and Python) projects that message shape and update those projections in the same change. **If no key is available locally, stop and surface this to the user instead of faking or skipping the fixture.**

- [ ] **Step 6: Report**

Report only commands actually run and their outcomes; list any disclosed `--no-verify` uses and the snapshot-ownership status.
