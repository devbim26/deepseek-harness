# Handoff: запись Session snapshot `agent-orchestration` через OpenRouter

> **Кому:** сессия, открытая в `C:\Users\Lenovo\Desktop\проект SOFT_2\Models FIN\Harness`.
> **Как читать:** «Состояние» — проверенные факты (каждый воспроизводим командой из «Verification»). «Шаги» — порядок работы с этого состояния.
> **Контекст:** продолжение `.agents/plans/2026-11-23-agent-orchestration-followup.md`. Тот план закрыт по пунктам 4 (Web-доказательство карточки) и 6 (финальные гейты) частично; незакрытым остался пункт 3 — запись Session snapshot, который теперь делается через OpenRouter.

**Goal:** записать живой Session-снимок сценария `agent-orchestration` через OpenRouter, приложить его к репозиторию и добиться зелёного replay-лейна для этого сценария — без изменения публичных контрактов фичи.

**Репозиторий:** pnpm-workspace, Node 24, ESM, хост — Windows. Перед каждой командой `pnpm`:
`export PATH="/c/Users/Lenovo/AppData/Local/Programs/nodejs-v24:$PWD/node_modules/.bin:$PATH"`.

---

## Состояние (проверено запусками)

| Пункт | Состояние | Чем подтверждено |
| --- | --- | --- |
| Клиентская карточка `orchestrate_agents` | ✅ восстановлена и работает | `packages/client/ui-tool/src/client/tool/models/agent-orchestration-card-model.ts` (реконструирован из уцелевшего `lib/types/.../agent-orchestration-card-model.js`); слот в `details-row.tsx`, заголовок в `tool-call-model.ts`, 24 ключа локалей в `ui-conversation/src/client/locales.ts` |
| Юнит-тесты клиента | ✅ 592 passed | `pnpm exec vitest run packages/client/ui-tool packages/client/ui-custom-agents` → 24 файла, 592 passed |
| Web e2e карточки + golden | ✅ зелёный | `pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/agent-orchestration.e2e.ts` → 1 passed; golden `apps/web/tests/expected/agent-orchestration.expected.md` (objective «Verify Loader composition», «Completed», «Rounds 2») |
| Keyless REAL-composition e2e | ✅ зелёный | `pnpm run test:e2e packages/subagent/tool-agent-orchestrator/tests/loader-composition.e2e.ts` → 1 passed (21.5 s) |
| Coverage трёх пакетов | ✅ 100/100/100/100 | focused coverage-команда из Verification |
| `pnpm run build` | ✅ 10/10 гейтов | host/client compiler, host/client bundle, desktop, web build, aggregate checks |
| `pnpm run doc-sync` | ✅ 43/43 | после регенерации устаревших каталогов: `gen-config-catalog`, `gen-persistence-catalog`, `gen-doc-graphs`, `gen-cordis-catalog`, `gen-client-catalog` |
| Клиентский компилятор (было 74 ошибки) | ✅ починен | фича протаскивала host-импорты в client-программы, из-за чего host-аугментация `Context.sessions: SessionStore` перекрывала клиентскую `ISessions`. Правки: `agent-preset-custom/src/config.ts` и `definition.ts` → импорт `PresetDefinition` из client-safe `/types` (ре-экспорт в `agent-preset-registry/src/types.ts`); host-сервис `FileDeliveries` вынесен из client-face `tool-present/src/types.ts` в новый `tool-present/src/deliveries.ts` (+ сабпас `./deliveries` в package.json и `tsconfig.base.json`); 3 endpoint-а в `liveshare/src/endpoint-classification.ts`; явные type-only импорты реестра в host-файлах |
| Сценарий `agent-orchestration` (каталог) | ⚠️ пересоздан мной, фикстуры нет | `snapshots/session/agent-orchestration/` содержит только `cordis.yml`, `cordis.snapshot.yml`, `snapshot.yml`; ни одного `session*.jsonl` |
| Запись через OpenRouter | ❌ не завершена | см. «Что уже проверено на пути к OpenRouter» |
| Полный `pnpm run test:snapshot` | ❌ красный на этом Windows-хосте | 207 сценариев падают на платформенно-условных model-visible входах: Windows-only скилл `diagnose-windows-sandbox-acl` (регистрация под `process.platform === 'win32'`, в коде пометка «Linux coverage lane cannot take this branch»), office-kit скиллы, токенизация `cwd`. По AGENTS.md обязательный лейн идёт на macOS/Linux, сигнал принадлежит CI |
| `pnpm run verify-product-use` | ❌ красный, 5 предсуществующих падений | ui-brand-devbim, ui-brand-north-waterfront, tool-document, tool-pdf, host-devbim-auth — «no product runtime use»; не связаны с этой работой, по Approach A не заявляются зелёными |

