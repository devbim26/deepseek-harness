---
description: "用 pdf_report 工具或程序化运行时，从文本节、表格和工具结果图片组装 PDF 报告文件，无需 shell 和 Python。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-pdf

[English](README.md) | 中文

## 概述

使用 `pdf_report` 把 PDF 报告文件写入 Session 工作目录。模型传入有序的文本块、表格块和引用先前工具调用的图片块；工具通过持久附件存储从 Session 日志读取这些图片并嵌入。表格渲染为带填充表头行、斑马纹行和按内容适配的列宽的表格。无需 shell、Python 和文件系统工具；模型通过 `present` 交付文件。

程序化入口 `@deepseek-ai/dsh-tool-pdf/runtime` 把同一个写入器作为服务提供，不注册任何工具。

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

把插件挂载到文件系统服务和附件存储旁边：

```yaml
- name: '@deepseek-ai/dsh-tool-pdf'
  config:
    maxImages: 50
    maxImageBytes: 20971520
```

`file_path` 通过 Session 工作目录解析，且必须以 `.pdf` 结尾；`reports/` 等嵌套文件夹会在写入时创建。工具在解析出的本地路径上通过宿主文件系统写入编码后的文档，因此需要本地文件系统后端；受限部署通过 `write` 工具使用的同一个 `fs/write-intent` 策略槽位授予写入。`blocks` 按顺序渲染：`text` 块打印可选标题和正文，`table` 块根据 `header` 和 `rows` 绘制带样式的表格（短行补空单元格，换页后重复表头），`image` 块嵌入其 `call_id` 结果携带的每一张图片（按结果顺序），并在每张图片下方打印可选说明。图片来自附件存储，因此产生图片的调用可以是 MCP 工具、其他代理工具或上传；不支持的媒体类型、超大图片和未知 call id 会在 `imagesSkipped` 中逐图报告，而不会导致整个调用失败，同时 `availableImageCalls` 会列出结果携带图片的每一个会话调用，模型据此重试错误的 id 而无需猜测。写入完成后调用 `present`，宿主才会显示交付卡片。

`text` 块的正文接受一小部分 Markdown：`#`、`##`、`###` 开启标题；以 `- `、`* `、`+ ` 或数字开头的行是列表项；管道符行（带或不带 `---` 分隔行）组成表格，其打印效果与 `table` 块相同；`**文本**` 以粗体打印；`==文本==` 打印在黄色底带上。每个非空行自成一个段落，空行分隔两个段落。行内标记不能嵌套，斜体和链接按原样打印，行内无法转义管道符。报告标题、块标题和表格单元格打印时去掉行内标记；带有该标记的表格单元格整格使用黄色底带。工具描述要求模型少量标记关键事实、数字和结论。

内置的 Noto Sans 字体（SIL Open Font License，见 `assets/fonts/LICENSE`）覆盖拉丁、希腊和西里尔文字。`maxImages` 限制嵌入数量，`maxImageBytes` 限制单张存储图片大小；两者不是正整数时在加载时明确报错。

### 程序化运行时

当宿主需要在没有模型参与的情况下写出报告时，挂载 `@deepseek-ai/dsh-tool-pdf/runtime`：

```yaml
- id: tool-pdf-runtime
  name: '@deepseek-ai/dsh-tool-pdf/runtime'
  config:
    maxImages: 50
    maxImageBytes: 20971520
```

运行时入口提供 `ctx.pdfReports` 并且不注册任何工具，因此不会给模型的工具 schema 增加内容，也不消耗 token。它接受与工具相同的限制，其写入器接收活动的所属 Agent、相对 Session 工作目录的输出路径、标题、有序块，以及拥有该写入的策略 actor。

请求可以要求附加被跳过图像的附录：写入器随后追加一节，列出每一张未能嵌入的请求图像及其原因。没有该请求时，文档只包含请求的块。

程序化调用方还可以使用 `code` 块：`{ type: 'code', text }` 用正文字面按书写的样子打印每一行，保留行首缩进，并且不从中读取任何 Markdown。`pdf_report` 工具 schema 不提供该块，因此模型无法传入。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

