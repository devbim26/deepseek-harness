---
description: "north-waterfront brand occupants for the sidebar and the blank-session hero; for deployments composing the north-waterfront identity instead of the official DeepSeek Harness brand."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-north-waterfront

English | [中文](README.zh.md)

## Summary

This package gives a browser build the north-waterfront mark and name in the sidebar and the blank-session hero. It replaces `dsh-client-ui-brand-official` in deployments whose identity is north-waterfront: mount it in the browser roster through a patch overlay and disable the official brand row. The mark is a text badge (NW initials on the `#1E88E5` accent tile) rather than image artwork, so it renders identically on light and dark surfaces and carries no asset bytes. It has no runtime state and does not affect model requests.

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

Mount this plugin in the browser roster of a deployment branded as north-waterfront, and disable the official brand row in the same overlay so exactly one occupant set holds the brand seats. Unlike the official package, registration is not profile-gated: a deployment that mounts this row is a north-waterfront deployment.

```yaml
- id: ui-brand-official
  disabled: true
- insert:
    - id: ui-brand-north-waterfront
      name: '@deepseek-ai/dsh-client-ui-brand-north-waterfront'
```

The browser title defaults to the build-environment value (`DSH_CLIENT_TITLE`, baked by the client bundlers); a deployment that brands the tab title overrides it through `dsh-host-devbim-auth`'s `indexTitle` config, which rewrites every served index render. The favicon and web manifest live in `apps/web/public`.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The sidebar pair installs as one declaration-aware registration set under the `sidebar.brand.mark` declaration, exactly like the official and devBIM packages; the hero mark is a second, independent set waiting on `conversation.hero.brand.mark`, so each declaring package can come and go without dragging the other seat's brand away. Brand copy is locale-owned: the package registers its `ui-brand-north-waterfront` dictionaries and each occupant renders the framework-injected `t` seat, so no user-visible text is hard-coded. The browser half is [`src/client/index.ts`](src/client/index.ts); the node half is an empty Loader seat. The badge is plain styled text, so the package carries no asset files.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-sidebar](../ui-sidebar/README.md) — declares `sidebar.brand.mark` and `sidebar.brand.name` and renders their fallbacks.
- [ui-conversation](../ui-conversation/README.md) — declares `conversation.hero.brand.mark` in the hero.
- [ui-brand-devbim](../ui-brand-devbim/README.md) — the devBIM occupants of the same seats, with raster artwork instead of the text badge.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No raster or vector artwork** — the badge is styled text; a designed NW glyph can replace it without touching the slot contract.
- **The browser title is independent of the slots** — it defaults to the build-time `DSH_CLIENT_TITLE`; the `dsh-host-devbim-auth` `indexTitle` config overrides it per deployment at serve time.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The brand was introduced for the north-waterfront.dev-bim.com client site alongside the configurable entry copy in `dsh-host-devbim-auth`; the accent reuses the deployment family's `#1E88E5` blue, and the badge renders one variant for both themes.

</details>

**Runtime invariant:** No companion is published. The package retains no mutable state, and its three slot occupants install and leave through two transactional effects beside the one dictionary-registration effect.
