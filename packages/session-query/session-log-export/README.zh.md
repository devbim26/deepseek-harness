---
description: "Web 会话日志 ZIP 导出、Markdown 复制与交互式 PDF 报告：Host 路由、/export 与 /report 命令及 Session Header 操作。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-log-export

[English](README.md) | 中文

## 概述

`dsh-session-log-export` 让 Web 界面导出会话的完整历史。Session Header 的更多操作菜单提供 `复制会话为 Markdown`、`下载 Session 日志` 与 `下载 PDF 报告`；`/export` 与 `/report` 斜杠命令分别启动 ZIP 下载与 PDF 报告。ZIP 包含会话本身、其子会话与附件；PDF 报告把当前会话的消息、表格与图像渲染到会话工作目录并下载。本包拥有经过认证的 Host 路由、Markdown 记录格式化器、报告转换器以及浏览器控件和反馈。下载目标位置由浏览器选择，剪贴板由浏览器持有。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当 Web bundle 需要让用户导出会话日志时使用本包。它需要 Connection、命令注册表、Session 查询与持久化以及附件服务；PDF 报告还需要程序化报告服务（`@deepseek-ai/dsh-tool-pdf/runtime`）与一个活动会话。挂载插件，然后在 Session Header 的更多操作菜单中选择 `复制会话为 Markdown`、`下载 Session 日志` 或 `下载 PDF 报告`，或输入 `/export` 与 `/report`；浏览器会复制记录、下载 `dsh-session-<id>.zip` 或下载 `dsh-session-<id>-report.pdf`。

### 复制会话为 Markdown

`复制会话为 Markdown` 会把选中的完整 Session 复制为可移植 Markdown，包括客户端尚未加载的历史。记录以最新的日志标题开头。人类用户消息按时间顺序作为引用块，最终的 assistant 回复保持普通 Markdown，每轮中较早的 assistant 说明与工具活动折叠到该轮最终回复之前的 `<details>` 区段。若一轮中最后一条已提交 assistant 消息带有工具调用，该轮没有最终回复，全部活动保持折叠。未完成的一轮渲染其已提交的消息。仅导出 append 消息事件。未完成的 assistant 代码围栏会在消息边界闭合，四空格或制表符缩进的代码保留缩进。

格式化器读取已提交的原始日志，因此压缩产生的表层替换不会移除较早消息，fork 继承的历史只出现一次。标题与正文来自同一个 `readSession` 快照。持久化元数据报告选中的已物化产物时，记录会在标题后添加一个 `Session file:` 围栏文本块，包含该精确路径；没有时省略该块。只复制选中的 Session 及其继承前缀；子会话日志仍只由 ZIP 导出。推理块、system 与 developer 消息、source kind 不是 `user` 的注入用户角色上下文、请求头与上下文以及运行时记录都会被省略。图片与文件变成可读标签；附件字节与认证链接不会进入记录。`Assistant`、`Tool` 和附件占位符等结构性标签有意使用英文；原始消息文本保持不变。文本以恰好一个换行结尾。

剪贴板是浏览器范围的唯一目标，因此本插件实例一次只运行一项复制。在支持 `ClipboardItem` 与 `navigator.clipboard.write` 的宿主上，控制器会在点击时请求延迟的 `ClipboardItem` 写入，同时加载文档相对的 `api/session.markdown?sessionId=<id>` 路由；其他宿主在准备完成后回退到共享剪贴板助手。复制进行中到达的请求会加入该操作，并保留第一次点击的 Session。所有 Session Header 菜单在复制操作结束前禁用各自的复制行；无关操作保持可用。成功、准备失败或剪贴板失败通过根 overlay 浮层反馈。释放会中止读取，并阻止后续文本进入由 Promise 提供的 Blob；操作系统已经接受的剪贴板写入无法回滚。

