/**
 * @deepseek-ai/dsh-host-devbim-auth — password gate for the devBIM Web
 * deployment. An unauthenticated index visit redirects to a self-contained
 * password page; the correct password is exchanged, through Connection's
 * process launch token, for the persistent browser-session cookie Connection
 * already mints, so every downstream fence (/api, upgrades) accepts the
 * session unchanged. An empty `password` config registers nothing and the
 * token flow stays the only entry.
 * @module @deepseek-ai/dsh-host-devbim-auth
 */

import { timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Stable Cordis plugin name. */
export const name = 'devbim-auth'

/** Services required before the gate can register its routes. */
export const inject = ['webServer', 'connection']

/** Plugin config: the shared entry secret plus the dist anchor override. */
export interface Config {
  /** Shared entry password; empty disables the gate entirely. */
  password: string
  /**
   * Absolute index.html path the gate serves for authenticated visits.
   * Empty resolves the built Web frontend dist, the same manifest anchor
   * the Web bundle glue uses.
   */
  distIndex: string
}

export const Config: z<Config> = z.object({
  password: z.string().default(''),
  distIndex: z.string().default(''),
})

const LOGIN_PATH = '/devbim/login'
/** Upper bound for the login form body; the password form is far smaller. */
const LOGIN_BODY_LIMIT_BYTES = 2048
/** Fixed response delay after one wrong password, so guessing costs time. */
const WRONG_PASSWORD_DELAY_MS = 400
const HTML_MIME = 'text/html; charset=utf-8'

/** The built frontend index location, from the same manifest anchor the Web bundle glue resolves. */
function defaultDistIndex(): string {
  const require = createRequire(import.meta.url)
  try {
    return join(dirname(require.resolve('@deepseek-ai/dsh-web-frontend/package.json')), 'dist', 'index.html')
  } catch {
    /* v8 ignore next 2 -- reachable only when the frontend package is absent from the composition */
    throw new Error('devbim-auth: @deepseek-ai/dsh-web-frontend is not resolvable from this composition')
  }
}

/** Constant-time comparison of the submitted password against the configured one. */
function passwordMatches(actual: string | null | undefined, expected: string): boolean {
  if (actual === undefined || actual === null) return false
  const actualBytes = Buffer.from(actual, 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')
  return actualBytes.byteLength === expectedBytes.byteLength && timingSafeEqual(actualBytes, expectedBytes)
}

/** Read the full request body, or undefined once it exceeds the limit. */
async function readBody(req: IncomingMessage, limitBytes: number): Promise<Buffer | undefined> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    total += buffer.byteLength
    if (total > limitBytes) return undefined
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

/** The `/?token=…` path-and-query of an authenticated URL, so the token exchange stays on the requesting origin. */
function tokenRedirectTarget(authenticatedUrl: string): string {
  const url = new URL(authenticatedUrl)
  return `${url.pathname}${url.search}`
}

/** One line of the login page's wrong-password block; empty for the initial visit. */
function wrongPasswordNote(wrongPassword: boolean): string {
  return wrongPassword
    ? '<span class="error">Неверный пароль. Попробуйте ещё раз.</span>'
    : ''
}

/**
 * The self-contained devBIM password page; no asset requests precede the session.
 *
 * @param wrongPassword - render the wrong-password error block after a failed attempt.
 * @returns the complete login page as an HTML string.
 */
export function loginPage(wrongPassword: boolean): string {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>devBIM — вход</title>
<style>
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  background: #f4f6f8; color: #1a232e;
}
@media (prefers-color-scheme: dark) {
  body { background: #10161d; color: #e8edf3; }
  .card { background: #1a232e; border-color: #2a3644; }
  .hint { color: #93a4b5; }
}
.card {
  width: min(360px, calc(100vw - 32px)); padding: 36px 32px;
  background: #fff; border: 1px solid #e1e7ee; border-radius: 14px;
  box-shadow: 0 10px 34px rgba(16, 30, 51, 0.08);
}
.wordmark { font-size: 26px; font-weight: 700; letter-spacing: 0.3px; margin-bottom: 6px; }
.wordmark span { color: #1e88e5; }
.hint { margin: 0 0 22px; font-size: 14px; color: #5b6b7c; }
.error {
  display: block; margin: 0 0 14px; padding: 8px 12px; border-radius: 8px;
  background: #fdecea; border: 1px solid #f5c6c2; color: #b3261e; font-size: 13.5px;
}
input[type="password"] {
  width: 100%; padding: 11px 13px; margin-bottom: 14px; font-size: 15px;
  border: 1px solid #c9d4df; border-radius: 9px; background: inherit; color: inherit;
}
input[type="password"]:focus { outline: 2px solid #1e88e5; outline-offset: -1px; border-color: transparent; }
button {
  width: 100%; padding: 11px 0; font-size: 15px; font-weight: 600; color: #fff;
  background: #1e88e5; border: 0; border-radius: 9px; cursor: pointer;
}
button:hover { background: #1976d2; }
</style>
</head>
<body>
<main class="card">
  <div class="wordmark">dev<span>BIM</span></div>
  <p class="hint">Закрытый доступ — введите пароль</p>
  ${wrongPasswordNote(wrongPassword)}
  <form method="post" action="${LOGIN_PATH}">
    <input type="password" name="password" placeholder="Пароль" autofocus autocomplete="current-password" required>
    <button type="submit">Войти</button>
  </form>
</main>
</body>
</html>
`
}

/**
 * Mount the password gate over the Web surface: the exact `/` route answers
 * unauthenticated visits with a redirect to the login page (the token
 * exchange and cookie minting stay Connection's), the login route exchanges
 * the correct password for the session cookie, and every other path keeps
 * its existing owner.
 * @param ctx - plugin context carrying the webServer and connection services.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  // Empty password = gate off: no routes register, so the process-token flow
  // stays the only entry and the fallback keeps serving the index.
  if (config.password === '') return
  const distIndex = config.distIndex !== '' ? config.distIndex : defaultDistIndex()
  const renderIndex = async (): Promise<string> =>
    ctx.webServer.renderIndex(await readFile(distIndex, 'utf8'), ctx.connection.browserPeer)
      .replace(/<head(?:\s[^>]*)?>/i, open => `${open}<base href="/">`)

  // A dist read failure propagates to the webserver's per-request guard
  // (logged, answered 400): the configured index is a deployment fact, so an
  // unreadable one is a broken build, not a missing page.
  const serveIndex = async (res: ServerResponse): Promise<void> => {
    const body = await renderIndex()
    res.writeHead(200, { 'content-type': HTML_MIME })
    res.end(body)
  }

  const gate: WebRoute = {
    kind: 'exact',
    path: '/',
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405)
        res.end()
        return
      }
      /* v8 ignore next -- node:http always sets url on server requests */
      const url = new URL(req.url ?? '/', 'http://dsh.invalid')
      // A token-bearing request is wholly Connection's: the exchange mints
      // the cookie and redirects to ./, every other case keeps its 401.
      if (url.searchParams.has('token')) {
        ctx.connection.authorizeIndex(req, res)
        return
      }
      if (ctx.connection.requestRejection(req) === undefined) {
        await serveIndex(res)
        return
      }
      res.writeHead(303, { 'cache-control': 'no-store', location: LOGIN_PATH })
      res.end()
    },
  }

  const login: WebRoute = {
    kind: 'exact',
    path: LOGIN_PATH,
    handler: async (req, res) => {
      if (req.method === 'GET' || req.method === 'HEAD') {
        res.writeHead(200, { 'content-type': HTML_MIME, 'cache-control': 'no-store' })
        res.end(loginPage(false))
        return
      }
      if (req.method !== 'POST') {
        res.writeHead(405)
        res.end()
        return
      }
      // Connection's Host/cross-site fence (the /api one) also fences the
      // password attempt: only loopback or a --trusted-host authority may
      // even try, and browser cross-site markers are refused outright.
      if (ctx.connection.requestRejection(req) === 403) {
        res.writeHead(403)
        res.end()
        return
      }
      const contentType = req.headers['content-type']
      if (typeof contentType !== 'string' || !contentType.startsWith('application/x-www-form-urlencoded')) {
        res.writeHead(415)
        res.end()
        return
      }
      const body = await readBody(req, LOGIN_BODY_LIMIT_BYTES)
      if (body === undefined) {
        res.writeHead(413)
        res.end()
        return
      }
      const form = new URLSearchParams(body.toString('utf8'))
      if (passwordMatches(form.get('password'), config.password)) {
        const target = tokenRedirectTarget(ctx.connection.authenticatedUrl('http://devbim.invalid/'))
        res.writeHead(303, { 'cache-control': 'no-store', location: target, 'referrer-policy': 'no-referrer' })
        res.end()
        return
      }
      await new Promise((resolve) => { setTimeout(resolve, WRONG_PASSWORD_DELAY_MS) })
      res.writeHead(401, { 'content-type': HTML_MIME, 'cache-control': 'no-store' })
      res.end(loginPage(true))
    },
  }

  ctx.effect(() => ctx.webServer.register(gate), 'devbim-auth: index gate')
  ctx.effect(() => ctx.webServer.register(login), 'devbim-auth: login route')
}
