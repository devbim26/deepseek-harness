# NW 项目文件夹实现计划

[English](2026-11-18-nw-project-folders.md) | 中文

> **致 agentic worker：**必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务逐个实现本计划。步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：**NW 站点的客户端用户通过项目面板中的「新建项目」按钮创建命名项目（`%USERPROFILE%\north-waterfront` 下的文件夹）；会话在项目中工作；spill 从 `%TEMP%` 移到 `DSH_HOME\spill`；persona 不展示 temp 路径。

**架构：**在既有 Remote 命名空间 `workspace`（`WorkspaceController`）上新增动词 `createProject({name})`，配置项 `projectBase`（与 `documentsDirectory` 互斥）；能力信号——baseline follow-feed 中的 `projectBase: string | null` 字段 → 客户端 `WorkspaceSnapshot` → `WorkspaceBrowser` 经既有 hook `useWorkspaces` 判定按钮可见性。设计：`docs/superpowers/specs/2026-11-18-nw-project-folders-design.zh.md`。

**技术栈：**TypeScript ESM（cordis、schemastery、zod、typert Remote），React 18（client slot），vitest（jsdom + @testing-library/react），pnpm workspaces。

## 全局约束

- 仓库：`C:\Users\Lenovo\Desktop\проект SOFT_2\Models FIN\Harness`。提交沿用仓库风格：`feat(api): …`、`feat(client): …`、`chore(bundle): …`。
- ESM：本地导入带 `.ts` 扩展名；禁止任何 `as unknown`/`<unknown>`；文件以恰好一个 `\n` 结尾（pre-commit `git diff --cached --check`）。
- 线上错误码（封闭家族）：`workspace/project-unavailable`、`workspace/project-name-invalid`、`workspace/project-exists`、`workspace/project-create-failed`。
- `projectBase` 与 `documentsDirectory` 互斥：两者同时设置 → 插件加载时抛异常。
- 项目名：校验后 1–64 个字符；允许 Unicode；禁止 `/ \ < > : " | ? *`、控制字符、`.`/`..`、首尾的点或空格、Windows 保留名（CON、PRN、AUX、NUL、COM1–9、LPT1–9，大小写不敏感）。
- 客户端文案只经 `packages/client/ui-workspace/src/client/locales.ts` 中的 `workspace` 字典，全部 8 种语言（zh 为 key 来源；en、ja、es、fr、de、ru、pt 用 `satisfies`）；英文 sentence case。门禁：`pnpm run verify-client-ui-i18n`。
- 新增 Remote 动词后重新生成 typert 产物：`pnpm run generate-typert`（或从仓库根运行 `npx tsx scripts/generate-typert.ts`）——要在运行导入 `@deepseek-ai/dsh-api-workspace-controller/remote` 的 typecheck/测试之前。
- 定点运行：仓库根的 `pnpm vitest run packages/api/workspace-controller` 与 `pnpm vitest run packages/client/ui-workspace`。完整套件与 coverage 归 CI。
- 环境已知问题：lefthook pre-commit 可能因 msys `NtCreateDirectoryObject`（access denied）失败。若不是你的文件导致——手动运行 `git diff --cached --check` 后用 `git commit --no-verify` 提交（见 AGENTS.md「Host sandbox failures」）。
- SDK（`SessionEventMap`、agent loop）不变。快照：NW overlay/persona 不在 keyless 套件覆盖范围（已用 `snapshots/` grep 核对）——不需要新快照。

---

### 任务 1：宿主配置——`projectBase`、互斥、`initializeDefault`

**文件：**
- 修改：`packages/api/workspace-controller/src/index.ts:37-45`（Config）、`:71-83`（构造函数）、`:103-112`（initializeDefault）
- 修改：`packages/api/workspace-controller/src/default-directory.ts:15-28`（校验器泛化）
- 测试：`packages/api/workspace-controller/tests/workspace-controller.host.spec.ts`

