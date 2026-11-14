# Agent Note: dsh 0.2.2-rc.2 之上的 devBIM 层

Status: implemented

[English](2026-11-12-devbim-rebase-on-dsh-0.2.2-rc.2.md) | 中文

## 问题

devBIM 历史是叠在 fork-master 快照之上的提交层，落后上游 `deepseek-ai/deepseek-harness` master 10 394 个 commit。上游 0.2.2-rc.2 带来原生 Excel 文档预览、仅解决方案级（solution-only）的客户端 face TypeScript 工程、`Connection.authorizeIndex` 中目录相对的令牌交换重定向，并要求 `node >=24.9.0`。留在快照上意味着把基底永久 fork 掉，并让未来的每一个上游修复都搁浅。

## 决策

分支 `internet-rebase-0.2.2` 把七个 devBIM commit 重放到上游发布 `0.2.2-rc.2` 的 master 上；快照 commit 被丢弃。在该分支验证通过之前，本地 `master` 与 `internet` 保留 rebase 前的历史，GitHub 上的 fork 不动。

冲突解决：devBIM 的 favicon 与 manifest 身份赢得品牌席位，同时保留上游新增的 `background_color` 与 `theme_color`；`packages/bundle/web-app/package.json` 取上游依赖列表并加上 `dsh-client-ui-brand-devbim`、`dsh-host-devbim-auth` 与 `dsh-mcp-client`（该上游包现在位于 `packages/mcp/mcp-client`）；`pnpm-lock.yaml` 跟随上游文件并以重新生成的 workspace importer 为准；slot 目录保留上游的 `declaredBy` 措辞与 devBIM 的 `DevBimHeroMark` 占位者；`.gitignore` 把上游的 CUA record 条目与 `.mimosa/` 取并集。

上游的 Excel 预览声明了 `.xlsx`，而它的 `apply.client.spec.ts` 禁止后注册的 body 声明先注册 body 的扩展名。`XLSX_EXTENSIONS` 收窄为 `['xlsm']`，因此 devBIM 的 xlsx body 只服务 `.xlsm`；如果不需要 `.xlsm` 支持，删除 devBIM 的 `xlsx/` 模块是备选做法。

API 对齐：令牌交换的测试期望与 devbim-auth 源码注释跟随新的目录相对 `./` 重定向；`WebServer.port` 在绑定前是 `number | undefined`，因此 spec 通过 `boundPort` 辅助函数收窄；`ui-brand-devbim/tsconfig.json` 引用 `../ui-conversation/tsconfig.client.json`，因为上游包根变成了仅解决方案级配置加 face 叶配置；`XlsxBody` 包装了上游的 `LoadingIndicator`，其 props 去掉了 `className`。

`document-preview-license-bundle.client.spec.ts` 设置了显式的 120 s 测试超时。该测试把 `task.timeout` 透传进 `pnpm pack` 的 `spawnSync` 调用：打包 374 个文件在 devBIM 的 Windows 机器上约需 30 s，而之前的默认 5 s 会在任何断言运行前中断子进程。

## 备选方案

**留在快照层上。** 迁移风险为零，devBIM 的每个 commit 都不动，但基底被永久 fork：落后上游 10 394 个 commit，未来的每个上游修复都搁浅，下一次无法回避的同步更难。输给 rebase 的原因：fork 成本会复利累积，而快照换不到任何 rebase 换不到的东西。

**删除 devBIM 的 xlsx 模块，而不是收窄它的声明。** 上游原生 Excel 预览将服务 `.xlsx`，devBIM body 只保留 `.xlsm`。暂不采纳：devBIM 的 xlsx body 是 devBIM 客户端已经在看的表面，把 `XLSX_EXTENSIONS` 收窄为 `['xlsm']` 让两个预览都继续工作；如果最终不需要 `.xlsm`，删除仍可选。

## 后果

devBIM 的 commit 落在上游发布 `0.2.2-rc.2` 的 master 上；被丢弃的快照 commit 把 rebase 之前的 fork master 从祖先里移除，因此本地 `master` 与 `internet` 分支在这条线验证并重新指向前与之分叉。`.xlsx` 扩展名的 Excel 文档现在由上游原生预览服务；只有 `.xlsm` 到达 devBIM body。

工具链要求 `node >=24.9.0`：在永久性的本地 Node 24 安装到位之前，构建与测试经由 `C:\Users\Lenovo\node24-portable\` 的便携 Node 24 运行。上游约定——目录相对的令牌交换重定向与仅解决方案级的客户端 face 配置——现在是本地约定，devbim-auth 的源码注释与 `ui-brand-devbim` 的 tsconfig 引用跟随它们。

## 工具链

上游 `engines` 要求 `node >=24.9.0`：tsdown 客户端打包阶段经 Node 类型剥离（`--config-loader native`）加载 `tsdown.config.ts`，Node 22.17 做不到，因此 `pnpm run build` 在先前的本地 Node 上无法完成。`C:\Users\Lenovo\node24-portable\` 的便携 Node 24.22.3 通过 `PATH` 覆盖运行构建与测试；把 Node 24 装成永久的本地 Node 是后续事项。