## Что уже проверено на пути к OpenRouter (не повторять)

Ключ OpenRouter лежит в `.env.north-waterfront` (`OPENROUTER_API_KEY`); там же `KIMI_API_KEY`, `MINIMAX_API_KEY`, `ZAI_CODING_CN_API_KEY`. На DeepSeek-ключе из корневого `.env` запись невозможна: `dsh: QUOTA: Insufficient Balance`.

1. **Адаптер DeepSeek (Messages) + OpenRouter** — `llm-deepseek` с `baseURL: https://openrouter.ai/api/v1` (Messages-совместимый эндпоинт OpenRouter) отвечает, но его строгая валидация usage не принимает ответ OpenRouter:
   - с `thinking: enabled` → `dsh: INVALID_REQUEST: Invalid Anthropic Messages API request`;
   - с `thinking: disabled` + `reasoningEffort: off` → `dsh: MALFORMED_RESPONSE: DeepSeek Messages stream: invalid cache_read_input_tokens`.
   Вывод: DeepSeek-адаптер с OpenRouter несовместим.
2. **Маршрут `llm-pi-ai` с протоколом `openai-completions`** (родной для OpenRouter; тот же приём, что в `packages/bundle/web-app/client-north-waterfront.patch.yml`) — запрос уходит, модель отвечает; запись падает уже на лимите времени процесса: `agent-orchestration headless snapshot did not exit within 30s`.

**Текущая конфигурация сценария** (пересоздан мной, файлы `snapshots/session/agent-orchestration/`):

- `cordis.yml` (живая запись): `llm-deepseek` — `disabled: true`; `llm-pi-ai` — маршрут `openrouter` (`apiKeyEnv: OPENROUTER_API_KEY`, `api: openai-completions`, `baseURL: https://openrouter.ai/api/v1`, `models: [{ id: deepseek/deepseek-v4-flash }]`); `agent-default-model` — `provider: openrouter`, `model: deepseek/deepseek-v4-flash`; `session-title-llm` — `disabled: true`; persistence в `dshHomePath('sessions')`; вставлены реестр и два пресета (`orchestrator`, `reviewer`), `agent-orchestrator`, `tool-agent-orchestrator` (delegate `reviewer`, `maxIterations: 2`, `maxParallel: 1`, `autoReport: false`).
- `cordis.snapshot.yml` (replay): `llm-deepseek`/`plugin-package-inventory-deepseek`/`session-title-llm` — `disabled: true`; sandbox-local с passthrough-runner; `llm-replay` с провайдером `openrouter` и моделью `deepseek/deepseek-v4-flash`; те же вставки пресетов и оркестратора.
- `snapshot.yml`: `recording: live`, `header: { class: agent-orchestration, pin: true, childSystemPrompts: [1, 2], childToolSchemas: [1, 2] }`, `input.task` — инструкция вызвать `orchestrate_agents` ровно один раз с objective «Complete a two-round evidence check», дать воркеру одну стартовую задачу, получить от оценщика ровно один уточняющий follow-up, затем завершить и ответить ровно `PARENT_DONE`.

Модельные id OpenRouter (проверено `GET /api/v1/models`): `deepseek/deepseek-v4-flash`, `deepseek/deepseek-v4-pro`, `deepseek/deepseek-v4.1-flash` и др.

## Шаги

### 1. Поднять лимит времени процесса записи — обязательный первый шаг