**接口：**
- 产出：`Config.projectBase?: string`（经校验，与 documentsDirectory 互斥）；`defaultWorkspaceDirectory` 分支不变；任务 2/3 读取 `this.config.projectBase`。

- [x] **步骤 1：编写失败测试**

在 `workspace-controller.host.spec.ts`（harness `harness()` 已创建真实 cordis `Context` + `WorkspaceRegistry` + memory storage；目录为 `mkdtempSync(join(tmpdir(), 'dsh-workspace-controller-'))`；见 54-76 行）中加入共享 helper 与 describe 块（任务 2 的测试复用该 helper）：

```ts
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

```ts
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

（`roots`、`tempDirs`——harness 既有的数组，见 33-41 行；`DEFAULT_WORKSPACE_DIRECTORY` 已在 spec 中导入。）

- [x] **步骤 2：运行并确认失败**

运行：`pnpm vitest run packages/api/workspace-controller` 预期：FAIL——没有 `projectBase` 属性（schemastri 的 TS 错误 / initializeDefault 没有该分支）。

- [x] **步骤 3：实现**

`src/default-directory.ts`——泛化校验器（documentsDirectory 的消息不变）：

```ts
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

（`index.ts:75` 处对 `validateDocumentsDirectory` 的旧调用保留；其在 `default-directory.host.spec.ts` 中的测试不变。）

`src/index.ts`——Config 与构造函数：

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

构造函数中 `this.config = WorkspaceController.Config(config)` 之后：

```ts
    if (this.config.documentsDirectory !== undefined && this.config.projectBase !== undefined) {
      throw new Error('projectBase and documentsDirectory are mutually exclusive; configure one first-use policy')
    }
    if (this.config.projectBase !== undefined) {
      this.config = { ...this.config, projectBase: validateFullyQualifiedDirectory(this.config.projectBase, process.platform, 'Project base directory') }
    }
```

以及 `initializeDefault` 中的分支（替换 `initializeDefault` 回调的主体）：

```ts
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

在 `src/index.ts` 添加导入：`import { join } from 'node:path'`，在既有 `./default-directory.ts` 导入中加入 `validateFullyQualifiedDirectory`；`DEFAULT_WORKSPACE_DIRECTORY` 来自 `./default-workspace.ts`。

- [x] **步骤 4：运行测试**

运行：`pnpm vitest run packages/api/workspace-controller` 预期：PASS（全部，含旧测试）。

- [x] **步骤 5：提交**

```bash
git add packages/api/workspace-controller/src packages/api/workspace-controller/tests
git commit -m "feat(api): projectBase config with exclusive documentsDirectory policy"
```

---

### 任务 2：`createProject` 动词——名称校验、目录、注册

**文件：**
- 新建：`packages/api/workspace-controller/src/project-name.ts`
- 修改：`packages/api/workspace-controller/src/types.ts`（request + 错误码）
- 修改：`packages/api/workspace-controller/src/commands.ts`（构造函数 + 方法）
- 修改：`packages/api/workspace-controller/src/index.ts`（verb + projectBase 透传）
- 测试：`packages/api/workspace-controller/tests/workspace-controller.host.spec.ts`、新建 `tests/project-name.host.spec.ts`

**接口：**
- 消费：`Config.projectBase`（任务 1）、`WorkspaceCommands.create({ path })`（既有，按规范化路径幂等）。
- 产出：`WorkspaceProjectCreateRequest { name: string }`；动词 `controller.createProject(request): Promise<WorkspaceCreateValue>`；`isValidProjectName(name): boolean`；代码 `workspace/project-*`。任务 4 把同一动词接进客户端模型。

- [x] **步骤 1：名称校验测试（新文件）**

`tests/project-name.host.spec.ts`：

```ts
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

- [x] **步骤 2：运行——模块不存在**

运行：`pnpm vitest run packages/api/workspace-controller/tests/project-name.host.spec.ts` 预期：FAIL（没有 `../src/project-name.ts`）。

- [x] **步骤 3：实现 `src/project-name.ts`**

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

- [x] **步骤 4：动词测试（在 host.spec.ts；`projectHarness`/`rejectionCode` 来自任务 1）**

```ts
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

