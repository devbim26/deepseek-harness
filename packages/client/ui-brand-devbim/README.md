---
description: "DevBIM brand occupants for the sidebar and the blank-session hero; for deployments composing the devBIM identity instead of the official DeepSeek Harness brand."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-devbim

English | [中文](README.zh.md)

## Summary

This package gives a browser build the devBIM mark and name in the sidebar and the blank-session hero. It replaces `dsh-client-ui-brand-official` in deployments whose identity is devBIM: mount it in the browser roster through a patch overlay and disable the official brand row. The dB monogram ships as two PNG variants (blue `#1E88E5` for light surfaces, white for dark) and CSS picks one through the theme attribute the shell already toggles. It has no runtime state and does not affect model requests.

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

Mount this plugin in the browser roster of a deployment branded as devBIM, and disable the official brand row in the same overlay so exactly one occupant set holds the brand seats. Unlike the official package, registration is not profile-gated: a deployment that mounts this row is a devBIM deployment.

```yaml
- id: ui-brand-official
  disabled: true
- insert:
    - id: ui-brand-devbim
      name: '@deepseek-ai/dsh-client-ui-brand-devbim'
```

The browser title stays a build-environment concern (`DSH_CLIENT_TITLE`, baked by the client bundlers); the favicon and web manifest live in `apps/web/public`.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The sidebar pair installs as one declaration-aware registration set under the `sidebar.brand.mark` declaration, exactly like the official package; the hero mark is a second, independent set waiting on `conversation.hero.brand.mark`, so each declaring package can come and go without dragging the other seat's brand away. The browser half is [`src/client/index.ts`](src/client/index.ts); the node half is an empty Loader seat. The monogram artwork is embedded as base64 data URIs ([`src/client/artwork.ts`](src/client/artwork.ts)) cropped to the glyph bounds, so the package carries no external asset files.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-sidebar](../ui-sidebar/README.md) — declares `sidebar.brand.mark` and `sidebar.brand.name` and renders their fallbacks.
- [ui-conversation](../ui-conversation/README.md) — declares `conversation.hero.brand.mark` in the hero.
- [ui-brand-official](../ui-brand-official/README.md) — the DeepSeek Harness occupants these seats replace.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Raster artwork** — the monogram is a cropped PNG, not a vector path; both theme variants ride in one bundle (~8 KB base64 total). A vector trace can replace them without touching the slot contract.
- **The browser title is independent** — `DSH_CLIENT_TITLE` selects title text at build time rather than through a UI slot.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The brand kit source is the devBIM branding folder (`db_blue.png` / `db_white.png`); the glyph crop bounds were 210x122 of the 500x500 source canvas.

</details>

**Runtime invariant:** No companion is published. The package retains no mutable state, and its three slot occupants install and leave through two transactional effects.
