# NW Document Upload and Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the north-waterfront client site accept PDF, DOCX, DOC, XLSX, XLS, TXT, and CSV attachments in chat and answer questions from their extracted text, without giving the agent shell, filesystem, or Office skills.

**Architecture:** One new package `packages/document/tool-document` registers `document_read`. The tool authorizes the requested path against the calling Session's generic-file attachments, reads the stored bytes through `ctx.fs`, extracts text in-process (`pdfjs-dist`, `fflate`, SheetJS), or converts legacy `.doc` through the already-mounted `office-kit`, then returns one bounded window. The NW overlay re-enables `ui-attachment` and mounts the tool in `preset-standard` and in the custom-agent whitelist.

**Tech Stack:** TypeScript ESM, Cordis/Schemastery, `pdfjs-dist` 6.3.289, `fflate` 0.8.x, SheetJS `xlsx` 0.20.3, LibreOffice Kit through `@deepseek-ai/dsh-office-kit`, Vitest.

**Approved design:** `docs/superpowers/specs/2026-11-16-nw-document-analysis-design.md` (approved 2026-11-16).

## Global Constraints

- Branch: `add-documents`. Do not push; commit locally only.
- Repo root: `C:\Users\Lenovo\Desktop\проект SOFT_2\Models FIN\Harness`. Run all commands from the repo root in Git Bash.
- ESM everywhere; local relative imports end in `.ts`; package imports use package names.
- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, and `noUnusedParameters` are on. Handle every possibly-undefined index.
- Where a defensive branch cannot be produced by any reachable fixture (for example a missing stat result), add a narrow `/* v8 ignore next -- <reason> */` comment; `docs/testing.md` requires the reason.
- 100% per-file coverage is required for `packages/*/*/src`; run focused coverage after each extractor and add tests for every branch.
- No new `as unknown` casts. Narrow typed unions instead.
- Every exported symbol needs JSDoc; function-like exports carry `@param`/`@returns`.
- One physical line per README paragraph; English copy in sentence case; bilingual README pairs recorded with `pnpm run verify-translation-pairing --write <README.md>`.
- Files end with exactly one trailing newline.
- `cordis.yml`/patch YAML allows `!!js` (never `!js`) under `config` and entry `disabled`.
- The NW deployment keeps shell, fs, Office skills, and settings disabled. Only `ui-attachment`, `tool-document`, and workspace config change.
- Do not commit real documents or credentials.
- Do not use `pnpm dsh` directly for the client site; use the launcher `dsh-web-north-waterfront.cmd` or `restart-north-waterfront.cmd`.

---

### Task 1: Package scaffold, attachment guard, and TXT/CSV extraction

**Files:**
- Create: `packages/document/tool-document/package.json`
- Create: `packages/document/tool-document/tsconfig.json`
- Create: `packages/document/tool-document/src/errors.ts`
- Create: `packages/document/tool-document/src/types.ts`
- Create: `packages/document/tool-document/src/paths.ts`
- Create: `packages/document/tool-document/src/extract/normalize.ts`
- Create: `packages/document/tool-document/src/extract/text.ts`
- Create: `packages/document/tool-document/src/extract/index.ts`
- Create: `packages/document/tool-document/src/render.ts`
- Create: `packages/document/tool-document/src/index.ts`
- Create: `packages/document/tool-document/tests/support.ts`
- Create: `packages/document/tool-document/tests/read-text.spec.ts`
- Modify: `tsconfig.base.json` (paths, near `@deepseek-ai/dsh-tool-office`)
- Modify: `tsconfig.host.json` (project reference, near `packages/document/tool-office`)

**Interfaces:**
- Consumes: `ctx.tools`, `ctx.fs`, `ctx.attachments`, `ctx.officeKit` (later tasks), Session events.
- Produces: `DocumentReadValue` with `{ path, format, bytes, text, totalChars?, pages?, page?, sheets?, sheet?, range?, row?, rows?, totalRows?, nextOffset?, nextPage?, nextRow? }`; `DocumentFormat`; `DocumentWindow`; `DocumentError` codes; `WindowRequest`.

- [ ] **Step 1: Write the failing tests**

Create `packages/document/tool-document/tests/support.ts`:

```ts
/** Shared composition for document_read tests: real services over a temp home. */

import { Context } from '@deepseek-ai/cordis'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { unsupportedInbox, unsupportedModel } from '@deepseek-ai/dsh-agent-loop-testkit'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import * as ToolDocument from '../src/index.ts'

const cleanups: Array<() => Promise<unknown>> = []
let callNumber = 0

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

/** Attachment helper result: the durable reference and its host path. */
export interface AttachedFile {
  ref: FileAttachmentRef
  hostPath: string
}

/** Test composition over real Cordis services and one calling Agent. */
export interface Setup {
  ctx: Context
  agent: Agent
  session: Session
  root: string
  attach: (name: string, data: Uint8Array) => Promise<AttachedFile>
  execute: (args: Record<string, unknown>) => Promise<ToolExecutionResult>
}

async function agent(ctx: Context, cwd: string): Promise<Agent> {
  const id = SessionId(`document-owner-${++callNumber}`)
  let scope: Scope
  const session = Session.create(id, [], {
    version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd, isSeeded: false,
  })
  const value: Agent = {
    id,
    options: {},
    session,
    model: unsupportedModel(),
    inbox: unsupportedInbox(),
    status: 'idle',
    get ctx() { return scope.ctx },
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, value) }, { inject: ['tools'] }))
  await ctx.agents.register(value)
  return value
}

async function attachFile(
  ctx: Context, session: Session, name: string, data: Uint8Array,
): Promise<AttachedFile> {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) throw new Error('attachment store missing')
  const ref = await attachments.saveFile({ data, name })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: `Attached ${name}` }, { type: 'file', attachment: ref }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const hostPath = attachments.fileHostPath(ref)
  if (hostPath === undefined) throw new Error('attachment host path missing')
  return { ref, hostPath }
}

/** Compose the real services the tool injects over a temp workspace and home. */
export async function compose(overrides: Partial<ToolDocument.Config> = {}): Promise<Setup> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tool-document-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(LocalAttachmentStore, { dshHome: root })
  await ctx.plugin(ToolDocument, overrides)
  const owner = await agent(ctx, root)
  const execute = (args: Record<string, unknown>) => executeToolFixture(ctx, {
    signal: new AbortController().signal,
    callId: ToolCallId(`document-${++callNumber}`),
    name: 'document_read',
    arguments: args,
    agent: owner,
  })
  return {
    ctx, agent: owner, session: owner.session, root,
    attach: (name, data) => attachFile(ctx, owner.session, name, data),
    execute,
  }
}
```

Create `packages/document/tool-document/tests/read-text.spec.ts`:

```ts
/** document_read over plain-text and CSV attachments, including the path guard. */

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ToolCallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { describe, expect, it } from 'vitest'
import { matchesAttachmentPath } from '../src/paths.ts'
import { renderDocument } from '../src/render.ts'
import { compose } from './support.ts'

describe('document_read text formats', () => {
  it('reads a TXT attachment and reports its size', async () => {
    const { attach, execute } = await compose()
    const text = 'Первая строка\nВторая строка'
    const { hostPath } = await attach('notes.txt', new TextEncoder().encode(text))
    const result = await execute({ path: hostPath })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('document_read failed')
    expect(result.value).toMatchObject({ format: 'txt', text, totalChars: text.length })
  })

  it('reads a CSV attachment as text', async () => {
    const { attach, execute } = await compose()
    const text = 'Позиция;Кол-во\nКирпич;100'
    const { hostPath } = await attach('смета.csv', new TextEncoder().encode(text))
    const result = await execute({ path: hostPath })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('document_read failed')
    expect(result.value).toMatchObject({ format: 'csv', text })
  })

  it('returns a character window and the next offset', async () => {
    const { attach, execute } = await compose({ maxChars: 5 })
    const { hostPath } = await attach('long.txt', new TextEncoder().encode('abcdefghij'))
    const result = await execute({ path: hostPath })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('document_read failed')
    expect(result.value).toMatchObject({ text: 'abcde', totalChars: 10, nextOffset: 5 })
  })

  it('continues from offset', async () => {
    const { attach, execute } = await compose({ maxChars: 5 })
    const { hostPath } = await attach('long.txt', new TextEncoder().encode('abcdefghij'))
    const result = await execute({ path: hostPath, offset: 5 })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('document_read failed')
    expect(result.value).toMatchObject({ text: 'fghij', totalChars: 10 })
    expect((result.value as { nextOffset?: number }).nextOffset).toBeUndefined()
  })

  it('honors an explicit limit below the configured cap', async () => {
    const { attach, execute } = await compose()
    const { hostPath } = await attach('long.txt', new TextEncoder().encode('abcdefghij'))
    const result = await execute({ path: hostPath, limit: 3 })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('document_read failed')
    expect(result.value).toMatchObject({ text: 'abc', nextOffset: 3 })
  })

  it('does not read a path that is not an attachment of this Session', async () => {
    const { root, execute } = await compose()
    const secret = join(root, 'secret.txt')
    await writeFile(secret, 'outside the attachment store')
    const result = await execute({ path: secret })
    expect(result.isError).toBe(true)
  })

  it('skips an attachment whose stored host path is unavailable', async () => {
    const { attach } = await compose()
    const { ref } = await attach('notes.txt', new TextEncoder().encode('text'))
    const matched = await matchesAttachmentPath([ref], () => undefined, async () => '/unused', '/unused')
    expect(matched).toBe(false)
  })

  it('accepts a file reference carried by a tool result', async () => {
    const { ctx, session, attach, execute } = await compose()
    const { ref, hostPath } = await attach('tool.txt', new TextEncoder().encode('tool result text'))
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('call-file'),
        content: [{ type: 'text', text: 'saved' }, { type: 'file', attachment: ref }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    const result = await execute({ path: hostPath })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('document_read failed')
    expect(result.value).toMatchObject({ text: 'tool result text' })
  })

  it('rejects an unsupported extension attached to the conversation', async () => {
    const { attach, execute } = await compose()
    const { hostPath } = await attach('photo.png', Uint8Array.from([1, 2, 3]))
    const result = await execute({ path: hostPath })
    expect(result.isError).toBe(true)
  })

  it('rejects a negative page, row, and offset', async () => {
    const { attach, execute } = await compose()
    const { hostPath } = await attach('notes.txt', new TextEncoder().encode('text'))
    expect((await execute({ path: hostPath, page: 0 })).isError).toBe(true)
    expect((await execute({ path: hostPath, row: -1 })).isError).toBe(true)
    expect((await execute({ path: hostPath, offset: -1 })).isError).toBe(true)
  })

  it('requires an agent Session', async () => {
    const { ctx } = await compose()
    const result = await executeToolFixture(ctx, {
      signal: new AbortController().signal,
      callId: ToolCallId('document-no-agent'),
      name: 'document_read',
      arguments: { path: 'any.txt' },
    })
    expect(result.isError).toBe(true)
  })

  it('decodes a windows-1251 text file', async () => {
    const { attach, execute } = await compose()
    const bytes = Uint8Array.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2])
    const { hostPath } = await attach('старый.txt', bytes)
    const result = await execute({ path: hostPath })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('document_read failed')
    expect(result.value).toMatchObject({ text: 'Привет' })
  })

  it('reports a file above maxInputBytes', async () => {
    const { attach, execute } = await compose({ maxInputBytes: 4 })
    const { hostPath } = await attach('big.txt', new TextEncoder().encode('0123456789'))
    expect((await execute({ path: hostPath })).isError).toBe(true)
  })

  it('maps a timeout signal to a document timeout', async () => {
    const { ctx, attach } = await compose()
    const { hostPath } = await attach('notes.txt', new TextEncoder().encode('text'))
    const controller = new AbortController()
    controller.abort(new DOMException('timeout', 'TimeoutError'))
    const result = await executeToolFixture(ctx, {
      signal: controller.signal,
      callId: ToolCallId('document-timeout'),
      name: 'document_read',
      arguments: { path: hostPath },
    })
    expect(result.isError).toBe(true)
  })

  it('rethrows a user abort instead of reporting a timeout', async () => {
    const { ctx, attach } = await compose()
    const { hostPath } = await attach('notes.txt', new TextEncoder().encode('text'))
    const controller = new AbortController()
    controller.abort(new DOMException('stop', 'AbortError'))
    const result = await executeToolFixture(ctx, {
      signal: controller.signal,
      callId: ToolCallId('document-abort'),
      name: 'document_read',
      arguments: { path: hostPath },
    })
    expect(result.isError).toBe(true)
  })

  it('rethrows an abort without a DOMException reason', async () => {
    const { ctx, attach } = await compose()
    const { hostPath } = await attach('notes.txt', new TextEncoder().encode('text'))
    const controller = new AbortController()
    controller.abort(new Error('stop'))
    const result = await executeToolFixture(ctx, {
      signal: controller.signal,
      callId: ToolCallId('document-error-abort'),
      name: 'document_read',
      arguments: { path: hostPath },
    })
    expect(result.isError).toBe(true)
  })

  it('renders a text value without optional location fields', () => {
    const blocks = renderDocument({ path: '/tmp/notes.txt', format: 'txt', bytes: 3, text: 'abc' })
    expect(blocks[0]?.text).toContain('Document "notes.txt"')
  })

  it('renders a sheet value with default location fields', () => {
    const blocks = renderDocument({ path: '/tmp/book.xlsx', format: 'xlsx', bytes: 3, text: '', sheet: 'Лист' })
    expect(blocks[0]?.text).toContain('sheet "Лист" rows 0-0')
  })

  it('renders a page value without a page count', () => {
    const blocks = renderDocument({ path: '/tmp/a.pdf', format: 'pdf', bytes: 3, text: 'abc', page: 1 })
    expect(blocks[0]?.text).toContain('page 1 of 1')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run packages/document/tool-document/tests/read-text.spec.ts` — Expected: FAIL because `../src/index.ts` does not exist.

