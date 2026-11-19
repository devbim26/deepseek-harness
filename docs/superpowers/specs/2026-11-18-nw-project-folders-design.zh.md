# 设计：NW 客户端网站项目——项目文件夹与移出 Temp 的 spill

[English](2026-11-18-nw-project-folders-design.md) | 中文

日期：2026-11-18。状态：已获用户批准；2026-11-18 修订（计划阶段）：按调研结果明确了按钮启用判定的机制——以 baseline follow-feed 中的 `projectBase` 字段取代「命名空间缺失」方案（客户端会从生成的 artifact 挂载全部命名空间，与宿主无关，因此命名空间缺失无法充当信号），且 `createProject` 动词位于既有的 `workspace` 命名空间上。

## 背景与目标

客户端生产环境 `north-waterfront.dev-bim.com`（overlay `packages/bundle/web-app/client-north-waterfront.patch.yml`，启动器 `dsh-web-north-waterfront.cmd`）的现状是：用户产物散落在各服务目录里，客户端用户没有「自己的文件夹」：

- 超过 12 500 token 的 `mcp__drawing5__*` 结果（主要是 `get_sheet_images`）由 spill-policy 落盘到 `%TEMP%\dsh-spill-<6>\session-<12>\…`（`packages/spill/spill-local/src/store.ts:36-39`）；模型在 notice 中看到该路径并可能展示给用户。这是带 30 天清理的上下文恢复内部缓存，不是交付路径。
- PDF 报告（`tool-pdf`）写入会话 cwd——但 NW 服务器上的 cwd 是所有客户端用户共用的 first-use workspace `<Documents>/deepseek-harness/default-workspace`（`packages/api/workspace-controller/src/default-directory.ts:77`）。
- 启动器创建了 `%USERPROFILE%\north-waterfront`，但没有任何代码读取 `WORKSPACE` 环境变量——文件夹是死的。客户端站点上的 `directory-picker` 已禁用：客户端用户既不能选择也不能创建文件夹。

目标是两项能力：

1. 所有用户内容都存放在 NW 基目录下的项目文件夹中：会话在各自项目里工作，文件（`pdf_report`、嵌套文件夹）写入其中；spill 仍是模型的内部缓存，但从 `%TEMP%` 移到 `DSH_HOME`，且模型不向用户展示 temp/缓存路径。
2. 客户端用户自行创建项目——通过项目面板中的「新建项目」按钮：名称 → 文件夹 `<基目录>/<名称>` → workspace → 在其中打开新会话。

## 头脑风暴的决策

- 方案 A——「项目工厂」：在 `workspace-controller` 中新增一个窄 seam + `ui-workspace` 中的按钮 + overlay 接线。已选中：同时解决两个任务，不扩大受信面，适用于任何部署。
- 方案 B——给 `directory-picker-browse` 增加 confinement（`root`）并在 NW 上重新启用 picker——已否决：picker 为受信用户设计（从盘符根开始的面包屑、宿主文件系统的完整浏览），扩大它的面比新增一个窄动词更危险；UX 是浏览文件夹而非「按名称建项目」。
- 方案 C——仅 overlay（`documentsDirectory` = 基目录）——已否决：得到的路径是 `<基目录>/deepseek-harness/default-workspace`，而且完全无法创建项目。
- 项目空间是共享的：站点按单一密码登录，没有 per-user identity（不在范围内）。
- 基目录为 `%USERPROFILE%\north-waterfront`，可由 `.env.north-waterfront` 的 `NW_PROJECTS_DIR` 覆盖。
- 创建的交互是项目面板中的按钮加名称输入（不是在新会话时选择，也不是两者并存）。
- 用户产物只是项目文件夹中的文件；工具的大型文本结果不保存为项目文件（spill 仍是缓存）。
- 创建动词是 `WorkspaceController` 上的 `@Remote('createProject')`（`workspace` 命名空间）：独立子控制器在计划阶段已否决——`workspaceProjects` 命名空间同样会从同一生成 artifact 挂载到客户端而与宿主无关，「命名空间缺失」依旧无法充当信号，而独立控制器需要手工修改 remotes 组装且没有其他收益。

## 架构：组件

### 1. 宿主：`@deepseek-ai/dsh-api-workspace-controller`

配置（既有 `Config` schema）：

| 字段 | 约束 |
|---|---|
| `projectBase` | 绝对的完全限定路径；按 `documentsDirectory` 的方式校验（`validateDocumentsDirectory`）。与 `documentsDirectory` 互斥：两者同时设置 → 加载时报错（misconfiguration fails loud） |

`WorkspaceController` 上的 `createProject` 动词（`workspace` 命名空间）：

- `create({ name })` → 校验名称 → `mkdir(join(projectBase, name), { recursive: true })`（基目录在首次使用时创建）→ 通过既有 `commands.create` 注册 Workspace（标题 = 最后一个目录段 = 名称）→ 投影 `WorkspaceCreateValue`。
- 未设置 `projectBase` 时，该动词以 `workspace/project-unavailable` 拒绝（调用时刻的 misconfiguration fails loud——加载时无法与「有意不配置」区分）。

给客户端的能力信号是 follow-feed 中的一个字段：baseline 帧 `WorkspaceBaseline` 获得 `projectBase: string | null`（null = 能力关闭）。沿用既有的 workspace 投影通道；旧读取方忽略未知字段，新读取方容忍缺失——安全的 same-version 扩展。

`initializeDefault`：设置了 `projectBase` 时，first-use 默认 workspace 目录 = `join(projectBase, DEFAULT_WORKSPACE_DIRECTORY)`，取代 Documents 分支。注册表仍不迁移已创建的默认 workspace——既有安装的行为不变。

### 2. 项目名称校验

