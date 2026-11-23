# north-waterfront NW Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the devBIM brand with the NW (north-waterfront) brand on the client site north-waterfront.dev-bim.com while the internal site keeps devBIM.

**Architecture:** A new sibling client plugin `@deepseek-ai/dsh-client-ui-brand-north-waterfront` (text badge + wordmark, no rasters) occupies the same three browser-brand slots `ui-brand-devbim` occupies today. The shared password gate `@deepseek-ai/dsh-host-devbim-auth` gains validated config fields for its page title and wordmark, defaulting to the current devBIM copy, so the client patch passes the NW copy and the internal deployment changes nothing. The client patch, its persona prefix, and the launcher's tab title switch to NW wording.

**Tech Stack:** TypeScript ESM, Cordis plugins/slots, vitest (jsdom client specs via per-file pragma), CSS modules, tsdown bundling, z (schemastery) config validation.

**Approved design (user-approved 2026-11-13):** text wordmark, full scope (slots + gate page + tab title + persona), approach 1 (sibling package + config fields; no package rename).

## Global Constraints

- Branch: `webUI`. Do not push; commit locally only.
- ESM everywhere; local imports use `.ts` extensions.
- Every export has concise JSDoc; function-like exports include `@param`/`@returns` (`verify-export-jsdoc`).
- New web bare plugins appear in the consuming bundle's `dependencies` (`verify-cordis-config`): add `@deepseek-ai/dsh-client-ui-brand-north-waterfront: workspace:*` to `packages/bundle/web-app/package.json`.
- DSH workspace deps use `workspace:*` (bundle) / `workspace:^` (package devDependencies).
- Package READMEs are bilingual pairs with `README.i18n.yaml` recorded via `pnpm run verify-translation-pairing --write <path>/README.md`; English copy in sentence case; one physical line per paragraph.
- Client UI copy is locale-owned; brand names are exempt (precedent: `ui-brand-devbim` hardcodes "devBIM").
- Files end with exactly one trailing newline.
- `packages/client/ui-brand-devbim` and the internal `devbim.patch.yml` MUST remain untouched; defaults of every new config field reproduce today's internal behavior.
- No new `as unknown` casts; the test plumbing mirrors the existing `as never` slot fixture from `ui-brand-devbim`.
- Per-file 100% coverage applies to everything under `packages/*/*/src` (`test:coverage` is the CI gate).
- Keep comments local; no reasoning transcripts in code; docs/JSDoc state complete contracts.
- Repo root: `C:\Users\Lenovo\Desktop\проект SOFT_2\Models FIN\Harness`. Run all commands from the repo root (Git Bash).

---

### Task 1: NW brand package (code + tests)

**Files:**
- Create: `packages/client/ui-brand-north-waterfront/package.json`
- Create: `packages/client/ui-brand-north-waterfront/tsconfig.json`
- Create: `packages/client/ui-brand-north-waterfront/tsdown.config.ts`
- Create: `packages/client/ui-brand-north-waterfront/src/css-modules.d.ts`
- Create: `packages/client/ui-brand-north-waterfront/src/index.ts`
- Create: `packages/client/ui-brand-north-waterfront/src/client/index.ts`
- Create: `packages/client/ui-brand-north-waterfront/src/client/Brand.tsx`
- Create: `packages/client/ui-brand-north-waterfront/src/client/Brand.module.css`
- Test: `packages/client/ui-brand-north-waterfront/tests/browser-plugin.client.spec.tsx`

**Interfaces:**
- Consumes: slot contract of `@deepseek-ai/dsh-client-ui-sidebar/client` (`SidebarBrandMarkOwnerProps`, `SidebarBrandNameOwnerProps`) and `@deepseek-ai/dsh-client-ui-conversation/client` (`HeroBrandMarkOwnerProps`); `slots` service (`ctx.slots.inject`, `ctx.slots.register`).
- Produces: browser plugin exports `inject = ['slots']` and `apply(ctx)` filling `sidebar.brand.mark`, `sidebar.brand.name`, `conversation.hero.brand.mark`; node half exports empty `apply()`; components `NorthWaterfrontBrandMark`, `NorthWaterfrontBrandName`, `NorthWaterfrontHeroMark`. Task 4 consumes the package by name.

