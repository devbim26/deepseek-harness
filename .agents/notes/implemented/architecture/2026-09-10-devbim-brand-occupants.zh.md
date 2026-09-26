# Agent Note: devBIM 品牌占位 — 由 overlay 组合的替代品牌包

Status: implemented

[English](2026-09-10-devbim-brand-occupants.md) | 中文

## 问题

本检出以 devBIM 身份部署 Web 客户端，而非 DeepSeek 自有身份。外壳的品牌席位是通用 slot（`sidebar.brand.mark`、`sidebar.brand.name`、`conversation.hero.brand.mark`），其官方占位（`dsh-client-ui-brand-official`）仅在 `official` 构建 profile 下注册；没有替代品时，任何部署都显示外壳的鱼形回退。部署还需要自己的浏览器标题、favicon 与 web manifest —— 这些是 slot 系统之外的构建环境和 `apps/web/public` 事务。

## 决策

`dsh-client-ui-brand-devbim` 无条件占位三个品牌席位：侧栏一对以 `sidebar.brand.mark` 声明之下的声明感知注册组安装（与官方包一致的分组），首屏字标是等待 `conversation.hero.brand.mark` 的独立注册组 —— 两个席位的声明者不同，各自必须能在对方缺席时存活。dB 字标以两个裁剪后的 PNG data URI 交付（浅色面用 `#1E88E5`，深色面用白色，为 500x500 品牌素材画布中的 210x122），内嵌于 `src/client/artwork.ts`；模块样式表里的 CSS 依据 `body[data-ds-dark-theme]`（由 ui-theme 引导行切换）选择变体，React 树因此不感知主题。字标文字为样式化文本（`dev` 沿用周围标签色，`BIM` 用品牌蓝）。

部署组合不触碰已发布的 bundle 行：`packages/bundle/web-app/devbim.patch.yml` 禁用官方品牌行并插入 devBIM 行，启动器以 `dsh web --patch` 传入。overlay 放在 bundle 目录内，是因为 entry-local roster 解析从拥有该行的树解析行所属包 —— 即 bundle 自己的 `node_modules` 链接，而非仓库根目录。该包因此是 `dsh-web-app` 的依赖。客户端打包阶段设置 `DSH_CLIENT_TITLE=DevBIM`（同时内联进插件 bundle 的 define 与 Vite 文档标题），`apps/web/public/favicon.svg` 与 `manifest.webmanifest` 携带 devBIM 名称与字标。

## 备选方案

- **就地修改 `dsh-web-app` 的 `cordis.patch.yml` 行** —— 那是被跟踪的上游层；每次拉取都会与部署身份冲突。`--patch` overlay 在 profile 自有层之后应用，除一行依赖外不改动上游。
- **像官方包一样按 profile 门控注册** —— 门控的存在是让一个产物能渲染两种身份；本检出只有一个身份，门控将成为死配置。
- **三个席位共用一个嵌套注册组** —— 把首屏占位绑到侧栏声明上；没有侧栏的部署变体会静默丢失首屏品牌。

## 后果

部署的浏览器表面端到端呈现 devBIM：侧栏字标与文字、空白会话首屏、标签页标题、favicon 与安装清单。代价是需要随客户端目录再生成维护第二个品牌包（`gen-client-catalog` 自动纳入新占位），以及浏览器 bundle 中约 8 KB 的 base64 画作。位图画作限制了字标在大尺寸下的清晰度；日后可用矢量描摹替换 data URI 而不动 slot 契约。