`src/index.ts` 通过 `defineTool` 注册 `pdf_report`。执行路径先用 Session 工作目录通过 `ctx.fs.resolve` 解析输出，从 `fs/write-intent` 瀑布取策略意图，组装文档，在 `ctx.fs.processPath(target)` 解析出的本地路径上通过宿主文件系统写入字节，并用携带写入后版本的 `fs/observed` 记录变更。写入前的 `stat` 区分创建与覆盖并拒绝非普通文件目标；`createIfAbsent` 意图会拒绝已存在的文件。

`src/session-images.ts` 把 `session.snapshotEvents()` 折叠为每个请求 call id 的最新 `tool/result`，收集其中的 `image` 内容块，并通过 `ctx.attachments.readImage` 读取。缺失附件服务、缺失调用结果、不支持的媒体类型、大小或数量上限违规、空图片列表各自成为一条逐图跳过记录，因此一张坏图片不会毁掉整个报告。

`src/markdown.ts` 把文本块解析为标题、列表项、管道表格和段落，并把每一行拆成粗体、高亮和普通片段。`src/pdf.ts` 按片段折行，使同一行可以混用两种字面；它在文字之前先在 `==…==` 片段下方绘制黄色底带，并把列表标记留在页边、正文悬挂缩进。

`src/pdf.ts` 是纯组装器：A4 页面、48pt 页边距、内嵌子集化的 Noto Sans 字体、按宽度测量折行（超长词按字符硬断）、表格（列宽按内容权重、单元格折行、换页后重复表头）、按宽度适配的图片和说明。当某一行、图片或预留间距越过下边距时换页。

`src/service.ts` 保存两个入口共用的写入器。`src/config.ts` 保存它们校验的组装限制。`src/runtime.ts` 是程序化入口：它把写入器挂载为 `ctx.pdfReports`，既不引入工具定义，也不引入工具注册表。被跳过图像的附录是写入请求上的一个字段，因此只有调用方要求时写入器才追加该节。`src/code.ts` 把代码块的各行拆成保留缩进的普通单词。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [dsh-tool-present](../../deliverables/tool-present/README.zh.md) — 与本工具输出配套的交付声明。
- [dsh-attachment](../../attachment/attachment/README.zh.md) — 工具读取的持久图片存储。
- [客户端部署 overlay](../../bundle/web-app/README.zh.md) — 以受限工具集挂载本工具的组合。

-----

<a id="model-experience"></a>
## 模型体验

### pdf_report

#### 模型看到什么

结果渲染为一个 `<path>` 信封，写明文件、页数、图片数，以及每张被跳过图片及原因的一行；call id 有误时模型会修正请求并重试。调用卡片显示目标路径和块数。

#### Token 影响

每次调用追加一条工具结果。

#### KV Cache 效应

渲染大小由跳过列表长度决定，而跳过列表受图片上限约束。

### 程序化运行时

#### 模型看到什么

无。运行时入口不注册工具，因此不会给模型请求增加 schema，也不会给对话增加 token。

#### Token 影响

为零。通过运行时写出的报告不产生模型请求，也不消耗 token。

#### KV Cache 效应

无。运行时既不改变派生请求前缀，也不改变 Session 历史。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅本地文件系统后端** — 字节写入通过宿主文件系统落在解析出的本地路径上；远程文件系统后端需要先在 `FileSystem` 服务上增加二进制写入。
- **仅嵌入 PNG 和 JPEG** — WebP、GIF 及其他存储媒体类型会带着原因被跳过，而不是转码。
- **固定 A4 纵向版式** — 暂无横向、页码、页眉/页脚；版式集中在一个纯模块中便于后续扩展。
- **行内标记不嵌套** — 斜体、链接以及另一个标记内部的标记按原样打印；文本块子集没有表格行内管道符的转义，也没有代码围栏，因此反引号围栏之间的行与其他行一样接受该子集。
- **运行时需要活动的所属 Agent** — 写入器按所属 Agent 的 Session 工作目录解析输出，因此没有活动 Agent 的宿主没有可写入的目录。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

字体缓存的存活期是整个进程；`buildPdfReport` 以 `subset: true` 逐文档嵌入，因此重复调用复用已解码的字体字节，不会重复读取文件。`scripts/gen-tool-catalog.ts` 用打桩的文件系统和附件存储引导本包来收集 schema。

</details>