（把 `writeFileSync` 加到文件开头的 `node:fs` 导入。）

- [x] **步骤 5：运行——失败（方法不存在）**

运行：`pnpm vitest run packages/api/workspace-controller` 预期：FAIL——`controller.createProject is not a function`。

- [x] **步骤 6：实现**

`src/types.ts`——放在 `WorkspaceCreateRequest` 旁（64-73 行）：

```ts
/** Confined project creation: one directory name under the configured project base. */
export interface WorkspaceProjectCreateRequest {
  readonly name: string
}
```

并加入既有带 `RemoteErrorDetailsMap` 的 `declare module '@deepseek-ai/dsh-typert-protocol'` 块（32-62 行；与相邻条目对称）：

```ts
    'workspace/project-unavailable': Record<string, never>
    'workspace/project-name-invalid': { readonly name: string }
    'workspace/project-exists': { readonly path: string }
    'workspace/project-create-failed': { readonly path: string }
```

`src/commands.ts`——构造函数接收基目录（找到 `constructor(private readonly ctx: Context)` 并替换）：

```ts
  /**
   * @param ctx - Host context carrying the Workspace registry.
   * @param projectBase - configured project base directory; undefined disables
   *   confined project creation.
   */
  constructor(private readonly ctx: Context, private readonly projectBase: string | undefined) {}
```

以及 `create` 旁的方法（40-64 行）：

```ts
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

`commands.ts` 的导入：`import { existsSync } from 'node:fs'`、`import { mkdir } from 'node:fs/promises'`、`import { join } from 'node:path'`、`import { isValidProjectName } from './project-name.ts'`、`import type { WorkspaceProjectCreateRequest } from './types.ts'`（类型加到既有的类型导入）。

`src/index.ts`——透传与 verb（构造函数中 `new WorkspaceCommands(ctx)` → `new WorkspaceCommands(ctx, this.config.projectBase)`；放在 `@Remote('create')` 方法旁）：

```ts
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

- [x] **步骤 7：运行测试 + 重新生成 typert**

```bash
pnpm run generate-typert
pnpm vitest run packages/api/workspace-controller
```

预期：PASS（全部）。重新生成会更新包的 `lib/typert.*` 产物——不要提交它们（由构建生成）。

- [x] **步骤 8：提交**

```bash
git add packages/api/workspace-controller/src packages/api/workspace-controller/tests
git commit -m "feat(api): workspace createProject verb with confined name validation"
```

---

### 任务 3：follow-feed 中的 `projectBase` 字段

**文件：**
- 修改：`packages/api/workspace-controller/src/types.ts:152-158`（WorkspaceBaseline）
- 修改：`packages/api/workspace-controller/src/feed.ts:49-81`（构造函数 + baseline）
- 修改：`packages/api/workspace-controller/src/index.ts:214-223`（filtered）与 `:77`（透传给 feed）
- 测试：`packages/api/workspace-controller/tests/workspace-controller.host.spec.ts`（follow 测试，约 451 行）

**接口：**
- 消费：`Config.projectBase`（任务 1）。
- 产出：`WorkspaceBaseline.projectBase: string | null`——任务 4 把它放进 `WorkspaceSnapshot`。

- [x] **步骤 1：失败测试**

加入既有的 follow 测试 describe（风格仿照使用 `WorkspaceFeed`/`controller.follow` 的相邻 follow 测试）：

```ts
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

- [x] **步骤 2：运行——FAIL（字段不存在）**

运行：`pnpm vitest run packages/api/workspace-controller`

- [x] **步骤 3：实现**

`types.ts`（WorkspaceBaseline）：

```ts
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

`feed.ts`——构造函数与 baseline：

