---
description: "DevBIM 品牌占位：侧栏与新会话首屏；用于以 devBIM 身份而非官方 DeepSeek Harness 品牌组合的部署。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-devbim

[English](README.md) | 中文

## 概述

本包为浏览器构建提供侧栏与空白会话首屏中的 devBIM 标识与名称。它替代 `dsh-client-ui-brand-official`：通过 patch overlay 挂载到浏览器 roster，并禁用官方品牌行。dB 字标以两个 PNG 变体交付（浅色面用蓝 `#1E88E5`，深色面用白），由 CSS 依据外壳切换的主题属性择一显示。它没有运行时状态，也不影响模型请求。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [Model Experience](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

将以 devBIM 为品牌的部署把本插件挂入浏览器 roster，并在同一 overlay 中禁用官方品牌行，使品牌席位恰好由一组占位持有。与官方包不同，注册不受构建 profile 门控：挂载本行的部署就是 devBIM 部署。

```yaml
- id: ui-brand-official
  disabled: true
- insert:
    - id: ui-brand-devbim
      name: '@deepseek-ai/dsh-client-ui-brand-devbim'
```

浏览器标题仍是构建环境事务（`DSH_CLIENT_TITLE`，由客户端打包器内联）；favicon 与 web manifest 位于 `apps/web/public`。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

侧栏一对占位以 `sidebar.brand.mark` 声明之下的声明感知注册组安装，与官方包完全一致；首屏字标是等待 `conversation.hero.brand.mark` 的第二个独立注册组，因此两个声明包可以各自来去而不会牵连另一席位的品牌。浏览器半部是 [`src/client/index.ts`](src/client/index.ts)；node 半部是一个空 Loader 席位。字标画作以裁剪到字形边界的 base64 data URI 内嵌（[`src/client/artwork.ts`](src/client/artwork.ts)），本包不携带外部资产文件。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [ui-sidebar](../ui-sidebar/README.zh.md) — 声明 `sidebar.brand.mark` 与 `sidebar.brand.name` 并渲染其回退。
- [ui-conversation](../ui-conversation/README.zh.md) — 在首屏声明 `conversation.hero.brand.mark`。
- [ui-brand-official](../ui-brand-official/README.zh.md) — 本席位替代的 DeepSeek Harness 占位。

-----

<a id="model-experience"></a>
## Model Experience

无；本包仅贡献浏览器呈现，不触及任何模型请求。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **位图画作** — 字标是裁剪后的 PNG 而非矢量路径；两个主题变体共约 8 KB base64 随包分发。矢量描摹可在不动 slot 契约的前提下替换。
- **浏览器标题独立** — `DSH_CLIENT_TITLE` 在构建时选定标题文本，而非通过 UI slot。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景 — 点击展开</summary>

品牌素材来源为 devBIM branding 目录（`db_blue.png` / `db_white.png`）；字形裁剪边界为 500x500 原始画布中的 210x122。

</details>

**运行时不变量：** 不发布 companion。本包不持有可变状态，三个 slot 占位通过两个事务性 effect 安装与撤离。
