# Agent Note: north-waterfront NW 客户端品牌

Status: implemented

[English](2026-11-13-north-waterfront-nw-brand.md) | 中文

## 问题

公开客户端站点 `north-waterfront.dev-bim.com` 与内部 devBIM 部署（`devbim.dev-bim.com`）通过各自的部署 patch 运行同一个 web bundle，而在此之前这个 bundle 里的每个品牌表面都是固定的：`ui-brand-devbim` 渲染 devBIM 侧栏与空白会话首屏，`dsh-host-devbim-auth` 密码页硬编码 devBIM 标题和字标，标签页标题与 favicon 来自共享的构建默认值。从这个 bundle 服务"Северный берег"图纸客户，客户端站点会显示 devBIM 身份；把共享表面改指 NW，又会抹掉内部站点的身份。

## 决策

**客户端站点通过专门的姊妹包 `@deepseek-ai/dsh-client-ui-brand-north-waterfront` 完成品牌化，密码门禁保持为共享的 `@deepseek-ai/dsh-host-devbim-auth` 加新的标题 config 字段，其余部署身份放在启动器环境里。** 这把 devBIM 公网隧道 + 密码门禁决策（`.agents/notes/implemented/architecture/2026-11-05-devbim-public-tunnel-and-password-gate.md`）扩展到同一门禁的第二个部署。

品牌包以声明感知注册组把 NW 占位填进通用浏览器品牌 slot（`sidebar.brand.mark`、`sidebar.brand.name`、`conversation.hero.brand.mark`）。`client-north-waterfront.patch.yml` 禁用 `ui-brand-official` 并插入 NW 行；`devbim.patch.yml` 继续插入 `ui-brand-devbim`，内部站点保持 devBIM 身份不变。

密码门禁保持一个包。`dsh-host-devbim-auth` 增加 config 字段 `entryTitle`（默认 `devBIM — вход`）、`wordmarkLead`（默认 `dev`）、`wordmarkAccent`（默认 `BIM`），渲染时全部做 HTML 转义；NW patch 传入 `entryTitle: 'NW — вход'`、`wordmarkLead: 'NW'`、`wordmarkAccent: ''`。门禁保持单一实现，令牌交换、会话 cookie 与 Host 隔离只被拥有和测试一次，依据 dependencies-over-hand-rolling；随部署变化的文案作为带 devBIM 默认值的已验证 Config 字段，依据 no-hardcoded-tunables。`/devbim/login` 路由路径是技术 URL，不是品牌文案，两个部署都保持不变。

浏览器标签页标题是构建环境输入，不在 slot 系统之内：客户端打包器内联 `DSH_CLIENT_TITLE`（在 `apps/web/vite.config.ts` 做 HTML 转义），`dsh-web-north-waterfront.cmd` 在启动 `dsh web` 前把它设为 `NW — Северный берег`。favicon 与 web manifest 对每个部署都保持共享的 `apps/web/public` 集合；客户端专属 favicon 被推迟。

## 考虑过的替代方案

**按部署改造 `ui-brand-devbim` 的配置，而不是姊妹包。** 否决：`devbim.patch.yml` 为内部站点组合同一个包，devBIM 品牌会随配置移动，否则内部 patch 不得不重述旧的 devBIM 文案。姊妹包让每个 patch 只命名一个品牌，且不从 devBIM 包删除任何东西。

**第二个门禁包 `dsh-host-north-waterfront-auth`，内嵌 NW 文案。** 否决：它会复制 `dsh-host-devbim-auth` 已经拥有并测试的登录渲染、令牌交换、cookie 处理与 Host 隔离；三个字符串 config 字段覆盖全部可见差异。

**现在就发布 north-waterfront 的 favicon 与 manifest。** 推迟：favicon 与 manifest 从共享的 `apps/web/public` 集合提供，没有 per-deployment 接缝；增加一个是纯外观的后续工作，两个品牌包的 README 都记录了这次推迟。

## 后果

- 新包 `@deepseek-ai/dsh-client-ui-brand-north-waterfront`（lib、README 三件套、浏览器插件 spec）注册进 `packages/bundle/web-app`，并在 `scripts/verify-package-readme-model-experience.ts` 中审计；`client-north-waterfront.patch.yml` 以它替代 `ui-brand-official` 组合。
- `@deepseek-ai/dsh-host-devbim-auth` 携带三个带 devBIM 默认值的标题字段，未设置它们的内部部署渲染与之前完全一致；两个包 `src` 树的 per-file 覆盖率为 100% 行/分支/函数。
- 两个部署保持各自的品牌、密码（客户端站点用 `.env.north-waterfront`，devBIM 用仓库 `.env`）、端口、隧道与 DSH_HOME 状态，由启动器和 patch 原有安排。
- 两个站点服务相同的 favicon 与 manifest 集合，标签页标题仅通过启动器环境区分；给客户端站点自己的图标需要被推迟的 per-deployment 资产接缝。