- [ ] **Step 3: Create the package manifests**

Create `packages/document/tool-document/package.json`:

```json
{
  "name": "@deepseek-ai/dsh-tool-document",
  "description": "Model-facing text extraction from uploaded PDF, Word, spreadsheet, and plain-text documents",
  "version": "0.2.2-rc.2",
  "publishConfig": {
    "access": "public"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/deepseek-ai/deepseek-harness.git",
    "directory": "packages/document/tool-document"
  },
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/types/index.d.ts",
      "default": "./lib/index.js"
    },
    "./src/*": "./src/*",
    "./package.json": "./package.json",
    "./locale/*.json": "./locale/*.json"
  },
  "license": "MIT",
  "files": [
    "locale/*.json",
    "lib/index.js",
    "lib/types/**/*.d.ts",
    "lib/types/**/*.d.ts.map",
    "lib/**/*.js.map",
    "src"
  ],
  "dependencies": {
    "@deepseek-ai/schemastery": "workspace:~",
    "fflate": "^0.8.2",
    "pdfjs-dist": "6.3.289",
    "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "workspace:~",
    "@deepseek-ai/dsh-agent": "workspace:*",
    "@deepseek-ai/dsh-attachment": "workspace:*",
    "@deepseek-ai/dsh-error": "workspace:*",
    "@deepseek-ai/dsh-fs": "workspace:*",
    "@deepseek-ai/dsh-llm": "workspace:*",
    "@deepseek-ai/dsh-office-kit": "workspace:*",
    "@deepseek-ai/dsh-session": "workspace:*",
    "@deepseek-ai/dsh-tools": "workspace:*"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "workspace:~",
    "@deepseek-ai/dsh-agent": "workspace:*",
    "@deepseek-ai/dsh-agent-loop-testkit": "workspace:*",
    "@deepseek-ai/dsh-attachment": "workspace:*",
    "@deepseek-ai/dsh-attachment-local": "workspace:*",
    "@deepseek-ai/dsh-error": "workspace:*",
    "@deepseek-ai/dsh-fs": "workspace:*",
    "@deepseek-ai/dsh-fs-local": "workspace:*",
    "@deepseek-ai/dsh-llm": "workspace:*",
    "@deepseek-ai/dsh-office-kit": "workspace:*",
    "@deepseek-ai/dsh-scope": "workspace:*",
    "@deepseek-ai/dsh-session": "workspace:*",
    "@deepseek-ai/dsh-session-projection": "workspace:*",
    "@deepseek-ai/dsh-system-prompt": "workspace:*",
    "@deepseek-ai/dsh-tool-executor-native": "workspace:*",
    "@deepseek-ai/dsh-tool-testkit": "workspace:*",
    "@deepseek-ai/dsh-tools": "workspace:*",
    "pdf-lib": "^1.17.1"
  }
}
```

Create `packages/document/tool-document/tsconfig.json`:

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "lib/types"
  },
  "include": [
    "src"
  ],
  "references": [
    {
      "path": "../../../vendor/cordis"
    },
    {
      "path": "../../../vendor/schemastery"
    },
    {
      "path": "../../attachment/attachment"
    },
    {
      "path": "../../core/agent"
    },
    {
      "path": "../../document/office-kit"
    },
    {
      "path": "../../fs/fs"
    },
    {
      "path": "../../llm/llm"
    },
    {
      "path": "../../core/session"
    },
    {
      "path": "../../core/tools"
    },
    {
      "path": "../../util/error"
    }
  ]
}
```

Modify `tsconfig.base.json`: add this paths entry immediately before `"@deepseek-ai/dsh-tool-office"`:

```json
      "@deepseek-ai/dsh-tool-document": ["./packages/document/tool-document/src"],
```

Modify `tsconfig.host.json`: add this reference immediately before `{ "path": "./packages/document/tool-office" },`:

```json
    { "path": "./packages/document/tool-document" },
```

- [ ] **Step 4: Create the error and type modules**

Create `packages/document/tool-document/src/errors.ts`:

```ts
/** Document-extraction failure class. @module @deepseek-ai/dsh-tool-document/errors */

import { HarnessError } from '@deepseek-ai/dsh-error'

const DOCUMENT_ERROR_CODES = [
  'UNSUPPORTED_FORMAT',
  'TOO_LARGE',
  'UNREADABLE',
  'NO_TEXT_LAYER',
  'NOT_AN_ATTACHMENT',
  'CONVERTER_UNAVAILABLE',
  'TIMEOUT',
  'INVALID_SELECTION',
] as const

/** Stable document failure codes. */
export type DocumentErrorCode = typeof DOCUMENT_ERROR_CODES[number]

/** A classified extraction failure with a stable machine-routing code. */
export class DocumentError extends HarnessError {
  /** Stable machine-routing failure code. */
  override readonly code: DocumentErrorCode

  /**
   * @param message - human-readable failure description without document contents.
   * @param code - stable machine-routing code.
   * @param options - optional chained cause.
   */
  constructor(message: string, code: DocumentErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'DocumentError'
    this.code = code
  }
}
```

Create `packages/document/tool-document/src/types.ts`:

```ts
/** Formats `document_read` extracts. */
export type DocumentFormat = 'pdf' | 'docx' | 'doc' | 'xlsx' | 'xls' | 'txt' | 'csv'

/** A bounded extraction window and the document location it covers. */
export interface DocumentWindow {
  /** Extracted text of the requested unit. */
  text: string
  /** Characters in the complete selected unit; absent for workbooks. */
  totalChars?: number
  /** PDF page count. */
  pages?: number
  /** One-based PDF page the window covers. */
  page?: number
  /** Workbook sheet names. */
  sheets?: string[]
  /** Selected workbook sheet. */
  sheet?: string
  /** Selected sheet's used range in A1 notation. */
  range?: string
  /** Zero-based first data row of the selected sheet. */
  row?: number
  /** Data rows the sheet window covers. */
  rows?: number
  /** Data rows in the selected sheet's used range. */
  totalRows?: number
}

/** Canonical result of one document_read call. */
export interface DocumentReadValue {
  /** Resolved document path. */
  path: string
  /** Detected document format. */
  format: DocumentFormat
  /** Document size in bytes. */
  bytes: number
  /** Extracted text window. */
  text: string
  /** Characters in the complete selected unit. */
  totalChars?: number
  /** PDF page count. */
  pages?: number
  /** One-based PDF page. */
  page?: number
  /** Workbook sheet names. */
  sheets?: string[]
  /** Selected workbook sheet. */
  sheet?: string
  /** Selected sheet's used range in A1 notation. */
  range?: string
  /** Zero-based first data row of the selected sheet. */
  row?: number
  /** Data rows in this window. */
  rows?: number
  /** Data rows in the selected sheet's used range. */
  totalRows?: number
  /** Character offset of the next text window. */
  nextOffset?: number
  /** Next PDF page. */
  nextPage?: number
  /** Next worksheet row. */
  nextRow?: number
}
```

- [ ] **Step 5: Create the attachment path guard**

Create `packages/document/tool-document/src/paths.ts`:

```ts
/**
 * Attachment-path authorization for document_read: the requested path must be
 * one of the calling Session's generic-file attachments. @module
 * @deepseek-ai/dsh-tool-document/paths
 */

import { basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { DocumentError } from './errors.ts'
/**
 * Collect every generic-file attachment referenced by the Session's logged messages.
 * @param session - calling agent Session.
 * @returns distinct file references in log order.
 */
export function sessionFileReferences(session: Session): FileAttachmentRef[] {
  const seen = new Set<string>()
  const refs: FileAttachmentRef[] = []
  const collect = (blocks: readonly ContentBlock[]): void => {
    for (const block of blocks) {
      if (block.type !== 'file') continue
      const id = String(block.attachment.attachmentId)
      if (seen.has(id)) continue
      seen.add(id)
      refs.push(block.attachment)
    }
  }
  for (const event of session.snapshotEvents()) {
    if (event.type === 'user/message') collect(event.data.content)
    else if (event.type === 'tool/result') collect(event.data.message.content)
  }
  return refs
}

/**
 * Test whether one Session attachment stores the requested path.
 * @param refs - Session file references.
 * @param hostPathOf - resolves one reference to its stored host path.
 * @param processPathOf - resolves one host path to the execution-world path.
 * @param wanted - requested execution-world path.
 * @returns true when a reference stores the requested path.
 */
export async function matchesAttachmentPath(
  refs: readonly FileAttachmentRef[],
  hostPathOf: (ref: FileAttachmentRef) => string | undefined,
  processPathOf: (hostPath: string) => Promise<string>,
  wanted: string,
): Promise<boolean> {
  for (const ref of refs) {
    const hostPath = hostPathOf(ref)
    if (hostPath === undefined) continue
    if (await processPathOf(hostPath) === wanted) return true
  }
  return false
}

/**
 * Resolve a requested path only when it matches a generic-file attachment of the Session.
 * @param ctx - context owning the attachment store and filesystem.
 * @param session - calling agent Session.
 * @param requested - absolute path from the attachment handle.
 * @param signal - cancellation for filesystem resolution.
 * @returns the resolved target of the authorized attachment.
 * @throws a DocumentError with code NOT_AN_ATTACHMENT for every other path.
 */
export async function authorizeAttachmentPath(
  ctx: Context, session: Session, requested: string, signal: AbortSignal,
): Promise<FsTarget> {
  const target = await ctx.fs.resolve(requested, { signal })
  const wanted = ctx.fs.processPath(target)
  const matched = await matchesAttachmentPath(
    sessionFileReferences(session),
    ref => ctx.attachments.fileHostPath(ref),
    async hostPath => ctx.fs.processPath(await ctx.fs.resolve(hostPath, { signal })),
    wanted,
  )
  if (matched) return target
  throw new DocumentError(
    'NOT_AN_ATTACHMENT',
    `document_read reads only documents attached to this conversation; "${basename(requested)}" is not one of them.`,
  )
}
```

- [ ] **Step 6: Create the text normalization and extraction modules**

Create `packages/document/tool-document/src/extract/normalize.ts`:

```ts
/** Text normalization shared by the document extractors. @module @deepseek-ai/dsh-tool-document/extract/normalize */

/**
 * Normalize extracted text: CRLF, trailing spaces, and long blank runs.
 * @param text - raw extracted text.
 * @returns the normalized text without leading or trailing whitespace.
 */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+$/gmu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}
```

Create `packages/document/tool-document/src/extract/text.ts`:

```ts
/** Plain-text and CSV decoding. @module @deepseek-ai/dsh-tool-document/extract/text */

import { normalizeText } from './normalize.ts'

/**
 * Decode UTF-8 text, falling back to windows-1251 for legacy Russian files.
 * @param bytes - complete document bytes.
 * @returns decoded text.
 * @throws when neither UTF-8 nor windows-1251 can represent the bytes.
 */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    if (!(error instanceof TypeError)) throw error
    return new TextDecoder('windows-1251').decode(bytes)
  }
}

/**
 * Decode and normalize a plain-text or CSV document.
 * @param bytes - complete document bytes.
 * @returns normalized text.
 */
export function readPlainText(bytes: Uint8Array): string {
  return normalizeText(decodeText(bytes))
}
```

- [ ] **Step 7: Create the extraction dispatcher**

Create `packages/document/tool-document/src/extract/index.ts`:

```ts
/**
 * Format dispatch for document_read. Each format extracts one bounded unit;
 * later formats are added by their own implementation tasks. @module
 * @deepseek-ai/dsh-tool-document/extract
 */

import { extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { DocumentError } from '../errors.ts'
import type { DocumentFormat, DocumentWindow } from '../types.ts'
import { readPlainText } from './text.ts'

/** Extraction bounds and unit selection for one call. */
export interface WindowRequest {
  /** One-based PDF page. */
  page?: number
  /** Workbook worksheet name. */
  sheet?: string
  /** Zero-based first data row of the selected worksheet. */
  row?: number
  /** Character offset inside the selected page or document. */
  offset?: number
  /** Maximum characters in the returned window. */
  limit: number
  /** Maximum worksheet rows in the returned window. */
  maxRows: number
  /** Maximum bytes accepted from a converted legacy document. */
  maxBytes: number
}

/**
 * Map a stored document leaf name to its extraction format.
 * @param displayPath - resolved document path.
 * @returns the supported format.
 * @throws a DocumentError with code UNSUPPORTED_FORMAT for every other extension.
 */
export function formatOf(displayPath: string): DocumentFormat {
  switch (extname(displayPath).toLowerCase()) {
    case '.txt': return 'txt'
    case '.csv': return 'csv'
    default:
      throw new DocumentError(
        'UNSUPPORTED_FORMAT',
        `"${displayPath}" is not a supported document; supported formats are PDF, DOCX, DOC, XLSX, XLS, TXT, and CSV.`,
      )
  }
}

function slice(text: string, offset: number, limit: number): DocumentWindow {
  const start = Math.min(offset, text.length)
  return { text: text.slice(start, start + limit), totalChars: text.length }
}

/**
 * Extract one window from an authorized document.
 * @param ctx - context owning optional conversion services.
 * @param agent - calling agent, used for conversion ownership.
 * @param target - authorized document target.
 * @param format - detected format.
 * @param bytes - complete document bytes.
 * @param request - unit selection and bounds.
 * @param signal - cancellation for extraction and conversion.
 * @returns the extracted window.
 */
export async function extractDocument(
  ctx: Context, agent: Agent, target: FsTarget, format: DocumentFormat, bytes: Uint8Array,
  request: WindowRequest, signal: AbortSignal,
): Promise<DocumentWindow> {
  void ctx
  void agent
  void target
  void signal
  switch (format) {
    case 'txt':
    case 'csv':
      return slice(readPlainText(bytes), request.offset ?? 0, request.limit)
    default:
      throw new DocumentError('UNSUPPORTED_FORMAT', `"${target.displayPath}" cannot be extracted.`)
  }
}
```

- [ ] **Step 8: Create the result renderer**

Create `packages/document/tool-document/src/render.ts`:

```ts
/** Model-facing result rendering for document_read. @module @deepseek-ai/dsh-tool-document/render */

import { basename } from 'node:path'
import type { DocumentReadValue } from './types.ts'

function describe(value: DocumentReadValue): string {
  const head = `Document "${basename(value.path)}" (${value.format}, ${value.bytes} bytes)`
  if (value.page !== undefined) {
    return `${head}: page ${value.page} of ${value.pages ?? value.page}, ${value.text.length} of ${value.totalChars ?? value.text.length} characters.`
  }
  if (value.sheet !== undefined) {
    const sheets = (value.sheets ?? []).map(sheet => JSON.stringify(sheet)).join(', ')
    const first = value.row ?? 0
    const last = first + Math.max((value.rows ?? 0) - 1, 0)
    return `${head}: sheets ${sheets}; sheet ${JSON.stringify(value.sheet)} rows ${first}-${last} of ${value.totalRows ?? 0}, range ${value.range ?? 'A1'}.`
  }
  return `${head}: ${value.text.length} of ${value.totalChars ?? value.text.length} characters.`
}

function continuation(value: DocumentReadValue): string {
  if (value.nextOffset !== undefined) return `\n\nMore text remains on this page or document: call document_read with offset=${value.nextOffset}.`
  if (value.nextPage !== undefined) return `\n\nMore pages remain: call document_read with page=${value.nextPage}.`
  if (value.nextRow !== undefined) return `\n\nMore rows remain: call document_read with row=${value.nextRow} and the same sheet.`
  return ''
}

/**
 * Render the model-facing content of one document window.
 * @param value - canonical document_read result.
 * @returns the file envelope, metadata line, text, and continuation hint.
 */
export function renderDocument(value: DocumentReadValue): { type: 'text'; text: string }[] {
  return [{
    type: 'text',
    text: `<path>${value.path}</path>\n<type>file</type>\n<content>\n`
      + `${describe(value)}\n${value.text}${continuation(value)}\n</content>`,
  }]
}
```

- [ ] **Step 9: Create the plugin and tool definition**

Create `packages/document/tool-document/src/index.ts`:

```ts
/**
 * Model-facing document reading: extract text from an uploaded PDF, Word,
 * spreadsheet, or plain-text file and return one bounded window. @module
 * @deepseek-ai/dsh-tool-document
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { FsError } from '@deepseek-ai/dsh-fs'
import { ToolArgsError, ToolContextUnavailableError, defineTool } from '@deepseek-ai/dsh-tools'
import { DocumentError } from './errors.ts'
import { extractDocument, formatOf, type WindowRequest } from './extract/index.ts'
import { authorizeAttachmentPath } from './paths.ts'
import { renderDocument } from './render.ts'
import type { DocumentFormat, DocumentReadValue, DocumentWindow } from './types.ts'

export type { DocumentReadValue } from './types.ts'

/** Extraction bounds; every value is deployment-configurable. */
export interface Config {
  /** Maximum accepted source bytes. */
  maxInputBytes: number
  /** Maximum characters in one returned window. */
  maxChars: number
  /** Maximum workbook rows in one returned window. */
  maxRows: number
  /** Extraction deadline in milliseconds. */
  timeoutMs: number
}

/** Validated extraction bounds. */
export const Config: z<Partial<Config>, Config> = z.object({
  maxInputBytes: z.natural().min(1).default(52_428_800),
  maxChars: z.natural().min(1).max(1_000_000).default(20_000),
  maxRows: z.natural().min(1).max(100_000).default(500),
  timeoutMs: z.natural().min(1).default(30_000),
})

/** Stable Loader identity. */
export const name = 'tool-document'

/** Required services; the Office kit is read at call time. */
export const inject = ['tools', 'fs', 'attachments']

function requestOf(args: {
  page?: number
  sheet?: string
  row?: number
  offset?: number
  limit?: number
}, config: Config): WindowRequest {
  const page = args.page ?? 1
  if (!Number.isSafeInteger(page) || page < 1) throw new ToolArgsError(['document_read requires page to be a positive integer'])
  const row = args.row ?? 0
  if (!Number.isSafeInteger(row) || row < 0) throw new ToolArgsError(['document_read requires row to be a non-negative integer'])
  const offset = args.offset ?? 0
  if (!Number.isSafeInteger(offset) || offset < 0) throw new ToolArgsError(['document_read requires offset to be a non-negative integer'])
  const limit = args.limit === undefined ? config.maxChars : Math.min(args.limit, config.maxChars)
  if (!Number.isSafeInteger(limit) || limit < 1) throw new ToolArgsError(['document_read requires limit to be a positive integer'])
  return {
    page, row, offset, limit, maxRows: config.maxRows, maxBytes: config.maxInputBytes,
    ...args.sheet === undefined ? {} : { sheet: args.sheet },
  }
}

function valueOf(
  target: FsTarget, format: DocumentFormat, bytes: number, extracted: DocumentWindow, request: WindowRequest,
): DocumentReadValue {
  const value: DocumentReadValue = {
    path: target.displayPath,
    format,
    bytes,
    text: extracted.text,
    ...extracted.totalChars === undefined ? {} : { totalChars: extracted.totalChars },
    ...extracted.pages === undefined ? {} : { pages: extracted.pages },
    ...extracted.page === undefined ? {} : { page: extracted.page },
    ...extracted.sheets === undefined ? {} : { sheets: extracted.sheets },
    ...extracted.sheet === undefined ? {} : { sheet: extracted.sheet },
    ...extracted.range === undefined ? {} : { range: extracted.range },
    ...extracted.row === undefined ? {} : { row: extracted.row },
    ...extracted.rows === undefined ? {} : { rows: extracted.rows },
    ...extracted.totalRows === undefined ? {} : { totalRows: extracted.totalRows },
  }
  if (value.page !== undefined && value.pages !== undefined && value.page < value.pages) value.nextPage = value.page + 1
  if (value.totalChars !== undefined) {
    const offset = request.offset ?? 0
    if (offset + value.text.length < value.totalChars) value.nextOffset = offset + value.text.length
  }
  if (value.row !== undefined && value.rows !== undefined && value.totalRows !== undefined
    && value.row + value.rows < value.totalRows) value.nextRow = value.row + value.rows
  return value
}

/**
 * Register document_read with the extraction bounds.
 * @param ctx - agent-scoped services.
 * @param config - validated extraction bounds.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'document_read',
    description: 'Read text from a document the user attached to this conversation. Supports PDF, DOCX, DOC, '
      + 'XLSX, XLS, TXT, and CSV. Pass the absolute path from the attachment handle line in the user message. '
      + 'PDF: page selects one page (default 1); a page without a text layer, such as a scan, reports that no '
      + 'text exists. Workbook: sheet selects a worksheet and row selects the first data row; cells are '
      + 'tab-separated, and formulas follow values as (=formula). Other documents: offset and limit select a '
      + 'character window. Follow nextPage, nextOffset, or nextRow to continue a long document.',
    parameters: {
      path: {
        type: 'string', required: true,
        description: 'Absolute saved path of an uploaded document, as shown in its attachment handle.',
      },
      page: { type: 'integer', description: 'One-based PDF page; defaults to 1.' },
      sheet: { type: 'string', description: 'Workbook worksheet name; defaults to the first sheet.' },
      row: { type: 'integer', description: 'Zero-based first data row of the selected worksheet.' },
      offset: { type: 'integer', description: 'Character offset inside the selected page or document text.' },
      limit: { type: 'integer', description: 'Maximum characters to return; capped by configuration.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          format: {
            type: 'string', required: true,
            enum: ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'txt', 'csv'],
          },
          bytes: { type: 'integer', required: true },
          text: { type: 'string', required: true },
          totalChars: { type: 'integer' },
          pages: { type: 'integer' },
          page: { type: 'integer' },
          sheets: { type: 'array', items: { type: 'string' } },
          sheet: { type: 'string' },
          range: { type: 'string' },
          row: { type: 'integer' },
          rows: { type: 'integer' },
          totalRows: { type: 'integer' },
          nextOffset: { type: 'integer' },
          nextPage: { type: 'integer' },
          nextRow: { type: 'integer' },
        },
      },
      render: (_args, value) => renderDocument(value),
    },
    presentCall: args => ({
      card: 'generic' as const,
      title: `Document → ${args.path.split(/[\\/]/u).at(-1) ?? args.path}`,
      kind: 'other' as const,
      rawInput: { path: args.path, page: args.page, sheet: args.sheet },
    }),
    async execute(args, exec) {
      if (exec.agent === undefined) throw new ToolContextUnavailableError('document_read requires an agent Session')
      const signal = AbortSignal.any([exec.signal, AbortSignal.timeout(config.timeoutMs)])
      let target: FsTarget
      let value: DocumentReadValue
      try {
        signal.throwIfAborted()
        target = await authorizeAttachmentPath(ctx, exec.agent.session, args.path, signal)
        const format = formatOf(target.displayPath)
        const request = requestOf(args, config)
        const bytes = await ctx.fs.readBytes(target, signal, config.maxInputBytes).catch((error: unknown) => {
          if (error instanceof FsError && error.code === 'FS_TOO_LARGE') {
            throw new DocumentError('TOO_LARGE', `The document exceeds the ${config.maxInputBytes}-byte limit.`)
          }
          throw error
        })
        const window = await extractDocument(ctx, exec.agent, target, format, bytes, request, signal)
        value = valueOf(target, format, bytes.byteLength, window, request)
      } catch (error) {
        if (error instanceof DocumentError) throw error
        if (signal.aborted && signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError') {
          throw new DocumentError('TIMEOUT', `Document extraction exceeded ${config.timeoutMs} ms.`)
        }
        throw error
      }
      return value
    },
  }))
}
```

- [ ] **Step 10: Link the workspace and run the tests**

Run: `pnpm install` — Expected: the new workspace package links; the lockfile updates.

Run: `pnpm exec vitest run packages/document/tool-document/tests/read-text.spec.ts` — Expected: PASS (8 tests).

Run: `pnpm exec vitest run --coverage packages/document/tool-document` — Expected: PASS with 100% lines and branches for `src/errors.ts`, `src/paths.ts`, `src/extract/normalize.ts`, `src/extract/text.ts`, `src/extract/index.ts`, `src/index.ts`, `src/render.ts`. Add tests for whichever branch is reported missing before committing.

- [ ] **Step 11: Commit**

```bash
git add packages/document/tool-document tsconfig.base.json tsconfig.host.json pnpm-lock.yaml
git commit -m "feat(tool-document): read TXT and CSV attachments with a Session attachment guard"
```

---

### Task 2: PDF text extraction

**Files:**
- Create: `packages/document/tool-document/src/extract/pdf.ts`
- Create: `packages/document/tool-document/tests/pdf.spec.ts`
- Modify: `packages/document/tool-document/src/extract/index.ts`

**Interfaces:**
- Consumes: Task 1's `DocumentWindow`, `DocumentError`, `WindowRequest`.
- Produces: `extractPdfPage(bytes: Uint8Array, page: number): Promise<{ pages: number; text: string }>`.

- [ ] **Step 1: Write the failing tests**

Create `packages/document/tool-document/tests/pdf.spec.ts`:

```ts
/** document_read over generated PDFs: text pages, page selection, and scans. */

import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { compose } from './support.ts'

async function pdfBytes(lines: readonly string[]): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  for (const line of lines) {
    const page = document.addPage()
    if (line !== '') page.drawText(line, { x: 50, y: 700, size: 12, font })
  }
  return new Uint8Array(await document.save())
}

