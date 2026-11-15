---
description: "部署约束的用户自建 agent preset：持久化记录挂载到 preset 注册表。用户输入只变成类型化配置——Loader 永不执行用户提供的 YAML 或代码。"
kind: "package-reference"
---

# @deepseek-ai/dsh-agent-preset-custom

[English](README.md) | 中文

## 概述

部署约束的用户自建 agent preset：持久化记录挂载到 preset 注册表。用户输入只变成类型化配置——Loader 永不执行用户提供的 YAML 或代码。

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

```yaml
- insert:
    - id: agent-preset-custom
      name: '@deepseek-ai/dsh-agent-preset-custom'
      config:
        instructionsPrefix: You are the drawings assistant of this site, powered by the {{model}} model.
        basePlugins:
          - id: agent-instructions
            name: '@deepseek-ai/dsh-agent-instructions'
            config:
              maxBytes: 65536
          - id: time-context
            name: '@deepseek-ai/dsh-time-context'
        allowedTools:
          ask-user:
            name: '@deepseek-ai/dsh-tool-ask-user'
          todo:
            name: '@deepseek-ai/dsh-tool-todo'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `instructionsPrefix` | `''` | 前置到每个自定义智能体指令之前的站点人格。 |
| `basePlugins` | `[]` | 每个自定义智能体固定挂载的子行，由部署从其 standard preset 复制（不含 persona）。 |
| `allowedTools` | `{}` | 白名单：记录键 → 选中该键的智能体挂载的插件行 `{ name, config? }`；记录只保存键。 |
| `maxNameChars` | `64` | 名称长度上限。 |
| `maxDescriptionChars` | `200` | 描述长度上限。 |
| `maxInstructionsChars` | `16384` | 指令长度上限。 |
| `maxAgents` | `50` | 部署级记录数量上限。 |

客户端管理器（`@deepseek-ai/dsh-client-ui-custom-agents`）调用 Remote 接口 `list | create | update | delete`。每次写入都会重新校验字段与白名单键，失败时以编码的 `RemoteError` 响亮报错（`custom-agent-presets/invalid`、`/not-found`、`/limit`、`/conflict`）。更新携带记录的 `version` 实现乐观并发。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

[index.ts](src/index.ts) 打开 `custom_agent_presets` 存储域（json 后端，站点 `DSH_HOME` 下一个单元），在启动时重新注册每条存储记录，并保留每个 `agentPresets.register()` 的 disposer。[definition.ts](src/definition.ts) 合成注册表定义：persona 行（站点前缀 + 用户指令）、部署的 `basePlugins`，以及所选白名单行。更新时先注销旧注册，再注册新修订；注册表退役旧修订，运行中的 Agent 保留其组成。`invalidRecords: 'backup-and-skip'` 隔离不再解析的存储记录：备份、记录日志并跳过，站点保持可用。

</details>

<a id="further-exploration"></a>
## 进一步探索

- [注册表](../agent-preset-registry/README.zh.md) — 这些记录加入的名册、修订与会话绑定。
- [存储子系统](../../../docs/subsystems/storage.zh.md) — 域声明与后端契约。
- [存储域](../../storage/storage-domain/README.zh.md) — 本服务打开的类型化域形式。

<a id="model-experience"></a>
## 模型体验

### 自定义 preset 选择

#### 模型看到什么

合成 preset 的 `plugins` 拥有工具与提示词分节：`persona` 前缀——一个 `{{model}}` 模板加上用户指令——开启提示词，白名单行提供其工具。

#### Token 影响

每个挂载的行声明自己的提示词分节与工具 schema。

#### KV Cache 影响

运行中的 Agent 保留其启动时的组成；新会话按当前记录构建前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- preset 不是安全沙箱；部署拥有白名单及其中的每一行。只有在审查了新增行的沙箱之后才扩展 `allowedTools`。
- 目录按 `DSH_HOME` 共享：站点的单一密码门没有身份，因此编辑与删除权限是站点级的。
- 存储模式不再解析的记录在打开时被跳过（备份 + 日志）；名册中不显示。

### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

域名带下划线（`custom_agent_presets`），因为 `UNIT_NAME_RE` 禁止连字符；remote 错误码保留带连字符的域拼写。

</details>