挂载 `ui-message-feedback` 时，同一菜单还提供“反馈”，打开已有的 Session 反馈弹窗。打开或关闭该弹窗不会导出 Session 或提交反馈。反馈入口随反馈插件的可用状态显示；两个导出操作保持独立可用。[`ui-open-in-app`](../../client/ui-open-in-app/README.zh.md) 在下载之后、反馈之前的独立分隔组中贡献应用子菜单。

### 下载 PDF 报告

`下载 PDF 报告` 把当前活动会话渲染成一份 PDF，并交给浏览器下载。该报告是对会话已有内容的确定性呈现：人类用户消息、每一轮最终的助手回复，以及会话自身工具结果产生的图像。推理、system 与 developer 消息、注入上下文、工具输出文本和中间助手消息都不包含在内。

回复中的 Markdown 会被转换成报告块：标题与段落变成文本，管道表格变成带样式的表格，围栏代码变成按书写原样打印每一行的代码块，列表保留原始文本。Markdown 图片链接保留替代文本；报告不会解析链接目标，也不会经由它下载任何内容。每条人类消息与每条最终回复都带有 `User` 或 `Assistant` 结构标题；以自身标题开头的回复保留该标题。像素来自会话已存为附件的图像，每个图像只嵌入一次，取自该调用最后一次已提交的结果。

报告以唯一文件名写入会话工作目录下的 `reportDirectory`，因此重复导出不会互相覆盖，文件在下载后仍留在工作目录。若有图像被跳过，报告以 `Images not included` 小节列出每个被跳过的调用与原因。

报告只读取活动会话。已关闭或已归档的会话没有可渲染的活动会话，因此请求会给出明确错误，而不是在后台启动 Agent。导出不会请求模型做任何总结，不会调用模型适配器，也不会把文件发布到报告面板。

### 何时选择

为需要面向用户的会话导出——复制可读的 Markdown 记录、下载 ZIP 归档或当前会话的 PDF 报告——的 Web 部署选择它，也适用于已经持有完整已提交逻辑事件快照并需要相同 Markdown 转换的后端调用方。仅需 Host 路径写入时避免使用：浏览器操作把结果留在浏览器中，转换工具不执行 IO。日志从持久化读句柄序列化而来，因此任何已挂载后端都受支持。

### 后端转换

包入口还导出 `formatSessionMarkdown(events, sourcePath?)`：面向已经持有完整已提交逻辑事件快照（按 seq 排序，包含任何继承前缀）的调用方的纯后端工具。它读取最新的 `session/title` 事件，返回以恰好一个换行结尾的 Markdown，不执行 IO、不启动插件或 Session，也不修改事件。可选的、由后端解析的 `sourcePath` 会原样写入标题后的动态围栏 `Session file:` 文本块；省略或空路径不添加该块。缺失或空白标题生成 `Untitled Session`。它只转换传入的事件；不读取子会话日志。

```ts
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { formatSessionMarkdown } from '@deepseek-ai/dsh-session-log-export'

export function convertTranscript(events: readonly SessionEvent[], sourcePath?: string): string {
  return formatSessionMarkdown(events, sourcePath)
}
```

### 组合

```yaml
- id: session-log-download
  name: '@deepseek-ai/dsh-session-log-export'
```

Web bundle 将本包与 Connection、`dsh-commands`、`dsh-client-ui-commands`、`dsh-client-ui-conversation`、`dsh-client-ui-context-menu` 和 `dsh-client-ui-layout` 一起挂载。conversation 包拥有 Header 入口，右键菜单服务渲染其共享菜单，layout 声明下载弹窗与复制反馈浮层使用的 `shell.overlay` 插槽。locale 与命令服务提供翻译文案和命令确认。PDF 报告还需要 Session 查询引擎和程序化报告服务：在本包旁边挂载 `@deepseek-ai/dsh-tool-pdf/runtime`。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `compressionLevel` | `6` | 每个 ZIP 条目的 DEFLATE 级别，范围为 0 到 9。 |
| `reportDirectory` | `reports` | 接收生成的 PDF 报告的会话相对目录。它必须留在会话工作目录内；绝对路径、形如 `C:reports` 的驱动器相对路径或 `..` 片段会在加载时失败。 |
| `maxReportChars` | `200000` | 一份 PDF 报告可携带的最大文本字符数。更大的会话会被拒绝，而不是被截断。 |

