# План реализации: пользовательские пресеты агентов (custom agent presets)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Пользователи клиентского прода создают своих агентов через ограниченную форму (имя, описание, инструкция, инструменты из whitelist), записи хранятся как данные в `DSH_HOME`, синтезируются в пресеты через `agentPresets.register()` и выбираются в существующем чипе выбора агента.

**Architecture:** Новый хост-пакет `@deepseek-ai/dsh-agent-preset-custom` (seam: сервис `customAgentPresets` c Remote CRUD + storage-domain `custom-agent-presets` + синтез `PresetDefinition`) и клиентский пакет `@deepseek-ai/dsh-client-ui-custom-agents` (менеджер в модале, вход через новый слот `agentPreset.picker.actions` в попапе чипа). Оверлей north-waterfront включает `ui-agent-preset` и вставляет обе строки с конфигом whitelist/лимитов. Ядро agent-loop и сессия-проекция не трогаются.

**Tech Stack:** TypeScript ESM (strict), Cordis-плагины, `TypertRemoteService` + `@Remote` (typert codegen), `storage-domain` (`defineDomain`, zod), schemastery Config, React + `dsh-client-ui-*` слоты/примитивы, vitest + Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-15-custom-agent-presets-design.md`.

## Global Constraints

- Спека — источник истины. **Одна задокументированная девиация:** карантин битых записей выполняет сам storage-domain (`invalidRecords: 'backup-and-skip'` — бэкап + лог + пропуск при `open`), а не отдельный карантин-список в UI; битая запись не попадает в ростер и не роняет бут.
- Каждая регистрация — эффект: `ctx.effect()` или `yield`/возврат disposer; `agentPresets.register()` возвращает idempotent-дизпосер.
- Кодированные remote-ошибки — только `RemoteError` из `@deepseek-ai/dsh-typert-protocol`; коды объявляются через `RemoteErrorDetailsMap` (declaration merging) в `src/types.ts`. Никаких `as unknown`.
- Relative imports внутри пакета — с расширением `.ts` (`'./types.ts'`); vitest-спеки импортируют source напрямую (`'../src/index.ts'`); cross-package импорты тестов — относительные пути по source-плейну (прецедент: `packages/workspace/workspace/tests/workspace.spec.ts` импортирует `../../../storage/storage-domain/tests/helpers/memory-backend.ts`).
- peerDependencies: vendor (`@deepseek-ai/cordis`, schemastery) — `workspace:~`; dsh-пакеты — `workspace:*`. ESM только (`"type": "module"`).
- UI-копирайт — только через типизированные словари и `t` (гейт `verify-client-ui-i18n`); словари — `ru` и `en` (остальные шесть — механическое расширение позже).
- README каждого нового пакета — триплет `README.md` + `README.zh.md` + `README.i18n.yaml`; после правок пары: `pnpm run verify-translation-pairing --write <path>/README.md`.
- Файлы кончаются ровно одним `\n`; pre-commit (lefthook) гоняет whitespace и vendor-manifest guard.
- Именование: сервис-ключ `customAgentPresets`; id пресетов `custom/<slug>`; коды ошибок `custom-agent-presets/invalid|not-found|limit|conflict`; слот `agentPreset.picker.actions`; событие `custom-agents/changed`; домен `custom-agent-presets`.
- Концентрация лимитов в Config (schemastery), никакой магии в коде; whitelist — только конфиг оверлея.
- Сессия-проекция `agentPreset` и `SessionEventMap` не меняются → ожидаемые outputs TypeScript/Python SDK и снапшоты записанных сессий не обновляются.
- Команды: точечный тест — `pnpm exec vitest run <путь-к-пакету>`; быстрая проверка типов пакета — `pnpm exec tsc -b packages/preset/agent-preset-custom` (или `packages/client/ui-custom-agents`); перед завершением — `pnpm run build:artifacts`, затем `pnpm run build:check`; доки — `pnpm run doc-sync`; гигиена — `pnpm run hygiene`. E2E web: `pnpm exec vitest run --config vitest.e2e.config.ts apps/web/tests/custom-agent-presets.e2e.ts`.
- Windows-машина; в shell сессии `git` может отсутствовать в PATH — в этом случае полный путь `"/c/Program Files/Git/cmd/git.exe"`.
- Коммиты: conventional, строчными (`feat: …`, `test: …`, `docs: …`); в конце задачи — коммит.

---

### Task 1: Хост-пакет — скаффолд, типы, сервис-скелет, пустой каталог

**Files:**
- Create: `packages/preset/agent-preset-custom/package.json`
- Create: `packages/preset/agent-preset-custom/tsconfig.json`
- Create: `packages/preset/agent-preset-custom/src/index.ts`
- Create: `packages/preset/agent-preset-custom/src/config.ts`
- Create: `packages/preset/agent-preset-custom/src/types.ts`
- Create: `packages/preset/agent-preset-custom/src/spec.ts`
- Create: `packages/preset/agent-preset-custom/tests/harness.ts`
- Create: `packages/preset/agent-preset-custom/tests/custom-agents.spec.ts`

**Interfaces:**
- Consumes: `AgentPresetRegistry.register(definition: PresetDefinition): Promise<() => Promise<void>>` (ctx-ключ `agentPresets`); `ctx.storageDomain.open(spec)`; `DomainFacility(ctx, { backend, routes })`.
- Produces: типы `CustomAgentRecord { id; slug; name; description; instructions; tools: readonly string[]; version: number; updatedAt: string }`, `CustomAgentInput { name; description; instructions; tools }`, `CustomAgentPolicy { allowedTools; maxNameChars; maxDescriptionChars; maxInstructionsChars; maxAgents }`, `CustomAgentCatalog { agents; policy }`; сервис-ключ `customAgentPresets`; домен `custom-agent-presets` v1 (таблица `agents`).

- [ ] **Step 1: Написать падающий тест**

`packages/preset/agent-preset-custom/tests/harness.ts`:

```ts
/** Test harness: the real preset registry stack plus a memory-backed storage domain. */
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { harness as presetHarness } from '../../agent-preset-registry/tests/harness.ts'
import CustomAgentPresets from '../src/index.ts'
import type { Context } from '@deepseek-ai/cordis'

/** Deployment-authored defaults the specs assert against. */
export const standardConfig = {
  instructionsPrefix: 'You are the drawings assistant.',
  basePlugins: [] as readonly object[],
  allowedTools: {
    'ask-user': { name: '@deepseek-ai/dsh-tool-ask-user' },
    todo: { name: '@deepseek-ai/dsh-tool-todo', config: { allowParallelInProgress: true } },
  },
  maxNameChars: 64,
  maxDescriptionChars: 200,
  maxInstructionsChars: 16384,
  maxAgents: 50,
}

export type HarnessConfig = typeof standardConfig

/** Boot the preset-registry test stack, add a memory storage domain, mount the service. */
export async function harness(config: Partial<HarnessConfig> = {}): Promise<{ ctx: Context; service: CustomAgentPresets }> {
  const ctx = await presetHarness()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const service = await ctx.plugin(CustomAgentPresets, { ...standardConfig, ...config })
  return { ctx, service }
}
```

`packages/preset/agent-preset-custom/tests/custom-agents.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { harness } from './harness.ts'

