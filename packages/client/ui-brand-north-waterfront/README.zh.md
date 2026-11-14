---
description: "north-waterfront 品牌占位：侧栏与新会话首屏；用于以 north-waterfront 身份而非官方 DeepSeek Harness 品牌组合的部署。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-north-waterfront

[English](README.md) | 中文

## 概述

本包为浏览器构建提供侧栏与空白会话首屏中的 north-waterfront 标识与名称。它在身份为 north-waterfront 的部署中替代 `dsh-client-ui-brand-official`：通过 patch overlay 挂载到浏览器 roster，并禁用官方品牌行。标识是文本徽标（`#1E88E5` 强调色块上的 NW 首字母缩写）而非图片画作，因此在浅色与深色表面上渲染一致，且不携带任何资产字节。它没有运行时状态，也不影响模型请求。

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

将以 north-waterfront 为品牌的部署把本插件挂入浏览器 roster，并在同一 overlay 中禁用官方品牌行，使品牌席位恰好由一组占位持有。与官方包不同，注册不受构建 profile 门控：挂载本行的部署就是 north-waterfront 部署。

```yaml
- id: ui-brand-official
  disabled: true
- insert:
    - id: ui-brand-north-waterfront
      name: '@deepseek-ai/dsh-client-ui-brand-north-waterfront'
```

浏览器标题默认取构建环境值（`DSH_CLIENT_TITLE`，由客户端打包器内联）；需要为标签页标题定品牌的部署可通过 `dsh-host-devbim-auth` 的 `indexTitle` 配置覆盖——它在每次 index 渲染时改写所服务的标题。favicon 与 web manifest 位于 `apps/web/public`。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

侧栏一对占位以 `sidebar.brand.mark` 声明之下的声明感知注册组安装，与官方及 devBIM 包完全一致；首屏标识是等待 `conversation.hero.brand.mark` 的第二个独立注册组，因此两个声明包可以各自来去而不会牵连另一席位的品牌。品牌文案归 locale 所有：本包注册 `ui-brand-north-waterfront` 词典，每个占位渲染框架注入的 `t` 席位，用户可见文本没有硬编码。浏览器半部是 [`src/client/index.ts`](src/client/index.ts)；node 半部是一个空 Loader 席位。徽标是纯样式化文本，本包不携带资产文件。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [ui-sidebar](../ui-sidebar/README.zh.md) — 声明 `sidebar.brand.mark` 与 `sidebar.brand.name` 并渲染其回退。
- [ui-conversation](../ui-conversation/README.zh.md) — 在首屏声明 `conversation.hero.brand.mark`。
- [ui-brand-devbim](../ui-brand-devbim/README.zh.md) — 同一席位的 devBIM 占位，使用位图画作而非文本徽标。

-----

<a id="model-experience"></a>
## Model Experience

无；本包仅贡献浏览器呈现，不触及任何模型请求。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **无位图或矢量画作** — 徽标是样式化文本；设计好的 NW 字形可在不动 slot 契约的前提下替换。
- **浏览器标题独立于 slot 系统** — 默认取构建时的 `DSH_CLIENT_TITLE`；`dsh-host-devbim-auth` 的 `indexTitle` 配置在服务时按部署覆盖。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景 — 点击展开</summary>

该品牌与 `dsh-host-devbim-auth` 中的可配置入口文案一道，为 north-waterfront.dev-bim.com 客户端站点而引入；强调色沿用该部署系列的 `#1E88E5` 蓝，徽标对两种主题渲染同一变体。

</details>

**运行时不变量：** 不发布 companion。本包不持有可变状态，三个 slot 占位通过两个事务性 effect 安装与撤离，另有一个词典注册 effect。