```ts
  /**
   * @param ctx - Host context containing the authoritative Workspace registry.
   * @param projectBase - configured project base; null when project creation
   *   is off. Static for the process lifetime, so baselines carry it and no
   *   increment frame exists for it.
   */
  constructor(private readonly ctx: Context, private readonly projectBase: string | null) {
```

（替换既有构造函数的第一行；主体不变），并在 `baseline()` 中加入字段：

```ts
    return {
      items: this.ctx.workspaceRegistry.list().map(workspaceView),
      archivedSessionIds: [...this.ctx.workspaceRegistry.archivedSessionIds],
      pinnedSessionIds: [...this.ctx.workspaceRegistry.pinnedSessionIds],
      projectBase: this.projectBase,
    }
```

`index.ts`：`this.feed = new WorkspaceFeed(ctx, this.config.projectBase ?? null)`；在 `filtered()`（214-223 行）透传（`replace` 帧也经 `filtered` 组装，不透传字段会丢失）：

```ts
      return {
        items: items.map(item => ({ ...item, sessionIds: sessions(item.sessionIds) })),
        archivedSessionIds: sessions(value.archivedSessionIds),
        pinnedSessionIds: sessions(value.pinnedSessionIds),
        projectBase: value.projectBase,
      }
```

- [x] **步骤 4：测试 + fixture**

包内测试中所有 `WorkspaceBaseline` 字面量（`tests/remote/workspace.client.ts` 的 helper `baseline()` 69-74 行——不要动：它为 mock 构造同类型的帧；在其 `value` 字面量中加 `projectBase: null`）以及 client spec（任务 4）都必须获得该字段。修改后：

运行：`pnpm vitest run packages/api/workspace-controller` 预期：PASS。

- [x] **步骤 5：提交**

```bash
git add packages/api/workspace-controller/src packages/api/workspace-controller/tests
git commit -m "feat(api): projectBase capability field on the workspace follow baseline"
```

---

### 任务 4：客户端模型与门面——`createProject`、快照中的 `projectBase`

**文件：**
- 修改：`packages/api/workspace-controller/src/client/model.ts`（25-26、31-41、93-102、260-275、348-357）
- 修改：`packages/api/workspace-controller/src/client/service.ts`（10-18、46-115、130-134）
- 测试：`packages/api/workspace-controller/tests/model.client.spec.ts`、`tests/transport.client.spec.ts`、`tests/remote/workspace.client.ts`

**接口：**
- 消费：动词 `workspace/createProject`（任务 2，在 `pnpm run generate-typert` 之后）、`WorkspaceBaseline.projectBase`（任务 3）。
- 产出：`WorkspaceSnapshot.projectBase: string | null`；`IWorkspaces.createProject(input: { name: string }): Promise<WorkspaceView>`；带 `rpcError: RemoteFailure` 的 `WorkspaceProjectCreateError`（`rpcError.code` 字段 → 任务 5 中对话框的本地化文案）。

- [x] **步骤 1：模型的失败测试**

`model.client.spec.ts`——在 `FakeWorkspaceRemote`（71-158 行）中按 `create` 的样子加入方法：

```ts
  onCreateProject = (_request: { name: string }): Promise<RemoteResult<WorkspaceCreateValue>> =>
    Promise.resolve(remoteOk({ workspace: workspace('project'), created: true }))
  async createProject(request: { name: string }): Promise<RemoteResult<WorkspaceCreateValue>> {
    this.calls.push({ method: 'createProject', request })
    return await this.onCreateProject(request)
  }
```

以及测试：

```ts
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

（spec 中的本地 helper `baseline(model, items, archived, pinned)`——164-171 行——补充第五个参数 `projectBase: string | null = null`。）

- [x] **步骤 2：运行——FAIL**

运行：`pnpm run generate-typert && pnpm vitest run packages/api/workspace-controller/tests/model.client.spec.ts`

- [x] **步骤 3：实现模型**

`model.ts`：在 `WorkspaceSnapshot`（31-41）的 `pinnedSessionIds` 之后：

```ts
  /** Configured project-creation base from the latest baseline; null when off. */
  readonly projectBase: string | null
