# NW Project Folders Implementation Plan

English | [中文](2026-11-18-nw-project-folders.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** клиентский пользователь NW-сайта создаёт именованные проекты (папки под `%USERPROFILE%\north-waterfront`) кнопкой «Новый проект» в панели проектов; сессии работают в них; spill уходит из `%TEMP%` в `DSH_HOME\spill`; персона не показывает temp-пути.

**Architecture:** глагол `createProject({name})` на существующем Remote-неймспейсе `workspace` (`WorkspaceController`), конфиг `projectBase` (взаимоисключим с `documentsDirectory`); капабилити-сигнал — поле `projectBase: string | null` в baseline follow-фида → клиентский `WorkspaceSnapshot` → гейтинг кнопки в `WorkspaceBrowser` через существующий хук `useWorkspaces`. Спека: `docs/superpowers/specs/2026-11-18-nw-project-folders-design.md`.

**Tech Stack:** TypeScript ESM (cordis, schemastery, zod, typert Remote), React 18 (client slots), vitest (jsdom + @testing-library/react), pnpm workspaces.

## Global Constraints

- Репозиторий: `C:\Users\Lenovo\Desktop\проект SOFT_2\Models FIN\Harness`. Коммиты в стиле репо: `feat(api): …`, `feat(client): …`, `chore(bundle): …`.
- ESM: локальные импорты с расширением `.ts`; никаких `as unknown`/`<unknown>`; файлы заканчиваются ровно одним `\n` (pre-commit `git diff --cached --check`).
- Коды ошибок на проводе (закрытое семейство): `workspace/project-unavailable`, `workspace/project-name-invalid`, `workspace/project-exists`, `workspace/project-create-failed`.
- `projectBase` и `documentsDirectory` взаимоисключимы: оба заданы → исключение на загрузке плагина.
- Имя проекта: 1–64 символа после проверок; Unicode разрешён; запрещены `/ \ < > : " | ? *`, управляющие, `.`/`..`, точка/пробел на краях, зарезервированные имена Windows (CON, PRN, AUX, NUL, COM1–9, LPT1–9, без учёта регистра).
- Клиентский копирайт — только через словарь `workspace` в `packages/client/ui-workspace/src/client/locales.ts`, все 8 локалей (zh — источник ключей; en, ja, es, fr, de, ru, pt — `satisfies`); английский в sentence case. Гейт: `pnpm run verify-client-ui-i18n`.
- После добавления Remote-глагола регенерируйте typert-артефакты: `pnpm run generate-typert` (или `npx tsx scripts/generate-typert.ts` из корня) — до запуска typecheck/тестов, импортирующих `@deepseek-ai/dsh-api-workspace-controller/remote`.
- Точечные прогоны: `pnpm vitest run packages/api/workspace-controller` и `pnpm vitest run packages/client/ui-workspace` из корня. Полный suite и coverage — CI.
- Known issue окружения: lefthook pre-commit может падать с msys `NtCreateDirectoryObject` (access denied). Если упал не из-за вашего файла — прогоните `git diff --cached --check` вручную и коммитьте `git commit --no-verify` (см. AGENTS.md «Host sandbox failures»).
- SDK (`SessionEventMap`, agent-loop) не меняются. Снапшоты: NW-оверлей/персона keyless-сьютом не покрываются (проверено grep'ом `snapshots/`) — новый снапшот не нужен.

---

### Task 1: Host Config — `projectBase`, взаимоисключение, `initializeDefault`

**Files:**
- Modify: `packages/api/workspace-controller/src/index.ts:37-45` (Config), `:71-83` (конструктор), `:103-112` (initializeDefault)
- Modify: `packages/api/workspace-controller/src/default-directory.ts:15-28` (обобщение валидатора)
- Test: `packages/api/workspace-controller/tests/workspace-controller.host.spec.ts`

**Interfaces:**
- Produces: `Config.projectBase?: string` (validated, exclusive with `documentsDirectory`); `defaultWorkspaceDirectory` ветка не меняется; Task 2/3 читают `this.config.projectBase`.

- [x] **Step 1: Написать падающие тесты**

В `workspace-controller.host.spec.ts` (харнесс `harness()` уже создаёт реальный cordis `Context` + `WorkspaceRegistry` + memory storage; каталог — `mkdtempSync(join(tmpdir(), 'dsh-workspace-controller-'))`; см. строки 54-76) добавьте общий хелпер и describe-блок (хелпер переиспользуют тесты Task 2):

```text
/** Полный стек реестра под контроллером с явным конфигом first-use политики. */
async function projectHarness(config: { projectBase?: string; documentsDirectory?: string }) {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const storageDomain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', storageDomain)
  ctx.provide('storageDomain', storageDomain)
  ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)
  await ctx.plugin(WorkspaceRegistry)
  ctx.provide('typert', {
    lookups: { configure: () => () => {} },
    contexts: { configureHost: () => () => {} },
    resources: { register: () => () => {} },
  } as never)
  new RemoteAccessService(ctx)
  return { controller: new WorkspaceController(ctx, config), ctx }
}

/** Код ошибки отклонённого вызова (RemoteError.code как строка). */
async function rejectionCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error: unknown) {
    return String((error as { code?: string }).code)
  }
  throw new Error('expected a rejection')
}
```

```text
describe('projectBase configuration', () => {
  it('rejects documentsDirectory and projectBase together', async () => {
    const ctx = new Context()
    roots.push(ctx)
    await expect(new WorkspaceController(ctx, { documentsDirectory: 'C:\\doc', projectBase: 'C:\\projects' }))
      .rejects.toThrow(/projectBase and documentsDirectory are mutually exclusive/)
  })

  it('rejects a relative projectBase', async () => {
    const ctx = new Context()
    roots.push(ctx)
    await expect(new WorkspaceController(ctx, { projectBase: 'projects' }))
      .rejects.toThrow(/Project base directory must be fully qualified/)
  })

  it('anchors first-use default Workspace under projectBase', async () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-workspace-controller-')))
    tempDirs.push(root)
    const { controller } = await projectHarness({ projectBase: root })
    const value = await controller.initializeDefault(new AbortController().signal)
    expect(value?.workspace.path).toBe(join(root, DEFAULT_WORKSPACE_DIRECTORY))
  })
})
```

(`roots`, `tempDirs` — уже существующие массивы харнесса, см. строки 33-41; DEFAULT_WORKSPACE_DIRECTORY уже импортирован в спеке.)

- [x] **Step 2: Прогнать и убедиться в падении**

Run: `pnpm vitest run packages/api/workspace-controller` Expected: FAIL — свойств `projectBase` нет (TS-ошибка схемастри / нет ветки в initializeDefault).

- [x] **Step 3: Реализовать**

`src/default-directory.ts` — обобщить валидатор (сообщение для documentsDirectory не меняется):

```text
/**
 * Validate a configured directory path without resolving it against cwd.
 * @param directory - fully qualified directory spelling.
 * @param platform - Host platform.
 * @param label - error-message subject naming the config field.
 * @returns the normalized directory.
 */
export function validateFullyQualifiedDirectory(
  directory: string, platform: NodeJS.Platform = process.platform, label = 'Documents directory',
): string {
  const paths = platform === 'win32' ? win32 : posix
  const root = paths.parse(directory).root
  if (!paths.isAbsolute(directory) || (platform === 'win32' && (root === '\\' || root === '/'))) {
    throw new Error(`${label} must be fully qualified: '${directory}'`)
  }
  return paths.normalize(directory)
}

/** Validate the configured Documents directory. */
export function validateDocumentsDirectory(directory: string, platform: NodeJS.Platform = process.platform): string {
  return validateFullyQualifiedDirectory(directory, platform)
}
```

(старый вызов `validateDocumentsDirectory` в `index.ts:75` остаётся; его тесты в `default-directory.host.spec.ts` не меняются.)

`src/index.ts` — Config и конструктор:

```ts
export interface Config {
  /** Override the system Documents directory with a fully qualified path. */
  documentsDirectory?: string
  /**
   * Base directory for confined project creation: `createProject` makes one
   * named child directory per call, and first-use default Workspace anchoring
   * uses `<projectBase>/default-workspace`. Mutually exclusive with
   * `documentsDirectory`.
   */
  projectBase?: string
  /** Maximum duration of the operating system's Documents lookup. */
  documentsLookupTimeoutMs?: number
}
```

В конструкторе после `this.config = WorkspaceController.Config(config)`:

```text
    if (this.config.documentsDirectory !== undefined && this.config.projectBase !== undefined) {
      throw new Error('projectBase and documentsDirectory are mutually exclusive; configure one first-use policy')
    }
    if (this.config.projectBase !== undefined) {
      this.config = { ...this.config, projectBase: validateFullyQualifiedDirectory(this.config.projectBase, process.platform, 'Project base directory') }
    }
```

и ветка в `initializeDefault` (замените тело колбэка `initializeDefault`):

```text
  @Remote('initializeDefault')
  async initializeDefault(signal: AbortSignal): Promise<WorkspaceValue | undefined> {
    const workspace = await this.ctx.workspaceRegistry.initializeDefault(async () => {
      if (this.config.projectBase !== undefined) {
        return join(this.config.projectBase, DEFAULT_WORKSPACE_DIRECTORY)
      }
      const timeout = AbortSignal.timeout(this.config.documentsLookupTimeoutMs)
      return await defaultWorkspaceDirectory(
        this.config.documentsDirectory, AbortSignal.any([signal, timeout]),
      )
    })
    return workspace === undefined ? undefined : { workspace: workspaceView(workspace) }
  }
```

Добавьте импорты в `src/index.ts`: `import { join } from 'node:path'` и `validateFullyQualifiedDirectory` к существующему импорту из `./default-directory.ts`; `DEFAULT_WORKSPACE_DIRECTORY` из `./default-workspace.ts`.

- [x] **Step 4: Прогнать тесты**

Run: `pnpm vitest run packages/api/workspace-controller` Expected: PASS (все, включая старые).

- [x] **Step 5: Коммит**

```bash
git add packages/api/workspace-controller/src packages/api/workspace-controller/tests
git commit -m "feat(api): projectBase config with exclusive documentsDirectory policy"
```

---

### Task 2: Глагол `createProject` — валидация имени, каталог, регистрация

**Files:**
- Create: `packages/api/workspace-controller/src/project-name.ts`
- Modify: `packages/api/workspace-controller/src/types.ts` (request + коды ошибок)
- Modify: `packages/api/workspace-controller/src/commands.ts` (конструктор + метод)
- Modify: `packages/api/workspace-controller/src/index.ts` (verb + проброс projectBase)
- Test: `packages/api/workspace-controller/tests/workspace-controller.host.spec.ts`, новый `tests/project-name.host.spec.ts`

**Interfaces:**
- Consumes: `Config.projectBase` (Task 1), `WorkspaceCommands.create({ path })` (существующий, идемпотентен по каноническому пути).
- Produces: `WorkspaceProjectCreateRequest { name: string }`; verb `controller.createProject(request): Promise<WorkspaceCreateValue>`; `isValidProjectName(name): boolean`; коды `workspace/project-*`. Task 4 кладёт тот же глагол в клиентскую модель.

- [x] **Step 1: Тесты валидации имени (новый файл)**

`tests/project-name.host.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { isValidProjectName } from '../src/project-name.ts'

describe('isValidProjectName', () => {
  it.each([
    ['Жилой дом 12', true],
    ['Kotelnaya-2', true],
    ['a', true],
    ['x'.repeat(64), true],
    ['', false],
    ['x'.repeat(65), false],
    [' padded', false],
    ['padded ', false],
    ['dot.', false],
    ['.dot', false],
    ['.', false],
    ['..', false],
    ['a/b', false],
    ['a\\b', false],
    ['a<b', false], ['a>b', false], ['a:b', false], ['a"b', false],
    ['a|b', false], ['a?b', false], ['a*b', false],
    ['co\nn', false],
    ['CON', false], ['con', false], ['Prn', false], ['AuX', false],
    ['NUL', false], ['COM1', false], ['com9', false], ['LPT1', false],
    ['CONSOLE', true],
  ])('%s -> %s', (name, expected) => {
    expect(isValidProjectName(name)).toBe(expected)
  })
})
```

- [x] **Step 2: Прогнать — модуль отсутствует**

Run: `pnpm vitest run packages/api/workspace-controller/tests/project-name.host.spec.ts` Expected: FAIL (нет `../src/project-name.ts`).

- [x] **Step 3: Реализовать `src/project-name.ts`**

```ts
/** Project-name validation for the confined project factory. */

/** Characters a Windows directory segment must never carry, plus C0/C1 controls. */
const INVALID_SEGMENT = /[/\\<>*?:"|\u0000-\u001f\u007f-\u009f]/

/** Device names Windows reserves in every spelling. */
const RESERVED_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Edge dots and spaces Windows silently strips from a directory segment. */
const STRIPPED_EDGE = /^[.\s]|[.\s]$/

/**
 * Whether `name` is one safe directory segment under the project base.
 * @param name - user-supplied project name.
 * @returns whether the name can become exactly one directory segment.
 */
export function isValidProjectName(name: string): boolean {
  if (name.length < 1 || name.length > 64) return false
  if (name === '.' || name === '..') return false
  if (STRIPPED_EDGE.test(name)) return false
  if (INVALID_SEGMENT.test(name)) return false
  if (RESERVED_DEVICE.test(name)) return false
  return true
}
```

- [x] **Step 4: Тесты глагола (в host.spec.ts; `projectHarness`/`rejectionCode` — из Task 1)**

```text
describe('createProject', () => {
  it('creates a project directory and Workspace under projectBase', async () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-workspace-controller-')))
    tempDirs.push(root)
    const { controller } = await projectHarness({ projectBase: root })
    const value = await controller.createProject({ name: 'Жилой дом 12' })
    expect(value.created).toBe(true)
    expect(value.workspace.title).toBe('Жилой дом 12')
    expect(existsSync(join(root, 'Жилой дом 12'))).toBe(true)
  })

  it('refuses a duplicate project directory with project-exists', async () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-workspace-controller-')))
    tempDirs.push(root)
    const { controller } = await projectHarness({ projectBase: root })
    await controller.createProject({ name: 'alpha' })
    expect(await rejectionCode(controller.createProject({ name: 'alpha' }))).toBe('workspace/project-exists')
  })

  it.each([['a/b'], ['CON'], [''], ['x'.repeat(65)]])('refuses invalid name %s', async (name) => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-workspace-controller-')))
    tempDirs.push(root)
    const { controller } = await projectHarness({ projectBase: root })
    expect(await rejectionCode(controller.createProject({ name }))).toBe('workspace/project-name-invalid')
  })

  it('refuses createProject without projectBase', async () => {
    const { controller } = await projectHarness({})
    expect(await rejectionCode(controller.createProject({ name: 'alpha' }))).toBe('workspace/project-unavailable')
  })

  it('reports create-failed when the base is a file', async () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-workspace-controller-')))
    tempDirs.push(root)
    const blocker = join(root, 'blocker.txt')
    writeFileSync(blocker, '')
    const { controller } = await projectHarness({ projectBase: blocker })
    expect(await rejectionCode(controller.createProject({ name: 'alpha' }))).toBe('workspace/project-create-failed')
  })
})
```

(подключите `writeFileSync` к импорту `node:fs` в шапке файла.)

- [x] **Step 5: Прогнать — падают (метода нет)**

Run: `pnpm vitest run packages/api/workspace-controller` Expected: FAIL — `controller.createProject is not a function`.

- [x] **Step 6: Реализовать**

`src/types.ts` — рядом с `WorkspaceCreateRequest` (строки 64-73):

```ts
/** Confined project creation: one directory name under the configured project base. */
export interface WorkspaceProjectCreateRequest {
  readonly name: string
}
```

и в существующий `declare module '@deepseek-ai/dsh-typert-protocol'`-блок с `RemoteErrorDetailsMap` (строки 32-62; зеркально соседним записям):

```text
    'workspace/project-unavailable': Record<string, never>
    'workspace/project-name-invalid': { readonly name: string }
    'workspace/project-exists': { readonly path: string }
    'workspace/project-create-failed': { readonly path: string }
```

`src/commands.ts` — конструктор принимает базу (найдите `constructor(private readonly ctx: Context)` и замените):

```text
  /**
   * @param ctx - Host context carrying the Workspace registry.
   * @param projectBase - configured project base directory; undefined disables
   *   confined project creation.
   */
  constructor(private readonly ctx: Context, private readonly projectBase: string | undefined) {}
```

и метод рядом с `create` (строки 40-64):

```text
  /**
   * Create one project Workspace: a named child directory under the configured
   * project base, then ordinary adoption of that directory.
   * @param request - user-supplied project name.
   * @returns the Workspace and whether this call created it.
   */
  createProject(request: WorkspaceProjectCreateRequest): Promise<WorkspaceCreateValue> {
    return this.enqueue(async () => {
      if (this.projectBase === undefined) {
        throw new RemoteError('workspace/project-unavailable', 'project creation is not configured; set projectBase', {})
      }
      if (!isValidProjectName(request.name)) {
        throw new RemoteError('workspace/project-name-invalid', `"${request.name}" is not a usable project directory name`, { name: request.name })
      }
      const path = join(this.projectBase, request.name)
      try {
        if (existsSync(path)) {
          throw new RemoteError('workspace/project-exists', `project directory "${path}" already exists`, { path })
        }
        await mkdir(path, { recursive: true })
      } catch (error: unknown) {
        if (remoteErrorOf(error) !== undefined) throw error
        throw new RemoteError('workspace/project-create-failed', `cannot create project directory "${path}": ${errorMessage(error)}`, { path }, { cause: error })
      }
      return await this.create({ path })
    })
  }
```

Импорты в `commands.ts`: `import { existsSync } from 'node:fs'`, `import { mkdir } from 'node:fs/promises'`, `import { join } from 'node:path'`, `import { isValidProjectName } from './project-name.ts'`, `import type { WorkspaceProjectCreateRequest } from './types.ts'` (тип добавьте к существующему импорту типов).

`src/index.ts` — проброс и verb (в конструкторе `new WorkspaceCommands(ctx)` → `new WorkspaceCommands(ctx, this.config.projectBase)`; рядом с `@Remote('create')`-методом):

```text
  /**
   * Create one project Workspace under the configured project base.
   * @param request - user-supplied project name.
   * @returns the Workspace and whether this call created it.
   */
  @Remote('createProject')
  createProject(request: WorkspaceProjectCreateRequest): Promise<WorkspaceCreateValue> {
    return this.commands.createProject(request)
  }
```

- [x] **Step 7: Прогнать тесты + регенерировать typert**

```bash
pnpm run generate-typert
pnpm vitest run packages/api/workspace-controller
```

Expected: PASS (все). Регенерация обновляет `lib/typert.*` артефакты пакета — НЕ коммитьте их (генерятся билдом).

- [x] **Step 8: Коммит**

```bash
git add packages/api/workspace-controller/src packages/api/workspace-controller/tests
git commit -m "feat(api): workspace createProject verb with confined name validation"
```

---

### Task 3: Поле `projectBase` в follow-фиде

**Files:**
- Modify: `packages/api/workspace-controller/src/types.ts:152-158` (WorkspaceBaseline)
- Modify: `packages/api/workspace-controller/src/feed.ts:49-81` (конструктор + baseline)
- Modify: `packages/api/workspace-controller/src/index.ts:214-223` (filtered) и `:77` (прокинуть в feed)
- Test: `packages/api/workspace-controller/tests/workspace-controller.host.spec.ts` (follow-тесты, ~строка 451)

**Interfaces:**
- Consumes: `Config.projectBase` (Task 1).
- Produces: `WorkspaceBaseline.projectBase: string | null` — Task 4 кладёт его в `WorkspaceSnapshot`.

- [x] **Step 1: Падающий тест**

В существующий describe follow-тестов добавьте (стиль — по соседним follow-тестам, использующим `WorkspaceFeed`/`controller.follow`):

```text
  it('carries projectBase in the follow baseline', async () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-workspace-controller-')))
    tempDirs.push(root)
    const { controller } = await projectHarness({ projectBase: root })
    const stream = controller.follow(new AbortController().signal)
    const first = await stream.next()
    expect(first.value).toMatchObject({ type: 'baseline', value: { projectBase: root } })
    await stream.return?.(undefined)
  })

  it('carries null projectBase without the config', async () => {
    const { controller } = await projectHarness({})
    const stream = controller.follow(new AbortController().signal)
    const first = await stream.next()
    expect(first.value).toMatchObject({ type: 'baseline', value: { projectBase: null } })
    await stream.return?.(undefined)
  })
```

- [x] **Step 2: Прогнать — FAIL (поля нет)**

Run: `pnpm vitest run packages/api/workspace-controller`

- [x] **Step 3: Реализовать**

`types.ts` (WorkspaceBaseline):

```text
/** Complete reconnect baseline for Workspace browser state. */
export interface WorkspaceBaseline {
  readonly items: readonly WorkspaceView[]
  readonly archivedSessionIds: readonly SessionId[]
  /** Registry-global pin set, most recently pinned first. */
  readonly pinnedSessionIds: readonly SessionId[]
  /** Configured project-creation base; null when the capability is off. */
  readonly projectBase: string | null
}
```

`feed.ts` — конструктор и baseline:

```text
  /**
   * @param ctx - Host context containing the authoritative Workspace registry.
   * @param projectBase - configured project base; null when project creation
   *   is off. Static for the process lifetime, so baselines carry it and no
   *   increment frame exists for it.
   */
  constructor(private readonly ctx: Context, private readonly projectBase: string | null) {
```

(первую строку существующего конструктора замените; тело не меняется), и в `baseline()` добавьте поле:

```text
    return {
      items: this.ctx.workspaceRegistry.list().map(workspaceView),
      archivedSessionIds: [...this.ctx.workspaceRegistry.archivedSessionIds],
      pinnedSessionIds: [...this.ctx.workspaceRegistry.pinnedSessionIds],
      projectBase: this.projectBase,
    }
```

`index.ts`: `this.feed = new WorkspaceFeed(ctx, this.config.projectBase ?? null)`; в `filtered()` (строки 214-223) — проброс (`replace`-кадры тоже собираются через `filtered`, без этого поле потеряется):

```text
      return {
        items: items.map(item => ({ ...item, sessionIds: sessions(item.sessionIds) })),
        archivedSessionIds: sessions(value.archivedSessionIds),
        pinnedSessionIds: sessions(value.pinnedSessionIds),
        projectBase: value.projectBase,
      }
```

- [x] **Step 4: Тесты + фиксtures**

Все литералы `WorkspaceBaseline` в тестах пакета (`tests/remote/workspace.client.ts` helper `baseline()` строка 69-74 — не трогайте: он строит КАДР для мока с тем же типом; добавьте `projectBase: null` в его `value`-литерал) и в client-спеках (Task 4) обязаны получить поле. После правки:

Run: `pnpm vitest run packages/api/workspace-controller` Expected: PASS.

- [x] **Step 5: Коммит**

```bash
git add packages/api/workspace-controller/src packages/api/workspace-controller/tests
git commit -m "feat(api): projectBase capability field on the workspace follow baseline"
```

---

### Task 4: Клиентская модель и фасад — `createProject`, `projectBase` в снапшоте

**Files:**
- Modify: `packages/api/workspace-controller/src/client/model.ts` (25-26, 31-41, 93-102, 260-275, 348-357)
- Modify: `packages/api/workspace-controller/src/client/service.ts` (10-18, 46-115, 130-134)
- Test: `packages/api/workspace-controller/tests/model.client.spec.ts`, `tests/transport.client.spec.ts`, `tests/remote/workspace.client.ts`

**Interfaces:**
- Consumes: verb `workspace/createProject` (Task 2, после `pnpm run generate-typert`), `WorkspaceBaseline.projectBase` (Task 3).
- Produces: `WorkspaceSnapshot.projectBase: string | null`; `IWorkspaces.createProject(input: { name: string }): Promise<WorkspaceView>`; `WorkspaceProjectCreateError` с `rpcError: RemoteFailure` (поле `rpcError.code` → локаль диалога в Task 5).

- [x] **Step 1: Падающие тесты модели**

`model.client.spec.ts` — в `FakeWorkspaceRemote` (строки 71-158) добавьте метод по образцу `create`:

```text
  onCreateProject = (_request: { name: string }): Promise<RemoteResult<WorkspaceCreateValue>> =>
    Promise.resolve(remoteOk({ workspace: workspace('project'), created: true }))
  async createProject(request: { name: string }): Promise<RemoteResult<WorkspaceCreateValue>> {
    this.calls.push({ method: 'createProject', request })
    return await this.onCreateProject(request)
  }
```

и тесты:

```text
  it('creates a project and merges the returned row', async () => {
    const remote = new FakeWorkspaceRemote()
    const model = modelFor(remote)
    remote.onCreateProject = request => Promise.resolve(remoteOk({
      workspace: workspace('ЖД-12', [], '2026-02-01T00:00:00.000Z'),
      created: request.name === 'ЖД-12',
    }))
    await expect(model.createProject({ name: 'ЖД-12' })).resolves.toMatchObject({ ok: true })
    expect(remote.calls).toContainEqual({ method: 'createProject', request: { name: 'ЖД-12' } })
    expect(model.getSnapshot().items[0]?.title).toBe('ЖД-12')
  })

  it('keeps projectBase from the stream baseline in the snapshot', async () => {
    const remote = new FakeWorkspaceRemote()
    const model = modelFor(remote)
    model.replaceBaseline({ items: [], archivedSessionIds: [], pinnedSessionIds: [], projectBase: '/nw' })
    expect(model.getSnapshot().projectBase).toBe('/nw')
    model.replaceBaseline({ items: [], archivedSessionIds: [], pinnedSessionIds: [], projectBase: null })
    expect(model.getSnapshot().projectBase).toBeNull()
  })
```

(локальный helper `baseline(model, items, archived, pinned)` в спеке — строки 164-171 — дополните пятым параметром `projectBase: string | null = null`.)

- [x] **Step 2: Прогнать — FAIL**

Run: `pnpm run generate-typert && pnpm vitest run packages/api/workspace-controller/tests/model.client.spec.ts`

- [x] **Step 3: Реализовать модель**

`model.ts`: в `WorkspaceSnapshot` (31-41) после `pinnedSessionIds`:

```text
  /** Configured project-creation base from the latest baseline; null when off. */
  readonly projectBase: string | null
```

поле класса рядом с прочим состоянием: `private projectBase: string | null = null`; в `replaceBaseline` (260-275) до `this.invalidate()`: `this.projectBase = baseline.projectBase`; в сборке снапшота (348-357, `buildSnapshot`) — добавить строку `projectBase: this.projectBase,`; метод по образцу `create` (93-102):

```text
  async createProject(input: { name: string }): Promise<RemoteResult<WorkspaceCreateValue>> {
    const result = await this.remote.createProject(input)
    if (result.ok) this.upsert(result.value.workspace)
    return result
  }
```

- [x] **Step 4: Фасад**

`service.ts` — класс ошибки по образцу `WorkspaceCreateError` (10-18):

```text
/** createProject wire failure; `rpcError.code` picks the dialog's localized message. */
export class WorkspaceProjectCreateError extends Error {
  readonly rpcError: RemoteFailure

  /**
   * @param rpcError - wire failure from the createProject call.
   */
  constructor(rpcError: RemoteFailure) {
    super(`workspace project create failed: ${rpcError.code}: ${rpcError.message}`)
    this.rpcError = rpcError
  }
}
```

в интерфейс `IWorkspaces` (46-115) рядом с `create`:

```text
  /**
   * Create one project Workspace under the configured project base.
   * @param input - user-supplied project name.
   * @returns the created or already-registered Workspace.
   */
  createProject(input: { readonly name: string }): Promise<WorkspaceView>
```

и реализация в классе рядом с `create` (130-134):

```text
  async createProject(input: { name: string }): Promise<WorkspaceView> {
    const result = await this.model.createProject(input)
    if (!result.ok) throw new WorkspaceProjectCreateError(result.error)
    return result.value.workspace
  }
```

Экспортируйте `WorkspaceProjectCreateError` из клиентского индекса пакета (`src/client/index.ts` переэкспортирует из `./service.ts` по образцу остальных ошибок; проверьте существующий реэкспорт `WorkspaceCreateError` и добавьте рядом).

- [x] **Step 5: Тестовые хелперы и transport**

`tests/remote/workspace.client.ts`: в `workspaceWorld.unary` добавьте:

```text
      'workspace/createProject': (request: { name: string }): RemoteResult<WorkspaceCreateValue> =>
        ok({ workspace: workspace('project', { path: `/nw/${request.name}`, title: request.name }), created: true }),
```

а в `baseline(...)`-хелпере (69-74) — `projectBase: null` в литерале value. В `transport.client.spec.ts` продлите существующий тест «publishes the model source and exposes successful Workspace commands» (357-388):

```text
    await expect(controller.createProject({ name: 'Котельная' })).resolves.toMatchObject({ title: 'Котельная' })
    expect(mock.log.requests('workspace/createProject')).toEqual([{ name: 'Котельная' }])
```

- [x] **Step 6: Прогнать пакет целиком**

Run: `pnpm vitest run packages/api/workspace-controller` Expected: PASS (host + model + transport).

- [x] **Step 7: Коммит**

```bash
git add packages/api/workspace-controller/src packages/api/workspace-controller/tests
git commit -m "feat(api): client createProject facade and projectBase snapshot field"
```

---

### Task 5: Кнопка «Новый проект» и диалог в `ui-workspace`

**Files:**
- Modify: `packages/client/ui-workspace/src/client/locales.ts` (все 8 словарей)
- Modify: `packages/client/ui-workspace/src/client/contract/slots.ts` (WorkspaceBrowserInjected + WorkspaceBrowserProps проброс)
- Modify: `packages/client/ui-workspace/src/client/index.ts` (browserInjected + createProject)
- Modify: `packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx` (гейтинг, кнопка, монтаж диалога)
- Create: `packages/client/ui-workspace/src/client/rows/NewProjectDialog.tsx`
- Test: `packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx`

**Interfaces:**
- Consumes: `workspaces.createProject` (Task 4), `useWorkspaces`-хук (`state.projectBase`), `startSession(workspaceId, { clearPreviousDraft: false })` (существующий, WorkspaceBrowser.tsx:1329).
- Produces: UI-возможность; ключи локали `project.new`, `project.name`, `project.create`, `project.placeholder`, `project.error.exists`, `project.error.invalid`, `project.error.failed`.

- [x] **Step 1: Ключи локалей (8 словарей)**

В каждый словарь `locales.ts` добавьте по 7 ключей (zh — источник; остальные — `satisfies`):

zh:
```text
  'project.new': '新建项目',
  'project.name': '项目名称',
  'project.create': '创建',
  'project.placeholder': '例如：12号住宅楼',
  'project.error.exists': '同名文件夹已存在。',
  'project.error.invalid': '文件夹名称无效：请使用字母、数字、空格或连字符。',
  'project.error.failed': '项目创建失败。',
```
en:
```text
  'project.new': 'New project',
  'project.name': 'Project name',
  'project.create': 'Create',
  'project.placeholder': 'For example: House 12',
  'project.error.exists': 'A folder with this name already exists.',
  'project.error.invalid': 'Invalid folder name: use letters, digits, spaces, and hyphens.',
  'project.error.failed': 'Project creation failed.',
```
ru:
```text
  'project.new': 'Новый проект',
  'project.name': 'Имя проекта',
  'project.create': 'Создать',
  'project.placeholder': 'Например: Жилой дом 12',
  'project.error.exists': 'Папка с таким именем уже существует.',
  'project.error.invalid': 'Недопустимое имя папки: используйте буквы, цифры, пробелы и дефисы.',
  'project.error.failed': 'Не удалось создать проект.',
```
ja:
```text
  'project.new': '新規プロジェクト',
  'project.name': 'プロジェクト名',
  'project.create': '作成',
  'project.placeholder': '例：12号住宅',
  'project.error.exists': '同じ名前のフォルダーが既に存在します。',
  'project.error.invalid': 'フォルダー名が無効です：英数字・スペース・ハイフンを使用してください。',
  'project.error.failed': 'プロジェクトを作成できませんでした。',
```
es:
```text
  'project.new': 'Proyecto nuevo',
  'project.name': 'Nombre del proyecto',
  'project.create': 'Crear',
  'project.placeholder': 'Por ejemplo: Casa 12',
  'project.error.exists': 'Ya existe una carpeta con ese nombre.',
  'project.error.invalid': 'Nombre de carpeta no válido: use letras, dígitos, espacios y guiones.',
  'project.error.failed': 'No se pudo crear el proyecto.',
```
fr:
```text
  'project.new': 'Nouveau projet',
  'project.name': 'Nom du projet',
  'project.create': 'Créer',
  'project.placeholder': 'Par exemple : Maison 12',
  'project.error.exists': 'Un dossier portant ce nom existe déjà.',
  'project.error.invalid': 'Nom de dossier invalide : utilisez des lettres, des chiffres, des espaces et des tirets.',
  'project.error.failed': 'Échec de la création du projet.',
```
de:
```text
  'project.new': 'Neues Projekt',
  'project.name': 'Projektname',
  'project.create': 'Erstellen',
  'project.placeholder': 'Zum Beispiel: Haus 12',
  'project.error.exists': 'Ein Ordner mit diesem Namen ist bereits vorhanden.',
  'project.error.invalid': 'Ungültiger Ordnername: Verwenden Sie Buchstaben, Ziffern, Leerzeichen und Bindestriche.',
  'project.error.failed': 'Projekt konnte nicht erstellt werden.',
```
pt:
```text
  'project.new': 'Projeto novo',
  'project.name': 'Nome do projeto',
  'project.create': 'Criar',
  'project.placeholder': 'Por exemplo: Casa 12',
  'project.error.exists': 'Já existe uma pasta com esse nome.',
  'project.error.invalid': 'Nome de pasta inválido: use letras, dígitos, espaços e hífens.',
  'project.error.failed': 'Falha ao criar o projeto.',
```

- [x] **Step 2: Падающие тесты браузера**

В `tests/workspace-browser.client.spec.tsx`: билдер `workspaceState` (75-86) дополните `projectBase: null as string | null`; в `mount()` (115-166) — `createProject: vi.fn(async () => workspace('created')),`; тесты (стиль — по образцу «hides the add button…», строки 2076-2085):

```tsx
  it('hides the New project button when the Host advertises no projectBase', () => {
    mount({ useWorkspaces: hook({ ...workspaceState([workspace('alpha', [])]), projectBase: null }) })
    expect(screen.queryByRole('button', { name: '新建项目' })).toBeNull()
  })

  it('creates a project from the header dialog and starts a session in it', async () => {
    const created = workspace('ЖД-12', [])
    const createProject = vi.fn(async () => created)
    const b = mount({ useWorkspaces: hook({ ...workspaceState([]), projectBase: '/nw' }), createProject })
    fireEvent.click(screen.getByRole('button', { name: '新建项目' }))
    const input = screen.getByRole('textbox', { name: '项目名称' })
    fireEvent.change(input, { target: { value: 'ЖД-12' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => { expect(createProject).toHaveBeenCalledWith({ name: 'ЖД-12' }) })
    await waitFor(() => { expect(b.props.startSession).toHaveBeenCalledWith(created.workspaceId, { clearPreviousDraft: false }) })
  })

  it('maps the exists wire failure to the localized dialog message', async () => {
    const createProject = vi.fn(async () => { throw new WorkspaceProjectCreateError(new RemoteError('workspace/project-exists', 'exists', { path: '/nw/a' })) })
    mount({ useWorkspaces: hook({ ...workspaceState([]), projectBase: '/nw' }), createProject })
    fireEvent.click(screen.getByRole('button', { name: '新建项目' }))
    const input = screen.getByRole('textbox', { name: '项目名称' })
    fireEvent.change(input, { target: { value: 'alpha' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('同名文件夹已存在。') })
  })
```

Импорты в спеку: `WorkspaceProjectCreateError` из `@deepseek-ai/dsh-api-workspace-controller/client`, `RemoteError` из `@deepseek-ai/dsh-typert-protocol` (и `fireEvent` к существующим @testing-library импортам).

- [x] **Step 3: Прогнать — FAIL**

Run: `pnpm vitest run packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx`

- [x] **Step 4: Слоты-контракт и wiring**

`contract/slots.ts`: в `WorkspaceBrowserInjected` (243-302; там, где `renameWorkspace`/`deleteWorkspace`) добавьте:

```text
  /** Create one project Workspace under the Host's project base. */
  createProject: (input: { readonly name: string }) => Promise<WorkspaceView>
```

(`WorkspaceView` уже импортирован в контракт.) `src/client/index.ts`: в `browserInjected()` (334-357) рядом с `startSession`:

```text
    createProject: async (input) => workspaces.createProject(input),
```

- [x] **Step 5: Кнопка и диалог в WorkspaceBrowser**

`rows/WorkspaceBrowser.tsx`:

1. Импорт: добавьте `IconPlusOutlineRegular` к импорту из `@deepseek-ai/dsh-client-ui-primitives` (строки 20-26; пикер уже использует этот глиф для «добавить» — единый язык «плюс = создать», отдельный от ProjectAdd-кнопки пикера каталога).
2. Деструктура пропсов (893-926): добавьте `createProject,`.
3. Состояние и гейтинг (рядом с `directoryFlowAvailable`, 949-951):

```tsx
  const projectBaseAvailable = useWorkspaces(state => state.projectBase !== null)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
```

4. Кнопка в `headerActions` (сразу после блока `directoryFlowAvailable && (…)`, строки 1298-1313):

```tsx
          {projectBaseAvailable && (
            <Tooltip label={t('project.new')} side="bottom" delayMs={500} portal>
              <button
                type="button"
                className={css.iconButton}
                aria-label={t('project.new')}
                onClick={() => { setNewProjectOpen(true) }}
              >
                <IconPlusOutlineRegular size={wide ? 16 : 18} />
              </button>
            </Tooltip>
          )}
```

5. Монтаж диалога рядом с `WorkspaceDialogs` (1430-1432):

```tsx
      {newProjectOpen && <NewProjectDialog
        onClose={() => { setNewProjectOpen(false) }}
        createProject={createProject} startSession={startSession} t={t}
      />}
```

и импорт `import { NewProjectDialog } from './NewProjectDialog.tsx'`.

- [x] **Step 6: Новый компонент `rows/NewProjectDialog.tsx`**

(Каркас — точная копия паттерна rename из `WorkspaceDialogs.tsx:14-113`: Modal+Button, busy, `role="alert"`, IME-гард `composingRef`, `data-modal-autofocus`.)

```tsx
/** New-project dialog: one name under the Host's project base becomes a Workspace. */
import { useRef, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { WorkspaceProjectCreateError } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import css from './WorkspaceBrowser.module.css'

type Props = Pick<WorkspaceBrowserProps, 'createProject' | 'startSession' | 't'> & {
  readonly onClose: () => void
}

/** @param props - create action, session starter, locale seat, and dismissal. @returns the creation dialog. */
export function NewProjectDialog({ createProject, startSession, onClose, t }: Props) {
  const composingRef = useRef(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmed = draft.trim()
  const blocked = busy || trimmed === ''

  const localizedError = (reason: unknown): string => {
    if (reason instanceof WorkspaceProjectCreateError) {
      if (reason.rpcError.code === 'workspace/project-exists') return t('project.error.exists')
      if (reason.rpcError.code === 'workspace/project-name-invalid') return t('project.error.invalid')
      return t('project.error.failed')
    }
    return reason instanceof Error ? reason.message : String(reason)
  }

  const close = () => {
    if (busy) return
    onClose()
  }

  const confirm = () => {
    if (blocked) return
    setBusy(true)
    setError(null)
    createProject({ name: trimmed }).then(workspace => {
      setBusy(false)
      onClose()
      startSession(workspace.workspaceId, { clearPreviousDraft: false })
    }).catch((reason: unknown) => {
      setBusy(false)
      setError(localizedError(reason))
    })
  }

  return (
    <Modal open onClose={close} closeLabel={t('close')} title={t('project.new')}
      footer={(
        <>
          <Button variant="outline" disabled={busy} onClick={close}>{t('cancel')}</Button>
          <Button variant="primary" disabled={blocked} onClick={confirm}>{t('project.create')}</Button>
        </>
      )}
    >
      <input
        className={css.renameInput}
        value={draft}
        aria-label={t('project.name')}
        placeholder={t('project.placeholder')}
        data-modal-autofocus
        disabled={busy}
        onChange={(e) => { setDraft(e.target.value); setError(null) }}
        onCompositionStart={() => { composingRef.current = true }}
        onCompositionEnd={() => { composingRef.current = false }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !composingRef.current) {
            e.preventDefault()
            confirm()
          }
        }}
      />
      {error !== null && <div className={css.renameError} role="alert">{error}</div>}
    </Modal>
  )
}
```

(`t('close')`/`t('cancel')` — существующие ключи словаря; классы `renameInput`/`renameError` переиспользуются.)

- [x] **Step 7: Прогнать тесты и i18n-гейт**

```bash
pnpm vitest run packages/client/ui-workspace
pnpm run verify-client-ui-i18n
```

Expected: PASS / без находок.

- [x] **Step 8: Коммит**

```bash
git add packages/client/ui-workspace/src packages/client/ui-workspace/tests
git commit -m "feat(client): New project dialog gated on the workspace projectBase capability"
```

---

### Task 6: NW-оверлей и лаунчер

**Files:**
- Modify: `packages/bundle/web-app/client-north-waterfront.patch.yml`
- Modify: `dsh-web-north-waterfront.cmd:17,117`

**Interfaces:**
- Consumes: `projectBase` (Task 1), spill-local `root` (существующий конфиг), `dshHomePath` в `!!js` (boot-provide), персоны строк 226 и 328.

- [x] **Step 1: Оверлей — три правки**

В `client-north-waterfront.patch.yml`:

(а) Новые same-id строки (вставьте после блока `permission`, строки 90-102; same-id override целиком заменяет config целевой строки — у обеих целей сегодня конфига нет, рестейтить нечего):

```yaml
# -- Projects: client users create named project folders under one base. -----
# Same-id override of the web-app `workspace-controller` row: projectBase
# anchors the first-use default Workspace and switches on the New project
# button (the follow baseline carries the field). NW_PROJECTS_DIR comes from
# .env.north-waterfront through the launcher; the default matches the folder
# the launcher prepares. Mutually exclusive with documentsDirectory, which is
# never set on this deployment.
- id: workspace-controller
  config:
    projectBase: !!js process.env.NW_PROJECTS_DIR ?? (process.env.USERPROFILE ?? process.env.HOME) + '/north-waterfront'

# Spill is the model's internal recovery cache, not a delivery path: keep it
# under this deployment's DSH_HOME (the launcher pins
# %USERPROFILE%\.dsh-north-waterfront), never in %TEMP%. Same-id override of
# the base `spill-local` row; the 30-day cleanup default stands.
- id: spill-local
  config:
    root: !!js dshHomePath('spill')
```

(б) Персона `preset-standard` (строка 226) — допишите в конец `prefix:` одно предложение:

```
 Never show cache, temp, or attachment-store paths to the user: user files live only in the project folder, and a file is handed over by creating it in the working directory and calling present.
```

(в) `instructionsPrefix` (строка 328) — то же предложение в конец.

- [x] **Step 2: Лаунчер**

`dsh-web-north-waterfront.cmd`:

Строку 17 `set "WORKSPACE=%USERPROFILE%\north-waterfront"` замените на:

```bat
set "NW_PROJECTS_DIR=%USERPROFILE%\north-waterfront"
```

(стоит ДО загрузки `.env.north-waterfront` в строках 120-123 — файл может переопределить), и строку 117 `if not exist "%WORKSPACE%" mkdir "%WORKSPACE%"` на:

```bat
if not exist "%NW_PROJECTS_DIR%" mkdir "%NW_PROJECTS_DIR%"
```

- [x] **Step 3: Проверки**

```bash
pnpm run verify-cordis-config
pnpm run doc-sync
```

Expected: PASS (гейты документации; конфиг-каталог не затронут — строка без config-док уже была).

- [x] **Step 4: Коммит**

```bash
git add packages/bundle/web-app/client-north-waterfront.patch.yml dsh-web-north-waterfront.cmd
git commit -m "chore(bundle): north-waterfront project base, spill root, and persona guardrail"
```

---

### Task 7: Документация и финальные гейты

**Files:**
- Modify: `packages/api/workspace-controller/README.md` (таблица конфига, строки 39-43)
- Modify: `packages/api/workspace-controller/README.zh.md` (зеркально)
- Modify: `docs/config-catalog.md` (генерат)

**Interfaces:** нет кода.

- [x] **Step 1: README**

В таблицу «First-use Workspace» добавьте строку:

```markdown
| `projectBase` | — | Fully qualified base directory for `createProject` and first-use default anchoring; mutually exclusive with `documentsDirectory` |
```

и раздел «Confined project creation» (3–4 предложения: глагол создаёт `<projectBase>/<name>`, имя = один безопасный сегмент, ошибки `workspace/project-*`, follow-фид несёт `projectBase`, клиентская кнопка `ui-workspace` гейтится им). Зеркально в `README.zh.md`; перезапишите i18n-запись:

```bash
pnpm run verify-translation-pairing --write packages/api/workspace-controller/README.md
```

- [x] **Step 2: Конфиг-каталог (генерат)**

```bash
pnpm run gen-config-catalog
```

(блок `@deepseek-ai/dsh-api-workspace-controller` перегенерируется из `Config` — `projectBase` появится сам; строка `source:` сместится.)

- [x] **Step 3: Финальные гейты**

```bash
pnpm run generate-typert
pnpm run build:artifacts
pnpm run build:check
pnpm vitest run packages/api/workspace-controller packages/client/ui-workspace
pnpm run verify-client-ui-i18n
pnpm run doc-sync
```

Expected: всё PASS. (build:check обязан идти после свежего build:artifacts — см. AGENTS.md.)

- [x] **Step 4: Коммит**

```bash
git add packages/api/workspace-controller/README.md packages/api/workspace-controller/README.zh.md packages/api/workspace-controller/README.i18n.yaml docs/config-catalog.md
git commit -m "docs(api): projectBase configuration and confined project creation"
```

---

## Ручной смоук (после деплоя NW)

1. Перезапустить `dsh-web-north-waterfront.cmd`; в панели проектов появилась кнопка «Новый проект» (заголовок).
2. Создать проект «Жилой дом 12» → папка `%USERPROFILE%\north-waterfront\Жилой дом 12` существует, в панели — новый воркспейс, открылась новая сессия в нём.
3. Повторить то же имя → в диалоге «Папка с таким именем уже существует.»
4. В сессии попросить PDF-отчёт → файл лежит в папке проекта, не в `%TEMP%`; в `%TEMP%` новых `dsh-spill-*` не появляется (spill теперь в `%USERPROFILE%\.dsh-north-waterfront\spill`).
5. Старый `default-workspace` из Documents виден в панели как раньше.
