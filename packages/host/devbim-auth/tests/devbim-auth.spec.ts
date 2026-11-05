/**
 * REAL-composition coverage: a test-only cordis.yml booted through the
 * vendored Loader mounts the webserver, connection, and devbim-auth rows,
 * and every assertion observes the served HTTP surface — the index redirect,
 * the login page, the password exchange into the persistent session cookie,
 * and the denials (wrong password, cross-site/host fence, wrong content
 * type, oversized body, unsupported methods, gate-off with an empty
 * password).
 */

import { request as httpRequest } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import * as DevBimAuth from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Boot the Web rows plus the gate through the real Loader; `gateConfig` lines are produced after the fixture root exists. */
async function loadComposition(gateConfig: () => string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-devbim-auth-'))
  const dist = join(root, 'dist')
  await mkdir(dist)
  await writeFile(join(dist, 'index.html'), '<head></head><body>shell</body>')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-credentials-local'",
    '  config:',
    `    path: '${join(root, '.credentials.yaml')}'`,
    '    watch: false',
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    "- name: '@deepseek-ai/dsh-client-connection'",
    '- id: gate',
    "  name: '@deepseek-ai/dsh-host-devbim-auth'",
    ...gateConfig(),
    '',
  ].join('\n'))
  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-credentials-local', LocalCredentials],
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['@deepseek-ai/dsh-client-connection', Connection],
    ['@deepseek-ai/dsh-host-devbim-auth', DevBimAuth],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

/** The gate-config lines for an active gate with a fixture dist index. */
function activeGate(password: string): string[] {
  return [
    '  config:',
    `    password: '${password}'`,
    `    distIndex: '${join(root!, 'dist', 'index.html')}'`,
  ]
}

/** Request one path; returns status, content-type, location, set-cookie, and the body. */
async function request(port: number, path: string, init?: RequestInit): Promise<{
  status: number
  type: string | null
  location: string | null
  setCookie: string | null
  body: string
}> {
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, { redirect: 'manual', ...init })
  return {
    status: response.status,
    type: response.headers.get('content-type'),
    location: response.headers.get('location'),
    setCookie: response.headers.get('set-cookie'),
    body: await response.text(),
  }
}

/** POST with a fully controlled header set, bypassing fetch's Host handling. */
function rawPost(port: number, path: string, headers: Record<string, string>, body: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'POST', headers }, (res) => {
      res.resume()
      res.on('end', () => { resolve(res.statusCode ?? 0) })
    })
    req.on('error', reject)
    req.end(body)
  })
}

describe('real Loader composition', () => {
  it('redirects unauthenticated visits to the login page and exchanges the password for a session', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition(() => activeGate('sekret'))
    expect([...loaded.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
    const port = loaded.webServer.port

    // Unauthenticated index visit → the login page; the page is self-contained.
    expect(await request(port, '/')).toMatchObject({ status: 303, location: '/devbim/login' })
    const page = await request(port, '/devbim/login')
    expect(page).toMatchObject({ status: 200, type: 'text/html; charset=utf-8' })
    expect(page.body).toContain('dev<span>BIM</span>')
    expect(page.body).toContain('name="password"')
    expect(page.body).not.toContain('Неверный пароль')
    expect(await request(port, '/devbim/login', { method: 'HEAD' })).toMatchObject({ status: 200, body: '' })

    // Denials: unsupported methods, wrong content type, oversized body, missing field.
    expect(await request(port, '/', { method: 'POST', body: '' })).toMatchObject({ status: 405 })
    expect(await request(port, '/devbim/login', { method: 'PUT', body: '' })).toMatchObject({ status: 405 })
    expect(await request(port, '/devbim/login', {
      method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x',
    })).toMatchObject({ status: 415 })
    expect(await request(port, '/devbim/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `password=${'a'.repeat(3000)}`,
    })).toMatchObject({ status: 413 })

    // Wrong password: the fixed delay applies, the page names the failure.
    const wrong = await request(port, '/devbim/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'password=nope',
    })
    expect(wrong).toMatchObject({ status: 401 })
    expect(wrong.body).toContain('Неверный пароль')
    expect(await request(port, '/devbim/login', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: '',
    })).toMatchObject({ status: 401 })

    // Correct password: a relative token redirect keeps the exchange on this origin.
    const login = await request(port, '/devbim/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'password=sekret',
    })
    expect(login).toMatchObject({ status: 303 })
    expect(login.location).toMatch(/^\/\?token=/)
    if (login.location === null) throw new Error('login did not redirect to the token exchange')
    const exchange = await request(port, login.location)
    expect(exchange).toMatchObject({ status: 303, location: '/' })
    const setCookie = exchange.setCookie
    if (setCookie === null) throw new Error('token exchange did not set a cookie')
    const cookie = setCookie.split(';', 1)[0]!

    // The session cookie serves the gated index with the same render pipeline as the fallback.
    const index = await request(port, '/', { headers: { cookie } })
    expect(index).toMatchObject({ status: 200, type: 'text/html; charset=utf-8' })
    expect(index.body).toContain('<base href="/">')
    expect(index.body).toContain('shell')

    // An invalid token keeps Connection's plain 401, not a login redirect.
    expect(await request(port, '/?token=not-the-launch-token')).toMatchObject({
      status: 401,
      body: 'dsh web authentication required; reopen the URL printed by dsh web.\n',
    })

    // The Host/cross-site fence inherited from Connection refuses a foreign authority.
    expect(await rawPost(port, '/devbim/login', {
      host: 'evil.example',
      'content-type': 'application/x-www-form-urlencoded',
    }, 'password=sekret')).toBe(403)
  })

  it('resolves the built frontend dist when distIndex is absent', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition(() => ['  config:', "    password: 'sekret'"])
    expect([...loaded.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
    // The gate registers and redirects before any dist byte is read.
    expect(await request(loaded.webServer.port, '/')).toMatchObject({ status: 303, location: '/devbim/login' })
  })

  it('registers nothing when the password is empty', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition(() => ['  config:', "    password: ''"])
    expect([...loaded.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
    // No gate route and no fallback owner in this composition: plain 404, the
    // pre-gate surface (the fallback keeps the index when it is mounted).
    expect(await request(loaded.webServer.port, '/')).toMatchObject({ status: 404 })
    expect(await request(loaded.webServer.port, '/devbim/login')).toMatchObject({ status: 404 })
  })
})
