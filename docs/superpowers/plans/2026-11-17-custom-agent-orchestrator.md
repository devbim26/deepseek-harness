# Оркестраторы и видимость кастомных агентов — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** дать кастомным агентам NW статус «оркестратор» (запуск других кастомных агентов через `tool-subagent`) и чекбокс «видимость в интерфейсе» (скрыть агента из пикера, оставив запускаемым).

**Architecture:** статус и список запускаемых хранятся в записи `agent-preset-custom`; синтез пресета оркестратора монтирует строку делегирования из нового поля `delegation` конфига сервиса (витрина деплоя); флаг `hidden` проходит через `PresetDefinition` → `agentPresets/list` → фильтры пикера. Движок `tool-subagent` не меняется. Спека: [docs/superpowers/specs/2026-11-17-custom-agent-orchestrator-design.md](../specs/2026-11-17-custom-agent-orchestrator-design.md).

**Tech Stack:** TypeScript (strict, ESM), Cordis-плагины, schemastery-конфиг, zod (durable-граница), typert Remote, React + CSS Modules, vitest.

## Global Constraints

- Ветка `add-documents` содержит несвязанные незакоммиченные правки: каждый `git add` перечисляет только файлы задачи; никогда `git add -A`.
- `exactOptionalPropertyTypes`: «отсутствует» и «присутствует как undefined» различаются — необязательные поля строятся spread-приёмом (`...(x === undefined ? {} : { x })`).
- Файлы заканчиваются ровно одним переводом строки; pre-commit гейтит `git diff --cached --check`.
- Клиентская копия — только через словари `locales.ts` (en/ru/zh), английская — sentence case.
- Ввод с wire-границы (remote-вход `CustomAgentInput`) валидируется по форме; перекрёстные проверки (существование ссылок) — в сервисе по таблице.
- Никаких `as unknown`; никаких новых `any` без обоснования в комментарии.
- Команды проверки из корня репозитория: `pnpm exec vitest run <пути-спек>`, `pnpm run typecheck`, `pnpm run lint`.

---

### Task 1: Сервис — модель данных и валидация полей

**Files:**
- Modify: `packages/preset/agent-preset-custom/src/types.ts`
- Modify: `packages/preset/agent-preset-custom/src/config.ts`
- Modify: `packages/preset/agent-preset-custom/src/spec.ts`
- Modify: `packages/preset/agent-preset-custom/src/validate.ts`
- Test: `packages/preset/agent-preset-custom/tests/validate.spec.ts`
- Test: `packages/preset/agent-preset-custom/tests/persistence.spec.ts`

**Interfaces:**
- Consumes: существующие `CustomAgentRecord`, `CustomAgentInput`, `Config`, zod-схема `customAgentRecord`, `validateInput`.
- Produces: `CustomAgentRecord`/`CustomAgentInput` с обязательными `isOrchestrator: boolean`, `delegates: readonly string[]`, `hidden: boolean`; `CustomAgentPolicy.delegationAvailable: boolean`; `Config.delegation?: DelegationEntry` (`{ name: string; config?: Record<string, unknown> }`); `validateInput` возвращает расширенный `Pick`. Задачи 2–6 полагаются на эти имена.

- [ ] **Step 1: написать падающие тесты в validate.spec.ts**