- [ ] **Step 1: Create the package scaffold (four config files)**

`packages/client/ui-brand-north-waterfront/package.json`:

```json
{
  "name": "@deepseek-ai/dsh-client-ui-brand-north-waterfront",
  "description": "north-waterfront brand occupants for the Web client's sidebar and hero brand slots",
  "version": "0.1.0",
  "publishConfig": {
    "access": "public"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/deepseek-ai/deepseek-harness.git",
    "directory": "packages/client/ui-brand-north-waterfront"
  },
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/types/index.d.ts",
      "default": "./lib/index.js"
    },
    "./client": {
      "types": "./lib/types/client/index.d.ts",
      "default": "./lib/client.js"
    },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-ui-renderer",
        "@deepseek-ai/dsh-client-ui-sidebar"
      ],
      "platform": "web"
    }
  },
  "scripts": {
    "bundle": "tsdown",
    "watch": "tsdown --watch"
  },
  "license": "MIT",
  "peerDependencies": {
    "@deepseek-ai/cordis": "workspace:^"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "workspace:^",
    "@deepseek-ai/dsh-client-ui-conversation": "workspace:^",
    "@deepseek-ai/dsh-client-ui-renderer": "workspace:^",
    "@deepseek-ai/dsh-client-ui-sidebar": "workspace:^",
    "@testing-library/react": "^16.1.0",
    "@types/react": "~18.3.1",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "files": [
    "lib/index.js",
    "lib/client.js",
    "lib/types/**/*.d.ts"
  ]
}
```

`packages/client/ui-brand-north-waterfront/tsconfig.json`:

```json
{
  "extends": "../../../tsconfig.base.client.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "lib/types"
  },
  "include": [
    "src"
  ],
  "references": [
    {
      "path": "../../../vendor/cordis"
    },
    {
      "path": "../ui-conversation/tsconfig.client.json"
    },
    {
      "path": "../ui-renderer"
    },
    {
      "path": "../ui-sidebar"
    },
    {
      "path": "../ui-slots"
    }
  ]
}
```

`packages/client/ui-brand-north-waterfront/tsdown.config.ts`:

```ts
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle(import.meta.dirname, ['lib/types/index.js'])
```

`packages/client/ui-brand-north-waterfront/src/css-modules.d.ts`:

```ts
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css'
```

- [ ] **Step 2: Write the failing test**

Create `packages/client/ui-brand-north-waterfront/tests/browser-plugin.client.spec.tsx` (mirrors the devBIM spec; text-only assertions replace the image-pair ones):