describe('document_read PDF', () => {
  it('reads the first page and reports the page count', async () => {
    const { attach, execute } = await compose()
    const { hostPath } = await attach('report.pdf', await pdfBytes(['First page text', 'Second page text']))
    const result = await execute({ path: hostPath })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('document_read failed')
    expect(result.value).toMatchObject({ format: 'pdf', page: 1, pages: 2, nextPage: 2 })
    expect((result.value as { text: string }).text).toContain('First page text')
  })

  it('reads a selected page', async () => {
    const { attach, execute } = await compose()
    const { hostPath } = await attach('report.pdf', await pdfBytes(['First page text', 'Second page text']))
    const result = await execute({ path: hostPath, page: 2 })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('document_read failed')
    expect(result.value).toMatchObject({ page: 2, pages: 2 })
    expect((result.value as { text: string }).text).toContain('Second page text')
  })

  it('rejects a page outside the document', async () => {
    const { attach, execute } = await compose()
    const { hostPath } = await attach('report.pdf', await pdfBytes(['Only page']))
    const result = await execute({ path: hostPath, page: 3 })
    expect(result.isError).toBe(true)
  })

  it('reports a page without a text layer as a scan', async () => {
    const { attach, execute } = await compose()
    const { hostPath } = await attach('scan.pdf', await pdfBytes(['']))
    const result = await execute({ path: hostPath })
    expect(result.isError).toBe(true)
  })

  it('reports bytes that are not a PDF', async () => {
    const { attach, execute } = await compose()
    const { hostPath } = await attach('broken.pdf', Uint8Array.from([1, 2, 3, 4]))
    expect((await execute({ path: hostPath })).isError).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run packages/document/tool-document/tests/pdf.spec.ts` — Expected: FAIL because `.pdf` is reported as an unsupported format.

- [ ] **Step 3: Implement the PDF extractor**

Create `packages/document/tool-document/src/extract/pdf.ts`:

```ts
/** PDF text-layer extraction through pdfjs. @module @deepseek-ai/dsh-tool-document/extract/pdf */

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { DocumentError } from '../errors.ts'
import { normalizeText } from './normalize.ts'

/** One extracted PDF page and the document page count. */
export interface PdfPageText {
  /** Total pages in the document. */
  pages: number
  /** Normalized text of the selected page. */
  text: string
}

/**
 * Extract the text layer of one PDF page.
 * @param bytes - complete PDF bytes.
 * @param page - one-based page number.
 * @returns the page text and the document page count.
 * @throws a DocumentError with code INVALID_SELECTION for a page outside the document,
 *   or code UNREADABLE when pdfjs cannot open the file.
 */
export async function extractPdfPage(bytes: Uint8Array, page: number): Promise<PdfPageText> {
  const task = getDocument({
    data: bytes,
    isEvalSupported: false,
    useWorkerFetch: false,
    verbosity: 0,
  })
  try {
    const document = await task.promise
    if (page < 1 || page > document.numPages) {
      throw new DocumentError(
        'INVALID_SELECTION',
        `The document has ${document.numPages} page(s); page ${page} is out of range.`,
      )
    }
    const pdfPage = await document.getPage(page)
    const content = await pdfPage.getTextContent()
    let text = ''
    for (const item of content.items) {
      if (!('str' in item)) continue
      if (text.length > 0 && !/\s$/u.test(text) && !/^\s/u.test(item.str)) text += ' '
      text += item.str
      if (item.hasEOL) text += '\n'
    }
    return { pages: document.numPages, text: normalizeText(text) }
  } catch (error) {
    if (error instanceof DocumentError) throw error
    throw new DocumentError('UNREADABLE', 'The PDF file could not be read.', { cause: error })
  } finally {
    await task.destroy()
  }
}
```

- [ ] **Step 4: Wire the format into the dispatcher**

Modify `packages/document/tool-document/src/extract/index.ts`:
- Add import after `readPlainText`:

```ts
import { extractPdfPage } from './pdf.ts'
```

- Add the `.pdf` case in `formatOf` before `'.txt'`:

```ts
    case '.pdf': return 'pdf'
```

- Add the `pdf` case in `extractDocument` before the `txt` case:

```ts
    case 'pdf': {
      const page = request.page ?? 1
      const extracted = await extractPdfPage(bytes, page)
      signal.throwIfAborted()
      if (extracted.text.length === 0) {
        throw new DocumentError(
          'NO_TEXT_LAYER',
          `Page ${page} of "${target.displayPath}" has no extractable text; the PDF may be a scan.`,
        )
      }
      const window = slice(extracted.text, request.offset ?? 0, request.limit)
      return { ...window, pages: extracted.pages, page }
    }
```

- Remove the placeholder lines `void ctx`, `void agent`, `void target`, `void signal` only after the `doc` task wires all parameters; they exist so Task 1 compiles before every format lands. Keep them until Task 5.

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run packages/document/tool-document/tests/pdf.spec.ts` — Expected: PASS (4 tests).

Run: `pnpm exec vitest run --coverage packages/document/tool-document` — Expected: PASS with `src/extract/pdf.ts` at 100%.

- [ ] **Step 6: Commit**

```bash
git add packages/document/tool-document
git commit -m "feat(tool-document): extract PDF page text and report scans without a text layer"
```

---

### Task 3: DOCX text extraction

**Files:**
- Create: `packages/document/tool-document/src/extract/docx.ts`
- Create: `packages/document/tool-document/tests/docx.spec.ts`
- Modify: `packages/document/tool-document/src/extract/index.ts`

**Interfaces:**
- Consumes: `normalizeText`, `DocumentError`.
- Produces: `extractDocx(bytes: Uint8Array): string`.

- [ ] **Step 1: Write the failing tests**

Create `packages/document/tool-document/tests/docx.spec.ts`:

```ts
/** document_read over generated DOCX bodies: paragraphs, tables, and entities. */

import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { compose } from './support.ts'

function docxBytes(body: string): Uint8Array {
  return zipSync({
    'word/document.xml': strToU8(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + `<w:body>${body}</w:body></w:document>`,
    ),
  })
}

const PARAGRAPHS = '<w:p><w:r><w:t>Первый абзац</w:t></w:r></w:p>'
  + '<w:p><w:r><w:t xml:space="preserve">Второй </w:t></w:r><w:r><w:t>абзац</w:t></w:r>'
  + '<w:r><w:tab/><w:t>после табуляции</w:t></w:r><w:r><w:br/><w:t>после переноса</w:t></w:r></w:p>'
const TABLE = '<w:tbl><w:tr>'
  + '<w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc>'
  + '<w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc>'
  + '</w:tr></w:tbl>'
const ENTITY = '<w:p><w:r><w:t>Fish &amp; chips &#1055;&#x41; &unknown;</w:t></w:r></w:p>'

describe('document_read DOCX', () => {
  it('extracts paragraphs and preserves word boundaries', async () => {
    const { attach, execute } = await compose()
    const { hostPath } = await attach('письмо.docx', docxBytes(PARAGRAPHS))
    const result = await execute({ path: hostPath })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('document_read failed')
    const text = (result.value as { text: string }).text
    expect(text).toContain('Первый абзац')
    expect(text).toContain('Второй абзац')
    expect(text).toContain('после табуляции')
    expect(text).toContain('после переноса')
    expect(result.value).toMatchObject({ format: 'docx' })
  })

  it('extracts table cells and XML entities', async () => {
    const { attach, execute } = await compose()
    const { hostPath } = await attach('таблица.docx', docxBytes(TABLE + ENTITY))
    const result = await execute({ path: hostPath })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('document_read failed')
    const text = (result.value as { text: string }).text
    expect(text).toContain('A1')
    expect(text).toContain('B1')
    expect(text).toContain('Fish & chips ПA &unknown;')
  })

  it('reports a ZIP without a document body', async () => {
    const { attach, execute } = await compose()
    const { hostPath } = await attach('broken.docx', zipSync({ 'word/styles.xml': strToU8('<x/>') }))
    const result = await execute({ path: hostPath })
    expect(result.isError).toBe(true)
  })

  it('reports bytes that are not a ZIP', async () => {
    const { attach, execute } = await compose()
    const { hostPath } = await attach('broken.docx', Uint8Array.from([1, 2, 3, 4]))
    const result = await execute({ path: hostPath })
    expect(result.isError).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run packages/document/tool-document/tests/docx.spec.ts` — Expected: FAIL because `.docx` is reported as an unsupported format.

- [ ] **Step 3: Implement the DOCX extractor**

Create `packages/document/tool-document/src/extract/docx.ts`:

```ts
/** DOCX body-text extraction from the OOXML package. @module @deepseek-ai/dsh-tool-document/extract/docx */

import { unzipSync } from 'fflate'
import { DocumentError } from '../errors.ts'
import { normalizeText } from './normalize.ts'

const TOKEN = /<(\/?)(w:p|w:tbl|w:tr|w:tc|w:t|w:tab|w:br)\b[^>]*>/gu
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
}

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/giu, (entity: string, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16))
    }
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10))
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity
  })
}

function readWordXml(xml: string): string {
  let out = ''
  let cursor = 0
  let inText = false
  for (const match of xml.matchAll(TOKEN)) {
    const index = match.index ?? 0
    if (inText) out += decodeXml(xml.slice(cursor, index))
    cursor = index + (match[0] ?? '').length
    const closing = match[1] === '/'
    const tag = match[2]
    if (tag === 'w:t') { inText = !closing; continue }
    if (tag === 'w:tab') { out += '\t'; continue }
    if (tag === 'w:br') { out += '\n'; continue }
    if (tag === 'w:tc' && closing) { out += '\t'; continue }
    if (tag === 'w:tr' && closing) { out = `${out.replace(/\t+$/u, '')}\n`; continue }
    if (tag === 'w:p' && closing) out += '\n'
  }
  return out
}

/**
 * Extract the body text of a DOCX package.
 * @param bytes - complete DOCX bytes.
 * @returns normalized paragraph and table text.
 * @throws a DocumentError with code UNREADABLE when the package or its body is missing.
 */
export function extractDocx(bytes: Uint8Array): string {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch (error) {
    throw new DocumentError('UNREADABLE', 'The Word document could not be opened.', { cause: error })
  }
  const xmlBytes = files['word/document.xml']
  if (xmlBytes === undefined) {
    throw new DocumentError('UNREADABLE', 'The Word document has no document body.')
  }
  return normalizeText(readWordXml(new TextDecoder('utf-8').decode(xmlBytes)))
}
```

- [ ] **Step 4: Wire the format into the dispatcher**

Modify `packages/document/tool-document/src/extract/index.ts`:
- Add import after the PDF import:

```ts
import { extractDocx } from './docx.ts'
```

- Add the `.docx` case in `formatOf`:

```ts
    case '.docx': return 'docx'
```

- Add the `docx` case in `extractDocument` after the `pdf` case:

```ts
    case 'docx':
      return slice(extractDocx(bytes), request.offset ?? 0, request.limit)
```

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run packages/document/tool-document/tests/docx.spec.ts` — Expected: PASS (4 tests).

Run: `pnpm exec vitest run --coverage packages/document/tool-document` — Expected: PASS with `src/extract/docx.ts` at 100%.

- [ ] **Step 6: Commit**

```bash
git add packages/document/tool-document
git commit -m "feat(tool-document): extract DOCX paragraph and table text"
```

---

### Task 4: XLSX and XLS extraction

**Files:**
- Create: `packages/document/tool-document/src/extract/workbook.ts`
- Create: `packages/document/tool-document/tests/workbook.spec.ts`
- Modify: `packages/document/tool-document/src/extract/index.ts`

**Interfaces:**
- Consumes: `DocumentError`, `WindowRequest.row`, `WindowRequest.maxRows`.
- Produces: `extractWorkbookSheet(bytes, sheet: string | undefined, row: number, maxRows: number): { sheets: string[]; sheet: string; range: string; row: number; rows: number; totalRows: number; text: string }`.

- [ ] **Step 1: Write the failing tests**

Create `packages/document/tool-document/tests/workbook.spec.ts`:

```ts
/** document_read over generated workbooks: sheets, rows, formulas, and XLS. */

import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { compose } from './support.ts'

function workbookBytes(sheets: Record<string, (string | number | null)[][]>, bookType: 'xlsx' | 'biff8' = 'xlsx'): Uint8Array {
  const book = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name)
  }
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType }))
}