describe('custom agent presets service', () => {
  it('serves an empty catalog and the deployment policy before any write', async () => {
    const { ctx } = await harness()
    const catalog = await ctx.customAgentPresets.remoteExportList()
    expect(catalog.agents).toEqual([])
    expect(catalog.policy).toMatchObject({
      allowedTools: ['ask-user', 'todo'],
      maxNameChars: 64,
      maxInstructionsChars: 16384,
      maxAgents: 50,
    })
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `pnpm exec vitest run packages/preset/agent-preset-custom`
Expected: FAIL — «Cannot find module '.../src/index.ts'» (пакета ещё нет).

- [ ] **Step 3: Создать скаффолд пакета**

`packages/preset/agent-preset-custom/package.json` (по образцу `packages/preset/agent-preset-registry/package.json`, версия и repository.directory — свои):

```json
{
  "name": "@deepseek-ai/dsh-agent-preset-custom",
  "description": "Deployment-constrained user-created agent presets: durable records mounted into the preset registry",
  "version": "0.2.2-rc.2",
  "publishConfig": { "access": "public" },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/deepseek-ai/deepseek-harness.git",
    "directory": "packages/preset/agent-preset-custom"
  },
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./types": { "types": "./lib/types/types.d.ts", "default": "./lib/types/types.js" },
    "./typert": { "types": "./lib/typert.host.d.ts", "default": "./lib/typert.host.js" },
    "./remote": { "types": "./lib/typert.remote-client.d.ts", "default": "./lib/typert.remote-client.js" },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "files": [
    "lib/index.js",
    "lib/types/**/*.js",
    "lib/types/**/*.d.ts",
    "lib/types/**/*.d.ts.map",
    "lib/types/**/*.js.map",
    "lib/typert.host.js",
    "lib/typert.host.d.ts",
    "lib/typert.remote-client.js",
    "lib/typert.remote-client.d.ts",
    "lib/typert.remote-client.d.ts.map",
    "src"
  ],
  "license": "MIT",
  "peerDependencies": {
    "@deepseek-ai/cordis": "workspace:~",
    "@deepseek-ai/dsh-agent-preset-registry": "workspace:*",
    "@deepseek-ai/dsh-storage": "workspace:*",
    "@deepseek-ai/dsh-storage-domain": "workspace:*",
    "@deepseek-ai/dsh-typert-protocol": "workspace:*",
    "@deepseek-ai/schemastery": "workspace:~"
  },
  "dependencies": {
    "zod": "4.6.6"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "workspace:~",
    "@deepseek-ai/dsh-agent": "workspace:*",
    "@deepseek-ai/dsh-agent-preset-registry": "workspace:*",
    "@deepseek-ai/dsh-storage": "workspace:*",
    "@deepseek-ai/dsh-storage-domain": "workspace:*",
    "@deepseek-ai/dsh-typert-protocol": "workspace:*",
    "@deepseek-ai/schemastery": "workspace:~"
  }
}
```

`packages/preset/agent-preset-custom/tsconfig.json`:

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "lib/types"
  },
  "include": ["src"],
  "references": [
    { "path": "../../../vendor/cordis" },
    { "path": "../../../vendor/schemastery" },
    { "path": "../agent-preset-registry" },
    { "path": "../../storage/storage" },
    { "path": "../../storage/storage-domain" },
    { "path": "../../typert/protocol" }
  ]
}
```

- [ ] **Step 4: Написать минимальную реализацию**

`packages/preset/agent-preset-custom/src/types.ts`:

```ts
/** Client-safe payloads and error details owned by the custom-agent-presets domain. */

/**
 * One user-created agent as a client reads it.
 */
export interface CustomAgentRecord {
  /** Roster identity: `custom/<slug>`. */
  readonly id: string
  /** The slug behind the id; immutable after create. */
  readonly slug: string
  /** Display name. */
  readonly name: string
  /** One sentence on what this agent is for. */
  readonly description: string
  /** Persona instructions rendered as the agent's prompt prefix. */
  readonly instructions: string
  /** Keys of the deployment whitelist this agent mounts. */
  readonly tools: readonly string[]
  /** Optimistic-concurrency stamp; every write increments it. */
  readonly version: number
  /** Last write time, ISO-8601. */
  readonly updatedAt: string
}

/** Fields a client submits for create or update. */
export interface CustomAgentInput {
  readonly name: string
  readonly description: string
  readonly instructions: string
  readonly tools: readonly string[]
}

/** The deployment-authored limits and whitelist the form renders against. */
export interface CustomAgentPolicy {
  readonly allowedTools: readonly string[]
  readonly maxNameChars: number
  readonly maxDescriptionChars: number
  readonly maxInstructionsChars: number
  readonly maxAgents: number
}

/** The catalog one deployment currently serves. */
export interface CustomAgentCatalog {
  readonly agents: readonly CustomAgentRecord[]
  readonly policy: CustomAgentPolicy
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** A field broke its limit or names an unknown tool. */
    'custom-agent-presets/invalid': { readonly reason: string }
    /** No stored record carries the requested identity. */
    'custom-agent-presets/not-found': { readonly agentPreset: string }
    /** The deployment-wide cap is reached, or no slug remains for a name. */
    'custom-agent-presets/limit': { readonly reason: string }
    /** The caller's version stamp does not match the stored record. */
    'custom-agent-presets/conflict': { readonly expectedVersion: number }
  }
}

export {}
```

`packages/preset/agent-preset-custom/src/config.ts`:

```ts
/** Service configuration: the deployment-authored template, whitelist, and limits. */
import z from '@deepseek-ai/schemastery'

/** Config of the `agent-preset-custom` service row. */
export interface Config {
  /** Site persona prepended to every custom agent's instructions. */
  instructionsPrefix: string
  /** Fixed child rows (agent-instructions, time-context, compaction) the deployment copies from its standard preset, minus persona. */
  basePlugins: readonly object[]
  /** Whitelist: entry key → the plugin row a selecting agent mounts. */
  allowedTools: Record<string, { name: string; config?: unknown }>
  /** Name length cap. */
  maxNameChars: number
  /** Description length cap. */
  maxDescriptionChars: number
  /** Instructions length cap. */
  maxInstructionsChars: number
  /** Deployment-wide record cap. */
  maxAgents: number
}

/** Runtime schema for the service row. */
export const Config: z<Config> = z.object({
  instructionsPrefix: z.string().default(''),
  basePlugins: z.array(z.any()).default([]),
  allowedTools: z.dict(z.object({ name: z.string().required(), config: z.any() })).default({}),
  maxNameChars: z.number().default(64),
  maxDescriptionChars: z.number().default(200),
  maxInstructionsChars: z.number().default(16384),
  maxAgents: z.number().default(50),
}) as z<Config>
```

`packages/preset/agent-preset-custom/src/spec.ts`:

```ts
/** The durable declaration of the custom-agent-presets domain. */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { CustomAgentRecord } from './types.ts'

/** Zod shape of one stored record; validates every read at the durable boundary. */
export const customAgentRecord = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  instructions: z.string(),
  tools: z.array(z.string()),
  version: z.number().int(),
  updatedAt: z.string(),
})

/**
 * The custom-agent domain: one `agents` table keyed by roster id. Records
 * that no longer parse are backed up and skipped at open, so a bad file
 * cannot take the deployment down; the backup and log line are the
 * visible quarantine.
 */
export const customAgentsDomainSpec = defineDomain({
  name: 'custom-agent-presets',
  version: 1,
  invalidRecords: 'backup-and-skip',
  tables: { agents: domainTable<string, CustomAgentRecord>(customAgentRecord) },
})
```

`packages/preset/agent-preset-custom/src/index.ts`:

```ts
/** User-created agent presets: durable CRUD, mounted into the preset registry. */
import { Service } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the storageDomain Context merge (ctx.storageDomain).
import type {} from '@deepseek-ai/dsh-storage-domain'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { Config } from './config.ts'
import type { CustomAgentCatalog, CustomAgentInput, CustomAgentPolicy, CustomAgentRecord } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    customAgentPresets: CustomAgentPresets
  }
}

/** Registry-backed CRUD for deployment-constrained, user-created agent presets. */
export class CustomAgentPresets extends TypertRemoteService {
  static inject = ['agentPresets', 'storageDomain']
  static Config = Config

  private domain?: Domain<typeof import('./spec.ts').customAgentsDomainSpec>
  private table?: KvTable<string, CustomAgentRecord>
  private readonly registrations = new Map<string, () => Promise<void>>()

  constructor(ctx: Context, public config: import('./config.ts').Config) {
    super(ctx, 'customAgentPresets')
  }

  protected async [Service.init](): Promise<void> {
    const { customAgentsDomainSpec } = await import('./spec.ts')
    const domain = await this.ctx.storageDomain.open(customAgentsDomainSpec)
    this.domain = domain
    this.table = domain.table('agents')
    this.ctx.effect(() => async () => {
      for (const dispose of [...this.registrations.values()]) await dispose()
      this.registrations.clear()
      await domain.close()
    }, 'custom-agent-presets.dispose')
    for (const record of [...this.table.entries()].map(([, value]) => value)) {
      await this.mount(record)
    }
  }

  /** Mount one record as a registry definition and remember its disposer. */
  private async mount(record: CustomAgentRecord): Promise<void> {
    const { synthesizeDefinition } = await import('./definition.ts')
    const dispose = await this.ctx.agentPresets.register(synthesizeDefinition(record, this.config))
    this.registrations.set(record.id, dispose)
  }

  private requireTable(): KvTable<string, CustomAgentRecord> {
    const table = this.table
    if (table === undefined) throw new Error('custom-agent-presets: the service has not initialized')
    return table
  }

  private policy(): CustomAgentPolicy {
    return {
      allowedTools: Object.keys(this.config.allowedTools),
      maxNameChars: this.config.maxNameChars,
      maxDescriptionChars: this.config.maxDescriptionChars,
      maxInstructionsChars: this.config.maxInstructionsChars,
      maxAgents: this.config.maxAgents,
    }
  }