```

类字段放在其他状态旁：`private projectBase: string | null = null`；`replaceBaseline`（260-275）中在 `this.invalidate()` 之前：`this.projectBase = baseline.projectBase`；快照组装（348-357，`buildSnapshot`）加入一行 `projectBase: this.projectBase,`；按 `create`（93-102）的样子加方法：

```ts
  async createProject(input: { name: string }): Promise<RemoteResult<WorkspaceCreateValue>> {
    const result = await this.remote.createProject(input)
    if (result.ok) this.upsert(result.value.workspace)
    return result
  }
```

- [x] **步骤 4：门面**

`service.ts`——按 `WorkspaceCreateError`（10-18）的样子写错误类：

```ts
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

在接口 `IWorkspaces`（46-115）中 `create` 旁：

```ts
  /**
   * Create one project Workspace under the configured project base.
   * @param input - user-supplied project name.
   * @returns the created or already-registered Workspace.
   */
  createProject(input: { readonly name: string }): Promise<WorkspaceView>
```

以及类中 `create` 旁的实现（130-134）：

```ts
  async createProject(input: { name: string }): Promise<WorkspaceView> {
    const result = await this.model.createProject(input)
    if (!result.ok) throw new WorkspaceProjectCreateError(result.error)
    return result.value.workspace
  }
```

从包的客户端索引导出 `WorkspaceProjectCreateError`（`src/client/index.ts` 按其他错误的样子从 `./service.ts` 重导出；找到既有的 `WorkspaceCreateError` 重导出并加在旁边）。

- [x] **步骤 5：测试 helper 与 transport**

`tests/remote/workspace.client.ts`：在 `workspaceWorld.unary` 中加入：

```ts
      'workspace/createProject': (request: { name: string }): RemoteResult<WorkspaceCreateValue> =>
        ok({ workspace: workspace('project', { path: `/nw/${request.name}`, title: request.name }), created: true }),
```

并在 `baseline(...)` helper（69-74）的 value 字面量中加 `projectBase: null`。在 `transport.client.spec.ts` 中扩展现有测试「publishes the model source and exposes successful Workspace commands」（357-388）：

```ts
    await expect(controller.createProject({ name: 'Котельная' })).resolves.toMatchObject({ title: 'Котельная' })
    expect(mock.log.requests('workspace/createProject')).toEqual([{ name: 'Котельная' }])
```

- [x] **步骤 6：整包运行**

运行：`pnpm vitest run packages/api/workspace-controller` 预期：PASS（host + model + transport）。

- [x] **步骤 7：提交**

```bash
git add packages/api/workspace-controller/src packages/api/workspace-controller/tests
git commit -m "feat(api): client createProject facade and projectBase snapshot field"
```

---

### 任务 5：`ui-workspace` 中的「新建项目」按钮与对话框

**文件：**
- 修改：`packages/client/ui-workspace/src/client/locales.ts`（全部 8 个字典）
- 修改：`packages/client/ui-workspace/src/client/contract/slots.ts`（WorkspaceBrowserInjected + WorkspaceBrowserProps 透传）
- 修改：`packages/client/ui-workspace/src/client/index.ts`（browserInjected + createProject）
- 修改：`packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx`（启用判定、按钮、对话框挂载）
- 新建：`packages/client/ui-workspace/src/client/rows/NewProjectDialog.tsx`
- 测试：`packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx`

**接口：**
- 消费：`workspaces.createProject`（任务 4）、`useWorkspaces` hook（`state.projectBase`）、`startSession(workspaceId, { clearPreviousDraft: false })`（既有，WorkspaceBrowser.tsx:1329）。
- 产出：UI 能力；locale key `project.new`、`project.name`、`project.create`、`project.placeholder`、`project.error.exists`、`project.error.invalid`、`project.error.failed`。