```tsx
// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import {
  NorthWaterfrontBrandMark, NorthWaterfrontBrandName, NorthWaterfrontHeroMark,
} from '../src/client/Brand.tsx'
import { apply as hostApply } from '../src/index.ts'

afterEach(() => {
  cleanup()
  document.body.removeAttribute('data-ds-dark-theme')
})

const SIDEBAR_HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
] as const

const HERO_HOLE = 'conversation.hero.brand.mark'

const BRAND_HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'conversation.hero.brand.mark',
] as const

/** Flush every pending microtask chain behind the two independent inject sets. */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

async function bench(initial: readonly string[] = [...SIDEBAR_HOLES, HERO_HOLE]) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const registerWith = (holes: readonly string[]) => slots.register({
    name: 'root',
    children: Object.fromEntries(holes.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  const declareHoles = () => registerWith([...SIDEBAR_HOLES, HERO_HOLE])
  const disposeHoles = initial.length > 0 ? registerWith(initial) : undefined
  return { ctx, slots, declareHoles, disposeHoles }
}

describe('north-waterfront browser-brand plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the slot service it uses', () => {
    expect(inject).toEqual(['slots'])
  })

  it('fills every brand seat once declared and removes every occupant on teardown', async () => {
    const before = await bench()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of BRAND_HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    before.disposeHoles?.()
    for (const hole of BRAND_HOLES) expect(before.slots.entries(hole)).toHaveLength(0)
    before.declareHoles()
    await settle()
    for (const hole of BRAND_HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    await fiber.dispose()
    for (const hole of BRAND_HOLES) expect(before.slots.entries(hole)).toHaveLength(0)

    const after = await bench([])
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of BRAND_HOLES) expect(after.slots.entries(hole)).toHaveLength(0)
    after.declareHoles()
    await settle()
    for (const hole of BRAND_HOLES) expect(after.slots.entries(hole)).toHaveLength(1)
  })

  it('keeps the hero occupant while the sidebar declaration is absent', async () => {
    const subject = await bench([HERO_HOLE])
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    expect(subject.slots.entries(HERO_HOLE)).toHaveLength(1)
    for (const hole of SIDEBAR_HOLES) expect(subject.slots.entries(hole)).toHaveLength(0)
  })

  it('renders a text badge with no image assets at every requested size', () => {
    const mark = render(<NorthWaterfrontBrandMark size={34} />)
    expect(mark.container.querySelectorAll('img')).toHaveLength(0)
    const badge = mark.container.firstElementChild
    expect(badge?.textContent).toBe('NW')
    expect(badge?.getAttribute('style')).toContain('width: 34px')
    expect(badge?.getAttribute('style')).toContain('height: 34px')
    mark.rerender(<NorthWaterfrontBrandMark size={24} />)
    expect(mark.container.firstElementChild?.getAttribute('style')).toContain('width: 24px')
    mark.unmount()

    const hero = render(<NorthWaterfrontHeroMark size={34} className="host-hero" />)
    expect(hero.container.firstElementChild?.getAttribute('class')).toContain('host-hero')
    expect(hero.container.firstElementChild?.textContent).toBe('NW')
  })

  it('renders the wordmark with the accented waterfront half', () => {
    const name = render(<NorthWaterfrontBrandName />)
    expect(name.container.textContent).toBe('north-waterfront')
    expect(name.container.querySelector('span > span')?.textContent).toBe('waterfront')
  })
})
```

- [ ] **Step 3: Link the workspace**

Run: `pnpm install`
Expected: install succeeds; the new workspace package links without errors.

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/client/ui-brand-north-waterfront`
Expected: FAIL — cannot resolve `../src/client/index.ts` (implementation missing).

- [ ] **Step 5: Implement the package sources**

`packages/client/ui-brand-north-waterfront/src/index.ts`:

```ts
/**
 * north-waterfront browser-brand plugin, node half. The empty apply gives
 * Loader a host-side row while the browser half ships through `exports["./client"]`.
 */

/** Host plugin body — this package contributes browser presentation only. */
export function apply(): void {}
```

`packages/client/ui-brand-north-waterfront/src/client/index.ts`:

```ts
/** north-waterfront occupants for the generic browser-brand slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { NorthWaterfrontBrandMark, NorthWaterfrontBrandName, NorthWaterfrontHeroMark } from './Brand.tsx'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Fill the brand seats as declaration-aware registration sets: the sidebar
 * pair groups under the sidebar brand-mark declaration (one declarer), and
 * the hero mark waits on the conversation hero declaration independently.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark' }, NorthWaterfrontBrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name' }, NorthWaterfrontBrandName)
    }))
  ctx.slots.inject('conversation.hero.brand.mark', function* () {
    yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, NorthWaterfrontHeroMark)
  })
}
```

`packages/client/ui-brand-north-waterfront/src/client/Brand.tsx`:

```tsx
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  SidebarBrandMarkOwnerProps, SidebarBrandNameOwnerProps,
} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './Brand.module.css'

/** Props of the NW badge: the size every brand seat requests plus the hero's layout class. */
export type NorthWaterfrontMarkProps = SidebarBrandMarkOwnerProps & Pick<HeroBrandMarkOwnerProps, 'className'>

/**
 * Render the NW badge: brand initials on an accent tile, identical on both
 * themes, so the seat needs no theme-dependent artwork.
 * @param props.size - requested square edge in pixels.
 * @param props.className - host class preserving the surrounding mark geometry.
 * @returns the badge element (aria-hidden text; pair with the wordmark for accessibility).
 */
export function NorthWaterfrontBrandMark({ size, className }: NorthWaterfrontMarkProps) {
  return (
    <span
      className={className ? `${css.mark} ${className}` : css.mark}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      NW
    </span>
  )
}