const SHEETS: Record<string, (string | number | null)[][]> = {
  Титул: [['Проект', 'Северный берег']],
  Смета: [['Позиция', 'Кол-во'], ['Кирпич', 100], ['Раствор', null], ['Смесь\nсухая', 20]],
}

describe('document_read workbooks', () => {
  it('lists sheets and reads the first sheet as TSV', async () => {
    const { attach, execute } = await compose()
    const { hostPath } = await attach('смета.xlsx', workbookBytes(SHEETS))
    const result = await execute({ path: hostPath })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('document_read failed')
    expect(result.value).toMatchObject({
      format: 'xlsx', sheets: ['Титул', 'Смета'], sheet: 'Титул', row: 0, totalRows: 1,
    })
    expect((result.value as { text: string }).text).toContain('Проект\tСеверный берег')
  })

  it('selects a sheet and a row window', async () => {
    const { attach, execute } = await compose({ maxRows: 1 })
    const { hostPath } = await attach('смета.xlsx', workbookBytes(SHEETS))
    const first = await execute({ path: hostPath, sheet: 'Смета' })
    expect(first.isError).toBe(false)
    if (first.isError) throw new Error('document_read failed')
    expect(first.value).toMatchObject({ sheet: 'Смета', row: 0, rows: 1, nextRow: 1 })
    const second = await execute({ path: hostPath, sheet: 'Смета', row: 1 })
    expect(second.isError).toBe(false)
    if (second.isError) throw new Error('document_read failed')
    expect((second.value as { text: string }).text).toContain('Кирпич')
  })

  it('renders a formula beside its value', async () => {
    const { attach, execute } = await compose()
    const book = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet([['A', 'B', 'C'], [2, 4]])
    const cell = sheet.B2 as XLSX.CellObject
    cell.f = 'A2*2'
    sheet.C2 = { t: 'z' }
    sheet['!ref'] = 'A1:C2'
    XLSX.utils.book_append_sheet(book, sheet, 'Лист')
    const { hostPath } = await attach('формула.xlsx', new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })))
    const result = await execute({ path: hostPath })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('document_read failed')
    expect((result.value as { text: string }).text).toContain('4 (=A2*2)')
  })

  it('reads an empty worksheet with the default range', async () => {
    const { attach, execute } = await compose()
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), 'Пусто')
    const { hostPath } = await attach('пусто.xlsx', new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })))
    const result = await execute({ path: hostPath })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('document_read failed')
    expect(result.value).toMatchObject({ sheet: 'Пусто', range: 'A1', row: 0, rows: 1 })
    expect((result.value as { text: string }).text).toBe('')
  })

  it('reports bytes that are not a workbook', async () => {
    const { attach, execute } = await compose()
    const { hostPath } = await attach('broken.xlsx', Uint8Array.from([1, 2, 3, 4]))
    expect((await execute({ path: hostPath })).isError).toBe(true)
  })

  it('reads a legacy XLS workbook', async () => {
    const { attach, execute } = await compose()
    const { hostPath } = await attach('старый.xls', workbookBytes(SHEETS, 'biff8'))
    const result = await execute({ path: hostPath })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('document_read failed')
    expect(result.value).toMatchObject({ format: 'xls', sheet: 'Титул' })
  })

  it('rejects an unknown worksheet', async () => {
    const { attach, execute } = await compose()
    const { hostPath } = await attach('смета.xlsx', workbookBytes(SHEETS))
    expect((await execute({ path: hostPath, sheet: 'Нет такого' })).isError).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run packages/document/tool-document/tests/workbook.spec.ts` — Expected: FAIL because `.xlsx` and `.xls` are reported as unsupported formats.

- [ ] **Step 3: Implement the workbook extractor**

Create `packages/document/tool-document/src/extract/workbook.ts`:

```ts
/** XLSX and XLS worksheet extraction through SheetJS. @module @deepseek-ai/dsh-tool-document/extract/workbook */

import * as XLSX from 'xlsx'
import { DocumentError } from '../errors.ts'

/** One worksheet window plus the workbook's sheet roster. */
export interface WorkbookWindow {
  /** Sheet names in workbook order. */
  sheets: string[]
  /** Selected sheet name. */
  sheet: string
  /** Selected sheet's used range in A1 notation. */
  range: string
  /** Zero-based first data row in this window. */
  row: number
  /** Data rows in this window. */
  rows: number
  /** Data rows in the selected sheet's used range. */
  totalRows: number
  /** Tab-separated rows. */
  text: string
}

function sanitize(value: string): string {
  return value.replace(/[\t\n\r]+/gu, ' ')
}

function cellText(cell: XLSX.CellObject | undefined): string {
  if (cell === undefined) return ''
  const raw = cell.w ?? (cell.v === undefined ? '' : String(cell.v))
  const formula = cell.f === undefined ? '' : ` (=${cell.f})`
  return `${sanitize(raw)}${sanitize(formula)}`
}

/**
 * Extract one worksheet window from a workbook.
 * @param bytes - complete workbook bytes.
 * @param requested - worksheet name; omission selects the first sheet.
 * @param row - zero-based first data row.
 * @param maxRows - maximum data rows in the window.
 * @returns the sheet roster, selected range, row window, and TSV text.
 * @throws a DocumentError with code UNREADABLE for an unreadable or empty workbook,
 *   or code INVALID_SELECTION for an unknown worksheet.
 */
export function extractWorkbookSheet(
  bytes: Uint8Array, requested: string | undefined, row: number, maxRows: number,
): WorkbookWindow {
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(bytes, { type: 'array', cellFormula: true, cellText: true, cellDates: false })
  } catch (error) {
    throw new DocumentError('UNREADABLE', 'The workbook could not be read.', { cause: error })
  }
  const sheets = workbook.SheetNames
  const sheet = requested ?? sheets[0] ?? ''
  const worksheet = workbook.Sheets[sheet]
  if (worksheet === undefined) {
    throw new DocumentError(
      'INVALID_SELECTION',
      `The workbook has no worksheet "${sheet}"; available sheets are ${sheets.map(name => JSON.stringify(name)).join(', ')}.`,
    )
  }
  const rangeRef = worksheet['!ref'] ?? 'A1'
  const range = XLSX.utils.decode_range(rangeRef)
  const totalRows = range.e.r - range.s.r + 1
  const start = Math.max(row, range.s.r)
  const end = Math.min(range.e.r, start + maxRows - 1)
  const lines: string[] = []
  for (let r = start; r <= end; r++) {
    const cells: string[] = []
    for (let c = range.s.c; c <= range.e.c; c++) {
      cells.push(cellText(worksheet[XLSX.utils.encode_cell({ r, c })]))
    }
    lines.push(cells.join('\t'))
  }
  return { sheets, sheet, range: rangeRef, row: start, rows: lines.length, totalRows, text: lines.join('\n') }
}
```

- [ ] **Step 4: Wire the formats into the dispatcher**

Modify `packages/document/tool-document/src/extract/index.ts`:
- Add import after the DOCX import:

```ts
import { extractWorkbookSheet } from './workbook.ts'
```

- Add the cases in `formatOf`:

```ts
    case '.xlsx': return 'xlsx'
    case '.xls': return 'xls'
```

- Add the workbook case in `extractDocument` after the `docx` case:

```ts
    case 'xlsx':
    case 'xls':
      return extractWorkbookSheet(bytes, request.sheet, request.row ?? 0, request.maxRows)
```

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run packages/document/tool-document/tests/workbook.spec.ts` — Expected: PASS (6 tests).

Run: `pnpm exec vitest run --coverage packages/document/tool-document` — Expected: PASS with `src/extract/workbook.ts` at 100%.

- [ ] **Step 6: Commit**

```bash
git add packages/document/tool-document
git commit -m "feat(tool-document): extract XLSX and XLS worksheet values and formulas"
```

---

### Task 5: Legacy DOC conversion through the Office kit

**Files:**
- Create: `packages/document/tool-document/src/extract/legacy-doc.ts`
- Create: `packages/document/tool-document/tests/legacy-doc.spec.ts`
- Modify: `packages/document/tool-document/src/extract/index.ts`

**Interfaces:**
- Consumes: `ctx.officeKit` (`convertTo` with `{ extension: 'doc', format: 'txt', source, output }`), `ctx.fs`, the calling `Agent`.
- Produces: `convertLegacyDoc(ctx, agent, target, maxBytes, signal): Promise<string>`.

- [ ] **Step 1: Write the failing tests**

Create `packages/document/tool-document/tests/legacy-doc.spec.ts`:

```ts
/** document_read over legacy .doc files through a stubbed Office kit. */

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { OfficeKitError } from '@deepseek-ai/dsh-office-kit'
import { describe, expect, it } from 'vitest'
import { compose } from './support.ts'

describe('document_read legacy DOC', () => {
  it('reads the converted text when the Office kit is available', async () => {
    const { ctx, root, attach, execute } = await compose()
    const output = join(root, 'converted.txt')
    await writeFile(output, 'Текст из старого документа')
    ctx.provide('officeKit', {
      outputDirectory: root,
      async convertTo(request: {
        extension: string
        format: string
        source: { read(signal: AbortSignal, maxBytes: number): Promise<{ bytes: Uint8Array; version: string }> }
      }) {
        expect(request.extension).toBe('doc')
        expect(request.format).toBe('txt')
        const read = await request.source.read(new AbortController().signal, 1024)
        expect(read.bytes.byteLength).toBeGreaterThan(0)
        return { path: output, bytes: 32, missingFonts: [] }
      },
    } as never)
    const { hostPath } = await attach('старый.doc', Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0]))
    const result = await execute({ path: hostPath })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('document_read failed')
    expect(result.value).toMatchObject({ format: 'doc', text: 'Текст из старого документа' })
  })

  it('reports an unavailable converter when no Office kit is mounted', async () => {
    const { attach, execute } = await compose()
    const { hostPath } = await attach('старый.doc', Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0]))
    expect((await execute({ path: hostPath })).isError).toBe(true)
  })

  it('reports an unavailable converter failure from the kit', async () => {
    const { ctx, attach, execute } = await compose()
    ctx.provide('officeKit', {
      async convertTo() { throw new OfficeKitError('unavailable', 'no engine') },
    } as never)
    const { hostPath } = await attach('старый.doc', Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0]))
    expect((await execute({ path: hostPath })).isError).toBe(true)
  })

  it('reports any other conversion failure', async () => {
    const { ctx, attach, execute } = await compose()
    ctx.provide('officeKit', {
      async convertTo() { throw new Error('engine crashed') },
    } as never)
    const { hostPath } = await attach('старый.doc', Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0]))
    expect((await execute({ path: hostPath })).isError).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run packages/document/tool-document/tests/legacy-doc.spec.ts` — Expected: FAIL because `.doc` is reported as an unsupported format.

- [ ] **Step 3: Implement the legacy converter**

Create `packages/document/tool-document/src/extract/legacy-doc.ts`:

```ts
/** Legacy .doc conversion through the Office kit. @module @deepseek-ai/dsh-tool-document/extract/legacy-doc */

import { basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import {
  OfficeKitError, OfficeSourceKey, type OfficeKit, type OfficeKitSource,
} from '@deepseek-ai/dsh-office-kit'
import { DocumentError } from '../errors.ts'
import { decodeText } from './text.ts'

/**
 * Attachment copies are immutable, so one buffered read is a valid source for
 * the whole conversion and needs no second version check.
 */
function sourceOf(ctx: Context, agent: Agent, target: FsTarget, bytes: Uint8Array): OfficeKitSource {
  const version = 'attached-copy'
  return {
    key: OfficeSourceKey(JSON.stringify([agent.session.id, ctx.fs.processPath(target)])),
    version,
    bytes: bytes.byteLength,
    async read(_signal, _maxBytes) {
      return { bytes, version }
    },
  }
}

/**
 * Convert a legacy .doc file to text through the mounted Office kit.
 * @param ctx - context owning the Office kit and filesystem.
 * @param agent - calling agent, used as the output owner.
 * @param target - authorized .doc target.
 * @param bytes - complete .doc bytes.
 * @param maxBytes - maximum bytes accepted from the converted text file.
 * @param signal - cancellation for conversion and reads.
 * @returns decoded converted text.
 * @throws a DocumentError with code CONVERTER_UNAVAILABLE when the kit is absent or fails,
 *   or code UNREADABLE when the output cannot be read.
 */
export async function convertLegacyDoc(
  ctx: Context, agent: Agent, target: FsTarget, bytes: Uint8Array, maxBytes: number, signal: AbortSignal,
): Promise<string> {
  const kit: OfficeKit | undefined = ctx.get('officeKit')
  if (kit === undefined) {
    throw new DocumentError(
      'CONVERTER_UNAVAILABLE',
      'Reading .doc files requires the document converter, which is not available on this deployment.',
    )
  }
  const stem = basename(target.displayPath).replace(/\.[^.]*$/u, '')
  let result
  try {
    result = await kit.convertTo({
      extension: 'doc',
      format: 'txt',
      source: sourceOf(ctx, agent, target, bytes),
      output: { owner: agent.session.id, name: `${stem}.txt` },
    }, signal)
  } catch (error) {
    if (error instanceof OfficeKitError && error.code === 'unavailable') {
      throw new DocumentError(
        'CONVERTER_UNAVAILABLE',
        'The document converter is unavailable; tell the user or retry later. Do not substitute soffice or another converter.',
        { cause: error },
      )
    }
    throw new DocumentError('UNREADABLE', 'The .doc file could not be converted.', { cause: error })
  }
  const output = await ctx.fs.resolve(result.path, { signal })
  return decodeText(await ctx.fs.readBytes(output, signal, maxBytes))
}
```
- [ ] **Step 4: Wire the format into the dispatcher and remove the compile placeholders**

Modify `packages/document/tool-document/src/extract/index.ts`:
- Add import after the workbook import:

```ts
import { convertLegacyDoc } from './legacy-doc.ts'
```

- Add the `.doc` case in `formatOf`:

```ts
    case '.doc': return 'doc'
```

- Add the `doc` case in `extractDocument` before the workbook case:

```ts
    case 'doc': {
      const text = await convertLegacyDoc(ctx, agent, target, bytes, request.maxBytes, signal)
      return slice(normalizeText(text), request.offset ?? 0, request.limit)
    }
```

- Add `normalizeText` to the imports from `./normalize.ts`:

```ts
import { normalizeText } from './normalize.ts'
```

- Remove the four placeholder lines `void ctx`, `void agent`, `void target`, `void signal`.
- Remove the `default:` branch from `extractDocument`: the switch now covers every `DocumentFormat` member, so the fallback is unreachable.

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run packages/document/tool-document/tests/legacy-doc.spec.ts` — Expected: PASS (2 tests).

Run: `pnpm exec vitest run --coverage packages/document/tool-document` — Expected: PASS with every `src` file at 100%.

- [ ] **Step 6: Commit**

```bash
git add packages/document/tool-document
git commit -m "feat(tool-document): convert legacy DOC files through the Office kit"
```

---

### Task 6: Mount the tool on the NW client site

**Files:**
- Modify: `packages/bundle/web-app/client-north-waterfront.patch.yml`
- Modify: `packages/bundle/web-app/package.json`
- Modify: `scripts/product-package-policy.ts`

**Interfaces:**
- Consumes: `@deepseek-ai/dsh-tool-document`, `ui-attachment`, the existing `preset-standard` and `agent-preset-custom` rows.
- Produces: a client site where attachments are uploaded and `document_read` is available to standard and custom agents.

- [ ] **Step 1: Re-enable chat attachments**

In `packages/bundle/web-app/client-north-waterfront.patch.yml`, replace the block:

```yaml
# Chat attachments are dead weight without fs tools, and drawing uploads go
# through the Чертежи window; `ui-file-drag` stays enabled because the
# document-preview panel waits on its service.
- id: ui-attachment
  disabled: true
```

with:

```yaml
# Chat attachments carry uploaded documents to document_read: the tool
# authorizes the saved path against this Session's file attachments and
# extracts the text itself, so the rail, drop target, and file cards stay
# available. `ui-file-drag` stays enabled for the document-preview panel.
```

- [ ] **Step 2: Mount the tool in the standard preset**

In the `preset-standard` plugin list, immediately after the `tool-todo` row, add:

```yaml
      # Uploaded documents: PDF, Word, and spreadsheet text extraction with
      # no shell, filesystem, or Office-skill access.
      - id: tool-document
        name: '@deepseek-ai/dsh-tool-document'
```

- [ ] **Step 3: Offer the tool to custom agents**

In `agent-preset-custom.allowedTools`, immediately after the `todo` entry, add:

```yaml
          documents:
            name: '@deepseek-ai/dsh-tool-document'
            label: Документы
            description: Чтение загруженных PDF, DOCX, DOC, XLSX, XLS, TXT и CSV — агент извлекает текст и отвечает по содержимому. Отметьте, чтобы инструмент был доступен.
```

- [ ] **Step 4: Update the overlay header**

Replace the sentence in the top comment:

```yaml
# and narrows the agent's tool set to the drawing5 tools. The model picker
```

with:

```yaml
# and narrows the agent's tool set to drawing5, smeta, and uploaded-document
# text extraction. The model picker
```

- [ ] **Step 5: Add the bundle dependency**

In `packages/bundle/web-app/package.json`, add this entry to `dependencies` in alphabetical order:

```json
    "@deepseek-ai/dsh-tool-document": "workspace:*",
```

- [ ] **Step 6: Classify the optional package**

In `scripts/product-package-policy.ts`, add this entry to `PRODUCT_PACKAGE_POLICY` in directory order:

```ts
  'packages/document/tool-document': {
    category: 'optional',
    reason: 'Document text extraction mounted only by the client deployment overlay.',
  },
```

- [ ] **Step 7: Link and verify the composition**

Run: `pnpm install` — Expected: the lockfile links the new dependency.

Run: `pnpm run verify-cordis-config` — Expected: PASS, with `@deepseek-ai/dsh-tool-document` resolvable from the web bundle manifest.

- [ ] **Step 8: Commit**

```bash
git add packages/bundle/web-app/client-north-waterfront.patch.yml packages/bundle/web-app/package.json scripts/product-package-policy.ts pnpm-lock.yaml
git commit -m "feat(north-waterfront): accept document attachments and mount document_read"
```

---

### Task 7: Documentation, catalogs, checks, and production deployment

**Files:**
- Create: `packages/document/tool-document/README.md`
- Create: `packages/document/tool-document/README.zh.md`
- Create: `packages/document/tool-document/README.i18n.yaml` (written by the pairing command)
- Modify: `packages/document/README.md`
- Modify: `packages/document/README.zh.md`
- Modify: `packages/document/README.i18n.yaml` (written by the pairing command)
- Modify: generated catalogs reported by the generators

**Interfaces:**
- Consumes: the completed package and overlay.
- Produces: documented, catalogued, verified, deployed feature.

- [ ] **Step 1: Write the package README**

Create `packages/document/tool-document/README.md`:

```markdown
---
description: "Read text from uploaded PDF, Word, spreadsheet, and plain-text documents with the document_read tool, without shell or filesystem tools."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-document

English | [中文](README.zh.md)

## Summary

Use `document_read` to extract the text of a document the user attached to the conversation and return one bounded window. The tool supports PDF, DOCX, DOC, XLSX, XLS, TXT, and CSV files saved by the attachment store, so a restricted deployment can answer document questions without shell, filesystem, or Office skills. PDF text comes from the page's text layer; a scan without one reports that no text exists.

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

Mount the plugin in an agent preset beside the base attachment store and filesystem:

```yaml
- name: '@deepseek-ai/dsh-tool-document'
  config:
    maxInputBytes: 52428800
    maxChars: 20000
    maxRows: 500
    timeoutMs: 30000
```

The model passes the absolute path from the attachment handle line in the user message. The tool resolves that path and accepts it only when it equals the stored path of a generic-file attachment of the calling Session; every other path fails with `NOT_AN_ATTACHMENT`. `page` selects one PDF page, `sheet` and `row` select a worksheet window, and `offset` and `limit` select a character window in text documents. The result carries the document metadata, the text window, and a continuation hint (`nextPage`, `nextOffset`, or `nextRow`).

`maxInputBytes` bounds the source and any converted legacy output, `maxChars` bounds one text window, `maxRows` bounds one worksheet window, and `timeoutMs` bounds the complete call. Values validate at load; every default is a deployment-configurable field.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`src/index.ts` registers `document_read` through `defineTool`. The execute path authorizes the requested path in `src/paths.ts`, rejects files above `maxInputBytes`, reads the stored bytes through `ctx.fs`, and dispatches by extension in `src/extract/index.ts`.

The extractors are independent modules: `pdf.ts` uses the pdfjs legacy ESM build and reads one page's text layer; `docx.ts` unzips `word/document.xml` with fflate and reconstructs paragraphs, tabs, breaks, and table cells; `workbook.ts` uses SheetJS for XLSX and XLS and serializes one used-range window as TSV; `text.ts` decodes UTF-8 with a windows-1251 fallback; `legacy-doc.ts` converts `.doc` to text through `ctx.officeKit` and reads the converted file. `render.ts` writes the model-facing envelope and continuation hint.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Attachment store](../../../packages/attachment/attachment/README.md) — durable uploads and their read-only host paths.
- [Office kit](../../../packages/document/office-kit/README.md) — the LibreOffice-backed converter used for `.doc`.
- [Client deployment overlay](../../../packages/bundle/web-app/README.md) — the composition that mounts this tool on the client site.

-----

<a id="model-experience"></a>
## Model Experience

### document_read

#### What the model sees

The user message carries one handle line per attachment with the saved read-only path. The tool result opens with `Document "<name>" (<format>, <bytes> bytes)`, the selected page, sheet, or character count, then the text window and one continuation hint. Failures name the file and the corrective action: resave in a supported format, request a text version of a scan, or retry later when the converter is unavailable.

#### Token effect

Each call appends one tool result bounded by `maxChars` or `maxRows`.

#### KV Cache effect

The tool declaration is fixed for the session; results append to the conversation.
```

- [ ] **Step 2: Write the Chinese README**

Create `packages/document/tool-document/README.zh.md`:

```markdown
---
description: "通过 document_read 工具读取用户上传的 PDF、Word、电子表格和纯文本文档，无需 shell 或文件系统工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-document

[English](README.md) | 中文

## 概述

使用 `document_read` 提取用户附加到对话的文档文本，并返回一个有界窗口。工具支持附件存储保存的 PDF、DOCX、DOC、XLSX、XLS、TXT 和 CSV 文件，因此受限部署无需 shell、文件系统或 Office 技能即可回答文档问题。PDF 文本来自页面文本层；没有文本层的扫描件会明确报告无文本。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在代理预设中，将插件挂载到基础附件存储和文件系统旁边：

```yaml
- name: '@deepseek-ai/dsh-tool-document'
  config:
    maxInputBytes: 52428800
    maxChars: 20000
    maxRows: 500
    timeoutMs: 30000
```

模型传入用户消息中附件句柄行给出的绝对路径。工具解析该路径，仅当它与当前会话通用文件附件的存储路径一致时接受；其他路径以 `NOT_AN_ATTACHMENT` 失败。`page` 选择一页 PDF，`sheet` 和 `row` 选择工作表窗口，`offset` 和 `limit` 选择文本文档的字符窗口。结果包含文档元数据、文本窗口和继续提示（`nextPage`、`nextOffset` 或 `nextRow`）。

`maxInputBytes` 限制源文件和转换后的旧格式输出，`maxChars` 限制一个文本窗口，`maxRows` 限制一个工作表窗口，`timeoutMs` 限制整个调用。所有值在加载时校验，默认值均为部署可配置字段。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

`src/index.ts` 通过 `defineTool` 注册 `document_read`。执行路径在 `src/paths.ts` 中授权请求路径，拒绝超过 `maxInputBytes` 的文件，通过 `ctx.fs` 读取存储的字节，并在 `src/extract/index.ts` 中按扩展名分派。

各提取器是独立模块：`pdf.ts` 使用 pdfjs 旧版 ESM 构建读取一页的文本层；`docx.ts` 用 fflate 解压 `word/document.xml` 并重建段落、制表符、换行和表格单元格；`workbook.ts` 使用 SheetJS 读取 XLSX 和 XLS，并将一个已用范围窗口序列化为 TSV；`text.ts` 以 windows-1251 作为 UTF-8 失败的备选；`legacy-doc.ts` 通过 `ctx.officeKit` 将 `.doc` 转换为文本并读取转换结果。`render.ts` 生成面向模型的信封和继续提示。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [附件存储](../../../packages/attachment/attachment/README.md) — 持久上传及其只读主机路径。
- [Office kit](../../../packages/document/office-kit/README.md) — 用于 `.doc` 的 LibreOffice 转换器。
- [客户端部署覆盖层](../../../packages/bundle/web-app/README.md) — 在客户端站点挂载此工具的组装。

-----

<a id="model-experience"></a>
## 模型体验

### document_read

#### 模型看到什么

用户消息为每个附件携带一行句柄，给出保存的只读路径。工具结果以 `Document "<name>" (<format>, <bytes> bytes)` 开头，随后是所选页面、工作表或字符数，然后是文本窗口和一个继续提示。失败信息会指出文件和建议动作：另存为受支持格式、请求扫描件的文本版本，或在转换器不可用时稍后重试。

#### Token 影响

每次调用追加一个工具结果，受 `maxChars` 或 `maxRows` 限制。

#### KV Cache 影响

工具声明在会话内固定；结果追加到对话。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **无 OCR** — 没有文本层的 PDF 页面会报告无文本，不执行识别。
- **DOCX 文本范围** — 不提取页眉、页脚、脚注、批注和文本框。
- **`.doc` 依赖 Office kit** — 未挂载 `office-kit` 的部署会收到 `CONVERTER_UNAVAILABLE`。
- **主机进程解析** — 非受信文档在主机进程中由解析库处理，受输入大小和截止时间限制。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

无。

</details>
```

- [ ] **Step 3: Record the README translation pairing**

Run: `pnpm run verify-translation-pairing --write packages/document/tool-document/README.md` — Expected: `README.i18n.yaml` is created or updated; exit 0.

- [ ] **Step 4: Add the package to the group README**

In `packages/document/README.md`, add this row to the package table after the `tool-office` row:

```markdown
| [tool-document](tool-document/README.md) | `document_read` extracts text from an uploaded PDF, Word, spreadsheet, or plain-text document, one page or worksheet window at a time | — |
```

In the "Working with documents" list, add this bullet after the Office-document bullet:

```markdown
- **An uploaded document:** `document_read` reads a PDF, Word, spreadsheet, or plain-text attachment through the attachment store and returns text windows, so a deployment without shell or filesystem tools can answer questions about a client's files. Legacy `.doc` needs the Office kit; scanned PDFs report that no text layer exists.
```

Mirror both changes in `packages/document/README.zh.md`:

```markdown
| [tool-document](tool-document/README.md) | `document_read` 从上传的 PDF、Word、电子表格或纯文本文档中逐页或逐工作表窗口提取文本 | — |
```

```markdown
- **已上传的文档：**`document_read` 通过附件存储读取 PDF、Word、电子表格或纯文本附件并返回文本窗口，因此没有 shell 或文件系统工具的部署也能回答客户文件的问题。旧格式 `.doc` 需要 Office kit；扫描版 PDF 会报告没有文本层。
```

Run: `pnpm run verify-translation-pairing --write packages/document/README.md` — Expected: `packages/document/README.i18n.yaml` updates; exit 0.

- [ ] **Step 5: Regenerate the catalogs**

Run, in order:

```bash
pnpm run gen-tool-catalog
pnpm run gen-config-catalog
pnpm run gen-cordis-catalog
pnpm run gen-dependency-catalog
```

Expected: `docs/tool-catalog.md` and its Chinese pair gain `document_read`; `docs/config-catalog.md` gains the four fields; composition and dependency catalogs report the new package where their generators include it. Review every diff before staging.

- [ ] **Step 6: Run the focused and repository checks**

Run:

```bash
pnpm exec vitest run packages/document/tool-document
pnpm exec vitest run --coverage packages/document/tool-document
pnpm run typecheck
pnpm run build:artifacts
pnpm run build:check
pnpm run verify-cordis-config
pnpm run verify-tool-catalog
pnpm run verify-config-catalog
pnpm run verify-dependency-catalog
pnpm run doc-sync
```

Expected: all PASS. Fix findings before committing; do not bypass a gate.

- [ ] **Step 7: Commit the documentation and catalogs**

```bash
git add packages/document/tool-document/README.md packages/document/tool-document/README.zh.md packages/document/tool-document/README.i18n.yaml
git add packages/document/README.md packages/document/README.zh.md packages/document/README.i18n.yaml
git add docs/tool-catalog.md docs/tool-catalog.zh.md docs/tool-catalog.i18n.yaml
git add docs/config-catalog.md docs/config-catalog.zh.md docs/config-catalog.i18n.yaml
git add docs/dependency-catalog.json
git status --porcelain
git commit -m "docs(tool-document): document uploaded-document extraction and regenerate catalogs"
```

Stage every generated file the catalog commands actually changed and omit paths with no diff; `git status --porcelain` is the authority after the generators run.

- [ ] **Step 8: Deploy to the NW production site**

Run: `pnpm install` — Expected: the new workspace package is linked.

Run: `restart-north-waterfront.cmd` — Expected: the old server on :3081 and its tunnel connector stop; a fresh server starts, and the tunnel window is reused.

- [ ] **Step 9: Smoke-test the production site**

1. Open `http://127.0.0.1:3081/`, enter the client password from `.env.north-waterfront`.
2. Click `+` → `Файл`, attach a small TXT, PDF, DOCX, and XLSX.
3. Ask “Что написано в приложенном документе?” for each; the answer must quote the extracted text.
4. Attach a scanned PDF; the answer must say the page has no text layer, not invent content.
5. Ask the agent to run a shell command or list a directory; no such tool may exist.
6. Confirm the standard preset and a custom agent with the «Документы» checkbox both answer document questions.

Expected: all six checks pass. If any fails, stop the server, fix, and repeat from Step 6.

- [ ] **Step 10: Commit any deployment-only fix**

If the smoke test required a source change, commit it with a focused message and re-run the checks from Step 6 before restarting the site.

---

## Self-Review

- **Spec coverage:** attachment intake (Task 6), path authorization (Task 1), TXT/CSV (Task 1), PDF with scan behavior (Task 2), DOCX (Task 3), XLSX/XLS (Task 4), DOC through office-kit (Task 5), limits and errors (Task 1, extended by each extractor), custom-agent checkbox (Task 6), docs/catalogs/tests/deploy (Task 7).
- **Placeholder scan:** every code step carries the exact code; commands name exact files and expected outcomes; no deferred “add error handling” steps.
- **Type consistency:** `DocumentWindow` fields match `DocumentReadValue` and `renderDocument`; `WindowRequest` fields match `requestOf`, the dispatcher, and every extractor; `DocumentError` codes match the spec.
