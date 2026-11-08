# Agent Note: devBIM profile 接入 drawing5 MCP 服务器

Status: implemented

[English](2026-11-05-devbim-drawing5-mcp-bridge.md) | 中文

## 问题

harness 的 devBIM 部署形态（`dsh web` 位于 Cloudflare 隧道之后、通过 `devbim.dev-bim.com` 对外提供、由共享密码页把守入口）无法访问 `drawing5` 服务器持有的图纸集：这是 АР 阶段的一套 PDF 图纸，共 100 张，已抽取进 `entities.jsonl`。该服务器只通过面向外部聊天机器人的 HTTP 端点（`/ask`、`/sheet`、`/stamps`）暴露这批数据，因此 devBIM 聊天背后的 agent 无法回答关于图纸的问题。公网隧道与密码门禁一文（`.agents/notes/implemented/architecture/2026-11-05-devbim-public-tunnel-and-password-gate.md`）为这个入口提供了稳定的公网地址，却没有提供数据源。

## 决策

devBIM profile 通过已有的 `@deepseek-ai/dsh-mcp-client` 桥接接入 drawing5 MCP 服务器。部署 overlay `packages/bundle/web-app/devbim.patch.yml` 在其 `insert:` 块中承载一行配置：

```yaml
- id: mcp-drawing5
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: drawing5
    transport: streamable-http
    url: http://127.0.0.1:8808/mcp
    headers:
      Authorization: !!js '`Bearer ${process.env.DRAWING5_KEY}`'
```

bundle 的 `package.json` 增加工作区依赖 `@deepseek-ai/dsh-mcp-client`，使该行引用的包能从本层自身的依赖中解析。Bearer 密钥经启动器进入进程：`dsh-web.cmd` 与 `start-dsh-web-detached.ps1` 会加载仓库根目录 `.env` 里的每一行 `KEY=VALUE`，overlay 再通过既有的 `!!js` 接缝读取 `DRAWING5_KEY`，因此仓库内不落任何凭据。

新行只能放进 overlay 的 `insert:` 块：顶层的 `- id:` 行针对 base 中已存在的条目，id 不存在时加载器会丢弃该行并报 `patch: entry "mcp-drawing5" not found`。工具以 `mcp__drawing5__list_sheets`、`mcp__drawing5__search`、`mcp__drawing5__get_sheet`、`mcp__drawing5__get_health`、`mcp__drawing5__extract_stamps` 的形式进入模型可见的工具列表。

drawing5 一侧需要在自身的 `.env` 中设置 `DRAWING5_PDF`：缺少该变量时 `get_sheet(include="raw")` 返回 `422`，agent 只能读到实体层，而元素尺寸并不总在实体层中。`start-drawing5-server.bat` 从 `.env` 读取该变量交给 HTTP 服务器；`mcp_server.py` 自行加载 `.env`。

MCP 服务器只监听回环地址。公网路径 `https://drawing5.dev-bim.com/mcp` 已在 drawing5 隧道的 ingress 中配置且可用，但 profile 指向回环地址，因为两个进程运行在同一台主机上。

## 验证

`dsh --profile web --dump-config --patch packages/bundle/web-app/devbim.patch.yml` 显示该行已进入组合后的配置树。重启 `dsh web` 之后，进程与 `127.0.0.1:8808` 之间保持已建立连接，工具可以正常应答：`list_sheets` 返回 100 张图纸，`search` 返回命中实体及其 `sheet_no`，`get_sheet(include="raw")` 返回原始文本层（图纸 80 —— 450 个词）。

在 `https://devbim.dev-bim.com/` 的 devBIM 聊天中，关于雨水检查口的问题产生了 20 次工具调用（`get_health`、`list_sheets`、若干次 `search`、`get_sheet`），答案引用了图纸编号、标记 `ПЛК-1` 与 `ПЛК-2`、尺寸 `250х250 мм` 与 `300(h)х300 мм`、标高 `−1,000` 与 `−0,770` —— 每项均引自所引用图纸的文本层。

## 备选方案

**在 harness 仓库中新建原生 `@deepseek-ai/dsh-tool-drawing5` 包。** 本次部署不采纳：该做法要为一项部署的数据源承担工具呈现、会话日志记录与权限规则，并会向已发布接口新增一个包、一对 README、测试与覆盖率要求。MCP 桥接本就是为这种形态而存在——外部工具服务器——而本次部署需要的是工具，不是新的第一方能力。

**采用 stdio 传输，由桥接拉起 MCP 服务器。** 不采纳：drawing5 的 MCP 服务器已是长期运行的服务，且隧道能够访问它，运维方也用自己的启动器拉起它。由 harness 启动时拉起会把它的生命周期绑在 harness 上，并隐藏真正持有图纸索引的进程。

**把公网地址 `https://drawing5.dev-bim.com/mcp` 作为 profile 的端点。** 暂缓：该路径可用，但两个进程同机部署，却让每次工具调用都绕行公网边缘。该公网路径保留给机器之外的客户端。

**把配置行放进 profile 自带的 `cordis.patch.yml`，而不是部署 overlay。** 不采纳：devBIM overlay 已经承载本次部署的品牌、密码门禁与信任围栏，图纸桥接属于同一层；再拆一个文件会把一次部署的接线分置两处。

## 后果

devBIM 部署现在依赖 drawing5 MCP 服务器处于运行状态：该服务停止时，桥接按自身退避策略重连，工具在服务恢复前持续失败，聊天其余部分不受影响。Bearer 密钥存在于两个被 git 忽略的 `.env` 文件中——仓库根目录一份供 profile 使用，drawing5 根目录一份供服务器使用——两侧各读各的。profile 的工具集在每个会话中增加五个模型可见工具，其定义随之进入每次模型请求。

桥接注册到全局工具层，因此部署的每个会话都能看到图纸工具，与 agent preset 无关：preset 决定的是它自行挂载哪些工具，而部署级 provider 对所有 agent 可见。