### 命令约定

| 输入 | 结果 |
|---|---|
| `/export` | 记录用户命令的生命周期；提交命令的浏览器下载文档相对的 `api/session.export?sessionId=<id>&includeDescendants=true`（Host 路由 `/api/session.export`） |
| `/export <path>` | 错误；浏览器下载通过浏览器的普通下载行为选择目标位置 |
| `/report` | 记录用户命令的生命周期；提交命令的浏览器下载文档相对的 `api/session.report.pdf?sessionId=<id>`（Host 路由 `/api/session.report.pdf`） |
| `/report <argument>` | 错误；报告渲染已记录的会话，不接受参数 |

### 预期行为

根级弹窗通过 ID 标识导出的 Session，并报告准备中、开始下载或失败。切换会话后弹窗仍然保留。不同 Session 可以并行下载，弹窗按发起顺序一次显示一个；关闭后显示下一个未关闭的弹窗。关闭不会取消下载，也不会在操作结束时重新打开弹窗。同一 Session 下载进行中的重复请求共用该操作并保留原位置；操作结束后的新请求取得新的位置。一个 Session 同时只运行一项文档操作：ZIP 下载进行中发起的 PDF 请求会加入该操作，而不会启动第二项。导出包含实时会话的最新事件：Host 端点在读取前会 flush 活动的根会话，因此斜杠命令触发的 ZIP 会包含启动下载的 `command/run` 与 `command/done` 事件对；非活动的持久化会话不需要 flush。每份逻辑日志在归档中使用当前 generation 的规范文件名（v0 为 `session.jsonl`，其他版本为 `session.vN.jsonl`），每个子会话目录下也遵循同一规则。图片使用 `media/<attachmentId>.<ext>`，通用文件使用 `files/<digest-prefix>/<digest>/<name>`。通用文件以有界分块读取并压缩，因此导出大型上传文件时不会把它完整缓冲进内存。

PDF 报告通过 Session 查询引擎读取活动会话的已提交日志一次，与 Markdown 复制使用同一次完整日志读取。请求先执行预检：缺失的 session id、没有活动 Agent 的会话、没有可报告内容的会话以及超过 `maxReportChars` 的会话都会在写入任何文件之前被拒绝。预检不写文件；报告每个请求只写入一次，文件名唯一。

附件收集读取内置 Session 事件声明的内容字段与已完成的 assistant 流块，包括扁平的 V4 tool 角色消息。未知事件载荷与无关字段在导出日志中保持不变，但不会触发附件读取。

### 失败

当 ZIP 流式传输开始前的预检失败时——例如 Host 端点不可达或配置错误——弹窗显示准备阶段错误。浏览器接受 GET 后发生的子会话或附件读取失败由浏览器下载管理器报告，不通过弹窗报告。Markdown 准备失败显示重试 Session 读取的浮层；剪贴板写入失败显示单独的检查剪贴板权限浮层。二者都不会为不完整或缺失的记录报告成功，也不会显示进行中的浮层。

PDF 报告给出经过清理的状态，而不是残缺文档：缺失的 session id 是错误请求，没有活动 Agent 的会话是冲突，没有可报告内容的会话是空报告，超过 `maxReportChars` 的会话过大，缺少 Session 查询引擎或报告服务则不可用。日志读取失败，与写入或读取文档时的失败一样，以不含宿主路径的服务端错误报告。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释本包如何接入导出控件，并指出实现它的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计拆分

