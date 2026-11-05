---
description: "Password gate for the devBIM Web deployment: unauthenticated index visits redirect to a self-contained password page whose correct submission exchanges for Connection's persistent browser-session cookie."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-devbim-auth

English | [中文](README.zh.md)

## Summary

Gate the devBIM Web deployment behind one shared password. The plugin registers the exact `/` route: an unauthenticated visit redirects to `/devbim/login`, a self-contained password page in the devBIM brand. The correct password is exchanged, through Connection's process launch token, for the persistent browser-session cookie Connection already mints, so every downstream fence (`/api`, upgrades) accepts the session unchanged. An empty `password` config registers no routes and leaves the token flow the only entry.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose this plugin in the devBIM Web deployment layer (the `devbim.patch.yml` overlay of [`dsh-web-app`](../../bundle/web-app/README.md)) when the surface is reached through a public hostname and reopening the printed token URL is impractical. It needs one config value — the shared password, sourced from the deployment environment, never committed.

### Minimal configuration

```yaml
- id: devbim-auth
  name: '@deepseek-ai/dsh-host-devbim-auth'
  config:
    password: !!js process.env.DEVBIM_WEB_PASSWORD ?? ''
```

`password` is the deployment-varying secret; empty disables the gate (no routes register, and the fallback keeps serving the index through the token flow). `distIndex` overrides the built frontend index location, which otherwise resolves from the `@deepseek-ai/dsh-web-frontend` manifest — the same anchor the Web bundle glue uses — so a normal deployment never sets it.

### What the gate enforces

`GET/HEAD /` redirects to `/devbim/login` (303) when the request carries neither a valid session cookie nor a root token; other methods are answered 405. `GET /devbim/login` serves the self-contained password page (`no-store`, `noindex`). `POST /devbim/login` with `application/x-www-form-urlencoded` compares the `password` field against the configured value in constant time and answers a relative `/?token=…` 303 on match, so the token exchange and cookie minting stay on the requesting origin and stay owned by Connection; a wrong password re-renders the page with a failure note after a fixed 400 ms delay. The login attempt is fenced by Connection's `/api` Host/cross-site fence — a foreign Host header or a browser cross-site marker is refused 403 — and bodies over 2 KiB are refused 413. A root `?token=` visit is delegated to `ctx.connection.authorizeIndex` unchanged: a valid token mints the cookie and redirects to `/`, an invalid one keeps Connection's plain 401.

### Observable failures

An unreadable configured index is a broken deployment, not a missing page: the read failure propagates to the webserver's per-request guard (logged, answered 400). Wrong content types are answered 415, oversized login bodies 413, and unauthenticated non-login paths keep their existing owners (public assets stay public; `/api` keeps its own fence).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The package is one function plugin with two exact webserver routes registered under effect scopes. The `/` route is a thin gate: token-bearing requests delegate to `authorizeIndex`, cookie-bearing ones to `requestRejection`, and both pass cases serve the index through `ctx.webServer.renderIndex` with the same `<base href="/">` anchor the fallback applies. The login route renders a template string — no client bundle, no asset requests precede the session — and on match extracts the path-and-query of `ctx.connection.authenticatedUrl()` so the redirect stays relative. The plugin adds no new credential material: the password only triggers the exchange; the session secret, cookie signing, and expiry all stay in `dsh-client-connection`.

### Extension points

None. The page text and paths are fixed deployment facts; a different brand or an identity provider is a different plugin.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [`dsh-client-connection`](../../client/connection/README.md) — the browser-session owner whose token exchange and cookie this gate reuses.
- [`dsh-host-frontend-static`](../../host/frontend-static/README.md) — the fallback owner whose index render this gate mirrors on `/`.

## Model Experience

None, as the password gate answers browser authentication requests and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when an authentication class is not yet covered. They are current package constraints, not a task backlog.

- **One shared password, no per-user identity** — the gate authenticates a deployment, not people; a Google-account flow needs an OAuth client and a per-user session record and is deliberately out of scope for this package.
- **No per-address lockout** — a wrong password costs a fixed 400 ms and nothing accumulates across addresses; a single-user deployment behind one public hostname is the assumed threat surface.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The owned relations are the two exact routes, whose register/release symmetry the webserver already probes on its reserved paths at teardown; a package-level probe would duplicate that observation against the same source.