  @Remote('list')
  async remoteExportList(): Promise<CustomAgentCatalog> {
    const table = this.requireTable()
    const agents = [...table.entries()].map(([, value]) => value)
    return { agents, policy: this.policy() }
  }
}

export default CustomAgentPresets
```

(Методы `create/update/remove` появят в Task 3; здесь — только `list`.)

- [ ] **Step 5: Прогнать тест**

Run: `pnpm exec vitest run packages/preset/agent-preset-custom`
Expected: PASS (1 тест). Если registry-harness тянет сборные зависимости — прогреть один раз `pnpm run build:artifacts` и повторить.

- [ ] **Step 6: Проверить типы и закоммитить**

Run: `pnpm exec tsc -b packages/preset/agent-preset-custom && pnpm install`
Expected: без ошибок; линк пакета в workspace создан.

```bash
git add packages/preset/agent-preset-custom pnpm-lock.yaml
git commit -m "feat(agent-preset-custom): scaffold the custom agent preset service"
```

---

### Task 2: Валидация входа и синтез slug

**Files:**
- Create: `packages/preset/agent-preset-custom/src/validate.ts`
- Test: `packages/preset/agent-preset-custom/tests/validate.spec.ts`

**Interfaces:**
- Consumes: `Config` (Task 1), `RemoteError`, `CustomAgentInput`.
- Produces: `slugForName(name: string): string` — ASCII-slug `[a-z0-9][a-z0-9-]{0,47}`, fallback `'agent'`; `validateInput(input, config): { name; description; instructions; tools }` — бросает `RemoteError('custom-agent-presets/invalid'|'limit')`.

- [ ] **Step 1: Падающий тест**

`packages/preset/agent-preset-custom/tests/validate.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { slugForName, validateInput } from '../src/validate.ts'
import { standardConfig } from './harness.ts'

describe('slugForName', () => {
  it('slugifies Latin names and falls back to agent', () => {
    expect(slugForName('Сметчик')).toBe('agent')
    expect(slugForName('Report Helper')).toBe('report-helper')
    expect(slugForName('  --A!!B--  ')).toBe('a-b')
  })
})

