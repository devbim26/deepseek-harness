---
description: "devBIM Web 部署的密码门禁：未认证的首页访问重定向到自包含的密码页，正确提交后换取 Connection 已有的持久浏览器会话 Cookie。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-devbim-auth

[English](README.md) | 中文

## 概述

用单一共享密码保护 devBIM Web 部署。插件注册精确的 `/` 路由：未认证的访问重定向到 `/devbim/login`——一个 devBIM 品牌的自包含密码页。正确密码经由 Connection 的进程启动令牌换取 Connection 已铸造的持久浏览器会话 Cookie，因此所有下游围栏（`/api`、upgrade）照常接受该会话。`password` 配置为空时不注册任何路由，令牌流程仍是唯一入口。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [Model Experience](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当部署通过公共主机名访问、重新打开打印的令牌 URL 不现实时，在 devBIM Web 部署层（[`dsh-web-app`](../../bundle/web-app/README.zh.md) 的 `devbim.patch.yml` 覆盖层）组合本插件。它只需要一个配置值——共享密码，来自部署环境，绝不提交入库。

### 最小配置

```yaml
- id: devbim-auth
  name: '@deepseek-ai/dsh-host-devbim-auth'
  config:
    password: !!js process.env.DEVBIM_WEB_PASSWORD ?? ''
```

`password` 是随部署变化的秘密；为空即关闭门禁（不注册路由，fallback 继续通过令牌流程服务首页）。`distIndex` 覆盖构建前端的 index 位置，默认从 `@deepseek-ai/dsh-web-frontend` 清单解析——与 Web bundle 胶水使用的锚点相同——正常部署无需设置。`entryTitle` 是登录页的标签页标题；`wordmarkLead` 与 `wordmarkAccent` 是登录页字标的素色与强调两段；三者均默认为 devBIM 文案，现有部署渲染不变，且每个值在插值前都会做 HTML 转义。`indexTitle` 通过 webserver 的 index tap 在每次 index 渲染时替换所服务的 `<title>`——本门禁的 `/` 与 SPA fallback 都走该管线——并把同一值发布为 `dsh-product-title` meta 行，客户端的标题投影会优先于构建时标题读取它；值做 HTML 转义，为空（默认）保留构建产物在构建时烙定的标题且不注入任何内容，登录页不受影响，因为它在 index 管线之外渲染。

### 门禁约束

`GET/HEAD /` 在请求既无有效会话 Cookie 也无根令牌时重定向到 `/devbim/login`（303）；其他方法返回 405。`GET /devbim/login` 服务自包含密码页（`no-store`、`noindex`）。`POST /devbim/login` 以 `application/x-www-form-urlencoded` 接收，常量时间比较 `password` 字段：匹配则返回相对的 `/?token=…` 303，令牌交换与 Cookie 铸造保持在请求来源并由 Connection 拥有；密码错误在固定 400 ms 延迟后重渲染页面并附带失败提示。登录尝试受 Connection 的 `/api` 主机/跨站围栏约束——外来 Host 头或浏览器跨站标记被 403 拒绝——超过 2 KiB 的请求体被 413 拒绝。携带根 `?token=` 的访问原样委托给 `ctx.connection.authorizeIndex`：有效令牌铸造 Cookie 并重定向到 `/`，无效令牌保持 Connection 的纯文本 401。

### 可观察的失败

配置的 index 不可读属于部署损坏而非页面缺失：读取失败传播到 webserver 的逐请求守卫（记录日志、回答 400）。错误内容类型返回 415，超大的登录请求体返回 413，未认证的非登录路径保持既有属主（公共资产仍公开；`/api` 保持自己的围栏）。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

### 设计概念

本包是一个函数插件，在 effect 作用域下注册两个精确 webserver 路由。`/` 路由是薄门禁：携带令牌的请求委托 `authorizeIndex`，携带 Cookie 的委托 `requestRejection`，两者通过后经 `ctx.webServer.renderIndex` 服务 index，并施加与 fallback 相同的 `<base href="/">` 锚点。登录路由渲染一个模板字符串——无客户端 bundle，会话建立前无任何资产请求——匹配时提取 `ctx.connection.authenticatedUrl()` 的路径与查询串，使重定向保持相对。插件不新增任何凭据材料：密码只触发交换；会话秘密、Cookie 签名与过期全部留在 `dsh-client-connection`。

### 扩展点

无。路径是固定的部署事实；入口标题与字标是配置字段；身份提供者是另一个插件。

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [`dsh-client-connection`](../../client/connection/README.zh.md) —— 本门禁复用其令牌交换与 Cookie 的浏览器会话属主。
- [`dsh-host-frontend-static`](../../host/frontend-static/README.zh.md) —— 本门禁在 `/` 上镜像其 index 渲染的 fallback 属主。

## Model Experience

无：密码门禁应答浏览器认证请求，不注册任何面向模型的内容。

#### KV Cache effect

无；本包既不组装也不发送提供者请求。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义尚未覆盖的认证类别，是当前的包约束而非任务清单。

- **单一共享密码，无按用户身份** —— 门禁认证的是部署而非人；Google 账号流程需要 OAuth 客户端与按用户的会话记录，本包刻意不纳入。
- **无按地址锁定** —— 错误密码只花费固定 400 ms，不跨地址累计；假设威胁面是单一公共主机名后的单用户部署。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布 companion。拥有的关系是两个精确路由，其注册/释放对称性已由 webserver 在其保留路径的拆除探测覆盖；包级探测将以同一来源重复该观察。