`runLoaderSmoke` режет запись на 30 с: `DEFAULT_PROCESS_TIMEOUT_MS = 30_000` в `packages/test-support/loader-smoke/src/index.ts:26`, вызов — в `snapshots/session/headless.snapshot.ts` (~строка 1404, опция `processTimeoutMs` у `runLoaderSmoke`, `packages/test-support/loader-smoke/src/index.ts:154`). Живой прогон с оркестрацией (родитель + воркер + оценщик + follow-up) в 30 с не укладывается.

Добавить в вызов `runLoaderSmoke` в `snapshots/session/headless.snapshot.ts` передачу `processTimeoutMs` (например, 300_000), желательно как поле манифеста сценария, чтобы не менять поведение всех сценариев; если поле манифеста не подходит — просто поднять дефолт для этого вызова и отметить это в отчёте.

### 2. Записать снимок

```sh
export PATH="/c/Users/Lenovo/AppData/Local/Programs/nodejs-v24:$PWD/node_modules/.bin:$PATH"
export OPENROUTER_API_KEY="$(grep -m1 '^OPENROUTER_API_KEY=' .env.north-waterfront | cut -d= -f2- | tr -d '\r' | sed -e 's/^"//' -e 's/"$//')"
DSH_SNAPSHOT=record pnpm exec vitest run --config vitest.snapshot.config.ts --update -t 'agent-orchestration'
```

На Windows ключ обязательно экспортировать в окружение: `vitest.snapshot.config.ts` читает `.env` через `process.loadEnvFile(new URL('.env', import.meta.url).pathname)`, и на Windows этот путь получает ведущий слэш, поэтому файл молча не читается (и сценарий падает с `MISSING_CREDENTIAL`). Проверить, что ключ не утёк в вывод: не печатать его.

Успех → в `snapshots/session/agent-orchestration/` появятся нормализованные `session.v4.jsonl`, `session.1.v4.jsonl`, `session.2.v4.jsonl` и sidecar-ы (`system-prompt.expected.md`, `tool-schemas.expected.json`, `.1`/`.2`). Проверить, что запись дала ровно один вызов `orchestrate_agents`, статус `complete` и `rounds: 2` (иначе карточка и golden web e2e разойдутся).

Провал (модель отклонилась от сценария, 402/429 от OpenRouter, недостаточно баланса) → **не фабриковать фикстуру**: удалить каталог `snapshots/session/agent-orchestration/`, отчитаться о непокрытом пункте.

### 3. Убрать временную `input.task`

После первой успешной записи удалить блок `input:` из `snapshots/session/agent-orchestration/snapshot.yml` — выбранный Session сам владеет задачей (правило `snapshots/AGENTS.md`).

### 4. Приложить web-снимок

Добавить `snapshots/web/agent-orchestration/snapshot.yml` с `session.source: ../../session/agent-orchestration/session.v4.jsonl`, `ui.expected.md` и `assertFixtureInventory` (заимствованный Session только для чтения). Ориентир — существующий web-сценарий, например `snapshots/web/background-job-list/snapshot.yml`; лайнер web-снимков — `scripts/run-web-snapshots.ts`.

### 5. Доказать replay

```sh
pnpm run test:snapshot snapshots/session/headless.snapshot.ts -t 'agent-orchestration'
```

Должно быть зелёным на этом хосте: replay не обращается к провайдеру, а подаёт записанные ответы. Полный лейн (`pnpm run test:snapshot`) на Windows останется красным по платформенному дрейфу (см. «Состояние») — это не регрессия, сигнал CI на macOS/Linux.

### 6. Перепрогнать затронутые гейты

`pnpm run build` (после правок исходников/манифестов), `pnpm run doc-sync`, focused coverage, keyless composition e2e, web e2e в replay-режиме, `git diff --check`, `git status --short`. Коммит и push — только по отдельной просьбе пользователя.

## Известные грабли

