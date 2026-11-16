---
description: "Собирать PDF-отчёты из текстовых секций, таблиц и изображений результатов инструментов инструментом pdf_report, без shell и Python."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-pdf

[English](README.md) | 中文

## 摘要

Инструмент `pdf_report` записывает PDF-файл отчёта в рабочую директорию Session. Модель передаёт упорядоченные текстовые, табличные и графические блоки со ссылками на результаты предыдущих вызовов инструментов; инструмент читает изображения этих вызовов из журнала Session через долговременное хранилище вложений и встраивает их. Табличные блоки рендерят данные как оформленные таблицы: залитая шапка, зебра, ширины колонок подобраны по содержимому. Инструменту не нужны shell, Python и файловые инструменты, что подходит ограниченным развёртываниям вроде клиентских сайтов: модель собирает отчёт из уже созданного и передаёт файл через `present`.

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

`file_path` 通过 Session 工作目录解析，且必须以 `.pdf` 结尾。工具在解析出的本地路径上通过宿主文件系统写入编码后的文档，因此需要本地文件系统后端；受限部署通过 `write` 工具使用的同一个 `fs/write-intent` 策略槽位授予写入。`blocks` 按顺序渲染：`text` 块打印可选标题和正文，`table` 块根据 `header` 和 `rows` 绘制带样式的表格（短行补空单元格，换页后重复表头），`image` 块嵌入其 `call_id` 结果携带的每一张图片（按结果顺序），并在每张图片下方打印可选说明。图片来自附件存储，因此产生图片的调用可以是 MCP 工具、其他代理工具或上传；不支持的媒体类型、超大图片和未知 call id 会在 `imagesSkipped` 中逐图报告，而不会导致整个调用失败。写入完成后调用 `present`，宿主才会显示交付卡片。

内置的 Noto Sans 字体（SIL Open Font License，见 `assets/fonts/LICENSE`）覆盖拉丁、希腊和西里尔文字。`maxImages` 限制嵌入数量，`maxImageBytes` 限制单张存储图片大小；两者不是正整数时在加载时明确报错。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

`src/index.ts` 通过 `defineTool` 注册 `pdf_report`。执行路径先用 Session 工作目录通过 `ctx.fs.resolve` 解析输出，从 `fs/write-intent` 瀑布取策略意图，组装文档，在 `ctx.fs.processPath(target)` 解析出的本地路径上通过宿主文件系统写入字节，并用携带写入后版本的 `fs/observed` 记录变更。写入前的 `stat` 区分创建与覆盖并拒绝非普通文件目标；`createIfAbsent` 意图会拒绝已存在的文件。

`src/session-images.ts` 把 `session.snapshotEvents()` 折叠为每个请求 call id 的最新 `tool/result`，收集其中的 `image` 内容块，并通过 `ctx.attachments.readImage` 读取。缺失附件服务、缺失调用结果、不支持的媒体类型、大小或数量上限违规、空图片列表各自成为一条逐图跳过记录，因此一张坏图片不会毁掉整个报告。

`src/pdf.ts` 是纯组装器：A4 页面、48pt 页边距、内嵌子集化的 Noto Sans 字体、按宽度测量折行（超长词按字符硬断）、表格（列宽按内容权重、单元格折行、换页后重复表头）、按宽度适配的图片和说明。当某一行、图片或预留间距越过下边距时换页。

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

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅本地文件系统后端** — 字节写入通过宿主文件系统落在解析出的本地路径上；远程文件系统后端需要先在 `FileSystem` 服务上增加二进制写入。
- **仅嵌入 PNG 和 JPEG** — WebP、GIF 及其他存储媒体类型会带着原因被跳过，而不是转码。
- **固定 A4 纵向版式** — 暂无横向、页码、页眉/页脚；版式集中在一个纯模块中便于后续扩展。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

字体缓存的存活期是整个进程；`buildPdfReport` 以 `subset: true` 逐文档嵌入，因此重复调用复用已解码的字体字节，不会重复读取文件。`scripts/gen-tool-catalog.ts` 用打桩的文件系统和附件存储引导本包来收集 schema。

</details>