describe('validateInput', () => {
  const base = { name: 'Сметчик', description: 'Считает объёмы.', instructions: 'Считай объёмы работ.', tools: ['todo'] }

  it('accepts a valid input and trims fields', () => {
    expect(validateInput({ ...base, name: '  Сметчик  ' }, standardConfig)).toMatchObject({ name: 'Сметчик', tools: ['todo'] })
  })

  it('rejects empty name, over-limit name, over-limit instructions, and unknown tools with coded errors', async () => {
    await expect(validateInput({ ...base, name: '   ' }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/invalid' })
    await expect(validateInput({ ...base, name: 'x'.repeat(65) }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/invalid' })
    await expect(validateInput({ ...base, instructions: 'x'.repeat(16385) }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/limit' })
    await expect(validateInput({ ...base, tools: ['shell'] }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/invalid' })
  })
})
```

- [ ] **Step 2: Run** — `pnpm exec vitest run packages/preset/agent-preset-custom/tests/validate.spec.ts` → FAIL (модуля нет).

- [ ] **Step 3: Реализация**

`packages/preset/agent-preset-custom/src/validate.ts`:

```ts
/** Input validation: every rule rejects with a coded, actionable RemoteError. */
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { Config } from './config.ts'
import type { CustomAgentInput } from './types.ts'

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

/** Derive the ASCII slug for a name: Latin letters and digits only, `-`-separated. */
export function slugForName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  return slug === '' || !SLUG_RE.test(slug) ? 'agent' : slug
}

const invalid = (reason: string) => new RemoteError('custom-agent-presets/invalid', reason, { reason })
const limit = (reason: string) => new RemoteError('custom-agent-presets/limit', reason, { reason })

/**
 * Validate one submitted field set against the deployment policy.
 * @param input - the client-submitted fields.
 * @param config - the service config carrying the whitelist and limits.
 * @returns the trimmed, deduplicated fields to store.
 */
export function validateInput(input: CustomAgentInput, config: Config): Pick<CustomAgentInput, 'name' | 'description' | 'instructions' | 'tools'> {
  const name = input.name.trim()
  if (name === '') throw invalid('The name must not be empty')
  if (name.length > config.maxNameChars) throw invalid(`The name exceeds ${config.maxNameChars} characters`)
  const description = input.description.trim()
  if (description.length > config.maxDescriptionChars) throw invalid(`The description exceeds ${config.maxDescriptionChars} characters`)
  const instructions = input.instructions.trim()
  if (instructions === '') throw invalid('The instructions must not be empty')
  if (instructions.length > config.maxInstructionsChars) throw limit(`The instructions exceed ${config.maxInstructionsChars} characters`)
  const allowed = new Set(Object.keys(config.allowedTools))
  const unknown = input.tools.filter(tool => !allowed.has(tool))
  if (unknown.length > 0) throw invalid(`Unknown tools: ${unknown.join(', ')}`)
  return { name, description, instructions, tools: [...new Set(input.tools)] }
}
```

- [ ] **Step 4: Run** — тот же фильтр → PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/preset/agent-preset-custom
git commit -m "feat(agent-preset-custom): validate input against the deployment policy"
```

---

### Task 3: Синтез определения + CRUD-ремоуты (create/update/delete)

**Files:**
- Create: `packages/preset/agent-preset-custom/src/definition.ts`
- Modify: `packages/preset/agent-preset-custom/src/index.ts` (три метода)
- Test: `packages/preset/agent-preset-custom/tests/custom-agents.spec.ts` (дополнить)

**Interfaces:**
- Consumes: `PresetDefinition` (`@deepseek-ai/dsh-agent-preset-registry`), `validateInput`, `slugForName`.
- Produces: `synthesizeDefinition(record, config): PresetDefinition` — plugins `[persona(prefix = instructionsPrefix + ' ' + instructions)] + basePlugins + tools→{ id: 'tool-<key>', name, config }`, `order: 50`; ремоуты `create(input): Promise<CustomAgentRecord>`, `update(id, input, version)`, `remove(id, version)`.

- [ ] **Step 1: Падающие тесты** — дописать в `tests/custom-agents.spec.ts`:

```ts
  it('creates a record, mounts it into the registry roster, and derives unique slugs', async () => {
    const { ctx } = await harness()
    const first = await ctx.customAgentPresets.create({ name: 'Сметчик', description: 'Считает объёмы.', instructions: 'Считай объёмы работ.', tools: ['todo'] })
    expect(first.id).toBe('custom/agent')
    const second = await ctx.customAgentPresets.create({ name: 'Отчётчик', description: '', instructions: 'Собирай отчёт.', tools: [] })
    expect(second.id).toBe('custom/agent-2')
    const roster = await ctx.agentPresets.remoteExportList()
    const row = roster.presets.find(preset => preset.id === 'custom/agent')
    expect(row).toMatchObject({ name: 'Сметчик', description: 'Считает объёмы.' })
  })

  it('synthesizes the persona prefix, base rows, and whitelisted tool rows', async () => {
    const { ctx, service } = await harness()
    await ctx.customAgentPresets.create({ name: 'Helper', description: '', instructions: 'Be brief.', tools: ['todo'] })
    const document = await ctx.agentPresets.readDocument('custom/agent')
    expect(document.content).toContain('You are the drawings assistant. Be brief.')
    expect(document.content).toContain('dsh-tool-todo')
    expect(service).toBeDefined()
  })

  it('replaces the definition on update and drops it on delete', async () => {
    const { ctx } = await harness()
    const created = await ctx.customAgentPresets.create({ name: 'Helper', description: 'v1', instructions: 'v1', tools: [] })
    const updated = await ctx.customAgentPresets.update(created.id, { name: 'Helper', description: 'v2', instructions: 'v2', tools: ['todo'] }, created.version)
    expect(updated.version).toBe(2)
    const roster = await ctx.agentPresets.remoteExportList()
    expect(roster.presets.find(preset => preset.id === created.id)).toMatchObject({ description: 'v2' })
    await ctx.customAgentPresets.remove(created.id, updated.version)
    const after = await ctx.agentPresets.remoteExportList()
    expect(after.presets.find(preset => preset.id === created.id)).toBeUndefined()
  })

  it('rejects stale versions, over-cap creates, and unknown identities with coded errors', async () => {
    const { ctx } = await harness({ maxAgents: 1 })
    const created = await ctx.customAgentPresets.create({ name: 'Helper', description: '', instructions: 'x', tools: [] })
    await expect(ctx.customAgentPresets.update(created.id, { name: 'Helper', description: '', instructions: 'y', tools: [] }, created.version - 1))
      .rejects.toMatchObject({ code: 'custom-agent-presets/conflict' })
    await expect(ctx.customAgentPresets.remove('custom/missing', 1))
      .rejects.toMatchObject({ code: 'custom-agent-presets/not-found' })
    await expect(ctx.customAgentPresets.create({ name: 'Second', description: '', instructions: 'x', tools: [] }))
      .rejects.toMatchObject({ code: 'custom-agent-presets/limit' })
  })
```

- [ ] **Step 2: Run** → FAIL (`create is not a function`).

- [ ] **Step 3: Реализация**

`src/definition.ts`:

```ts
/** Synthesis of one stored record into a registry preset definition. */
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import type { Config } from './config.ts'
import type { CustomAgentRecord } from './types.ts'

/**
 * Build the registry definition: the site persona plus the user instructions,
 * the deployment's fixed base rows, and the whitelisted tool rows the record
 * selected. User data enters as plain configuration values only — nothing
 * here parses user text as configuration.
 * @param record - the stored record.
 * @param config - the service config (prefix, base rows, whitelist).
 * @returns the definition handed to `agentPresets.register`.
 */
export function synthesizeDefinition(record: CustomAgentRecord, config: Config): PresetDefinition {
  const prefix = config.instructionsPrefix === ''
    ? record.instructions
    : `${config.instructionsPrefix} ${record.instructions}`
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    order: 50,
    plugins: [
      { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix } },
      ...config.basePlugins,
      ...record.tools.map(key => {
        const row = config.allowedTools[key]
        return { id: `tool-${key}`, name: row.name, config: row.config }
      }),
    ],
  }
}
```

В `src/index.ts`: убрать `await import` для definition/spec (перенести в статические импорты), добавить методы в класс:

```ts
  /** Derive the first unused `custom/<slug>` id for a name. */
  private unusedId(name: string): string {
    const table = this.requireTable()
    const base = slugForName(name)
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? base : `${base}-${n}`
      if (table.get(`custom/${candidate}`) === undefined) return `custom/${candidate}`
      if (n >= 99) throw new RemoteError('custom-agent-presets/limit', 'No free slug for this name', { reason: 'slug-exhausted' })
    }
  }

  @Remote('create')
  async create(input: CustomAgentInput): Promise<CustomAgentRecord> {
    const table = this.requireTable()
    if (table.size >= this.config.maxAgents) {
      throw new RemoteError('custom-agent-presets/limit', `The deployment allows at most ${this.config.maxAgents} custom agents`, { reason: 'max-agents' })
    }
    const fields = validateInput(input, this.config)
    const id = this.unusedId(fields.name)
    const record: CustomAgentRecord = {
      id, slug: id.slice('custom/'.length), ...fields, version: 1, updatedAt: new Date().toISOString(),
    }
    await table.put(record.id, record)
    await this.mount(record)
    return record
  }

  @Remote('update')
  async update(id: string, input: CustomAgentInput, version: number): Promise<CustomAgentRecord> {
    const table = this.requireTable()
    const stored = table.get(id)
    if (stored === undefined) {
      throw new RemoteError('custom-agent-presets/not-found', `Unknown custom agent: ${id}`, { agentPreset: id })
    }
    if (stored.version !== version) {
      throw new RemoteError('custom-agent-presets/conflict', 'The record changed elsewhere; reload and retry', { expectedVersion: stored.version })
    }
    const fields = validateInput(input, this.config)
    const previous = this.registrations.get(id)
    if (previous !== undefined) await previous()
    this.registrations.delete(id)
    const record: CustomAgentRecord = { ...stored, ...fields, version: stored.version + 1, updatedAt: new Date().toISOString() }
    await table.put(id, record)
    await this.mount(record)
    return record
  }

  @Remote('delete')
  async remove(id: string, version: number): Promise<void> {
    const table = this.requireTable()
    const stored = table.get(id)
    if (stored === undefined) {
      throw new RemoteError('custom-agent-presets/not-found', `Unknown custom agent: ${id}`, { agentPreset: id })
    }
    if (stored.version !== version) {
      throw new RemoteError('custom-agent-presets/conflict', 'The record changed elsewhere; reload and retry', { expectedVersion: stored.version })
    }
    const previous = this.registrations.get(id)
    if (previous !== undefined) await previous()
    this.registrations.delete(id)
    await table.delete(id)
  }
```

Дополнить импорты: `import { slugForName, validateInput } from './validate.ts'`.

- [ ] **Step 4: Run** — `pnpm exec vitest run packages/preset/agent-preset-custom` → PASS (все спеки пакета).
- [ ] **Step 5: Commit**

```bash
git add packages/preset/agent-preset-custom
git commit -m "feat(agent-preset-custom): synthesize registry definitions and serve CRUD"
```

---

### Task 4: Персистентность через json-бэкенд (рестарт процесса)

**Files:**
- Modify: `packages/preset/agent-preset-custom/tests/harness.ts` (опция json-бэкенда)
- Test: `packages/preset/agent-preset-custom/tests/persistence.spec.ts`

**Interfaces:**
- Consumes: `StorageJson` (`@deepseek-ai/dsh-storage-json`, config `{ root }`).
- Produces: доказательство, что запись переживает пересоздание контекста (рестарт сайта).

- [ ] **Step 1: Расширить harness** — в `tests/harness.ts` добавить опцию:

```ts
export async function harness(config: Partial<HarnessConfig> = {}, storage: { jsonRoot?: string } = {}): Promise<...> {
  const ctx = await presetHarness()
  if (storage.jsonRoot !== undefined) {
    await ctx.plugin(StorageJson, { root: storage.jsonRoot })
  } else {
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  }
  const facility = new DomainFacility(ctx, { backend: 'json'... нет — backend имя })
```

Точный вариант (маршрут через конфиг facility):

```ts
  const backendName = storage.jsonRoot !== undefined ? 'json' : 'memory'
  const facility = new DomainFacility(ctx, { backend: backendName, routes: {} })
```

и для json-ветки: `await ctx.plugin(StorageJson, { root: storage.jsonRoot })` (сам регистрирует бэкенд `json` на хабе). Память-ветка остаётся как в Task 1.

- [ ] **Step 2: Падающий тест** `tests/persistence.spec.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { harness } from './harness.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

describe('custom agent persistence', () => {
  it('reopens records from the json backend after the process context is disposed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-custom-agents-'))
    roots.push(root)
    const first = await harness({}, { jsonRoot: root })
    const created = await first.ctx.customAgentPresets.create({ name: 'Helper', description: 'd', instructions: 'i', tools: ['todo'] })
    await first.ctx.fiber.dispose()

    const second = await harness({}, { jsonRoot: root })
    const catalog = await second.ctx.customAgentPresets.remoteExportList()
    expect(catalog.agents).toMatchObject([{ id: created.id, version: 1 }])
    const roster = await second.ctx.agentPresets.remoteExportList()
    expect(roster.presets.find(preset => preset.id === created.id)).toMatchObject({ name: 'Helper' })
  })
})
```

- [ ] **Step 3: Run** — `pnpm exec vitest run packages/preset/agent-preset-custom` → сначала FAIL (harness без json-ветки), после Step 1 — PASS.
- [ ] **Step 4: Commit**

```bash
git add packages/preset/agent-preset-custom
git commit -m "test(agent-preset-custom): prove records reopen from the json backend"
```

---

### Task 5: typert-экспорт и монтаж в `packages/api/remotes`

**Files:**
- Modify: `packages/api/remotes/package.json` (dependency `@deepseek-ai/dsh-agent-preset-custom: workspace:*`)
- Modify: `packages/api/remotes/tsconfig.client.json` (reference `../../preset/agent-preset-custom`)
- Modify: `packages/api/remotes/src/client/index.ts` (импорт + contribution array)
- Modify: `tsconfig.host.json` (reference `./packages/preset/agent-preset-custom`)
- Modify: `tsconfig.client.json` (references `./packages/preset/agent-preset-custom`, `./packages/client/ui-custom-agents` — последний добавится в Task 7; здесь только host-пакет)

**Interfaces:**
- Consumes: codegen `./remote` (создаётся `build:artifacts` по `./typert`/`./remote` exports).
- Produces: `ctx.remote.customAgentPresets { list, create, update, remove }` в браузере (конверт `{ ok, value } | { ok, error }`).

- [ ] **Step 1: Собрать typert-выходы** — `pnpm run build:artifacts` (генератор typert пишет `lib/typert.host.*` и `lib/typert.remote-client.*` для пакетов с `./typert`/`./remote` exports — оба уже в package.json из Task 1).

- [ ] **Step 2: Смонтировать remote** — в `packages/api/remotes/src/client/index.ts`, зеркально `agentPresetsRemote` (строки 6 и ~195):

```ts
import customAgentsRemote from '@deepseek-ai/dsh-agent-preset-custom/remote'
// ...
export type {} from '@deepseek-ai/dsh-agent-preset-custom/remote'
```

и в массив `contribution` внутри `apply()` добавить `customAgentsRemote` сразу после `agentPresetsRemote`.

- [ ] **Step 3: Обновить манифест и решения** — правки из списка Files (dependency в api/remotes `package.json`; references в `tsconfig.client.json` api/remotes, в корневых `tsconfig.host.json` и `tsconfig.client.json`), затем `pnpm install && pnpm run gen-tsconfig-paths`.

- [ ] **Step 4: Проверить** — `pnpm exec tsc -b packages/api/remotes` и `pnpm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/remotes tsconfig.host.json tsconfig.client.json pnpm-lock.yaml
git commit -m "feat(api-remotes): mount the custom agent presets remote"
```

---

### Task 6: `ui-agent-preset` — слот действий в попапе чипа + refresh-событие

**Files:**
- Create: `packages/client/ui-agent-preset/src/client/slot-contract.ts`
- Modify: `packages/client/ui-agent-preset/src/client/index.ts` (chip registration + refresh disposers + re-export)
- Modify: `packages/client/ui-agent-preset/src/client/AgentPresetSeat.tsx` (props + Menu children)
- Test: `packages/client/ui-agent-preset/tests/components.client.spec.tsx` (стаб renderSlot)

**Interfaces:**
- Consumes: `SlotMap` merge, `PropsRenderSlots`.
- Produces: слот `agentPreset.picker.actions` (`kind: 'list'`, `scope: 'root'`, owner `{ onDismiss: () => void }`); cordis-событие `custom-agents/changed` (emit со стороны кастом-пакета, подписка здесь).

- [ ] **Step 1: Контракт слота**

`packages/client/ui-agent-preset/src/client/slot-contract.ts`:

```ts
/** Slot contract owned by the agent-preset surfaces. */

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Extra rows at the bottom of the agent-preset picker menu, such as the custom-agent manager entry. */
    'agentPreset.picker.actions': { kind: 'list'; scope: 'root'; owner: AgentPresetPickerActionsProps }
  }
}

/** Owner share of the picker-menu action rows. */
export interface AgentPresetPickerActionsProps {
  /** Close the picker menu before starting the contributed action. */
  readonly onDismiss: () => void
}

export {}
```

- [ ] **Step 2: Seat** — в `AgentPresetSeat.tsx`:
  - в импорты: `import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'` (расширить существующий import из ui-slots);
  - тип пропсов: добавить `& PropsRenderSlots<'agentPreset.picker.actions'>`;
  - в деструктуризацию добавить `renderSlot`;
  - в `<Menu …>` добавить пропс после `items`:

```tsx
          children={renderSlot('agentPreset.picker.actions', { onDismiss: () => { setOpen(false) } })}
```

- [ ] **Step 3: Регистрация** — в `index.ts`, в `scope.effect` регистрации чипа (строки ~226-230):

```ts
        const chip = scope.slots.register({
          name: 'conversation.hero.agentPreset',
          locale: 'settings.agentPreset',
          inject: seatInjected,
          slots: { 'agentPreset.picker.actions': { scope: 'root' } },
        }, AgentPresetSeat)
```

и в массив `disposers` refresh-эффекта (строки ~158-166) добавить подписку:

```ts
        ctx.on('custom-agents/changed', refresh),
```

- [ ] **Step 4: Стаб в тестах** — прочитать `tests/components.client.spec.tsx`, найти сборку пропсов `AgentPresetSeat` и добавить `renderSlot: () => null` (и `import type {} from '../src/client/slot-contract.ts'` не нужен — стаб типируется PropsRenderSlots).

- [ ] **Step 5: Run** — `pnpm exec vitest run packages/client/ui-agent-preset` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/client/ui-agent-preset
git commit -m "feat(ui-agent-preset): open the picker menu to contributed actions and custom-agent refresh"
```

---

### Task 7: Клиентский пакет — скаффолд, словари, стор

**Files:**
- Create: `packages/client/ui-custom-agents/package.json`
- Create: `packages/client/ui-custom-agents/tsconfig.json`
- Create: `packages/client/ui-custom-agents/src/index.ts`
- Create: `packages/client/ui-custom-agents/src/client/index.ts`
- Create: `packages/client/ui-custom-agents/src/client/locales.ts`
- Create: `packages/client/ui-custom-agents/src/client/custom-agents-store.ts`
- Create: `packages/client/ui-custom-agents/locale/{de,en,es,fr,ja,pt,ru,zh}.json` (стабы `{"meta":{"title":"ui-custom-agents"}}`, у zh — с description по образцу ui-agent-preset)
- Test: `packages/client/ui-custom-agents/tests/store.client.spec.ts`

**Interfaces:**
- Consumes: `ctx.remote.customAgentPresets` (Task 5), `SnapshotStore` (`@deepseek-ai/dsh-client-store`), `LocaleNamespaceMap` merge.
- Produces: `CustomAgentsController { store, load(), create(input), update(id, input, version), remove(id, version) }`; namespace `customAgents`; событие `custom-agents/changed` (emit после успешной записи).

- [ ] **Step 1: Падающий тест** `tests/store.client.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { CustomAgentsController } from '../src/client/custom-agents-store.ts'
import type { CustomAgentCatalog } from '@deepseek-ai/dsh-agent-preset-custom/types'

const catalog: CustomAgentCatalog = {
  agents: [{ id: 'custom/agent', slug: 'agent', name: 'Сметчик', description: 'd', instructions: 'i', tools: [], version: 1, updatedAt: '2026-11-15T00:00:00.000Z' }],
  policy: { allowedTools: ['todo'], maxNameChars: 64, maxDescriptionChars: 200, maxInstructionsChars: 16384, maxAgents: 50 },
}

/** A scripted remote answering fixed outcomes; records emitted events. */
function fakeCtx(outcomes: { list?: { ok: boolean; value?: CustomAgentCatalog; message?: string }; create?: { ok: boolean }; events?: string[] }): ClientContext {
  const partial = {
    remote: {
      customAgentPresets: {
        list: () => outcomes.list?.ok === true
          ? Promise.resolve({ ok: true as const, value: outcomes.list.value! })
          : Promise.resolve({ ok: false as const, error: new RemoteError('gateway/internal', outcomes.list?.message ?? 'down', {}) }),
        create: () => Promise.resolve(outcomes.create?.ok === true ? { ok: true as const, value: catalog.agents[0] } : { ok: false as const, error: new RemoteError('gateway/internal', 'refused', {}) }),
        update: () => Promise.resolve({ ok: true as const, value: catalog.agents[0] }),
        remove: () => Promise.resolve({ ok: true as const, value: undefined }),
      },
    },
    emit: (event: string) => { outcomes.events?.push(event) },
  }
  return partial as ClientContext
}

describe('custom agents store', () => {
  it('loads the catalog into ready state', async () => {
    const controller = new CustomAgentsController(fakeCtx({ list: { ok: true, value: catalog } }))
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready', agents: [expect.objectContaining({ name: 'Сметчик' })] })
  })

  it('marks the remote unavailable on failure', async () => {
    const controller = new CustomAgentsController(fakeCtx({ list: { ok: false, message: 'down' } }))
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('unavailable')
  })

  it('emits custom-agents/changed after a successful create', async () => {
    const events: string[] = []
    const controller = new CustomAgentsController(fakeCtx({ create: { ok: true }, events }))
    const outcome = await controller.create({ name: 'x', description: '', instructions: 'y', tools: [] })
    expect(outcome.ok).toBe(true)
    expect(events).toContain('custom-agents/changed')
  })
})
```

- [ ] **Step 2: Run** → FAIL (модулей нет).

- [ ] **Step 3: Скаффолд** — `package.json` по образцу `packages/client/ui-agent-preset/package.json` с отличиями: name `@deepseek-ai/dsh-client-ui-custom-agents`, description `"Custom-agent manager: create, edit, and remove user-defined agent presets from the preset picker"`, exports без `./types`, `dsh.client`:

```json
  "dsh": {
    "client": {
      "inject": [
        "@deepseek-ai/dsh-api-remotes",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-agent-preset",
        "@deepseek-ai/dsh-client-ui-primitives"
      ],
      "platform": "web"
    }
  },
```

devDependencies: cordis, dsh-agent-preset-custom, dsh-api-remotes, dsh-client-locale, dsh-client-store, dsh-client-test-runtime, dsh-client-ui-agent-preset, dsh-client-ui-primitives, dsh-client-ui-slots, react; peerDependencies: cordis workspace:~. tsconfig.json по образцу ui-agent-preset (extends `../../../tsconfig.base.client.json`, references: `../../api/remotes/tsconfig.client.json`, `../../preset/agent-preset-custom`, `../locale/tsconfig.client.json`, `../store`, `../ui-agent-preset`, `../ui-primitives`, `../ui-slots`, `../../../vendor/cordis`).

`src/index.ts` (серверная половина — тривиальная, по образцу ui-agent-preset/src/index.ts; если там пустой экспорт — повторить его содержание):

- [ ] **Step 4: Словари** `src/client/locales.ts`:

```ts
/** Locale bundles for the custom-agent manager. */

/** Locale keys the manager renders. */
export type CustomAgentsKey =
  | 'open' | 'createTitle' | 'editTitle' | 'name' | 'namePlaceholder' | 'description' | 'descriptionPlaceholder'
  | 'instructions' | 'instructionsPlaceholder' | 'tools' | 'save' | 'cancel' | 'remove' | 'removeConfirm'
  | 'empty' | 'edit' | 'saved' | 'limitReached' | 'invalidInput' | 'conflict' | 'errorUnavailable' | 'charsUsed'

/** English copy. */
export const en: Record<CustomAgentsKey, string> = {
  open: 'New custom agent',
  createTitle: 'New custom agent',
  editTitle: 'Edit custom agent',
  name: 'Name',
  namePlaceholder: 'What is this agent called?',
  description: 'Description',
  descriptionPlaceholder: 'One sentence on what it is for',
  instructions: 'Instructions',
  instructionsPlaceholder: 'How should this agent behave?',
  tools: 'Tools',
  save: 'Save',
  cancel: 'Cancel',
  remove: 'Delete',
  removeConfirm: 'Delete this agent? Sessions already running keep their composition.',
  empty: 'No custom agents yet',
  edit: 'Edit',
  saved: 'Saved',
  limitReached: 'The limit of custom agents is reached',
  invalidInput: '{reason}',
  conflict: 'The agent changed elsewhere; reopen and retry',
  errorUnavailable: 'The custom-agent service is unavailable',
  charsUsed: '{used} / {limit} characters',
}

/** Russian copy. */
export const ru: Record<CustomAgentsKey, string> = {
  open: 'Свой агент',
  createTitle: 'Новый агент',
  editTitle: 'Правка агента',
  name: 'Название',
  namePlaceholder: 'Как назвать этого агента?',
  description: 'Описание',
  descriptionPlaceholder: 'Одно предложение — зачем он нужен',
  instructions: 'Инструкция',
  instructionsPlaceholder: 'Как агент должен себя вести?',
  tools: 'Инструменты',
  save: 'Сохранить',
  cancel: 'Отмена',
  remove: 'Удалить',
  removeConfirm: 'Удалить агента? Запущенные сессии сохранят свою композицию.',
  empty: 'Своих агентов пока нет',
  edit: 'Править',
  saved: 'Сохранено',
  limitReached: 'Достигнут лимит своих агентов',
  invalidInput: '{reason}',
  conflict: 'Агент изменён в другом окне; откройте заново и повторите',
  errorUnavailable: 'Сервис своих агентов недоступен',
  charsUsed: '{used} / {limit} символов',
}
```

- [ ] **Step 5: Стор** `src/client/custom-agents-store.ts`:

```ts
/** Client store for the custom-agent manager: one catalog load and CRUD writes. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { CustomAgentInput, CustomAgentPolicy, CustomAgentRecord } from '@deepseek-ai/dsh-agent-preset-custom/types'

/** Render state of the manager. */
export interface CustomAgentsState {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
  agents: readonly CustomAgentRecord[]
  policy: CustomAgentPolicy | undefined
  saving: boolean
  error: string | undefined
}

const INITIAL: CustomAgentsState = { status: 'idle', agents: [], policy: undefined, saving: false, error: undefined }

/** Outcome of one write, for the form's error surface. */
export type WriteOutcome =
  | { ok: true; record: CustomAgentRecord }
  | { ok: false; kind: 'limit' | 'invalid' | 'conflict' | 'not-found' | 'unavailable'; reason?: string }

/** Loads the catalog and performs CRUD through the typed remote. */
export class CustomAgentsController {
  readonly store: SnapshotStore<CustomAgentsState> = createSnapshotStore(INITIAL)

  constructor(private readonly ctx: ClientContext) {}

  /** Read the catalog; an unreachable remote marks the manager unavailable, not empty. */
  async load(): Promise<void> {
    this.store.set(state => ({ ...state, status: 'loading' }))
    const result = await this.ctx.remote.customAgentPresets.list()
    if (!result.ok) {
      this.store.set(state => ({ ...state, status: 'unavailable', error: result.error.message }))
      return
    }
    this.store.set(state => ({ ...state, status: 'ready', agents: result.value.agents, policy: result.value.policy, error: undefined }))
  }

  async create(input: CustomAgentInput): Promise<WriteOutcome> {
    this.store.set(state => ({ ...state, saving: true }))
    try {
      const result = await this.ctx.remote.customAgentPresets.create(input)
      if (!result.ok) return this.writeFailure(result.error)
      await this.load()
      this.ctx.emit('custom-agents/changed')
      return { ok: true, record: result.value }
    } finally {
      this.store.set(state => ({ ...state, saving: false }))
    }
  }

  async update(id: string, input: CustomAgentInput, version: number): Promise<WriteOutcome> {
    this.store.set(state => ({ ...state, saving: true }))
    try {
      const result = await this.ctx.remote.customAgentPresets.update(id, input, version)
      if (!result.ok) return this.writeFailure(result.error)
      await this.load()
      this.ctx.emit('custom-agents/changed')
      return { ok: true, record: result.value }
    } finally {
      this.store.set(state => ({ ...state, saving: false }))
    }
  }

  async remove(id: string, version: number): Promise<WriteOutcome> {
    const result = await this.ctx.remote.customAgentPresets.remove(id, version)
    if (!result.ok) return this.writeFailure(result.error)
    await this.load()
    this.ctx.emit('custom-agents/changed')
    return { ok: true, record: this.store.getSnapshot().agents.find(agent => agent.id === id) ?? { id, slug: '', name: '', description: '', instructions: '', tools: [], version: 0, updatedAt: '' } }
  }

  private writeFailure(error: { code: string; message: string }): WriteOutcome {
    if (error.code === 'custom-agent-presets/limit') return { ok: false, kind: 'limit', reason: error.message }
    if (error.code === 'custom-agent-presets/conflict') return { ok: false, kind: 'conflict', reason: error.message }
    if (error.code === 'custom-agent-presets/not-found') return { ok: false, kind: 'not-found', reason: error.message }
    if (error.code === 'custom-agent-presets/invalid') return { ok: false, kind: 'invalid', reason: error.message }
    return { ok: false, kind: 'unavailable', reason: error.message }
  }
}
```

- [ ] **Step 6: Apply** `src/client/index.ts`:

```ts
/** Custom-agent manager surface: the picker-menu entry and its modal. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ui-agent-preset SlotMap merge (the picker action slot).
import type {} from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import { CreateCustomAgentButton } from './CreateCustomAgentButton.tsx'
import { CustomAgentsController } from './custom-agents-store.ts'
import { en, ru, type CustomAgentsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Custom-agent manager copy. */
    customAgents: CustomAgentsKey
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A custom-agent write succeeded; the preset roster may have changed.
     * @mode emit
     */
    'custom-agents/changed'(): void
  }
}

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.customAgentPresets']

/**
 * Mount the manager entry into the preset picker's action slot.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('customAgents', { ru, en }), 'ui-custom-agents: dictionaries')
  const controller = new CustomAgentsController(ctx)
  ctx.slots.inject('agentPreset.picker.actions', () => ctx.slots.register({
    name: 'agentPreset.picker.actions',
    id: 'create-custom-agent',
    locale: 'customAgents',
    inject: () => ({ hooks: { customAgents: controller.store }, controller, load: () => controller.load() }),
  }, CreateCustomAgentButton))
}
```

- [ ] **Step 7: Run** — `pnpm exec vitest run packages/client/ui-custom-agents` → PASS.
- [ ] **Step 8: Commit**

```bash
git add packages/client/ui-custom-agents pnpm-lock.yaml
git commit -m "feat(ui-custom-agents): scaffold the manager store, dictionaries, and picker entry"
```

---

### Task 8: Клиентские компоненты — кнопка в меню, модал-менеджер

**Files:**
- Create: `packages/client/ui-custom-agents/src/client/CreateCustomAgentButton.tsx` + `.module.css`
- Create: `packages/client/ui-custom-agents/src/client/CustomAgentsModal.tsx` + `.module.css`
- Modify: `packages/client/ui-custom-agents/src/client/index.ts` (если компоненты требуют доп. inject — поправить)
- Test: `packages/client/ui-custom-agents/tests/components.client.spec.tsx`

**Interfaces:**
- Consumes: props-композиция `PropsRuntime<'agentPreset.picker.actions'> & PropsLocale<'customAgents'> & InjectFace<...>`; примитивы `MenuItemButton`, `Modal`, `Button`, `Checkbox`, `IconPlusOutlineRegular`.
- Produces: пункт меню «Свой агент», открывающий модал со списком и формой (create/edit/delete).

- [ ] **Step 1: Кнопка** `CreateCustomAgentButton.tsx` (по образцу `CreatePluginMenuItem.tsx`):

```tsx
/** The picker-menu row opening the custom-agent manager. */
import { useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import { IconPlusOutlineRegular, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CustomAgentsState } from './custom-agents-store.ts'
import { CustomAgentsModal } from './CustomAgentsModal.tsx'
import css from './CreateCustomAgentButton.module.css'

/** Manager handle supplied by the plugin scope. */
export interface CreateCustomAgentButtonInjected {
  hooks: {
    customAgents: SnapshotStore<CustomAgentsState>
  }
  /** The store controller the modal calls for CRUD. */
  controller: CustomAgentsController
  load: () => Promise<void>
}

type CreateCustomAgentButtonProps = PropsRuntime<'agentPreset.picker.actions'>
  & PropsLocale<'customAgents'> & InjectFace<CreateCustomAgentButtonInjected>

/**
 * Append the manager entry after the preset rows.
 * @param props - locale, roster store, the controller, and the owner's onDismiss.
 * @returns the menu item with the manager modal.
 */
export function CreateCustomAgentButton({
  t, useCustomAgents, controller, load, onDismiss,
}: CreateCustomAgentButtonProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <MenuItemButton icon={<IconPlusOutlineRegular size={14} />} onSelect={() => {
        onDismiss()
        setOpen(true)
        void load()
      }}>
        <span className={css.copy}>{t('open')}</span>
      </MenuItemButton>
      {open && <CustomAgentsModal t={t} useCustomAgents={useCustomAgents} controller={controller} onClose={() => { setOpen(false) }} />}
    </>
  )
}
```

`CreateCustomAgentButton.module.css`:

```css
.copy {
  font-weight: 500;
}
```

- [ ] **Step 2: Модал** `CustomAgentsModal.tsx` — форма (name, description, instructions с счётчиком `charsUsed` от policy), чекбоксы tools из `policy.allowedTools`, список агентов с кнопками edit/delete (delete — через `window.confirm`-подобный inline-подтверждение с копией `removeConfirm`), вызовы `controller.create/update/remove`, ошибки — `invalidInput`/`limitReached`/`conflict`/`errorUnavailable`. Каркас:

```tsx
/** The manager modal: the agent list plus the create/edit form. */
import { useEffect, useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { PropsLocale, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Checkbox, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CustomAgentRecord } from '@deepseek-ai/dsh-agent-preset-custom/types'
import type { CustomAgentsState, WriteOutcome } from './custom-agents-store.ts'
import css from './CustomAgentsModal.module.css'

/** The modal composes the store hooks, the controller, and the shared locale seat. */
export interface CustomAgentsModalProps {
  /** Shared locale seat for the customAgents namespace. */
  t: Translate<'customAgents'>
  /** Selector hook bound from the inject.hooks compartment (SnapshotStore → SnapshotSelectorHook). */
  useCustomAgents: SnapshotSelectorHook<SnapshotStore<CustomAgentsState>>
  /** The store controller for create/update/remove. */
  controller: CustomAgentsController
  /** Close the modal. */
  onClose: () => void
}
```

Импорты: `import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'`. Тело: `const state = useCustomAgents(value => value)`; `useState` формы `{ name, description, instructions, tools: string[] }`; `editing: CustomAgentRecord | undefined`; submit собирает `CustomAgentInput` и зовёт `controller.create`/`update`; лимиты из `state.policy` для счётчика и `maxLength`-подсказок; список `state.agents` с кнопками edit (`setEditing(record)`) и delete (inline-подтверждение с `t('removeConfirm')`, затем `controller.remove(id, record.version)`); outcome-ошибки рендерятся строкой `t('invalidInput', { reason })` / `t('limitReached')` / `t('conflict')` / `t('errorUnavailable')`.

- [ ] **Step 3: Спека компонентов** — `tests/components.client.spec.tsx` по образцу `packages/client/ui-agent-preset/tests/create-plugin-menu-item.client.spec.tsx`: рендер кнопки с fake-стором, клик открывает модал, сабмит валидной формы зовёт create и эмитит событие.

- [ ] **Step 4: Run** — `pnpm exec vitest run packages/client/ui-custom-agents` → PASS; `pnpm run verify-client-ui-i18n` → PASS (весь копирайт через `t`).
- [ ] **Step 5: Commit**

```bash
git add packages/client/ui-custom-agents
git commit -m "feat(ui-custom-agents): render the picker entry and the manager modal"
```

---

### Task 9: Бандл — строки плагинов, решения, каталоги

**Files:**
- Modify: `packages/bundle/web-app/cordis.patch.yml` (клиентская строка после `ui-agent-preset` ~строка 456; host-строка после `agent-preset-registry` ~строка 620)
- Modify: `packages/bundle/web-app/package.json` (dependencies: `@deepseek-ai/dsh-agent-preset-custom`, `@deepseek-ai/dsh-client-ui-custom-agents` — по алфавиту)
- Modify: `tsconfig.client.json` (добавить `./packages/client/ui-custom-agents`)

**Interfaces:**
- Produces: обе строки резолвятся из манифеста (гейт `verify-cordis-config`); каталоги свежие.

- [ ] **Step 1: Строки** — в клиентский список (рядом с `ui-agent-preset`):

```yaml
      # The custom-agent manager over the preset picker's action slot.
      - id: ui-custom-agents
        name: '@deepseek-ai/dsh-client-ui-custom-agents'
```

в host-секцию (после `- insert:` блока `agent-preset-registry`):

```yaml
    - id: agent-preset-custom
      name: '@deepseek-ai/dsh-agent-preset-custom'
```

(у host-строки нет config — дефолты Config; оверлей north-waterfront задаёт настоящий конфиг в Task 10.)

- [ ] **Step 2: Манифест/решения/каталоги** — deps в web-app `package.json`, reference в `tsconfig.client.json`; `pnpm install`; затем `pnpm run gen-config-catalog`, `pnpm run gen-plugin-packages`, `pnpm run gen-tsconfig-paths`; если какой-то из `verify-*` gate в doc-sync/hygiene укажет на устаревший каталог — запустить его `pnpm run gen-…` по сообщению.

- [ ] **Step 3: Проверки** — `pnpm run verify-cordis-config` → PASS; `pnpm run build:artifacts && pnpm run typecheck` → PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/bundle/web-app tsconfig.client.json pnpm-lock.yaml
git commit -m "feat(web-app): mount the custom agent preset service and manager"
```

---

### Task 10: Оверлей north-waterfront + деплой-дока

**Files:**
- Modify: `packages/bundle/web-app/client-north-waterfront.patch.yml` (убрать disable `ui-agent-preset`; вставить конфиг хост-строки и клиентскую строку; обновить шапку)
- Modify: `DEPLOY-CLIENT-SITE.md` (раздел «Свои агенты»)

- [ ] **Step 1: Оверлей** — удалить строки 92-93 (`- id: ui-agent-preset / disabled: true`), в конец файла добавить:

```yaml
# -- Custom agents: user-created presets within the deployment whitelist. -----
# The preset picker chip returns (mode choice + the manager entry); Creator
# mode and the coding presets stay hidden by the Coding Tools gate. User
# input reaches the Loader only as typed configuration values.
- insert:
    - id: agent-preset-custom
      name: '@deepseek-ai/dsh-agent-preset-custom'
      config:
        instructionsPrefix: You are the drawings assistant of the north-waterfront client site, powered by the {{model}} model. Work from the drawing5 tools and say plainly when the loaded set has no answer.
        basePlugins:
          - id: agent-instructions
            name: '@deepseek-ai/dsh-agent-instructions'
            config:
              maxBytes: 65536
          - id: time-context
            name: '@deepseek-ai/dsh-time-context'
          - id: compaction
            name: cordis:group
            group: true
            isolate:
              compaction: true
              toolResultPruner: true
            config:
              - id: compaction-basic
                name: '@deepseek-ai/dsh-compaction-basic'
              - id: command-compact
                name: '@deepseek-ai/dsh-command-compact'
              - id: tool-result-pruner
                name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
                config:
                  thresholdChars: 8192
                  headChars: 4096
                  tailChars: 1024
        allowedTools:
          ask-user:
            name: '@deepseek-ai/dsh-tool-ask-user'
          todo:
            name: '@deepseek-ai/dsh-tool-todo'
            config:
              allowParallelInProgress: true
    - id: ui-custom-agents
      name: '@deepseek-ai/dsh-client-ui-custom-agents'
```

Обновить шапку-комментарий (строки 1-12): добавить, что чип выбора агента возвращён вместе с конструктором кастомных агентов в пределах whitelist, а Creator/PTC/Minimal остаются скрыты гейтом Coding Tools.

- [ ] **Step 2: Деплой-дока** — в `DEPLOY-CLIENT-SITE.md` добавить раздел: список агентов хранится в `%USERPROFILE%\.dsh-north-waterfront\storages\` (домен `custom-agent-presets`, json), whitelist и лимиты — в `client-north-waterfront.patch.yml` (allowedTools/basePlugins/limits), включение/выключение — правкой оверлея; профиль перечитывает патч через HMR, новые строки требуют рестарт.

- [ ] **Step 3: Commit**

```bash
git add packages/bundle/web-app/client-north-waterfront.patch.yml DEPLOY-CLIENT-SITE.md
git commit -m "docs(deploy): enable the custom agent builder on the north-waterfront overlay"
```

---

### Task 11: Web e2e и золотые снапшоты

**Files:**
- Modify: `apps/web/tests/scaffold.ts` (опция `customAgentPresets`)
- Create: `apps/web/tests/custom-agent-presets.e2e.ts`
- Create: `apps/web/tests/expected/custom-agent-presets/menu.expected.md` (golden, через refresh-режим)

- [ ] **Step 1: Scaffold-опция** — в `LaunchOptions` добавить:

```ts
  customAgentPresets?: {
    instructionsPrefix?: string
    allowedTools?: Record<string, { name: string; config?: unknown }>
  }
```

в compose-список rows рядом с `agentPresets` (строки ~685-688):

```ts
    ...options.customAgentPresets === undefined ? [] : [
      { insert: [{ id: 'agent-preset-custom', name: '@deepseek-ai/dsh-agent-preset-custom', config: {
        instructionsPrefix: options.customAgentPresets.instructionsPrefix ?? '',
        basePlugins: [],
        allowedTools: options.customAgentPresets.allowedTools ?? {},
      } }] },
    ],
```

- [ ] **Step 2: Сценарий** `apps/web/tests/custom-agent-presets.e2e.ts` (по образцу `agent-preset-selection.e2e.ts`; zero model calls):

```ts
// Web e2e scenario: user-created custom agent presets. The service mounts the
// seeded record before the page loads; the manager writes go through the UI.
// Zero model calls: no replay fixture mounts, so a stray stream fails loud.
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/custom-agent-presets', import.meta.url))
const MENU_EXPECTED = join(SNAPSHOT_DIR, 'menu.expected.md')
const MODE = webSnapshotMode()

let scaffold: WebScaffold
let browser: Browser
let page: Page
let tripwire: ReturnType<typeof watchConsole>

beforeAll(async () => {
  scaffold = await launchWebScaffold({
    agentPresets: { default: 'standard' },
    customAgentPresets: {
      instructionsPrefix: 'You are the drawings assistant.',
      allowedTools: { 'ask-user': { name: '@deepseek-ai/dsh-tool-ask-user' } },
    },
  })
  await scaffold.ctx.customAgentPresets.create({
    name: 'Сметчик', description: 'Считает объёмы по чертежам.', instructions: 'Считай объёмы работ и материалов.', tools: [],
  })
  browser = await chromium.launch()
  page = await newEnglishPage(browser)
  tripwire = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
}, 120_000)

afterAll(async () => {
  await browser?.close()
  await scaffold?.close()
})

describe('custom agent presets', () => {
  it('lists the seeded custom agent in the preset menu', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-custom-agent-menu'))
    await page.getByRole('button', { name: 'Standard mode' }).click()
    const menu = page.getByRole('menu')
    await menu.waitFor({ timeout: 10_000 })
    const snapshot = await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(MENU_EXPECTED, snapshot, MODE)
    expect(snapshot).toContain('Сметчик')
    expect(snapshot).toContain('Свой агент')
    await page.keyboard.press('Escape')
  })

  it('creates a custom agent through the manager and offers it in the menu', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-custom-agent-create'))
    await page.getByRole('button', { name: 'Standard mode' }).click()
    await page.getByRole('menuitem', { name: /Свой агент/ }).click()
    await page.getByRole('heading', { name: 'Новый агент' }).waitFor({ timeout: 10_000 })
    await page.getByLabel('Название').fill('Отчётчик')
    await page.getByLabel('Инструкция').fill('Собирай отчёт по выполненным работам.')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByRole('menuitem', { name: /Отчётчик/ }).or(page.getByText('Отчётчик'))).toBeVisible()
  })
})
```

(Точные локаторы формы сверить с разметкой Task 8 — aria-label из `t('name')`/`t('instructions')`; при расхождении поправить локаторы под фактическую разметку модала.)

- [ ] **Step 3: Прогнать с refresh золот** — `DSH_SNAPSHOT=refresh pnpm exec vitest run --config vitest.e2e.config.ts apps/web/tests/custom-agent-presets.e2e.ts`, затем повторить без `DSH_SNAPSHOT` — PASS на сравнении (`webSnapshotMode()` читает `$DSH_SNAPSHOT`: replay | record | refresh).
- [ ] **Step 4: Commit**

```bash
git add apps/web/tests
git commit -m "test(web): cover the custom agent presets surface"
```

---

### Task 12: README-триплеты, финальные гейты

**Files:**
- Create: `packages/preset/agent-preset-custom/README.md` + `README.zh.md` + `README.i18n.yaml`
- Create: `packages/client/ui-custom-agents/README.md` + `README.zh.md` + `README.i18n.yaml`
- Modify (при необходимости): `packages/bundle/web-app/README.md`

- [ ] **Step 1: README** — по шаблону `packages/preset/agent-preset-registry/README.md` (Summary / Use this package с YAML-примером строки оверлея / Understand the implementation / Model Experience: «персона из записи; KV cache — новые сессии берут новую ревизию» / Known Limitations: «пресет — не песочница; whitelist задаёт деплой; список общий на DSH_HOME»). Русская копия зеркально в `README.zh.md`; `README.i18n.yaml` записать через `pnpm run verify-translation-pairing --write <путь>`.

- [ ] **Step 2: Гейты** — последовательно: `pnpm run build:artifacts && pnpm run build:check`; `pnpm run doc-sync`; `pnpm run hygiene`; `pnpm exec vitest run packages/preset/agent-preset-custom packages/client/ui-custom-agents packages/client/ui-agent-preset packages/api/remotes`. Все зелёные; падения каталогов — запустить указанный генератор и повторить.

- [ ] **Step 3: Commit**

```bash
git add packages/preset/agent-preset-custom packages/client/ui-custom-agents
git commit -m "docs: add the custom agent presets package references"
```

---

## Self-review (заполняется при исполнении)

- Спека → задачи: компонент 1 (хост) — Tasks 1-5; компонент 2 (клиент) — Tasks 6-8; компонент 3 (оверлей) — Task 10; потоки/ошибки — Tasks 2-4; безопасность — Global Constraints + Task 10; тесты — Tasks 1-4, 7-8, 11-12; доки — Tasks 10, 12.
- Известные точки адаптации (исполнитель проверяет по месту, поведение описано): schemastery `z.dict(z.object(...))` (сигнатура по образцу `routes: z.dict(z.string())` в storage-domain), локаторы e2e под фактическую aria-разметку модала Task 8.