/**
 * Render the north-waterfront wordmark without its independently slotted badge.
 * @returns the wordmark text element.
 */
export function NorthWaterfrontBrandName({}: SidebarBrandNameOwnerProps) {
  return <span className={css.name}>north-<span className={css.accent}>waterfront</span></span>
}

/**
 * Render the NW badge for the blank-session hero at the requested size.
 * @param props.size - requested square edge in pixels.
 * @param props.className - host class preserving the surrounding mark geometry.
 * @returns the badge element.
 */
export function NorthWaterfrontHeroMark({ size, className }: HeroBrandMarkOwnerProps) {
  return <NorthWaterfrontBrandMark size={size} className={className} />
}
```

`packages/client/ui-brand-north-waterfront/src/client/Brand.module.css`:

```css
/* north-waterfront brand presentation: one accent tile serves both themes,
 * so there is no per-theme artwork and no dependence on the shell's
 * body[data-ds-dark-theme] toggle. The accent matches the devBIM brand
 * blue already used by the deployment family. */

.mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: #fff;
  background: #1e88e5;
  border-radius: 18%;
  user-select: none;
}

.name {
  font-weight: 700;
  font-size: 18px;
  line-height: 24px;
  letter-spacing: 0.2px;
}

.accent {
  color: #1e88e5;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/client/ui-brand-north-waterfront`
Expected: PASS — 6 tests green.

- [ ] **Step 7: Commit**

```bash
git add packages/client/ui-brand-north-waterfront
git commit -m "feat(web-app): add the north-waterfront client brand package"
```

---

### Task 2: NW package READMEs + resolver-manifest registration

**Files:**
- Create: `packages/client/ui-brand-north-waterfront/README.md`
- Create: `packages/client/ui-brand-north-waterfront/README.zh.md`
- Create: `packages/client/ui-brand-north-waterfront/README.i18n.yaml`
- Modify: `packages/bundle/web-app/package.json` (dependencies block, alphabetical neighbors around line 86)

**Interfaces:**
- Consumes: the package created in Task 1.
- Produces: `verify-cordis-config`-satisfying bundle dependency so Task 4's patch row resolves; bilingual README pair that passes the docs gates.

- [ ] **Step 1: Write the English README**

`packages/client/ui-brand-north-waterfront/README.md` (frontmatter + sections; every paragraph is one physical line):

```markdown
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

The browser title stays a build-environment concern (`DSH_CLIENT_TITLE`, baked by the client bundlers); the favicon and web manifest live in `apps/web/public`.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The sidebar pair installs as one declaration-aware registration set under the `sidebar.brand.mark` declaration, exactly like the official and devBIM packages; the hero mark is a second, independent set waiting on `conversation.hero.brand.mark`, so each declaring package can come and go without dragging the other seat's brand away. The browser half is [`src/client/index.ts`](src/client/index.ts); the node half is an empty Loader seat. The badge is plain styled text, so the package carries no asset files.

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
- **The browser title is independent** — `DSH_CLIENT_TITLE` selects title text at build time rather than through a UI slot.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The brand was introduced for the north-waterfront.dev-bim.com client site alongside the configurable entry copy in `dsh-host-devbim-auth`; the accent reuses the deployment family's `#1E88E5` blue, and the badge renders one variant for both themes.

</details>

**Runtime invariant:** No companion is published. The package retains no mutable state, and its three slot occupants install and leave through two transactional effects.
```

- [ ] **Step 2: Write the Chinese README**

`packages/client/ui-brand-north-waterfront/README.zh.md` — the section-for-section Chinese translation of Step 1 (same frontmatter shape, same anchors, `English | [中文](README.zh.md)` line becomes `[English](README.md) | 中文`). Translate faithfully; keep code blocks, package names, slot names, and `#1E88E5` as-is.

- [ ] **Step 3: Record the translation pairing**

Run: `pnpm run verify-translation-pairing --write packages/client/ui-brand-north-waterfront/README.md`
Expected: writes `README.i18n.yaml` with both blob hashes; command exits 0.

- [ ] **Step 4: Register the package in the web bundle's resolver manifest**

In `packages/bundle/web-app/package.json`, add to `dependencies` next to the other brand rows:

```json
    "@deepseek-ai/dsh-client-ui-brand-north-waterfront": "workspace:*",
```

Then run `pnpm install` and confirm the lockfile picks up the new link.

- [ ] **Step 5: Run the quick docs gates**

Run: `pnpm run test:docs`
Expected: PASS (README structure, pairing, prose checks).

- [ ] **Step 6: Commit**

```bash
git add packages/client/ui-brand-north-waterfront/README.md packages/client/ui-brand-north-waterfront/README.zh.md packages/client/ui-brand-north-waterfront/README.i18n.yaml packages/bundle/web-app/package.json pnpm-lock.yaml
git commit -m "docs(web-app): document the north-waterfront brand package and register it in the web bundle"
```

---

### Task 3: devbim-auth configurable entry copy (title + wordmark)

**Files:**
- Modify: `packages/host/devbim-auth/src/index.ts` (Config at lines 32–50, `loginPage` at 104–168, call sites at 223 and 260)
- Modify: `packages/host/devbim-auth/tests/devbim-auth.spec.ts`
- Modify: `packages/host/devbim-auth/README.md`, `packages/host/devbim-auth/README.zh.md`, `packages/host/devbim-auth/README.i18n.yaml`

**Interfaces:**
- Consumes: existing `Config` schema flow (`apply(ctx, config)`).
- Produces: `Config` fields `entryTitle: string` (default `'devBIM — вход'`), `wordmarkLead: string` (default `'dev'`), `wordmarkAccent: string` (default `'BIM'`); `loginPage(wrongPassword: boolean, config: Config)`. Task 4's patch sets the NW values.

- [ ] **Step 1: Extend the failing tests**

In `packages/host/devbim-auth/tests/devbim-auth.spec.ts`:

In the existing main test, next to the `dev<span>BIM</span>` assertion (line ~137), add the default-title assertion:

```ts
    expect(page.body).toContain('<title>devBIM — вход</title>')
```

Add two tests inside `describe('real Loader composition')`:

```ts
  it('renders the entry title and wordmark from config overrides', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition(() => [
      ...activeGate('sekret'),
      "    entryTitle: 'NW — вход'",
      "    wordmarkLead: 'NW'",
      "    wordmarkAccent: ''",
    ])
    const port = boundPort(loaded.webServer)
    const page = await request(port, '/devbim/login')
    expect(page).toMatchObject({ status: 200, type: 'text/html; charset=utf-8' })
    expect(page.body).toContain('<title>NW — вход</title>')
    expect(page.body).toContain('>NW<span></span>')
    expect(page.body).not.toContain('devBIM')
  })

  it('escapes HTML-significant characters in the configured entry copy', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition(() => [
      ...activeGate('sekret'),
      "    entryTitle: '<script>alert(1)</script>'",
      "    wordmarkLead: 'a&b'",
    ])
    const page = await request(boundPort(loaded.webServer), '/devbim/login')
    expect(page.body).toContain('<title>&lt;script&gt;alert(1)&lt;/script&gt;</title>')
    expect(page.body).toContain('>a&amp;b<span>')
    expect(page.body).not.toContain('<script>')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run packages/host/devbim-auth`
Expected: FAIL — the schema rejects unknown config keys and the title assertion finds the old hardcoded copy.

- [ ] **Step 3: Implement the config fields**

In `packages/host/devbim-auth/src/index.ts`:

Extend the `Config` interface and schema:

```ts
/** Plugin config: the shared entry secret, the dist anchor override, and the branded entry copy. */
export interface Config {
  /** Shared entry password; empty disables the gate entirely. */
  password: string
  /**
   * Absolute index.html path the gate serves for authenticated visits.
   * Empty resolves the built Web frontend dist, the same manifest anchor
   * the Web bundle glue uses.
   */
  distIndex: string
  /** Login-page `<title>` text. */
  entryTitle: string
  /** Plain-coloured lead of the login wordmark. */
  wordmarkLead: string
  /** Accented tail of the login wordmark. */
  wordmarkAccent: string
}

export const Config: z<Config> = z.object({
  password: z.string().default(''),
  distIndex: z.string().default(''),
  entryTitle: z.string().default('devBIM — вход'),
  wordmarkLead: z.string().default('dev'),
  wordmarkAccent: z.string().default('BIM'),
})
```

Add an escaper next to `wrongPasswordNote`:

```ts
/** Escape config-supplied entry copy for inline HTML interpolation. */
function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll(''', '&#39;')
}
```

Change the `loginPage` signature and JSDoc, replacing the two hardcoded spots:

```ts
/**
 * The self-contained password page; no asset requests precede the session.
 *
 * @param wrongPassword - render the wrong-password error block after a failed attempt.
 * @param config - validated {@link Config} carrying the entry title and wordmark halves.
 * @returns the complete login page as an HTML string.
 */
export function loginPage(wrongPassword: boolean, config: Config): string {
```

In the template, replace `<title>devBIM — вход</title>` with:

```
<title>${escapeHtml(config.entryTitle)}</title>
```

and `<div class="wordmark">dev<span>BIM</span></div>` with:

```
  <div class="wordmark">${escapeHtml(config.wordmarkLead)}<span>${escapeHtml(config.wordmarkAccent)}</span></div>
```

Update both call sites (lines ~223 and ~260) to pass the closure config: `res.end(loginPage(false, config))` and `res.end(loginPage(true, config))`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run packages/host/devbim-auth`
Expected: PASS — all existing tests plus the two new ones green.

- [ ] **Step 5: Update the package READMEs**

In `packages/host/devbim-auth/README.md` (and the matching `README.zh.md` section): extend the config documentation with the three fields — `entryTitle` (login-page tab title), `wordmarkLead`/`wordmarkAccent` (plain and accented halves of the login wordmark), each defaulting to the devBIM copy so existing deployments render identically; note that values are HTML-escaped. Then re-record the pairing:

Run: `pnpm run verify-translation-pairing --write packages/host/devbim-auth/README.md`
Expected: `README.i18n.yaml` updated; command exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/host/devbim-auth
git commit -m "feat(web-app): make the devbim-auth entry title and wordmark configurable"
```

---

### Task 4: Switch the client site to NW (patch + launcher)

**Files:**
- Modify: `packages/bundle/web-app/client-north-waterfront.patch.yml` (header comment, brand insert, auth config, persona)
- Modify: `dsh-web-north-waterfront.cmd` (`:do_start`, right before the `call %PNPM% dsh web` line)

**Interfaces:**
- Consumes: Task 1 package name; Task 3 config fields.
- Produces: the deployed client composition carrying NW branding end to end.

- [ ] **Step 0: Deal with the unrelated pending patch diff**

The patch file carries an uncommitted permission-presets change (visible in `git diff`). That is a separate concern: commit it first on its own, or get the user's call, before touching the file:

```bash
git diff -- packages/bundle/web-app/client-north-waterfront.patch.yml
```

If still uncommitted, ask the user, then commit it alone (e.g. `feat(web-app): pin workspace-write as the north-waterfront session preset`) so the rebrand commit stays clean.

- [ ] **Step 1: Edit the patch**

`packages/bundle/web-app/client-north-waterfront.patch.yml`:

Header comment: change "Keeps the devBIM brand and password gate" to "Keeps the NW (north-waterfront) brand and password gate".

Brand insert — replace:

```yaml
- insert:
    # devBIM occupants for the sidebar brand row and the blank-session hero.
    - id: ui-brand-devbim
      name: '@deepseek-ai/dsh-client-ui-brand-devbim'
```

with:

```yaml
- insert:
    # north-waterfront occupants for the sidebar brand row and the blank-session hero.
    - id: ui-brand-north-waterfront
      name: '@deepseek-ai/dsh-client-ui-brand-north-waterfront'
```

Gate config — replace:

```yaml
    - id: devbim-auth
      name: '@deepseek-ai/dsh-host-devbim-auth'
      config:
        password: !!js process.env.DEVBIM_WEB_PASSWORD ?? ''
```

with:

```yaml
    - id: devbim-auth
      name: '@deepseek-ai/dsh-host-devbim-auth'
      config:
        password: !!js process.env.DEVBIM_WEB_PASSWORD ?? ''
        entryTitle: 'NW — вход'
        wordmarkLead: 'NW'
        wordmarkAccent: ''
```

Persona — replace `You are the drawings assistant of the devBIM client site, powered by the {{model}} model.` with `You are the drawings assistant of the north-waterfront client site, powered by the {{model}} model.`

- [ ] **Step 2: Edit the launcher**

In `dsh-web-north-waterfront.cmd`, directly before `call %PNPM% dsh web --patch ...` insert (UTF-8 no BOM, CRLF preserved):

```bat
rem Client tab title: baked into the client bundle when dsh web builds it.
set "DSH_CLIENT_TITLE=NW — Северный берег"
```

- [ ] **Step 3: Verify the composition still parses**

Run: `pnpm run verify-cordis-config`
Expected: PASS — the bare NW plugin resolves through the bundle manifest added in Task 2, no unknown plugin ids.

- [ ] **Step 4: Commit**

```bash
git add packages/bundle/web-app/client-north-waterfront.patch.yml dsh-web-north-waterfront.cmd
git commit -m "feat(web-app): brand the north-waterfront client site as NW"
```

---

### Task 5: Agent Note + verification gates

**Files:**
- Create: `.agents/notes/implemented/architecture/2026-11-13-north-waterfront-nw-brand.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: the durable decision record and green local gates.

- [ ] **Step 1: Write the Agent Note**

Read `.agents/notes/README.md` first and follow its current note format exactly. Content to record (file `.agents/notes/implemented/architecture/2026-11-13-north-waterfront-nw-brand.md`): the north-waterfront client site is branded through a dedicated sibling package `ui-brand-north-waterfront` rather than reconfiguring `ui-brand-devbim`, because the internal deployment (`devbim.patch.yml`) shares that package and keeps the devBIM identity; the password gate stays one shared package (`dsh-host-devbim-auth`) with `entryTitle`/`wordmarkLead`/`wordmarkAccent` config fields (devBIM defaults) instead of a duplicated NW gate, per the dependencies-over-hand-rolling and no-hardcoded-tunables policies; the `/devbim/login` route path is a technical URL, not brand copy, and stays unchanged; the browser tab title is deployment env (`DSH_CLIENT_TITLE` in the launcher), and favicon/manifest assets remain the shared `apps/web/public` set — a client-specific favicon is deferred.

- [ ] **Step 2: Focused tests**

Run: `pnpm exec vitest run packages/client/ui-brand-north-waterfront packages/host/devbim-auth`
Expected: PASS.

- [ ] **Step 3: Per-file coverage for the touched sources**

Run: `pnpm exec vitest run --coverage.enabled --coverage.include="packages/client/ui-brand-north-waterfront/src/**" --coverage.include="packages/host/devbim-auth/src/**" packages/client/ui-brand-north-waterfront packages/host/devbim-auth`
Expected: 100% lines/branches/functions on both `src` trees.

- [ ] **Step 4: Clone detection and docs**

Run: `pnpm run duplication && pnpm run test:docs`
Expected: PASS. If duplication flags the two brand packages' shared structure, restructure the NW implementation (not the devBIM one) to silence the clone — e.g. extract only what the gate actually reports — and rerun.

- [ ] **Step 5: Build and hygiene**

Run: `pnpm run build`
Expected: `build:artifacts` + `build:check` PASS (typecheck against built output).

Run: `pnpm run hygiene`
Expected: PASS. If it flags the dependency catalog for the new package, run the catalog generator it names, then rerun.

- [ ] **Step 6: Commit the note**

```bash
git add .agents/notes/implemented/architecture/2026-11-13-north-waterfront-nw-brand.md
git commit -m "docs: record the north-waterfront NW brand decision"
```

---

### Task 6 (with the user): live smoke of the client site

Not committable code — a runtime check on Windows.

- [ ] **Step 1: Restart the site**

Run: `dsh-web-north-waterfront.cmd restart` (from the repo root; needs the portable Node under `.tools\node`).

- [ ] **Step 2: Inspect `http://127.0.0.1:3081/` in a browser**

Expected: password page titled «NW — вход» with the NW wordmark; after login, the sidebar shows the NW badge + «north-waterfront», the blank-session hero shows the NW badge, and the tab title is «NW — Северный берег». The internal site (`dsh-web.cmd`) still shows devBIM everywhere. Report any deviation before pushing.
