# Agent Note: devBIM public tunnel + password gate

Status: implemented

## Problem

`dsh web` on port 3080 (the devBIM deployment of DeepSeek Harness) was reachable only as `http://127.0.0.1:3080/?token=<launchToken>`, where the launch token prints once to the operator's console on startup and rotates every restart. Remote access (different device, different network, after a server bounce) had no entry: the token URL was unreachable and the only built-in alternative was a per-deployment client session cookie minted through the same token exchange.

## Decision

**Expose the surface through a Cloudflare named tunnel to `devbim.dev-bim.com`, and gate the public hostname with a shared-password page that exchanges for the existing Connection browser-session cookie.**

The tunnel follows the established one-port-one-subdomain pattern of the other dev-bim.com services (`docx`, `credits`, `blueprint`, `design`, `drawing5`, `nw`, `soundinsulcolc`); CNAME was verified through the cert.pem zone token before declaring the tunnel live. `dsh web` binds `127.0.0.1:3080` (the documented loopback-only posture that keeps the webserver off the LAN by default), and `cloudflared` reaches it as a same-host process — no `--host 0.0.0.0` and no public code change.

The gate ships as a new host plugin `@deepseek-ai/dsh-host-devbim-auth` mounted through `devbim.patch.yml` (the documented deployment extension point), not as a change to `browser-auth.ts`. The plugin reuses three Connection surfaces that were already public: `connection.authorizeIndex` for the launch-token exchange, `connection.authenticatedUrl` for the redirect target, and `connection.requestRejection` for the Host / cross-site fence. No new credential material lives in the plugin; the password only triggers the exchange, and the session secret, cookie signing, and expiry all stay where they were. The public hostname joins the `/api` trust fence through the connection-row expression override the base patch documents for exactly this case (`trustedHosts: !!js "[..., ...ctx.webRuntime.trustedHosts]"`).

`DEVBIM_WEB_PASSWORD` lives in the repo-root `.env` (gitignored), the launchers load it into the dsh process environment, and the patch yml reads it through the documented `!!js process.env.X ?? ''` seam. Empty password registers no routes and the token flow stays the only entry — `dsh web` runs unchanged for localhost use.

## Verification

The plugin's own REAL-composition test (vitest, vendored Loader, real HTTP through the WebServer) covers the unauthenticated redirect to the login page, the login page render, the correct-password exchange into the session cookie, the authenticated index (with `__DSH_BOOT__` injected through `renderIndex` and the `<base href="/">` anchor), wrong-password re-render with the failure note after the 400 ms delay, missing `password` field, oversized body (413), wrong content type (415), unsupported methods (405), and the Host-fence refusal (403) on a foreign authority. The composition's empty-password case asserts the gate registers nothing. Per-file coverage on `packages/host/devbim-auth/src/index.ts` is 100% (statements, branches, lines, functions).

End-to-end through `https://devbim.dev-bim.com/` is the same flow over TLS through the tunnel: `GET /` → 303 → `GET /devbim/login` (200 HTML in the devBIM brand with `name="password"`), `POST /devbim/login` with the right password → 303 to `/?token=<launchToken>` (relative Location keeps the exchange on the requesting origin), the token visit → 303 + `Set-Cookie: dsh-auth-…`, the cookie-bearing `GET /` → 200 with the real `<title>DevBIM</title>` and `__DSH_BOOT__` payload, and `GET /api` with the cookie → 404 (trusted host + valid session; an unauthorized request would be 401, a foreign host 403).

Doc gates pass for the new package: `verify-package-readme-model-experience` accepts the audited short-form entry, `verify-translation-pairing` records the bilingual README pair, and the doc-standard skeleton check finds the canonical 概述 / 目录 / 开发备注 headings.

## Alternatives considered

**Edit `browser-auth.ts` to serve an HTML login page instead of plain 401.** Rejected: the surface is owned upstream, the change would force an agent note + tests + session-format audit + coverage gate work on a security-sensitive file that has no model-visible counterpart, and the documented extension point already covers the deployment.

**Cloudflare Access (Zero Trust) in front of the tunnel with a Google identity.** Deferred as the next step. Cloudflare Access is the no-code Google path and fits the user's "full access through Google mail" intent, but the dashboard setup needs the user's interactive Cloudflare account (the cert.pem path only covers DNS) and the deployment surface is a personal single-user one. The password gate is the interim single-user flow; an Access overlay can replace it without touching this package's contract.

**A standalone reverse proxy with its own auth in front of the Web server.** Rejected: a new moving part and a new credential store, duplicating the cookie logic Connection already owns.

## Consequences

- New package `@deepseek-ai/dsh-host-devbim-auth` (lib + READMEs + REAL-composition test) plus a `devbim.patch.yml` row insertion and a connection-row expression override that adds `devbim.dev-bim.com` to the `/api` trust fence.
- New deployment artefacts: `~/.cloudflared/<UUID>.json` (credentials, gitignored-equivalent), `~/.cloudflared/config-devbim.yml` (the tunnel config with the documented header), and `Harness/run-tunnel-devbim.bat` (tunnel-only restart). DNS records on `dev-bim.com` now include the new CNAME.
- Repo-root `.env` (gitignored) carries the shared password; `.env.example` ships empty. `dsh-web.cmd`, `front-restart.cmd`, and `start-dsh-web-detached.ps1` load it before the dsh process spawns, and `dsh-web.cmd`/`front-restart.cmd` additionally start the tunnel window with a guard against duplicating an already-running connector.
- Gate-off behaviour is the documented default: an empty `DEVBIM_WEB_PASSWORD` registers no routes, and the token flow stays the only entry — running `dsh web` from a localhost shell behaves exactly as before.
- A wrong password costs a fixed 400 ms; there is no per-address lockout and no per-user identity. A Google / OAuth overlay is the next iteration when the single-user threat surface changes.
