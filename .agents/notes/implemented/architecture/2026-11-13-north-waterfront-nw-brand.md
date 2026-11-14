# Agent Note: north-waterfront NW brand

Status: implemented

English | [中文](2026-11-13-north-waterfront-nw-brand.zh.md)

## Problem

The public client site `north-waterfront.dev-bim.com` and the internal devBIM deployment (`devbim.dev-bim.com`) run the same web bundle through separate deployment patches, and until this change every brand surface in that bundle was fixed: `ui-brand-devbim` rendered the devBIM sidebar and hero, the `dsh-host-devbim-auth` password page hardcoded its devBIM title and wordmark, and the tab title and favicon came from the shared build defaults. Serving the "Северный берег" drawings client from that bundle would show devBIM identity on the client site, and re-pointing the shared surfaces at NW would erase it from the internal site.

## Decision

**The client site is branded through the dedicated sibling package `@deepseek-ai/dsh-client-ui-brand-north-waterfront`, the password gate stays the one shared `@deepseek-ai/dsh-host-devbim-auth` behind new title config fields, and the remaining deployment identity lives in the launcher environment.** This extends the devBIM public tunnel + password gate decision (`.agents/notes/implemented/architecture/2026-11-05-devbim-public-tunnel-and-password-gate.md`) to a second deployment of the same gate.

The brand package fills the generic browser-brand slots (`sidebar.brand.mark`, `sidebar.brand.name`, `conversation.hero.brand.mark`) with NW occupants as declaration-aware registration sets. `client-north-waterfront.patch.yml` disables `ui-brand-official` and inserts the NW row; `devbim.patch.yml` keeps inserting `ui-brand-devbim`, so the internal site keeps the devBIM identity unchanged.

The password gate stays one package. `dsh-host-devbim-auth` gains the config fields `entryTitle` (default `devBIM — вход`), `wordmarkLead` (default `dev`), and `wordmarkAccent` (default `BIM`), all HTML-escaped at render; the NW patch passes `entryTitle: 'NW — вход'`, `wordmarkLead: 'NW'`, `wordmarkAccent: ''`. One gate implementation keeps the token exchange, session cookie, and Host fence owned and tested once, per dependencies-over-hand-rolling; deployment-varying text as validated Config fields with devBIM defaults, per no-hardcoded-tunables. The `/devbim/login` route path is a technical URL, not brand copy, and stays unchanged for both deployments.

The browser tab title is rewritten per request, not baked: `DSH_CLIENT_TITLE` is read by the client bundlers only at vite build time, `dsh web` never builds the bundle, and both source-launched deployments serve the same `apps/web/dist`, so a launcher env var cannot brand one site. The gate therefore also gained `indexTitle` (default empty): a non-empty value registers a `webServer.tapIndex` transform that replaces the served index `<title>` (HTML-escaped) on every index render — the gate's `/` and the SPA fallback share that pipeline while the login page renders outside it — and publishes the same value as a `dsh-product-title` meta row. The client's title projection (`AppFrame`) reads that meta row before its build-configured or localized product title, so a rewrite wins in the live tab while deployments that set no `indexTitle` keep exactly the previous env/locale behavior. The NW patch passes `indexTitle: 'NW — Северный берег'`; the internal patch sets none and keeps the localized default. The favicon and web manifest remain the shared `apps/web/public` set for every deployment; a client-specific favicon is deferred.

## Alternatives considered

**Reconfigure `ui-brand-devbim` per deployment instead of a sibling package.** Rejected: `devbim.patch.yml` composes the same package for the internal site, so the devBIM brand would move with the config or the internal patch would have to restate the old devBIM text. A sibling package lets each patch name one brand and deletes nothing from the devBIM package.

**A second gate package `dsh-host-north-waterfront-auth` with NW copy baked in.** Rejected: it would duplicate the login render, token exchange, cookie handling, and Host fence that `dsh-host-devbim-auth` already owns and tests; three string config fields cover the whole visible difference.

**Ship a north-waterfront favicon and manifest now.** Deferred: the favicon and manifest are served from the shared `apps/web/public` set with no per-deployment seam; adding one is cosmetic-only follow-up work, and both brand packages' READMEs record that shared location but not the deferral.

## Consequences

- New package `@deepseek-ai/dsh-client-ui-brand-north-waterfront` (lib, README trio, browser-plugin spec) is registered in `packages/bundle/web-app` and audited in `scripts/verify-package-readme-model-experience.ts`; `client-north-waterfront.patch.yml` composes it in place of `ui-brand-official`.
- The package carries the repository version `0.2.2-rc.2` instead of the plan's `0.1.0` because the workspace-constraints gate requires every dsh-family package manifest to carry the repository root version.
- `@deepseek-ai/dsh-host-devbim-auth` carries the three title fields with devBIM defaults, so the internal deployment, which sets none of them, renders exactly as before; per-file coverage on both packages' `src` trees is 100% lines/branches/functions.
- The two deployments keep separate brands, passwords (`.env.north-waterfront` for the client site, repo `.env` for devBIM), ports, tunnels, and DSH_HOME state, as the launcher and patches already arrange.
- Both sites serve the same favicon and manifest set and differ in the tab title through the gate's `indexTitle` config (set by the NW patch, empty on the internal deployment); giving the client site its own icons requires the deferred per-deployment asset seam.