仿照 `createDirectoryRequestSchema` 的 Zod-refine，外加 Windows 特例。以下是不变量，不是可配置项：

- trim 后：非空、1–64 个字符；允许 Unicode（「Жилой дом 12」合法）；
- 禁止 `/ \ < > : " | ? *`、控制字符、`.` 和 `..`、首尾的点或空格（Windows 会静默裁掉它们）；
- 禁止大小写不敏感的保留设备名：`CON`、`PRN`、`AUX`、`NUL`、`COM1`–`COM9`、`LPT1`–`LPT9`；
- 已存在目录 `<基目录>/<名称>` 或同路径的 workspace → 以 `exists` 拒绝。

线上错误码（`workspace/project-*` 家族）：`workspace/project-name-invalid`、`workspace/project-exists`、`workspace/project-create-failed`、`workspace/project-unavailable`。

### 3. 客户端：`@deepseek-ai/dsh-client-ui-workspace`

- workspace 浏览器 `headerActions` 中的「新建项目」按钮（`rows/WorkspaceBrowser.tsx`）；仅当 follow-feed 送来 `projectBase !== null` 时渲染。
- 对话框仿照 `rows/WorkspaceDialogs.tsx` 的 rename：名称输入框（带示例 placeholder），Enter 创建、Esc 取消；输入框下方按 RemoteError code 显示本地化错误（`project-name-invalid` / `project-exists` / 兜底消息）。
- 成功：workspace 由 follow-feed 到达，复用既有动作 `startSession(workspaceId, { clearPreviousDraft: false })`——创建并打开会话。
- 文案覆盖 `locales.ts` 全部 8 种语言（zh 为 key 来源，其余 `satisfies`），英文 sentence case，入口经 `dsh-client-ui-ux`。

### 4. NW overlay 与启动器

`client-north-waterfront.patch.yml`：

- same-id override `workspace-controller`（目标为 `web-app/cordis.patch.yml:158` 行）：`projectBase: !!js process.env.NW_PROJECTS_DIR ?? (process.env.USERPROFILE ?? process.env.HOME) + '/north-waterfront'`（`!!js` 上下文中没有 `join`/`homedir`；`process.env` 与字符串拼接是该 overlay 的既有模式）；
- same-id override `spill-local`（目标为 `base/cordis.patch.yml:421` 行）：`root: !!js dshHomePath('spill')`——spill 文件落在 `<DSH_HOME>\spill`，30 天清理（`cleanupPeriodDays`）保持不变；
- 在 `preset-standard` persona 与 `agent-preset-custom` 的 `instructionsPrefix` 中各加一句：绝不向用户展示缓存、temp 与附件存储路径；用户文件只在项目文件夹中；交付文件 = 在工作文件夹中创建并调用 `present`。

启动器 `dsh-web-north-waterfront.cmd`：`NW_PROJECTS_DIR`（默认 `%USERPROFILE%\north-waterfront`，在加载 `.env.north-waterfront` 之前设置，以便该文件可以覆盖；基目录的 mkdir 保留）；移除无人读取的 `WORKSPACE` 环境变量。

## 边界情形与错误处理

- 基目录不存在——在首个项目或 first-use 默认时由 `recursive` mkdir 创建。
- 基目录不可写 / mkdir 失败——`workspace/project-create-failed` 附带原因；没有任何静默行为。
- 两个同名创建的竞态以幂等方式解决：`commands.create` 对路径的语义是「create or resolve」，两次调用返回同一个 workspace。预先存在的文件夹在 mkdir 前的检查中发现并以 `exists` 码拒绝。
- Documents 中既有的生产 `default-workspace` 仍是已注册的 workspace：文件在原位，面板照常显示。没有自动迁移；部署后操作者可在 UI 中改名或手动迁移。
- 未显式指定 workspaceId 的会话继续进入默认 workspace（`defaultCwd` 语义不变）——在新部署中它将位于基目录之下。

## 安全

- 客户端用户不能浏览宿主文件系统：新动词只在固定基目录下创建一个目录段，traversal 已被校验排除。
- `projectBase` 不扩大沙箱权限：`workspace-write` 本就限制在会话 cwd 内，每个 workspace 的 cwd 是它自己的文件夹。
- 名称是来自用户的类型化配置值（与站点表单的其他值一样），不是自由路径。

## 测试与文档

- `workspace-controller`：名称校验矩阵（西里尔字母、reserved、`..`、首尾点/空格、控制字符、长度）、`createProject` happy path、`exists` 冲突、`create-failed`、无配置时的 `unavailable`、`projectBase` 下的 `initializeDefault`、双配置同时设置的拒绝、feed baseline 中的 `projectBase` 字段——在 100% 按文件覆盖下。
- `ui-workspace`：`projectBase === null` 时隐藏按钮、错误码到文案的映射、成功后在新建 workspace 中 `startSession`；全部 8 种语言（`verify-client-ui-i18n`）。
- 文档：`workspace-controller` 的 README（含 README.zh.md 与 i18n 记录）、`docs/config-catalog.md`（`gen-config-catalog` 生成物）、overlay 注释；`pnpm run doc-sync`。
- 快照：keyless 套件不覆盖 NW overlay 与 persona（已核对：`snapshots/` 中没有任何 north-waterfront 场景）——不需要新快照；persona 文案只在 overlay 内部修改，不进入 shipped profile。
- SDK 不变：`SessionEventMap`、agent loop 与会话事件均未触及。

## 范围之外

- Per-user identity 与个人项目空间。
- 既有 `default-workspace` 到基目录的自动迁移。
- 将附件图片作为单独文件导出到项目（PDF 已内嵌它们；需要时另立任务）。
- 将工具的大型文本结果保存为项目文件。