- `pnpm run test:snapshot:record` через npm-скрипт на Windows не работает: `DSH_SNAPSHOT=record vitest ...` — POSIX-синтаксис, который cmd.exe не понимает («"DSH_SNAPSHOT" не является внутренней или внешней командой»). Запускать `vitest` напрямую с переменной окружения.
- В `packages/test-support/session-snapshot/src/`, `packages/test-support/llm-replay/src/`, `packages/test-support/loader-smoke/src/`, `packages/llm/deepseek-llm-api-extensions/src/` лежат скомпилированные `.js`/`.d.ts` рядом с исходниками (untracked, mtime 23.11 11:12). Vite предпочитает `.js` в `.ts`, из-за чего одна запись упала с `Cannot find package '@agentclientprotocol/sdk' imported from .../src/harness.js` — это артефакт-обман, резолв Node при этом рабочий. Если снова всплывёт — удалить эти `.js`/`.d.ts` из `src/` (это build-осадок, не пользовательская работа) либо починить резолв.
- Платформенно-условный Windows-скилл `diagnose-windows-sandbox-acl` ломает replay системных prompt-ов на этом хосте; лечится только средой macOS/Linux или перезаписью фикстур (что запрещено правилами репозитория для чужих сценариев).
- `verify-product-use` красный на 5 пакетах независимо от этой работы.

## Verification

```sh
export PATH="/c/Users/Lenovo/AppData/Local/Programs/nodejs-v24:$PWD/node_modules/.bin:$PATH"

# Запись (живой провайдер)
export OPENROUTER_API_KEY="$(grep -m1 '^OPENROUTER_API_KEY=' .env.north-waterfront | cut -d= -f2- | tr -d '\r' | sed -e 's/^"//' -e 's/"$//')"
DSH_SNAPSHOT=record pnpm exec vitest run --config vitest.snapshot.config.ts --update -t 'agent-orchestration'

# Replay сценария
pnpm run test:snapshot snapshots/session/headless.snapshot.ts -t 'agent-orchestration'

# Coverage трёх пакетов (ожидается 100/100/100/100)
pnpm exec vitest run packages/subagent/agent-orchestrator packages/subagent/tool-agent-orchestrator packages/preset/agent-preset-custom --coverage --testTimeout=30000 --coverage.include='packages/subagent/agent-orchestrator/src/**' --coverage.include='packages/subagent/tool-agent-orchestrator/src/**' --coverage.include='packages/preset/agent-preset-custom/src/**'

# Keyless REAL-composition
pnpm run test:e2e packages/subagent/tool-agent-orchestrator/tests/loader-composition.e2e.ts

# Web-карточка
pnpm run build:artifacts
pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/agent-orchestration.e2e.ts

# Финальные гейты
pnpm run build && pnpm run doc-sync
git diff --check && git status --short
```

Признак успеха: `snapshots/session/agent-orchestration/` содержит записанные и нормализованные `session*.jsonl` с sidecar-ами; replay-лейн этого сценария зелёный; web e2e и keyless e2e зелёные; coverage 100 %; в отчёте прямо названо всё, что не удалось записать или проверить.

## Assumptions

- Пункт 3 исходного плана выполняется через OpenRouter (решение пользователя); DeepSeek-ключ без баланса не используется.
- Сценарий `agent-orchestration` пересоздан с нуля по образцу исходного handoff; публичные контракты фичи не меняются, меняется только тестовая композиция.
- Fallback при неудачной записи прежний: удалить незаписанный каталог, не фабриковать фикстуру, честно отчитаться.
- `verify-product-use` и полный snapshot-лейн на этом хосте остаются красными по описанным выше причинам; в отчёте они названы отдельно, а не заявлены зелёными.
- Пользовательские файлы (`apps/web/tests/scaffold.ts`, `file-upload-round.e2e.ts`, `model-menu-observer.e2e.ts`, `packages/bundle/web-app/*.patch.yml`, `.agents/plans/*`, `.agents/skills/dsh-add-model-subscription/*`, `NW_documents_raw/`, `DEPLOY-CLIENT-SITE.md`, `dsh-web-north-waterfront.cmd`) не трогать.
- Коммит и push — только по отдельной просьбе пользователя; GUI-GIF и PR не готовятся.