- [x] **步骤 1：locale key（8 个字典）**

在每个 `locales.ts` 字典中加入 7 个 key（zh 为来源；其余用 `satisfies`）：

zh：
```ts
  'project.new': '新建项目',
  'project.name': '项目名称',
  'project.create': '创建',
  'project.placeholder': '例如：12号住宅楼',
  'project.error.exists': '同名文件夹已存在。',
  'project.error.invalid': '文件夹名称无效：请使用字母、数字、空格或连字符。',
  'project.error.failed': '项目创建失败。',
```
en：
```ts
  'project.new': 'New project',
  'project.name': 'Project name',
  'project.create': 'Create',
  'project.placeholder': 'For example: House 12',
  'project.error.exists': 'A folder with this name already exists.',
  'project.error.invalid': 'Invalid folder name: use letters, digits, spaces, and hyphens.',
  'project.error.failed': 'Project creation failed.',
```
ru：
```ts
  'project.new': 'Новый проект',
  'project.name': 'Имя проекта',
  'project.create': 'Создать',
  'project.placeholder': 'Например: Жилой дом 12',
  'project.error.exists': 'Папка с таким именем уже существует.',
  'project.error.invalid': 'Недопустимое имя папки: используйте буквы, цифры, пробелы и дефисы.',
  'project.error.failed': 'Не удалось создать проект.',
```
ja：
```ts
  'project.new': '新規プロジェクト',
  'project.name': 'プロジェクト名',
  'project.create': '作成',
  'project.placeholder': '例：12号住宅',
  'project.error.exists': '同じ名前のフォルダーが既に存在します。',
  'project.error.invalid': 'フォルダー名が無効です：英数字・スペース・ハイフンを使用してください。',
  'project.error.failed': 'プロジェクトを作成できませんでした。',
```
es：
```ts
  'project.new': 'Proyecto nuevo',
  'project.name': 'Nombre del proyecto',
  'project.create': 'Crear',
  'project.placeholder': 'Por ejemplo: Casa 12',
  'project.error.exists': 'Ya existe una carpeta con ese nombre.',
  'project.error.invalid': 'Nombre de carpeta no válido: use letras, dígitos, espacios y guiones.',
  'project.error.failed': 'No se pudo crear el proyecto.',
```
fr：
```ts
  'project.new': 'Nouveau projet',
  'project.name': 'Nom du projet',
  'project.create': 'Créer',
  'project.placeholder': 'Par exemple : Maison 12',
  'project.error.exists': 'Un dossier portant ce nom existe déjà.',
  'project.error.invalid': 'Nom de dossier invalide : utilisez des lettres, des chiffres, des espaces et des tirets.',
  'project.error.failed': 'Échec de la création du projet.',
```
de：
```ts
  'project.new': 'Neues Projekt',
  'project.name': 'Projektname',
  'project.create': 'Erstellen',
  'project.placeholder': 'Zum Beispiel: Haus 12',
  'project.error.exists': 'Ein Ordner mit diesem Namen ist bereits vorhanden.',
  'project.error.invalid': 'Ungültiger Ordnername: Verwenden Sie Buchstaben, Ziffern, Leerzeichen und Bindestriche.',
  'project.error.failed': 'Projekt konnte nicht erstellt werden.',
```
pt：
```ts
  'project.new': 'Projeto novo',
  'project.name': 'Nome do projeto',
  'project.create': 'Criar',
  'project.placeholder': 'Por exemplo: Casa 12',
  'project.error.exists': 'Já existe uma pasta com esse nome.',
  'project.error.invalid': 'Nome de pasta inválido: use letras, dígitos, espaços e hífens.',
  'project.error.failed': 'Falha ao criar o projeto.',
```

- [x] **步骤 2：浏览器的失败测试**

在 `tests/workspace-browser.client.spec.tsx`：builder `workspaceState`（75-86）补充 `projectBase: null as string | null`；`mount()`（115-166）补充 `createProject: vi.fn(async () => workspace('created')),`；测试（风格仿照「hides the add button…」，2076-2085 行）：

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

