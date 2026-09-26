# Agent Note: devBIM brand occupants — a replacement brand package composed by overlay

Status: implemented

English | [中文](2026-09-10-devbim-brand-occupants.zh.md)

## Problem

This checkout deploys the Web client under the devBIM identity, not DeepSeek's own. The shell's brand seats are generic slots (`sidebar.brand.mark`, `sidebar.brand.name`, `conversation.hero.brand.mark`) whose official occupants (`dsh-client-ui-brand-official`) register only in the `official` build profile; without a replacement, every deployment shows the shell's fish fallbacks. The deployment also needs its own browser title, favicon, and web manifest, which are build-environment and `apps/web/public` concerns outside the slot system.

## Decision

`dsh-client-ui-brand-devbim` occupies the three brand seats unconditionally: the sidebar pair as one declaration-aware registration set under the `sidebar.brand.mark` declaration (the official package's grouping), and the hero mark as an independent set waiting on `conversation.hero.brand.mark`, because the two seats have different declarers and each must survive the other's absence. The dB monogram ships as two cropped PNG data URIs (glyph `#1E88E5` on light, white on dark, 210x122 of the 500x500 brand-kit canvas) embedded in `src/client/artwork.ts`; CSS in a module stylesheet picks the variant through `body[data-ds-dark-theme]`, which the ui-theme boot row toggles, so the React tree stays theme-free. The wordmark is styled text (`dev` in the surrounding label color, `BIM` in the brand blue).

Deployment composition stays out of the shipped bundle rows: `packages/bundle/web-app/devbim.patch.yml` disables the official brand row and inserts the devBIM row, and the launcher passes it with `dsh web --patch`. The overlay lives inside the bundle directory because entry-local roster resolution resolves a row's package from the tree that owns the row — the bundle's own `node_modules` link, not the repository root. The package is a dependency of `dsh-web-app` for that link. `DSH_CLIENT_TITLE=DevBIM` is set for the client bundler passes (it bakes both the plugin bundles' defines and the Vite document title), and `apps/web/public/favicon.svg` + `manifest.webmanifest` carry the devBIM name and monogram.

## Alternatives considered

- **Editing `dsh-web-app`'s `cordis.patch.yml` rows in place** — a tracked upstream layer; every pull would conflict with the deployment's identity. The `--patch` overlay applies after the profile's own layers with no upstream edit beyond the one dependency line.
- **Profile-gated registration like the official package** — gating exists to keep one artifact able to render either identity; this checkout has exactly one identity, so the gate would be dead configuration.
- **One nested registration set for all three seats** — ties the hero occupant to the sidebar declaration; a deployment variant without the sidebar would silently lose the hero brand too.

## Consequences

The deployment's browser surface reads devBIM end to end: sidebar mark and wordmark, blank-session hero, tab title, favicon, and installed-app manifest. The cost is a second brand package to carry through client-catalog regeneration (`gen-client-catalog` picks the new occupants up automatically) and ~8 KB of base64 artwork in the browser bundle. Raster artwork bounds the monogram's crispness at large sizes; a vector trace can replace the data URIs later without touching the slot contract.