本包分为两部分。Host 半包（[`src/index.ts`](src/index.ts)）注册 `/export` 与 `/report` 命令，并向 Connection 贡献精确的 `GET`/`HEAD /api/session.export`、`/api/session.markdown` 与 `/api/session.report.pdf` Fetch 路由；[`src/archive.ts`](src/archive.ts) 构建有界 ZIP 流，[`src/markdown.ts`](src/markdown.ts) 渲染 Markdown 记录，[`src/session-report.ts`](src/session-report.ts) 把已提交日志转换成报告块。浏览器半包（[`src/client/index.ts`](src/client/index.ts)）提供共享下载与 Markdown 复制控制器和 UI，并观察 `command/executed`，因此只有提交命令的浏览器会启动下载。

共享右键菜单包声明被捕获的 `sessionHeader` 目标，独立于会话行及标题右键操作；conversation 包拥有其 Header 入口。本包贡献导出及可选反馈行，观察控制器、可用性与语言源。下载弹窗和复制反馈浮层挂载在根 overlay 中，独立于 Header 生命周期。

### 下载流程

两条入口都会先向文档相对的 `api/session.export?...` 发出 `HEAD` 预检请求，然后把 GET 路由交给浏览器下载管理器，JavaScript 不缓冲 ZIP。一个控制器按会话持有一项进行中的下载，把并发操作折叠进该任务，并在插件释放时取消预检。根组件依据每次操作的发起顺序，从控制器按 Session 键控的快照中选择最早的未关闭条目，不维护独立弹窗队列。释放会等待所有预检结束，防止迟到响应启动浏览器保存；已经交给浏览器的下载仍由浏览器管理。

Host 路由是由该功能拥有的精确 Fetch 路由贡献。Connection 应用 Host/Origin 与浏览器会话检查并桥接流式 `Response`；本包拥有查询校验、活动会话 flush、基于句柄的日志读取与附件读取、ZIP 生成和 HTTP 状态语义。

### Markdown 复制流程

Header 向 Markdown 复制控制器请求被点击的 Session。点击期间，控制器在加载文档相对的 `api/session.markdown?sessionId=<id>` 路由的同时请求延迟的 `ClipboardItem` 写入；其他宿主在准备完成后回退到共享剪贴板助手。Host 路由通过 `ctx.sessionQuery.readSession` 读取完整的 live-preferred 逻辑日志，并把事件交给纯格式化器。它另外通过 `ctx.get('sessionPersistence')?.stat` 获取选中已物化产物的路径，并把可选路径传给格式化器；元数据读取失败属于经过清理的准备失败。该读取是分离的导出观察：不创建 Agent、不保留 Session，也不写入 Session 数据。Session 不存在时返回 404，其他读取失败返回经过清理的 500。

控制器持有一个进行中的操作和一个 `shell.overlay` 浮层条目。第二个 Header 请求加入该进行中的操作，因此剪贴板及其提示始终描述第一次点击的 Session。准备 promise 与已接受的剪贴板写入都会被观察，所有拒绝都被包含。释放会中止读取、阻止后续文本进入由 Promise 提供的 Blob、抑制提示，并等待已接受的剪贴板工作完成。

### PDF 报告流程

报告路由解析拥有目标会话的活动 Agent，并通过 `ctx.sessionQuery.readSession` 读取其已提交日志一次；它不进行同步的 Session 事件读取。[`src/transcript.ts`](src/transcript.ts) 保存两个导出共用的投影——轮次、消息以及每个工具调用的最新结果——因此 Markdown 记录与 PDF 报告描述同一份可见会话。[`src/session-report.ts`](src/session-report.ts) 中的转换选出人类消息、每一轮的最终回复以及携带图像的工具结果，并把回复中的 Markdown 转成报告块。

随后路由调用程序化报告服务（`ctx.pdfReports`），传入活动 Agent 作为文件所有者、报告标题、报告块，以及追加被跳过图像附录的请求。服务按会话工作目录解析路径，从持久附件库读取图像，写入文档，并报告哪些图像未能嵌入。路由读回已写入的文件并以附件形式返回。

