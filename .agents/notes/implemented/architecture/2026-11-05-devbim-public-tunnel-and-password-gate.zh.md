# Agent Note: devBIM 公网隧道 + 密码门禁

Status: implemented

[English](2026-11-05-devbim-public-tunnel-and-password-gate.md) | 中文

## 问题

3080 端口上的 `dsh web`（DeepSeek Harness 的 devBIM 部署）此前只能通过 `http://127.0.0.1:3080/?token=<launchToken>` 访问：启动令牌（launch token）只在启动时向操作员控制台打印一次，并且每次重启都会轮换。远程访问（换设备、换网络、服务器重启之后）没有入口：令牌 URL 无法触达，唯一内置的替代方式是经同一令牌交换铸造的、每个部署一份的浏览器会话 cookie。

## 决策

**通过 Cloudflare 命名隧道（named tunnel）把该表面暴露到 `devbim.dev-bim.com`，并用共享密码页把公开主机名交换为既有的 Connection 浏览器会话 cookie。**

隧道沿用 dev-bim.com 其他服务（`docx`、`credits`、`blueprint`、`design`、`drawing5`、`nw`、`soundinsulcolc`）既定的一端口一子域模式；宣布隧道可用之前，已通过 cert.pem 的 zone token 验证过 CNAME。`dsh web` 绑定 `127.0.0.1:3080`（文档化的仅回环姿态，默认让 webserver 不暴露到局域网），`cloudflared` 作为同宿主进程访问它——不需要 `--host 0.0.0.0`，也不需要改动公共代码。

门禁以新的宿主插件 `@deepseek-ai/dsh-host-devbim-auth` 交付，通过 `devbim.patch.yml`（文档化的部署扩展点）挂载，而不是修改 `browser-auth.ts`。插件复用三个本就公开的 Connection 表面：用于启动令牌交换的 `connection.authorizeIndex`、用于重定向目标的 `connection.authenticatedUrl`、以及用于 Host/跨站围栏的 `connection.requestRejection`。插件里没有任何新的凭据材料：密码只触发交换，会话密钥、cookie 签名与过期管理全部留在原处。公开主机名通过基础 patch 为这一情形明确文档化的 connection 行表达式覆盖（`trustedHosts: !!js "[..., ...ctx.webRuntime.trustedHosts]"`）加入 `/api` 信任围栏。

`DEVBIM_WEB_PASSWORD` 存放在仓库根目录的 `.env`（gitignored），启动器把它加载进 dsh 进程环境，patch yml 通过文档化的 `!!js process.env.X ?? ''` 接缝读取。密码为空时不注册任何路由，令牌流程仍是唯一入口——本机使用的 `dsh web` 行为不变。

## 验证

插件自身的 REAL 组合测试（vitest、vendored Loader、经 WebServer 的真实 HTTP）覆盖：未认证访问重定向到登录页、登录页渲染、正确密码交换为会话 cookie、已认证的 index（`__DSH_BOOT__` 经 `renderIndex` 注入并带 `<base href="/">` 锚点）、错误密码在 400 ms 延迟后带失败提示重渲染、缺失 `password` 字段、超限请求体（413）、错误 content type（415）、不支持的 method（405）、以及外部权威主机的 Host 围栏拒绝（403）。组合的空密码用例断言门禁不注册任何内容。`packages/host/devbim-auth/src/index.ts` 的逐文件覆盖率为 100%（语句、分支、行、函数）。

经 `https://devbim.dev-bim.com/` 的端到端是同一流程经隧道走 TLS：`GET /` → 303 → `GET /devbim/login`（200，devBIM 品牌的 HTML，含 `name="password"`），带正确密码的 `POST /devbim/login` → 303 到 `/?token=<launchToken>`（相对 Location 让交换留在请求来源），令牌访问 → 303 + `Set-Cookie: dsh-auth-…`，带 cookie 的 `GET /` → 200，返回真实的 `<title>DevBIM</title>` 与 `__DSH_BOOT__` 载荷，带 cookie 的 `GET /api` → 404（受信 host + 有效会话；未授权请求为 401，外部 host 为 403）。

新包的文档门禁通过：`verify-package-readme-model-experience` 接受审计过的简式条目，`verify-translation-pairing` 记录双语 README 对，文档标准骨架检查找到规范的「概述 / 目录 / 开发备注」标题。

## 备选方案

**修改 `browser-auth.ts`，用 HTML 登录页替代纯 401。** 否决：该表面归上游所有，而它没有模型可见的对侧；改动会连带 agent note、测试、会话格式审计与覆盖率门禁工作压到这个安全敏感文件上，且文档化的扩展点已经覆盖该部署。

**在隧道前叠加 Cloudflare Access（Zero Trust）配 Google 身份。** 推迟为下一步。Cloudflare Access 是免代码的 Google 路径，也符合用户「用 Google 邮箱即可完全访问」的意图，但面板配置需要用户交互式操作 Cloudflare 账户（cert.pem 只覆盖 DNS），而部署表面是个人单用户场景。密码门禁是过渡期的单用户流程；Access 叠加可以在不动本包约定的前提下替换它。

**在 Web 服务器前放一个自带认证的独立反向代理。** 否决：新增一个活动部件和一处新的凭据存储，重复 Connection 已经拥有的 cookie 逻辑。

## 后果

- 新包 `@deepseek-ai/dsh-host-devbim-auth`（lib + README + REAL 组合测试），外加 `devbim.patch.yml` 的一次行插入，以及把 `devbim.dev-bim.com` 加入 `/api` 信任围栏的 connection 行表达式覆盖。
- 新部署产物：`~/.cloudflared/<UUID>.json`（凭据，等效 gitignored）、`~/.cloudflared/config-devbim.yml`（带文档化头的隧道配置）、以及 `Harness/run-tunnel-devbim.bat`（仅重启隧道）。`dev-bim.com` 的 DNS 记录新增了对应的 CNAME。
- 仓库根 `.env`（gitignored）保存共享密码；`.env.example` 发布为空。`dsh-web.cmd`、`front-restart.cmd` 与 `start-dsh-web-detached.ps1` 在 dsh 进程生成前加载它，`dsh-web.cmd`/`front-restart.cmd` 还会带着防止重复拉起已运行连接器的守卫启动隧道窗口。
- 关闭门禁的行为是文档化的默认：空的 `DEVBIM_WEB_PASSWORD` 不注册路由，令牌流程仍是唯一入口——从本机 shell 运行 `dsh web` 与从前完全一致。
- 错误密码固定消耗 400 ms；没有按地址封锁，也没有按用户身份。当单用户威胁面变化时，Google/OAuth 叠加是下一迭代。