spec 的导入：`WorkspaceProjectCreateError` 来自 `@deepseek-ai/dsh-api-workspace-controller/client`、`RemoteError` 来自 `@deepseek-ai/dsh-typert-protocol`（`fireEvent` 加到既有 @testing-library 导入）。

- [x] **步骤 3：运行——FAIL**

运行：`pnpm vitest run packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx`

- [x] **步骤 4：slot 契约与接线**

`contract/slots.ts`：在 `WorkspaceBrowserInjected`（243-302；`renameWorkspace`/`deleteWorkspace` 所在处）加入：

```ts
  /** Create one project Workspace under the Host's project base. */
  createProject: (input: { readonly name: string }) => Promise<WorkspaceView>
```

（`WorkspaceView` 已在契约中导入。）`src/client/index.ts`：在 `browserInjected()`（334-357）中 `startSession` 旁：

```ts
    createProject: async (input) => workspaces.createProject(input),
```

- [x] **步骤 5：WorkspaceBrowser 中的按钮与对话框**

`rows/WorkspaceBrowser.tsx`：

1. 导入：把 `IconPlusOutlineRegular` 加到 `@deepseek-ai/dsh-client-ui-primitives` 的导入（20-26 行；picker 已用该字形表示「添加」——统一的「加号 = 创建」语言，与目录 picker 的 ProjectAdd 按钮区分）。
2. props 解构（893-926）：加入 `createProject,`。
3. 状态与启用判定（`directoryFlowAvailable` 旁，949-951）：

```tsx
  const projectBaseAvailable = useWorkspaces(state => state.projectBase !== null)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
```

4. `headerActions` 中的按钮（紧跟 `directoryFlowAvailable && (…)` 块之后，1298-1313 行）：

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

5. 对话框挂载在 `WorkspaceDialogs` 旁（1430-1432）：

```tsx
      {newProjectOpen && <NewProjectDialog
        onClose={() => { setNewProjectOpen(false) }}
        createProject={createProject} startSession={startSession} t={t}
      />}
```

以及导入 `import { NewProjectDialog } from './NewProjectDialog.tsx'`。

- [x] **步骤 6：新组件 `rows/NewProjectDialog.tsx`**

（骨架——`WorkspaceDialogs.tsx:14-113` 中 rename 模式的精确复刻：Modal+Button、busy、`role="alert"`、IME 守卫 `composingRef`、`data-modal-autofocus`。）

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

（`t('close')`/`t('cancel')` 是既有的字典 key；复用 `renameInput`/`renameError` 类。）

- [x] **步骤 7：运行测试与 i18n 门禁**

```bash
pnpm vitest run packages/client/ui-workspace
pnpm run verify-client-ui-i18n
```

预期：PASS / 无发现。

- [x] **步骤 8：提交**

```bash
git add packages/client/ui-workspace/src packages/client/ui-workspace/tests
git commit -m "feat(client): New project dialog gated on the workspace projectBase capability"
```

---

### 任务 6：NW overlay 与启动器

**文件：**
- 修改：`packages/bundle/web-app/client-north-waterfront.patch.yml`
- 修改：`dsh-web-north-waterfront.cmd:17,117`

**接口：**
- 消费：`projectBase`（任务 1）、spill-local 的 `root`（既有配置）、`!!js` 中的 `dshHomePath`（boot-provide）、226 与 328 行的 persona。

- [x] **步骤 1：overlay——三处修改**

在 `client-north-waterfront.patch.yml` 中：

（а）新的 same-id 行（插在 `permission` 块之后，90-102 行；same-id override 整体替换目标行的 config——两个目标目前都没有 config，无需复述）：

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

（б）persona `preset-standard`（226 行）——在 `prefix:` 末尾补一句：

```
 Never show cache, temp, or attachment-store paths to the user: user files live only in the project folder, and a file is handed over by creating it in the working directory and calling present.
```

