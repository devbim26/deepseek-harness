---
description: "通过 document_read 工具读取会话附件文档：每次调用一个经授权的有界文本窗口。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-document

[English](README.md) | 中文

## 概述

使用 `document_read` 读取用户附加到会话的文档文本。模型传入附件句柄行中的路径，得到一个带续读游标的有界窗口，因此长文档只需多次小读取，而不是一次巨大结果。请求的路径必须是本次 Session 的文件附件，受限部署无需 shell 和文件系统工具即可回答文档问题。目前支持 TXT 和 CSV；PDF、Word 和工作簿提取器是延期工作。

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
- name: '@deepseek-ai/dsh-tool-document'
  config:
    maxInputBytes: 52428800
    maxChars: 20000
    maxRows: 500
    timeoutMs: 30000
```

`path` 必须指明本次 Session 的一个文件附件——上传文件或工具结果文件——其他路径一律以 `NOT_AN_ATTACHMENT` 失败。TXT 和 CSV 按 UTF-8 解码，对旧式俄文文件回退 windows-1251，规范化行尾和空行后按字符窗口读取：`offset` 是窗口起点（默认 0），`limit` 限制窗口大小（默认值和上限都是 `maxChars`），结果中的 `nextOffset` 在还有剩余文本时指明下一个窗口。超过 `maxInputBytes` 的源文件以 `TOO_LARGE` 失败；超过 `timeoutMs` 的提取以 `TIMEOUT` 失败。每个边界都必须是正整数，否则在加载时明确报错。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxInputBytes` | `52428800` | 接受的最大源文档 |
| `maxChars` | `20000` | 单个返回窗口的字符数；`limit` 的上限 |
| `maxRows` | `500` | 单个返回窗口的工作表行数 |
| `timeoutMs` | `30000` | 每次调用的提取时限 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-document)是每个接受字段的详尽来源。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

`src/index.ts` 通过 `defineTool` 注册 `document_read`。执行路径要求存在 agent Session，把调用方的 signal 与 `timeoutMs` 期限竞速，授权路径，在 `maxInputBytes` 之内通过 `ctx.fs.readBytes` 读取字节，按扩展名分派，并把提取出的窗口连同 `nextOffset`、`nextPage` 或 `nextRow` 游标折叠为规范值。

`src/paths.ts` 从 Session 日志的 `user/message` 和 `tool/result` 事件收集每个 `file` 内容块，解析每个附件的存储宿主路径，只有请求与其中之一在文件系统的进程路径上一致时才接受。

`src/extract/` 按扩展名分派：`text.ts` 以 UTF-8 解码并回退 windows-1251，`normalize.ts` 折叠 CRLF、行尾空格和长空行。没有提取器的扩展名以 `UNSUPPORTED_FORMAT` 失败；page、sheet 和 row 请求字段及其结果字段已为延期提取器就位。`src/render.ts` 渲染 `<path>` 文件信封、元数据行、窗口文本和续读提示；`src/errors.ts` 承载稳定的失败码。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [dsh-attachment](../../attachment/attachment/README.zh.md) — 工具授权其存储文件路径的持久附件存储。
- [dsh-tool-office](../tool-office/README.zh.md) — 渲染、转换和重算已授权的 Office 文件。
- [dsh-tool-fs](../../fs/tool-fs/README.zh.md) — 读取非附件工作区文件的 `read` 与 `grep` 组合。

-----

<a id="model-experience"></a>
## 模型体验

### document_read

#### 模型看到什么

结果渲染为一个 `<path>` 文件信封，带一行元数据（格式、字节大小、窗口位置）、窗口文本，以及指明确切下一个 `offset`、`page` 或 `row` 参数的续读提示。失败以分类码到达：路径不在 Session 附件内为 `NOT_AN_ATTACHMENT`，无提取器的扩展名为 `UNSUPPORTED_FORMAT`，以及 `TOO_LARGE` 和 `TIMEOUT`。

#### Token 影响

每次调用追加一条工具结果，其文本受 `maxChars` 限制。

#### KV Cache 效应

续读游标把下一个窗口作为新的工具结果追加到对话末尾，因此读取长文档只增加后缀轮次，从不改写更早的结果。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **目前仅提取 TXT 和 CSV** — 工具 schema 已公告 PDF、DOCX、DOC、XLSX、XLS，但它们作为各自的实现任务落地；在此之前以 `UNSUPPORTED_FORMAT` 失败。
- **仅限附件路径** — 工具只读取附加到本次 Session 的文档，绝不读取任意工作区路径；工作区文件归 `read` 和 `grep`。
- **每次调用一个窗口** — 长文档始终需要后续调用；续读游标让每次读取保持有界。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

None.

</details>
