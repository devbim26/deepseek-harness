---
description: "自定义智能体管理器：从 preset 选择器创建、编辑和删除用户自定义的 agent preset。对话框位于菜单树之外，因此菜单关闭后仍然存活。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-custom-agents

[English](README.md) | 中文

## 概述

自定义智能体管理器：从 preset 选择器创建、编辑和删除用户自定义的 agent preset。对话框位于菜单树之外，因此菜单关闭后仍然存活。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发注记](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

```yaml
- id: ui-custom-agents
  name: '@deepseek-ai/dsh-client-ui-custom-agents'
```

该行在 agent-preset 选择器的子插槽上挂载两个条目：`agentPreset.picker.actions` 菜单行（“新建自定义智能体”）和 `agentPreset.picker.overlays` 对话框宿主。属主（`ui-agent-preset`）在菜单旁边、菜单树之外渲染覆盖层，因此从菜单行打开的对话框能在菜单关闭后存活。文案归 locale 所有（`customAgents` 命名空间；zh、en、ru）。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

[custom-agents-store.ts](src/client/custom-agents-store.ts) 保存目录状态与对话框的打开标志；菜单条目与覆盖层读取同一个 store，因此任一表面卸载后状态仍然存活。写入通过类型化的 `customAgentPresets` remote 进行，并发出客户端 `custom-agents/changed` 事件，`ui-agent-preset` 的名册刷新订阅了该事件。[CustomAgentsModal.tsx](src/client/CustomAgentsModal.tsx) 严格根据服务上报的 policy 渲染字段与工具复选框——表单只能提供部署白名单携带的内容。

</details>

<a id="further-exploration"></a>
## 进一步探索

- [自定义 preset 服务](../../preset/agent-preset-custom/README.zh.md) — 该表面背后的持久化记录与校验。
- [Agent-preset 表面](../ui-agent-preset/README.zh.md) — 承载本管理器条目的选择器。
- [Slots](../ui-slots/README.zh.md) — 本包填充的插槽契约。

<a id="model-experience"></a>
## 模型体验

间接地，通过它写入的记录：这些记录合成的 preset 决定模型看到的内容。

#### KV Cache 效应

本包自身不产生；每个合成 preset 的插件拥有各自的提示词分节与工具 schema。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 打开的窗口中的名册不会推送别处所做的更改；选择器在重连与本地写入后刷新。
- 目前只提供 zh、en、ru 词典；其余 locale 回退，可机械补充。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

对话框不能由挂载在选择器菜单内部的组件打开：关闭菜单会卸载菜单的子节点。今后任何打开对话框的写入路径都必须经过插件作用域中 controller 的 `openManager()`。

</details>