（в）`instructionsPrefix`（328 行）——同一句加到末尾。

- [x] **步骤 2：启动器**

`dsh-web-north-waterfront.cmd`：

把 17 行 `set "WORKSPACE=%USERPROFILE%\north-waterfront"` 换成：

```bat
set "NW_PROJECTS_DIR=%USERPROFILE%\north-waterfront"
```

（须在 120-123 行加载 `.env.north-waterfront` 之前——该文件可以覆盖），并把 117 行 `if not exist "%WORKSPACE%" mkdir "%WORKSPACE%"` 换成：

```bat
if not exist "%NW_PROJECTS_DIR%" mkdir "%NW_PROJECTS_DIR%"
```

- [x] **步骤 3：检查**

```bash
pnpm run verify-cordis-config
pnpm run doc-sync
```

预期：PASS（文档门禁；config 目录未受影响——该行本来就没有 config 文档）。

- [x] **步骤 4：提交**

```bash
git add packages/bundle/web-app/client-north-waterfront.patch.yml dsh-web-north-waterfront.cmd
git commit -m "chore(bundle): north-waterfront project base, spill root, and persona guardrail"
```

---

### 任务 7：文档与最终门禁

**文件：**
- 修改：`packages/api/workspace-controller/README.md`（配置表，39-43 行）
- 修改：`packages/api/workspace-controller/README.zh.md`（镜像）
- 修改：`docs/config-catalog.md`（生成物）

**接口：**无代码。

- [x] **步骤 1：README**

在「First-use Workspace」表中加入一行：

```markdown
| `projectBase` | — | Fully qualified base directory for `createProject` and first-use default anchoring; mutually exclusive with `documentsDirectory` |
```

以及「Confined project creation」小节（3–4 句：动词创建 `<projectBase>/<name>`、名称 = 一个安全目录段、错误 `workspace/project-*`、follow-feed 携带 `projectBase`、`ui-workspace` 的客户端按钮由它判定可见性）。镜像写入 `README.zh.md`；重写 i18n 记录：

```bash
pnpm run verify-translation-pairing --write packages/api/workspace-controller/README.md
```

- [x] **步骤 2：config 目录（生成物）**

```bash
pnpm run gen-config-catalog
```

（`@deepseek-ai/dsh-api-workspace-controller` 块从 `Config` 重新生成——`projectBase` 会自动出现；`source:` 行会移动。）

- [x] **步骤 3：最终门禁**

```bash
pnpm run generate-typert
pnpm run build:artifacts
pnpm run build:check
pnpm vitest run packages/api/workspace-controller packages/client/ui-workspace
pnpm run verify-client-ui-i18n
pnpm run doc-sync
```

预期：全部 PASS。（build:check 必须跟在新鲜的 build:artifacts 之后——见 AGENTS.md。）

- [x] **步骤 4：提交**

```bash
git add packages/api/workspace-controller/README.md packages/api/workspace-controller/README.zh.md packages/api/workspace-controller/README.i18n.yaml docs/config-catalog.md
git commit -m "docs(api): projectBase configuration and confined project creation"
```

---

## 手动冒烟（NW 部署后）

1. 重启 `dsh-web-north-waterfront.cmd`；项目面板出现「新建项目」按钮（标题栏）。
2. 创建项目「Жилой дом 12」→ 文件夹 `%USERPROFILE%\north-waterfront\Жилой дом 12` 存在，面板出现新 workspace，并在其中打开新会话。
3. 重复同一名称 → 对话框显示「Папка с таким именем уже существует。」
4. 在会话中请求 PDF 报告 → 文件位于项目文件夹，不在 `%TEMP%`；`%TEMP%` 中不再出现新的 `dsh-spill-*`（spill 现在在 `%USERPROFILE%\.dsh-north-waterfront\spill`）。
5. Documents 中旧的 `default-workspace` 照旧显示在面板中。
