---
description: "Host Office 渲染、转换、PDF 报告组装以及面向模型的 Office 工具的包索引。"
kind: "package-group"
---

# document/ — Office 文档

[English](README.md) | 中文

## 摘要

在宿主上为预览和模型的 Office 工具渲染、转换已授权的 Office 文件并重算工作簿。共享服务运行 LibreOffice kit。声明了原生引擎的目标使用原生引擎，其余目标使用 Node WASM。除 Office 工具外，本系列在没有 shell 和 Python 的情况下用模型输出组装 PDF 报告。

## 目录

- [包](#packages)
- [文档处理](#working-with-documents)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

每个包负责自身配置和生命周期规则；子系统参考描述共享转换操作。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [office-kit](office-kit/README.zh.md) | 将已授权 Office 字节转换为完整 PDF、PNG 图片、转换后的文件和重算后的工作簿，并提供有界队列和缓存；提供方自行解析 Kit 入口、引擎清单和 ASAR 解包后的引擎路径 | `ctx.officeKit` |
| [tool-office](tool-office/README.zh.md) | 加载 Office 技能后声明的 `office_render`、`office_convert` 和 `office_recalculate`：在工具结果中把页面渲染为图片、转换文档、重算工作簿 | — |
| [tool-pdf](tool-pdf/README.zh.md) | `pdf_report` 用有序的文本、表格和工具结果图片块组装 PDF 报告，并写入 Session 工作目录 | — |

-----

<a id="working-with-documents"></a>
## 文档处理

本系列负责宿主侧的文档处理。交付属于 [deliverables 组](../deliverables/README.zh.md)：模型用 `present` 声明写出的文件，Web 客户端在轮次末尾渲染交付卡片。

- **PDF 报告：** `pdf_report` 接收有序的文本、表格和图片块，把 PDF 写入 Session 工作目录。表格数据请用带 `header` 和 `rows` 的 `table` 块传递；工具会绘制带样式的表格，包括填充的表头行、斑马纹行，以及换页后重复的表头，而不是纯文本行。它不需要 shell、Python 和文件系统工具，适合受限部署。用它把模型已生成的文本和数据组装成新报告；对于已有的 Office 文件，请使用下文的 Office 工具。
- **已有的 Office 文档：** 加载 [Office 技能](../skill/skill-office/README.zh.md) 后，[Office 工具](tool-office/README.zh.md)才会激活。`office_convert` 接受 Word、Excel 和 PowerPoint 文档，Word 可导出 pdf、docx、odt 或 txt，Excel 可导出 pdf、xlsx、ods 或 csv，PowerPoint 可导出 pdf、pptx 或 odp。`office_recalculate` 重算 xls、xlsx、ods 工作簿的公式，`office_render` 把页面、幻灯片和工作表区域作为图片返回。转换后的文件落在 Harness home 下 Office kit 的私有输出目录，模型用 shell 把它复制到目标位置。
- **模型自己撰写的文档或工作簿：** 本系列不根据文本或数据写出这类文件。文件来自模型运行的脚本，或来自向工作区写入的外部服务。

-----

<a id="related-documentation"></a>
## 相关文档

消费者负责源文件授权与展示。

- [文档转换](../../docs/subsystems/office-kit.zh.md) — 共享操作和生成的服务参考。
- [交付子系统](../../docs/subsystems/deliverables.zh.md) — 交付文件事件与轮次汇总服务。
- [dsh-tool-present](../deliverables/tool-present/README.zh.md) — 把写出的文件交给用户的交付声明。
- [独立 kit 所有权](../../.agents/notes/implemented/architecture/2026-09-14-independent-libreoffice-kit.zh.md) — 引擎分发与应用集成。
- [工作区文件](../api/workspace-files/README.zh.md) — 已授权的有界源文件读取。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