`HEAD` 在预检后即结束：它解析 Agent、转换日志并检查大小，但不写文件，也不读取附件。`GET` 针对当前日志重复预检，并写入一次报告。两条入口都会向文档相对的 `api/session.report.pdf?...` 发出 `HEAD` 预检请求，然后把 GET 路由交给浏览器下载管理器，因此文档不会经过 JavaScript。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从 Web 控件逐步进入 Host 端点及相关的命令与会话接口。

- [dsh-client-connection](../../client/connection/README.zh.md)——Host 端点使用的认证 Fetch 路由载体。
- [命令子系统参考](../../../docs/subsystems/commands.zh.md)——`/export` 命令注册的用户命令注册表。
- [dsh-client-ui-commands](../../client/ui-commands/README.zh.md)——渲染并确认 `/export` 的浏览器命令界面。
- [会话查询包映射](../README.zh.md)——本包所属的检索包族。

-----

<a id="model-experience"></a>
## 模型体验

### 用户导出与复制控制

#### 模型看到什么

无。`/export` 与 `/report` 都留在用户命令平面，ZIP 下载与 PDF 报告都不会进入模型历史。Markdown 复制操作同样只属于人类：它读取已提交日志、写入浏览器剪贴板，且不追加 Session 事件。PDF 报告不会请求模型做任何总结：它渲染会话已经记录的消息与图像。

#### Token 影响

为零。这些命令不创建模型轮次，三个导出控件也不会改变请求。

#### KV Cache 影响

无。仅日志命令生命周期、浏览器下载与剪贴板写入不会改变派生请求前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明本包何时不合适，或何时需要特别的运维注意。它们是当前包约束，不是任务积压。

- **浏览器下载，而非 Host 路径写入**——目标位置由浏览器选择；不会返回 Host 路径或原生文件夹操作。
- **预检只报告流式传输前的失败**——浏览器接受 GET 后发生的子会话或附件读取失败由浏览器下载管理器报告，不通过弹窗报告。
- **Markdown 只包含已提交历史**——未稳定的实时 token 分块没有已提交文本，因此不会出现在复制的记录中。压缩与 fork 继承遵循原始日志，而非当前模型上下文。
- **Markdown 复制仅限选中的 Session**——子会话日志由 ZIP 下载导出，而不是 Markdown 复制。
- **PDF 报告需要活动会话**——已关闭或已归档的会话没有可渲染的活动 Agent，因此报告会被拒绝，而不是启动一个 Agent。导出没有活动会话的已存会话尚未实现。
- **PDF 报告不发布任何内容**——文件留在会话工作目录中，并通过浏览器下载交给用户。它不会被复制进报告面板，也不会发送到聊天，因为那些目标需要本导出从不收到的季度与房屋。
- **PDF 报告是呈现，不是总结**——报告复现记录下来的消息与图像。它不添加结论，其文字就是会话自己的文本。
- **记录文本缓冲在内存中**——完整的 Markdown 字符串及其 Blob 在剪贴板接受前都会保留。浏览器剪贴板限制可能拒绝大型导出；本包不增加字节上限，也不截断请求的完整记录。
- **已接受的剪贴板写入无法回滚**——释放会停止待处理的准备与反馈，但操作系统已经成功的写入会留在剪贴板中。
- **来源路径是观察到的元数据，不是原子日志声明**——`stat` 标识导出时选中的已物化产物。实时已提交事件可能领先于该文件，未物化的 Session 没有来源路径块。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：开放设计问题与尚未决定的探索方向。它明确不具权威性——已交付的行为、限制与既定理由以上文、包代码和相关页面为准。

#### 未来：浏览器之外的导出目标

下载刻意限定在浏览器范围；Host 路径或原生文件夹导出需要新的端点约定，并决定 ZIP 的落盘位置。

#### 未来：已存会话的 PDF 报告

报告读取活动会话，因为活动 Agent 拥有报告写入的工作目录。已存会话也可以改为解析其记录目录来渲染，代价是报告不再属于运行中的会话。

</details>
