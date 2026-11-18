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
            label: Task list
            description: Keep a task list during long work.
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `instructionsPrefix` | `''` | 前置到每个自定义智能体指令之前的站点人格。 |
| `basePlugins` | `[]` | 每个自定义智能体固定挂载的子行，由部署从其 standard preset 复制（不含 persona）。 |
| `allowedTools` | `{}` | 白名单：记录键 → 选中该键的智能体挂载的插件行 `{ name, config?, label?, description? }`；表单为每个条目渲染一个复选框，未勾选即硬性阻断——智能体不会挂载该行。记录只保存键。 |
| `delegation` | — | 编排者的委派行（`name` + 基础 `config` + 可选 `rosterTemplate`）；该字段缺失时管理器中的“编排者”开关禁用。服务会从记录添加 `allowedAgentPresets`，并把委托名册（`rosterTemplate` 引导语 + 每个委托一行 `- <id> «<名称>» — <描述>`）追加到编排者的人格中；`rosterTemplate` 缺失或为空时人格不含名册文本。 |
| `maxNameChars` | `64` | 名称长度上限。 |
| `maxDescriptionChars` | `200` | 描述长度上限。 |
| `maxInstructionsChars` | `16384` | 指令长度上限。 |
| `maxAgents` | `50` | 部署级记录数量上限。 |

编排者是带有 `isOrchestrator: true` 且 `delegates` 非空（既有普通智能体的 id，不含自身）的记录。合成会挂载 `delegation` 行并携带 `allowedAgentPresets: delegates`，且在设置 `rosterTemplate` 时把委托名册追加到人格——模型无需在指令中点名即可知道能启动谁。删除级联清空列表后不再挂载该行，标志保留。被其他记录的 `delegates` 引用的智能体不能成为编排者；删除智能体会级联清理引用，更新智能体会重新挂载引用它的编排者，使其名册反映当前名称与描述（其存储记录保留各自版本）。`hidden` 将 preset 从选择器中隐藏（`agentPresets/list` 携带该标志），但定义保持挂载，仍可被编排者启动。

客户端管理器（`@deepseek-ai/dsh-client-ui-custom-agents`）调用 Remote 接口 `list | create | update | delete`。每次写入都会重新校验字段与白名单键，失败时以编码的 `RemoteError` 响亮报错（`custom-agent-presets/invalid`、`/not-found`、`/limit`、`/conflict`）。更新携带记录的 `version` 实现乐观并发。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

[index.ts](src/index.ts) 打开 `custom_agent_presets` 存储域（json 后端，站点 `DSH_HOME` 下一个单元），在启动时重新注册每条存储记录，并保留每个 `agentPresets.register()` 的 disposer。[definition.ts](src/definition.ts) 合成注册表定义：persona 行（站点前缀 + 用户指令 + 编排者的委托名册）、部署的 `basePlugins`，以及所选白名单行。挂载会从同一张表解析委托记录，委托缺失时响亮失败。更新时先注销旧注册，再注册新修订，然后重新挂载引用它的编排者；注册表退役旧修订，运行中的 Agent 保留其组成。`invalidRecords: 'backup-and-skip'` 隔离不再解析的存储记录：备份、记录日志并跳过，站点保持可用。

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

合成 preset 的 `plugins` 拥有工具与提示词分节：`persona` 前缀——一个 `{{model}}` 模板加上用户指令——开启提示词，白名单行提供其工具。编排者的前缀额外携带委托名册：部署的 `rosterTemplate` 引导语，随后每个委托一行 `- <id> «<名称>» — <描述>`，使 `subagent` 工具的 `agent_preset` 枚举呈现为具名角色而非裸 id。

#### Token 影响

每个挂载的行声明自己的提示词分节与工具 schema。

#### KV Cache 影响

运行中的 Agent 保留其启动时的组成；新会话按当前记录构建前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- preset 不是安全沙箱；部署拥有白名单及其中的每一行。只有在审查了新增行的沙箱之后才扩展 `allowedTools`。
- 白名单条目可以挂载 `mcp-client` 行，但部署必须保持任何同 `serverName` 的 host-plane 行处于禁用状态：按智能体挂载就是阻断机制，host-plane 行会把工具泄漏给每个智能体，并与按智能体的命名空间冲突。
- 目录按 `DSH_HOME` 共享：站点的单一密码门没有身份，因此编辑与删除权限是站点级的。
- 存储模式不再解析的记录在打开时被跳过（备份 + 日志）；名册中不显示。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

域名带下划线（`custom_agent_presets`），因为 `UNIT_NAME_RE` 禁止连字符；remote 错误码保留带连字符的域拼写。

</details>