В `describe('validateInput')` обнови `base` и добавь кейсы (файл целиком):

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
  const base = { name: 'Сметчик', description: 'Считает объёмы.', instructions: 'Считай объёмы работ.', tools: ['todo'], isOrchestrator: false, delegates: [], hidden: false }

  it('accepts a valid input and trims fields', async () => {
    await expect(validateInput({ ...base, name: '  Сметчик  ' }, standardConfig)).resolves.toMatchObject({ name: 'Сметчик', tools: ['todo'] })
  })

  it('rejects empty name, over-limit name, over-limit instructions, and unknown tools with coded errors', async () => {
    await expect(validateInput({ ...base, name: '   ' }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/invalid' })
    await expect(validateInput({ ...base, name: 'x'.repeat(65) }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/invalid' })
    await expect(validateInput({ ...base, instructions: 'x'.repeat(16385) }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/limit' })
    await expect(validateInput({ ...base, tools: ['shell'] }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/invalid' })
  })

  it('passes the delegation fields through, trimming and deduplicating delegates', async () => {
    await expect(validateInput({ ...base, isOrchestrator: true, delegates: ['custom/a', 'custom/a', ' custom/b '] }, standardConfig))
      .resolves.toMatchObject({ isOrchestrator: true, delegates: ['custom/a', 'custom/b'], hidden: false })
  })

  it('rejects malformed delegation input with coded errors', async () => {
    await expect(validateInput({ ...base, delegates: 'custom/a' }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/invalid' })
    await expect(validateInput({ ...base, delegates: ['  '] }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/invalid' })
    await expect(validateInput({ ...base, isOrchestrator: 'yes' }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/invalid' })
    await expect(validateInput({ ...base, hidden: 1 }, standardConfig)).rejects.toMatchObject({ code: 'custom-agent-presets/invalid' })
  })
})
```

- [ ] **Step 2: прогнать, убедиться в падении**

Run: `pnpm exec vitest run packages/preset/agent-preset-custom/tests/validate.spec.ts` — Expected: FAIL — новый `base` не проходит типы/`validateInput` не знает полей (время компиляции спеки или резолв без новых полей).

- [ ] **Step 3: расширить типы, конфиг, zod-схему и validateInput**

`src/types.ts` — в `CustomAgentRecord` после `tools`:

```ts
  /** Whether this agent may launch other custom agents as subagents. */
  readonly isOrchestrator: boolean
  /** Ids of the custom agents this orchestrator launches; regular agents only. */
  readonly delegates: readonly string[]
  /** Whether the preset picker offers this agent; hidden agents stay launchable by orchestrators. */
  readonly hidden: boolean
```

В `CustomAgentInput` после `tools`:

```ts
  readonly isOrchestrator: boolean
  readonly delegates: readonly string[]
  readonly hidden: boolean
```

В `CustomAgentPolicy` после `allowedTools`:

```ts
  /** Whether the deployment carries the delegation row; gates the orchestrator checkbox in the form. */
  readonly delegationAvailable: boolean
```

`src/config.ts` — новый интерфейс перед `Config` и поле в `Config`:

```ts
/** The delegation row template an orchestrator mounts; its presence enables the orchestrator flag. */
export interface DelegationEntry {
  /** Package name of the mounted delegation plugin row. */
  name: string
  /** Base row config; the service adds `allowedAgentPresets` from the record. */
  config?: Record<string, unknown>
}
```

В `interface Config` после `allowedTools`:

```ts
  /** Delegation row template for orchestrators; omit to disable the orchestrator flag entirely. */
  delegation?: DelegationEntry
```

В `z.object` схемы после `allowedTools`:

```ts
  delegation: z.object({ name: z.string().required(), config: z.dict(z.any()) }),
```

`src/spec.ts` — в `customAgentRecord` после `tools`:

```ts
  isOrchestrator: z.boolean().default(false),
  delegates: z.array(z.string()).default([]),
  hidden: z.boolean().default(false),
```

(дефолты zod нормализуют записи старой сборки при чтении с durable-границы; версию домена не поднимаем — старые файлы парсятся.)

`src/validate.ts` — в `validateInput` перед `return` и новый возвращаемый набор:

```ts
  if (typeof input.isOrchestrator !== 'boolean' || typeof input.hidden !== 'boolean') {
    throw invalid('isOrchestrator and hidden must be booleans')
  }
  if (!Array.isArray(input.delegates)) throw invalid('Delegates must be a list of agent ids')
  if (input.delegates.some((id: unknown) => typeof id !== 'string' || id.trim() === '')) {
    throw invalid('Delegates must be non-empty agent ids')
  }
  return {
    name, description, instructions, tools: [...new Set(input.tools)],
    isOrchestrator: input.isOrchestrator,
    delegates: [...new Set(input.delegates.map((id: string) => id.trim()))],
    hidden: input.hidden,
  }
```

- [ ] **Step 4: обновить существующие вызовы `create`/`update`/`validateInput` под новую форму входа**

В `tests/custom-agents.spec.ts` каждый литерал входа `{ name: ..., description: ..., instructions: ..., tools: ... }` дополни `isOrchestrator: false, delegates: [], hidden: false`. В `tests/components.client.spec.tsx` (пакет ui-custom-agents) — то же для литералов `CustomAgentInput` (задача 6 перепишет их глубже; здесь только совместимость типов).

- [ ] **Step 5: тест legacy-записи в persistence.spec.ts**

Добавь в конец `describe`:

```ts
  it('defaults the delegation fields for a record written by an older build', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-custom-agents-'))
    roots.push(root)
    const first = await harness({}, { jsonRoot: root })
    const created = await first.ctx.customAgentPresets.create({ name: 'Legacy', description: '', instructions: 'i', tools: [], isOrchestrator: false, delegates: [], hidden: false })
    await first.ctx.fiber.dispose()

    // Strip the new fields from the stored file, simulating an older build's record.
    const { readdir, readFile, writeFile } = await import('node:fs/promises')
    for (const rel of await readdir(root, { recursive: true })) {
      const path = join(root, String(rel))
      if (!path.endsWith('.json')) continue
      const raw = await readFile(path, 'utf8')
      if (!raw.includes(created.id)) continue
      const record: Record<string, unknown> = JSON.parse(raw)
      delete record.isOrchestrator
      delete record.delegates
      delete record.hidden
      await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    }

    const second = await harness({}, { jsonRoot: root })
    const catalog = await second.ctx.customAgentPresets.remoteExportList()
    expect(catalog.agents.find(agent => agent.id === created.id)).toMatchObject({ isOrchestrator: false, delegates: [], hidden: false })
  })
```

- [ ] **Step 6: прогнать пакет**

Run: `pnpm exec vitest run packages/preset/agent-preset-custom` — Expected: PASS (кроме, возможно, «serves an empty catalog» — policy ещё без `delegationAvailable`; если падает на toMatchObject строгой формы — это чинится в Task 4; тогда ожидай ровно этот FAIL и продолжай).

- [ ] **Step 7: Commit**

```bash
git add packages/preset/agent-preset-custom/src/types.ts packages/preset/agent-preset-custom/src/config.ts packages/preset/agent-preset-custom/src/spec.ts packages/preset/agent-preset-custom/src/validate.ts packages/preset/agent-preset-custom/tests/validate.spec.ts packages/preset/agent-preset-custom/tests/persistence.spec.ts packages/preset/agent-preset-custom/tests/custom-agents.spec.ts
git commit -m "feat(agent-preset-custom): orchestrator, delegates, and visibility record fields"
```

---

### Task 2: Реестр — клиентский флаг `hidden`

**Files:**
- Modify: `packages/preset/agent-preset-registry/src/definition.ts:5-11`
- Modify: `packages/preset/agent-preset/src/index.ts:16-23`
- Modify: `packages/preset/agent-preset-registry/src/index.ts:193-205`
- Modify: `packages/preset/agent-preset-registry/src/types.ts:8-19`
- Test: `packages/preset/agent-preset-registry/tests/display.spec.ts`

**Interfaces:**
- Produces: `PresetDefinition.hidden?: boolean`; поле конфига строки `@deepseek-ai/dsh-agent-preset` `hidden?: boolean`; `AgentPresetRow.hidden?: boolean` в ответе `agentPresets/list`. Задачи 3 и 5 используют их.

- [ ] **Step 1: падающий тест в display.spec.ts**

Внутри существующего `describe` добавь (используя уже импортированные в файле `harness`/`declare`; если `declare` не импортирован — добавь в существующий import из `'./harness.ts'`):

```ts
  it('carries the hidden flag to the roster without breaking the preset', async () => {
    const ctx = await harness()
    await declare(ctx, { id: 'stealth', hidden: true, plugins: [] })
    const roster = await ctx.agentPresets.remoteExportList()
    expect(roster.presets.find(preset => preset.id === 'stealth')).toMatchObject({ hidden: true })
    await expect(ctx.agentPresets.resolve('stealth')).resolves.not.toHaveProperty('broken')
  })
```

- [ ] **Step 2: прогнать**

Run: `pnpm exec vitest run packages/preset/agent-preset-registry/tests/display.spec.ts` — Expected: FAIL — тип `hidden` не объявлен, в ростере поля нет.

- [ ] **Step 3: реализация**

`agent-preset-registry/src/definition.ts` — в `PresetDefinition` после `order`:

```ts
  /** Client-facing visibility: pickers hide the preset; it still composes sessions and resolves as a child. */
  readonly hidden?: boolean
```

`agent-preset/src/index.ts` — в `static Config` схему после `order`:

```ts
    hidden: z.boolean(),
```

`agent-preset-registry/src/index.ts` — в `list()`, в маппинг строки после строки с `order`:

```ts
        ...(record.config.hidden === undefined ? {} : { hidden: record.config.hidden }),
```

`agent-preset-registry/src/types.ts` — в `AgentPresetRow` после `description`:

```ts
  /** Whether pickers hide this preset; the definition still composes sessions and resolves as a child. */
  readonly hidden?: boolean
```

- [ ] **Step 4: прогнать**

Run: `pnpm exec vitest run packages/preset/agent-preset-registry` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/preset/agent-preset-registry/src/definition.ts packages/preset/agent-preset-registry/src/index.ts packages/preset/agent-preset-registry/src/types.ts packages/preset/agent-preset/src/index.ts packages/preset/agent-preset-registry/tests/display.spec.ts
git commit -m "feat(agent-preset-registry): client-facing hidden flag on preset definitions"
```

---

### Task 3: Сервис — синтез пресета оркестратора

**Files:**
- Modify: `packages/preset/agent-preset-custom/src/definition.ts`
- Modify: `packages/preset/agent-preset-custom/tests/harness.ts`
- Modify: `packages/preset/agent-preset-custom/package.json` (devDependencies)
- Test: `packages/preset/agent-preset-custom/tests/custom-agents.spec.ts`

**Interfaces:**
- Consumes: `Config.delegation` (Task 1), `PresetDefinition.hidden` (Task 2).
- Produces: `synthesizeDefinition` монтирует `{ id: 'delegation', name: config.delegation.name, config: { ...base, allowedAgentPresets } }` для оркестратора с непустыми `delegates`; ставит `hidden: true` по записи. Тест-стек бутит subagent-сервис и spawn-провайдер.

- [ ] **Step 1: devDependencies + бут стека в harness**

`package.json` пакета — в `devDependencies` (сортировка по алфавиту с соседями):

```json
    "@deepseek-ai/dsh-subagent": "workspace:*",
    "@deepseek-ai/dsh-subagent-spawn-in-process": "workspace:*",
```

Затем `pnpm install` из корня.

`tests/harness.ts` — импорты и бут (после `StorageJson`-импортов и до `DomainFacility`):

```ts
import Subagents from '@deepseek-ai/dsh-subagent'
import SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
```

В `harness()` после `await ctx.plugin(Storage)`:

```ts
  // The delegation row synthesized for orchestrators needs the host-plane
  // subagent registry and its spawn provider to activate.
  await ctx.plugin(Subagents)
  await ctx.plugin(SubagentSpawn)
```

И в `standardConfig` — витрина с делегированием по умолчанию (спекам на «недоступность» передают `delegation: undefined`):

```ts
  delegation: { name: '@deepseek-ai/dsh-tool-subagent', config: { provider: 'spawn', toolName: 'subagent' } },
```

- [ ] **Step 2: падающий тест синтеза**

В `tests/custom-agents.spec.ts` добавь:

```ts
  it('mounts the delegation row with the record delegates for an orchestrator', async () => {
    const { ctx } = await harness()
    const worker = await ctx.customAgentPresets.create({ name: 'Worker', description: '', instructions: 'Do the work.', tools: [], isOrchestrator: false, delegates: [], hidden: false })
    const lead = await ctx.customAgentPresets.create({ name: 'Lead', description: '', instructions: 'Run the workers.', tools: [], isOrchestrator: true, delegates: [worker.id], hidden: false })
    const document = await ctx.agentPresets.readDocument(lead.id)
    expect(document.content).toContain('dsh-tool-subagent')
    expect(document.content).toContain('allowedAgentPresets')
    expect(document.content).toContain(worker.id)
    const row = await ctx.agentPresets.resolve(lead.id)
    expect(row.broken).toBeUndefined()
  })

  it('marks a hidden agent in the roster but keeps it resolvable', async () => {
    const { ctx } = await harness()
    const ghost = await ctx.customAgentPresets.create({ name: 'Ghost', description: '', instructions: 'Work unseen.', tools: [], isOrchestrator: false, delegates: [], hidden: true })
    const roster = await ctx.agentPresets.remoteExportList()
    expect(roster.presets.find(preset => preset.id === ghost.id)).toMatchObject({ hidden: true })
    await expect(ctx.agentPresets.resolve(ghost.id)).resolves.not.toHaveProperty('broken')
  })
```

- [ ] **Step 3: прогнать**

Run: `pnpm exec vitest run packages/preset/agent-preset-custom/tests/custom-agents.spec.ts` — Expected: FAIL — в синтезированном YAML нет строки делегирования и `hidden`.

- [ ] **Step 4: реализация definition.ts**

Файл целиком:

```ts
/** Synthesis of one stored record into a registry preset definition. */
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import type { Config } from './config.ts'
import type { CustomAgentRecord } from './types.ts'

/**
 * Build the registry definition: the site persona plus the user instructions,
 * the deployment's fixed base rows, the whitelisted tool rows the record
 * selected, and — for an orchestrator with delegates — the deployment's
 * delegation row narrowed to those delegates. User data enters as plain
 * configuration values only — nothing here parses user text as configuration.
 * @param record - the stored record.
 * @param config - the service config (prefix, base rows, whitelist, delegation row).
 * @returns the definition handed to `agentPresets.register`.
 */
export function synthesizeDefinition(record: CustomAgentRecord, config: Config): PresetDefinition {
  const prefix = config.instructionsPrefix === ''
    ? record.instructions
    : `${config.instructionsPrefix} ${record.instructions}`
  const delegation = record.isOrchestrator && record.delegates.length > 0 && config.delegation !== undefined
    ? [{
        id: 'delegation',
        name: config.delegation.name,
        config: {
          ...(config.delegation.config ?? {}),
          allowedAgentPresets: [...record.delegates],
        },
      }]
    : []
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    order: 50,
    ...(record.hidden ? { hidden: true } : {}),
    plugins: [
      { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix } },
      ...config.basePlugins,
      ...record.tools.map((key) => {
        const row = config.allowedTools[key]
        // Stored tools were validated against this same whitelist at write
        // time; a narrowed config orphaning a stored key fails loud here.
        if (row === undefined) throw new Error(`custom-agent-presets: the whitelist no longer carries the '${key}' tool`)
        return { id: `tool-${key}`, name: row.name, config: row.config }
      }),
      ...delegation,
    ],
  }
}
```

- [ ] **Step 5: прогнать пакет**

Run: `pnpm exec vitest run packages/preset/agent-preset-custom` — Expected: PASS (policy-тест «serves an empty catalog» может ещё падать без `delegationAvailable` — чинится в Task 4; если это единственный FAIL — иди дальше).

- [ ] **Step 6: Commit**

```bash
git add packages/preset/agent-preset-custom/src/definition.ts packages/preset/agent-preset-custom/tests/harness.ts packages/preset/agent-preset-custom/tests/custom-agents.spec.ts packages/preset/agent-preset-custom/package.json pnpm-lock.yaml
git commit -m "feat(agent-preset-custom): synthesize the delegation row and hidden flag for orchestrators"
```

---

### Task 4: Сервис — инварианты delegates, policy, каскад удаления

**Files:**
- Modify: `packages/preset/agent-preset-custom/src/index.ts`
- Test: `packages/preset/agent-preset-custom/tests/custom-agents.spec.ts`

**Interfaces:**
- Consumes: поля из Task 1, бут из Task 3.
- Produces: remote-ошибки `custom-agent-presets/invalid` с причинами `empty-delegates` / `unknown-delegate` / `orchestrator-delegate` / `self-delegate` / `referenced-by-orchestrator`; `policy.delegationAvailable`; `remove` каскадно чистит `delegates` и поднимает `version` задетых записей.

- [ ] **Step 1: падающие тесты**

В `tests/custom-agents.spec.ts`:

```ts
  it('reports delegation availability from the deployment config', async () => {
    const { ctx } = await harness()
    expect((await ctx.customAgentPresets.remoteExportList()).policy.delegationAvailable).toBe(true)
    const plain = await harness({ delegation: undefined })
    expect((await plain.ctx.customAgentPresets.remoteExportList()).policy.delegationAvailable).toBe(false)
  })

  it('rejects orchestrator writes that break the delegates invariants', async () => {
    const { ctx } = await harness()
    const plain = { name: 'X', description: '', instructions: 'i' }
    await expect(ctx.customAgentPresets.create({ ...plain, tools: [], isOrchestrator: true, delegates: [], hidden: false }))
      .rejects.toMatchObject({ code: 'custom-agent-presets/invalid', details: { reason: 'empty-delegates' } })
    await expect(ctx.customAgentPresets.create({ ...plain, tools: [], isOrchestrator: true, delegates: ['custom/missing'], hidden: false }))
      .rejects.toMatchObject({ code: 'custom-agent-presets/invalid', details: { reason: 'unknown-delegate' } })
    const w1 = await ctx.customAgentPresets.create({ ...plain, name: 'W1', tools: [], isOrchestrator: false, delegates: [], hidden: false })
    const w2 = await ctx.customAgentPresets.create({ ...plain, name: 'W2', tools: [], isOrchestrator: false, delegates: [], hidden: false })
    const lead = await ctx.customAgentPresets.create({ ...plain, name: 'Lead', tools: [], isOrchestrator: true, delegates: [w1.id], hidden: false })
    await expect(ctx.customAgentPresets.create({ ...plain, name: 'Chain', tools: [], isOrchestrator: true, delegates: [lead.id], hidden: false }))
      .rejects.toMatchObject({ code: 'custom-agent-presets/invalid', details: { reason: 'orchestrator-delegate' } })
    // w1 already launched by lead: it cannot itself become an orchestrator.
    await expect(ctx.customAgentPresets.update(w1.id, { name: 'W1', description: '', instructions: 'i', tools: [], isOrchestrator: true, delegates: [w2.id], hidden: false }, w1.version))
      .rejects.toMatchObject({ code: 'custom-agent-presets/invalid', details: { reason: 'referenced-by-orchestrator' } })
  })

  it('cascades a deleted agent out of delegates and unmounts the tool when the list empties', async () => {
    const { ctx } = await harness()
    const worker = await ctx.customAgentPresets.create({ name: 'Worker', description: '', instructions: 'Do the work.', tools: [], isOrchestrator: false, delegates: [], hidden: false })
    const lead = await ctx.customAgentPresets.create({ name: 'Lead', description: '', instructions: 'Run the workers.', tools: [], isOrchestrator: true, delegates: [worker.id], hidden: false })
    await ctx.customAgentPresets.remove(worker.id, worker.version)
    const catalog = await ctx.customAgentPresets.remoteExportList()
    expect(catalog.agents.find(agent => agent.id === lead.id)).toMatchObject({ isOrchestrator: true, delegates: [], version: 2 })
    const document = await ctx.agentPresets.readDocument(lead.id)
    expect(document.content).not.toContain('dsh-tool-subagent')
  })
```

Если `details` не виден в ошибке vitest-матчингом — сравнивай `instance.details.reason` через try/catch-хелпер; тип `RemoteError` несёт `details` публично.

- [ ] **Step 2: прогнать**

Run: `pnpm exec vitest run packages/preset/agent-preset-custom/tests/custom-agents.spec.ts` — Expected: FAIL — policy без `delegationAvailable`, инвариантов и каскада нет.

- [ ] **Step 3: реализация в index.ts**

`policy()` — после `allowedTools: ...`:

```ts
      delegationAvailable: this.config.delegation !== undefined,
```

Приватные проверки (рядом с `unusedId`):

```ts
  /** Cross-record invariants: an orchestrator launches existing regular agents, never itself. */
  private validateDelegates(delegates: readonly string[], selfId: string): void {
    const table = this.requireTable()
    for (const id of delegates) {
      if (id === selfId) throw new RemoteError('custom-agent-presets/invalid', 'An agent cannot launch itself', { reason: 'self-delegate' })
      const target = table.get(id)
      if (target === undefined) throw new RemoteError('custom-agent-presets/invalid', `Unknown delegate: ${id}`, { reason: 'unknown-delegate' })
      if (target.isOrchestrator) throw new RemoteError('custom-agent-presets/invalid', `Delegates must not be orchestrators: ${id}`, { reason: 'orchestrator-delegate' })
    }
  }

  /** An agent another orchestrator launches cannot become an orchestrator itself. */
  private assertNotLaunched(id: string): void {
    for (const [otherId, record] of this.requireTable().entries()) {
      if (otherId !== id && record.delegates.includes(id)) {
        throw new RemoteError('custom-agent-presets/invalid', `Another orchestrator launches this agent: ${otherId}`, { reason: 'referenced-by-orchestrator' })
      }
    }
  }

  /** Validate the orchestrator shape shared by create and update. */
  private assertOrchestratorFields(fields: Pick<CustomAgentInput, 'isOrchestrator' | 'delegates'>, selfId: string): void {
    if (!fields.isOrchestrator) return
    if (fields.delegates.length === 0) {
      throw new RemoteError('custom-agent-presets/invalid', 'An orchestrator must launch at least one agent', { reason: 'empty-delegates' })
    }
    this.assertNotLaunched(selfId)
    this.validateDelegates(fields.delegates, selfId)
  }
```

В `create()` после `const fields = await validateInput(input, this.config)`:

```ts
    const id = this.unusedId(fields.name)
    this.assertOrchestratorFields(fields, id)
```

(существующую строку `const id = this.unusedId(fields.name)` замени на этот блок — id вычисляется один раз.)

В `update()` после `const fields = await validateInput(input, this.config)`:

```ts
    this.assertOrchestratorFields(fields, id)
```

В `remove()` после `await table.delete(id)`:

```ts
    // Cascade: drop the deleted agent from every orchestrator's delegates and
    // remount the trimmed records; an emptied list unmounts the tool row.
    for (const [otherId, record] of table.entries()) {
      if (!record.delegates.includes(id)) continue
      const next: CustomAgentRecord = {
        ...record,
        delegates: record.delegates.filter((entry) => entry !== id),
        version: record.version + 1,
        updatedAt: new Date().toISOString(),
      }
      await table.put(otherId, next)
      const previousRegistration = this.registrations.get(otherId)
      if (previousRegistration !== undefined) await previousRegistration()
      this.registrations.delete(otherId)
      await this.mount(next)
    }
```

- [ ] **Step 4: прогнать пакет целиком**

Run: `pnpm exec vitest run packages/preset/agent-preset-custom` — Expected: PASS (включая «serves an empty catalog»: `toMatchObject` — новое поле не ломает старый тест).

- [ ] **Step 5: Commit**

```bash
git add packages/preset/agent-preset-custom/src/index.ts packages/preset/agent-preset-custom/tests/custom-agents.spec.ts
git commit -m "feat(agent-preset-custom): delegate invariants, delegation policy, and delete cascade"
```

---

### Task 5: Пикер — фильтрация скрытых пресетов

**Files:**
- Modify: `packages/client/ui-agent-preset/src/client/settings-store.ts:119-127`
- Modify: `packages/client/ui-agent-preset/src/client/section-store.ts:50`
- Test: `packages/client/ui-agent-preset/tests/settings-store.client.spec.ts`
- Test: `packages/client/ui-agent-preset/tests/section-store.client.spec.ts`

**Interfaces:**
- Consumes: `AgentPresetRow.hidden` (Task 2).
- Produces: `presetOptions` пропускает только здоровые видимые пресеты; ростер настроек (`section-store`) не содержит скрытых строк.

- [ ] **Step 1: падающие тесты**

`tests/settings-store.client.spec.ts` — тип параметра `presets` у `fakeRoster`/`fakeApi` пополни `hidden?: boolean`, и новый `it` в `describe('the agent-preset roster store')`:

```ts
  it('omits hidden presets: visibility is a picker concern, not a composition concern', async () => {
    const controller = derivedController(fakeApi([
      { id: 'standard', isDefault: true },
      { id: 'ghost', isDefault: false, hidden: true },
    ]))

    await controller.load()

    expect(controller.store.getSnapshot().options).toEqual([{ id: 'standard' }])
  })
```

`tests/section-store.client.spec.ts` — новый `it` в `describe('the preset roster')`:

```ts
  it('drops hidden presets from the management roster', async () => {
    const { remote, controller, state } = fixture()
    remote.agentPresets.list.mockResolvedValueOnce({ ok: true, value: { presets: [
      { id: 'standard', isDefault: true },
      { id: 'ghost', isDefault: false, hidden: true },
    ] } } as never)
    await controller.load()
    expect(state().rows).toEqual([{ id: 'standard', isDefault: true }])
  })
```

- [ ] **Step 2: прогнать**

Run: `pnpm exec vitest run packages/client/ui-agent-preset/tests/settings-store.client.spec.ts packages/client/ui-agent-preset/tests/section-store.client.spec.ts` — Expected: FAIL — скрытые строки проходят в опции/строки.

- [ ] **Step 3: реализация**

`settings-store.ts` — сигнатура и фильтр `presetOptions`:

```ts
export function presetOptions(
  presets: readonly { id: string; name?: string; description?: string; broken?: string; hidden?: boolean }[],
): AgentPresetOption[] {
  return presets.filter(preset => preset.broken === undefined && preset.hidden !== true).map(preset => ({
```

И дополни docstring-абзац: `healthy, visible presets only` (замените первое предложение описания: "The roster entries as the pickers render them: healthy, visible presets only.").

`section-store.ts:50`:

```ts
      this.set({ status: 'ready', error: null, rows: result.value.presets.filter(row => row.hidden !== true) })
```

- [ ] **Step 4: прогнать**

Run: `pnpm exec vitest run packages/client/ui-agent-preset` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/ui-agent-preset/src/client/settings-store.ts packages/client/ui-agent-preset/src/client/section-store.ts packages/client/ui-agent-preset/tests/settings-store.client.spec.ts packages/client/ui-agent-preset/tests/section-store.client.spec.ts
git commit -m "feat(ui-agent-preset): hide hidden presets from the picker and the settings roster"
```

---

### Task 6: Модалка — чекбоксы и секция «Запуск агентов»

**Files:**
- Modify: `packages/client/ui-custom-agents/src/client/CustomAgentsModal.tsx`
- Modify: `packages/client/ui-custom-agents/src/client/CustomAgentsModal.module.css`
- Modify: `packages/client/ui-custom-agents/src/client/locales.ts`
- Test: `packages/client/ui-custom-agents/tests/components.client.spec.tsx`
- Test: `packages/client/ui-custom-agents/tests/store.client.spec.ts`

**Interfaces:**
- Consumes: `CustomAgentInput.isOrchestrator/delegates/hidden`, `CustomAgentPolicy.delegationAvailable` (Task 1), `CustomAgentRecord` с новыми полями.
- Produces: форма отправляет три новых поля; словарные ключи `orchestrator | orchestratorHint | visible | visibleHint | delegatesTitle | noDelegates | orchestratorBadge | hiddenBadge`.

- [ ] **Step 1: локали**

`locales.ts` — тип-юнион пополни:

```ts
  | 'orchestrator' | 'orchestratorHint' | 'visible' | 'visibleHint' | 'delegatesTitle' | 'noDelegates' | 'orchestratorBadge' | 'hiddenBadge'
```

`en`:

```ts
  orchestrator: 'Orchestrator',
  orchestratorHint: 'The agent launches the checked agents as its subagents.',
  visible: 'Show in the mode picker',
  visibleHint: 'Uncheck to keep the agent reachable only to orchestrators.',
  delegatesTitle: 'Agents to launch',
  noDelegates: 'No other regular agents yet',
  orchestratorBadge: 'orchestrator',
  hiddenBadge: 'hidden',
```

`ru`:

```ts
  orchestrator: 'Оркестратор',
  orchestratorHint: 'Агент запускает отмеченных агентов как своих субагентов.',
  visible: 'Показывать в выборе режима',
  visibleHint: 'Снимите, чтобы агент был доступен только оркестраторам.',
  delegatesTitle: 'Запуск агентов',
  noDelegates: 'Других обычных агентов пока нет',
  orchestratorBadge: 'оркестратор',
  hiddenBadge: 'скрыт',
```

`zh`:

```ts
  orchestrator: '编排者',
  orchestratorHint: '该智能体将选中的智能体作为子智能体启动。',
  visible: '在选择器中显示',
  visibleHint: '取消勾选后，仅编排者可以启动该智能体。',
  delegatesTitle: '启动的智能体',
  noDelegates: '暂无其他普通智能体',
  orchestratorBadge: '编排者',
  hiddenBadge: '已隐藏',
```

- [ ] **Step 2: падающие компонентные тесты**

`tests/components.client.spec.tsx` — обнови фикстуры: `seededAgent` += `isOrchestrator: false, delegates: [], hidden: false`; `catalog.policy` += `delegationAvailable: true`; добавь второго агента:

```ts
const seededLead: CustomAgentRecord = { id: 'custom/lead', slug: 'lead', name: 'Ведущий', description: '', instructions: 'i', tools: [], isOrchestrator: true, delegates: [seededAgent.id], hidden: true, version: 1, updatedAt: '2026-11-15T00:00:00.000Z' }
```

(`catalog.agents = [seededAgent, seededLead]`; `READY.agents` наследует.)

Новые `it` (внутри существующего `describe`, по образцу соседних — те рендерят `view()` и кликают через `fireEvent`/`screen`):

```tsx
  it('offers the orchestrator checkbox only when the deployment allows delegation', async () => {
    const unavailable = { ...catalog, policy: { ...catalog.policy, delegationAvailable: false } }
    // Пере-сидировать каталожный ответ fakeCtx нельзя точечно — используй отдельный fakeCtx-параметр:
    // (см. существующий паттерн fakeCtx(events, creates); при необходимости добавь третий аргумент catalogOverride)
    // ...render view({ agents: [seededAgent], policy: unavailable.policy })
    expect(screen.queryByRole('checkbox', { name: 'Оркестратор' })).toBeNull()
  })
```

> Примечание исполняющему: если `view()` не позволяет переопределить `policy`, расширь `fakeCtx` параметром `catalogOverride?: CustomAgentCatalog`, подставив его в `list`-ответ; это правка фикстуры, не продукта.

```tsx
  it('gates the delegate list behind the orchestrator checkbox and submits the new fields', async () => {
    render(view())
    const orchestrator = screen.getByRole('checkbox', { name: 'Оркестратор' })
    expect(orchestrator).not.toBeChecked()
    // Секция затемнена: чекбоксы списка недоступны.
    expect(screen.getByRole('checkbox', { name: 'Сметчик' })).toHaveClass(expect.any(String)) // замените на проверку disabled-обёртки:
    // ...
  })
```

> Примечание исполняющему: конкретные query-строки подгони под фактическую разметку из Step 3: (а) до отметки «Оркестратор» чекбокс «Сметчик» (`seededAgent.name`) существует, но лежит в контейнере с классом `delegatesDisabled`; (б) после `fireEvent.click(orchestrator)` чекбокс доступен, `fireEvent.click(screen.getByRole('checkbox', { name: 'Сметчик' }))` выбирает его; (в) submit (`fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))`) кладёт в `creates[0]` объект с `isOrchestrator: true`, `delegates: ['custom/agent']`, `hidden: false`; (г) чекбокс «Показывать в выборе режима» отражает `hidden` инверсно (`toBeChecked()` при `hidden: false`). Язык кнопок/чекбоксов в спеке — из `en`-словаря (`Orchestrator`, `Save`), поскольку `translations` мапа построена на `en`.

`tests/store.client.spec.ts` — обнови литералы записей/входов новыми полями по типам (механически, как в Step 4 Task 1).

- [ ] **Step 3: реализация модалки**

`CustomAgentsModal.tsx`:

1. `BLANK`:

```ts
const BLANK: CustomAgentInput = { name: '', description: '', instructions: '', tools: [], isOrchestrator: false, delegates: [], hidden: false }
```

2. `startEdit` — строку `setFields({...})` замени:

```ts
    setFields({
      name: record.name,
      description: record.description,
      instructions: record.instructions,
      tools: [...record.tools],
      isOrchestrator: record.isOrchestrator,
      delegates: [...record.delegates],
      hidden: record.hidden,
    })
```

3. После `const policy = state.policy` добавь:

```ts
  const delegateChoices = state.agents.filter(agent => agent.id !== editing?.id && !agent.isOrchestrator)
```

4. В центральной `<form>` после поля `instructions` (после блока со счётчиком символов):

```tsx
          {policy?.delegationAvailable === true && (
            <div className={css.field}>
              <Checkbox
                label={t('orchestrator')}
                checked={fields.isOrchestrator}
                onChange={(checked) => { setFields({ ...fields, isOrchestrator: checked, ...(checked ? {} : { delegates: [] }) }) }}
              />
              <span className={css.toolDescription}>{t('orchestratorHint')}</span>
            </div>
          )}
          <div className={css.field}>
            <Checkbox
              label={t('visible')}
              checked={!fields.hidden}
              onChange={(checked) => { setFields({ ...fields, hidden: !checked }) }}
            />
            <span className={css.toolDescription}>{t('visibleHint')}</span>
          </div>
```

5. Правая колонка: оберни существующий `<section className={css.toolsPane}>…</section>` в `<div className={css.rightPane}>` и добавь следом вторую секцию (до закрывающего `</div>` сетки `css.layout`):

```tsx
        <div className={css.rightPane}>
          <section className={css.toolsPane} aria-labelledby={toolsTitleId}>
            {/* …существующее содержимое без изменений… */}
          </section>
          <section className={css.delegatesPane} aria-labelledby={delegatesTitleId}>
            <div className={css.paneHead}>
              <h3 id={delegatesTitleId} className={css.paneTitle}>{t('delegatesTitle')}</h3>
            </div>
            <div className={`${css.toolScroll} ${fields.isOrchestrator ? '' : css.delegatesDisabled ?? ''}`.trim() || undefined}>
              {delegateChoices.length === 0
                ? <p className={css.empty}>{t('noDelegates')}</p>
                : delegateChoices.map(agent => (
                  <div key={agent.id} className={css.tool}>
                    <Checkbox
                      label={agent.name}
                      checked={fields.delegates.includes(agent.id)}
                      onChange={(checked) => {
                        setFields({
                          ...fields,
                          delegates: checked
                            ? [...fields.delegates, agent.id]
                            : fields.delegates.filter(entry => entry !== agent.id),
                        })
                      }}
                    />
                  </div>
                ))}
            </div>
          </section>
        </div>
```

И `const delegatesTitleId = useId()` рядом с `toolsTitleId`.

Класс-строку упрости до шаблона:

```tsx
            <div className={fields.isOrchestrator ? css.toolScroll : `${css.toolScroll} ${css.delegatesDisabled}`}>
```

6. Ростер слева — внутри `<span className={css.rowName}>` после имени:

```tsx
                  {agent.isOrchestrator && <span className={css.badge}>{t('orchestratorBadge')}</span>}
                  {agent.hidden && <span className={css.badge}>{t('hiddenBadge')}</span>}
```

`CustomAgentsModal.module.css` — правило `.agentsPane, .toolsPane {` пополни `.delegatesPane` и в конец файла:

```css
/* The right column stacks the tool whitelist and the delegate checklist;
   each keeps its own scrollport. */
.rightPane {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  min-height: 0;
}

.rightPane > section {
  flex: 1 1 0;
  min-height: 0;
}

/* The delegate checklist stays visible but inert until the orchestrator
   checkbox turns it on. */
.delegatesDisabled {
  opacity: 0.5;
  pointer-events: none;
}

.badge {
  margin-left: 6px;
  font-size: 11px;
  line-height: 16px;
  padding: 1px 6px;
  border-radius: 999px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-secondary);
}
```

- [ ] **Step 4: прогнать**

Run: `pnpm exec vitest run packages/client/ui-custom-agents` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/ui-custom-agents/src/client/CustomAgentsModal.tsx packages/client/ui-custom-agents/src/client/CustomAgentsModal.module.css packages/client/ui-custom-agents/src/client/locales.ts packages/client/ui-custom-agents/tests/components.client.spec.tsx packages/client/ui-custom-agents/tests/store.client.spec.ts
git commit -m "feat(ui-custom-agents): orchestrator flag, delegate checklist, and visibility toggle"
```

---

### Task 7: Оверлей NW, документация, генерация каталога, финальные проверки

**Files:**
- Modify: `packages/bundle/web-app/client-north-waterfront.patch.yml` (блок `agent-preset-custom`)
- Modify: `DEPLOY-CLIENT-SITE.md` (раздел «Свои агенты»)
- Modify: `packages/preset/agent-preset-custom/README.md` + `README.zh.md`
- Modify: `packages/client/ui-custom-agents/README.md` + `README.zh.md`
- Modify: `packages/preset/agent-preset/README.md` + `README.zh.md` (строка о `hidden`)
- Regenerate: `docs/config-catalog.md`, `docs/config-catalog.zh.md`

Внимание: `DEPLOY-CLIENT-SITE.md`, `client-north-waterfront.patch.yml` и оба README кастомных агентов уже содержат **незакоммиченные правки пользователя** — правь хирургически, не откатывая их; в `git add` они попадут вместе с его правками — перед коммитом покажи пользователю `git diff --cached <файл>` и подтверди включение его правок.

- [ ] **Step 1: поле delegation в оверлее**

В `client-north-waterfront.patch.yml`, в `config:` строки `agent-preset-custom`, после закрывающей карту `allowedTools:` строки `doc6:`-блока (последняя строка его `config:` — `toolCallTimeoutMs: 300000`) и перед `- id: ui-custom-agents`:

```yaml
        # Оркестраторы: поле включает флаг «оркестратор» в менеджере; сервис
        # подставляет в allowedAgentPresets id выбранных агентом записей.
        # Реестр subagent'ов и spawn-бэкенд уже host-plane (dsh-base), отдельных
        # строк не нужно. У подчинённых этой строки нет — цепочек не возникает.
        delegation:
          name: '@deepseek-ai/dsh-tool-subagent'
          config:
            provider: spawn
            toolName: subagent
```

- [ ] **Step 2: DEPLOY-CLIENT-SITE.md**

В конец раздела «Свои агенты (кастомные пресеты)» (после абзаца про битую запись):

```markdown
Оркестраторы и видимость: чекбокс «Оркестратор» (доступен, пока оверлей
несёт поле `delegation` у `agent-preset-custom`) превращает агента в
верхнеуровневого: сервис монтирует в его пресет строку `tool-subagent`
с `allowedAgentPresets` — id агентов, отмеченных в секции «Запуск агентов»
(только обычные агенты, не другие оркестраторы и не сам агент). Чекбокс
«Показывать в выборе режима» прячет агента из пикера пресетов; скрытый
агент остаётся запускаемым оркестратором. Удаление агента каскадно
вычёркивает его из чужих списков запуска; опустевший оркестратор
сохраняет флаг, но строка делегирования не монтируется.
```

- [ ] **Step 3: README пакетов**

`packages/preset/agent-preset-custom/README.md` — в таблицу конфига строку после `allowedTools`:

```markdown
| `delegation` | — | Строка делегирования для оркестраторов (`name` + базовый `config`); отсутствие поля отключает флаг «оркестратор» в менеджере. Сервис добавляет `allowedAgentPresets` из записи. |
```

И абзац после таблицы (перед описанием remote-методов):

```markdown
Оркестратор — запись с `isOrchestrator: true` и непустым `delegates` (id существующих обычных агентов, не самого агента). Синтез монтирует строку `delegation` с `allowedAgentPresets: delegates`; пустой после каскада удаления список строку не монтирует, флаг сохраняется. Агент, на которого ссылается чужой `delegates`, не может стать оркестратором; удаление агента каскадно чистит ссылки. `hidden` прячет пресет из пикера (`agentPresets/list` несёт флаг), но определение остаётся смонтировым и запускаемым оркестратором.
```

`README.zh.md` — эквивалент по-китайски (две строки таблицы/абзац; следуй существующему переводу терминов «оркестратор/скрытый» как `编排者/隐藏`).

`packages/client/ui-custom-agents/README.md` + `README.zh.md` — в «Summary» (или первый абзац «Use this package») дополни: «The form also offers the deployment-gated orchestrator flag with its delegate checklist and the picker-visibility toggle» / соответствующий перевод.

`packages/preset/agent-preset/README.md` + `README.zh.md` — дополни описание строки пресета предложением: «`hidden: true` keeps the definition mounted while pickers omit it» (+ перевод).

- [ ] **Step 4: перегенерировать каталог конфигов**

Run: `pnpm run gen-config-catalog` — Ожидаемо: `docs/config-catalog.md` и `docs/config-catalog.zh.md` получают поля `delegation` (dsh-agent-preset-custom) и `hidden` (dsh-agent-preset).

- [ ] **Step 5: финальные проверки (по dsh-pre-push-checks: только релевантное)**

```bash
pnpm exec vitest run packages/preset/agent-preset-custom packages/preset/agent-preset-registry packages/preset/agent-preset packages/client/ui-agent-preset packages/client/ui-custom-agents
pnpm run typecheck
pnpm run lint
pnpm run doc-sync
```

Затем `pnpm run build:artifacts && pnpm run build:check` перед заявкой о завершении. Решение по снапшотам: как и у фичи 2026-11-15, модельно-видимая часть — синтез содержимого пресета — покрыта сервисными тестами (`readDocument`, `resolve`); новый keyless-снапшот-кейс не добавляется. Если ревьюер потребует — отдельная задача на обвязку снапшот-харнесса под кастомный пресет.

- [ ] **Step 6: Commit (после подтверждения пользователем включения его правок в общих файлах)**

```bash
git add packages/bundle/web-app/client-north-waterfront.patch.yml DEPLOY-CLIENT-SITE.md packages/preset/agent-preset-custom/README.md packages/preset/agent-preset-custom/README.zh.md packages/client/ui-custom-agents/README.md packages/client/ui-custom-agents/README.zh.md packages/preset/agent-preset/README.md packages/preset/agent-preset/README.zh.md docs/config-catalog.md docs/config-catalog.zh.md
git commit -m "feat(north-waterfront): enable custom-agent orchestrators and picker visibility"
```

---

## Self-review

1. **Покрытие спеки:** модель данных/валидация — Task 1; `hidden` в реестре — Task 2; синтез delegation-строки и hidden — Task 3; инварианты `delegates`, policy `delegationAvailable`, каскад — Task 4; фильтрация пикера и ростера настроек — Task 5; модалка (два чекбокса, секция, бейджи, локали) — Task 6; витрина NW + доки — Task 7. Пробелов нет.
2. **Плейсхолдеры:** Step 2 Task 6 содержит примечания исполняющему о подгонке query-строк под фактическую разметку и расширении фикстуры `fakeCtx` — это единственные места с адаптацией; критерии приёмки (assert-набор) перечислены явно.
3. **Консистентность типов:** имена полей (`isOrchestrator`, `delegates`, `hidden`, `delegationAvailable`, `delegation.name/config`) одинаковы во всех задачах; `allowedAgentPresets` — имя поля конфига `tool-subagent` из его README.
