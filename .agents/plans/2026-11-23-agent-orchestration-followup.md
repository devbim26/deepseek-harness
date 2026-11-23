# Handoff-план для другой сессии: доведение conversational agent orchestration до зелёных проверок

> **Кому:** любая сессия, открытая в репозитории `C:\Users\Lenovo\Desktop\проект SOFT_2\Models FIN\Harness`.
> **Как читать:** раздел «Состояние» даёт проверенные факты (каждый пункт воспроизводим командой из раздела «Verification»). Раздел «Шаги» — это порядок работы; выполнять его нужно с этого состояния, не с нуля.
> **Исходный план:** `.agents/notes`-план `black-panther-forager-daredevil` (утверждён ранее, вариант §6 = **Approach A**). Все его пункты 1, 2, 5 закрыты; остались 3, 4 (Web-доказательство) и 6 (финальные гейты).

**Goal:** закрыть оставшиеся пункты утверждённого плана — Web-доказательство карточки `orchestrate_agents`, запись (или осознанный отказ от записи) Session snapshot, финальные гейты — без изменения публичных контрактов фичи.

**Репозиторий:** pnpm-workspace, Node 24, ESM. Перед каждой командой `pnpm`:
`export PATH="/c/Users/Lenovo/AppData/Local/Programs/nodejs-v24:$PWD/node_modules/.bin:$PATH"`.

---

## Состояние (проверено запусками, а не чтением)

| Пункт | Состояние | Чем подтверждено |
| --- | --- | --- |
| 1. Coverage `agent-orchestrator`, `tool-agent-orchestrator`, `agent-preset-custom` | ✅ 100 % по statements/branches/functions/lines | точной командой из плана: таблица `All files 100 / 100 / 100 / 100` |
| 2. Keyless REAL-composition e2e (реальный Loader, реальный headless-профиль) | ✅ проходит | `pnpm run test:e2e packages/subagent/tool-agent-orchestrator/tests/loader-composition.e2e.ts` → 1 passed (24 s) |
| 4. Client-код карточки | ✅ реализован | `packages/client/ui-tool/src/client/tool/models/agent-orchestration-card-model.ts`; слот `orchestrate_agents` в `packages/client/ui-tool/src/client/tool/toolviews/details-row.tsx`; заголовок в `models/tool-call-model.ts`; локали в `packages/client/ui-conversation/src/client/locales.ts` |
| 4. Юнит-тесты клиента | ✅ 596 + 17 passed | `pnpm exec vitest run packages/client/ui-tool packages/client/ui-custom-agents`; отдельно `packages/client/ui-custom-agents/tests/components.client.spec.tsx` (17 passed, включая «requires at least one delegate and focuses the delegate section») |
| 5. Модальное окно custom-agents | ✅ реализовано | `packages/client/ui-custom-agents/src/client/CustomAgentsModal.tsx`: локальный отказ `delegatesRequired`, фокус на секции делегатов, сброс флага при выборе делегата |
| Документация | ✅ `pnpm run test:docs` → 21 passed, 0 failed | включая translation pairing; `README.i18n.yaml` в `ui-tool` и `ui-custom-agents` уже перезаписаны |
| **4b. Web e2e карточки** | ❌ **падает** | `apps/web/tests/agent-orchestration.e2e.ts`: строка `orchestrate_agents` рендерится generic-формой («Tool call · orchestrate_agents · …» + IN/OUT + Inspect) вместо карточки; objective/статус/Rounds не видны. Скриншот: `.artifacts/web-e2e-agent-orchestration.png` |
| **3. Записанный Session snapshot** | ❌ **не записан** | `snapshots/session/agent-orchestration/` содержит только `cordis.yml`, `cordis.snapshot.yml`, `snapshot.yml` — без `session*.jsonl` |
| **Следствие: snapshot- lane падает** | ❌ | `pnpm run test:snapshot snapshots/session/headless.snapshot.ts -t 'agent-orchestration'` → `Error: missing parent session fixture` (в lane нет незаписанного сценария) |
| 6. Финальные гейты | ⬜ не выполнялись | `pnpm run build`, `pnpm run doc-sync`, полный `pnpm run test:snapshot`, `pnpm run verify-product-use`, `git diff --check` |

**Гипотеза причины падения web e2e (проверить первой):** web-скаффолд отдаёт *собранный* клиент — `apps/web/dist` и `packages/client/ui-tool/lib` от 22.11 12:10, то есть до правок ui-tool/ui-conversation от 23.11. Ключевой слот `orchestrate_agents` и новые ключи локалей в этот bundle не попали, поэтому строка ушла в generic-ветку `DetailsRow` → `details === null`. Второй кандидат (если после пересборки строка останется generic): карточная модель возвращает `null` на реальных данных — тогда нужен дамп `tool/result` из засеянного родительского Session.

**Ветка решения по snapshot (пункт 3):** в корневом `.env` есть `DEEPSEEK_API_KEY=sk-b6f…` (живой ключ). Сценарий подготовлен к живой записи (`snapshot.yml`: `recording: live`, `childSystemPrompts: [1, 2]`, `childToolSchemas: [1, 2]`, `input.task` с точной инструкцией «вызвать инструмент ровно один раз, evaluator — ровно один follow-up, затем завершить»). Если модель отклонится от сценария или API недоступен — фикстуру не фабриковать, а удалить незаписанный каталог и честно отчитаться.

---

## Шаги (в этом порядке)

### 0. Зафиксировать этот handoff в репозитории

- [ ] Сохранить план как новый файл `.agents/plans/2026-11-23-agent-orchestration-followup.md` (новый файл; существующие `.agents/plans/*` из рабочего дерева не трогать и не удалять).
- [ ] Прогнать `git status --short` и убедиться, что пользовательские незакоммиченные файлы остались нетронутыми: `apps/web/tests/scaffold.ts`, `apps/web/tests/file-upload-round.e2e.ts`, `apps/web/tests/model-menu-observer.e2e.ts`, `packages/bundle/web-app/*.patch.yml`, `.agents/plans/*` (существующие), `.agents/skills/dsh-add-model-subscription/*`, `NW_documents_raw/`, `DEPLOY-CLIENT-SITE.md`, `dsh-web-north-waterfront.cmd`.

### A. Web-доказательство карточки (пункт 4 плана)

- [ ] `pnpm run build:artifacts` — обязательный шаг: без свежего клиентского bundle web-скаффолд отдаёт устаревший клиент без слота `orchestrate_agents`.
- [ ] `pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/agent-orchestration.e2e.ts`.
- [ ] Если строка всё ещё generic — снять дамп из засеянного родительского Session (события `tool/call` и `tool/result`: `data.meta`, `data.message.content`, `data.message.isError`, `call.argsRaw`) и сопоставить с контрактом `agentOrchestrationCardModel` (`kind: 'agent-orchestration'`, непустой `id`, `status ∈ complete|partial|budget-limited`, целое неотрицательное `rounds`, опциональный `pdf`). Чинить модель/источник данных, а не ослаблять проверки; на выявленную форму добавить кейс в `packages/client/ui-tool/tests/details-models.client.spec.ts`.
- [ ] Сгенерировать golden: `DSH_SNAPSHOT=refresh pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/agent-orchestration.e2e.ts` → `apps/web/tests/expected/agent-orchestration.expected.md` (файл принадлежит генератору, ручной правки нет), затем контрольный прогон без `DSH_SNAPSHOT`.
- [ ] Проверить в браузере (desktop и 390 px): collapsed/expanded, раскрытие с клавиатуры, отсутствие обрезки, отсутствие ошибок в консоли (тест уже проверяет 390 px и console-tripwire). Результат — в отчёт.

### B. Session snapshot (пункт 3 плана)

- [ ] Запись живым ключом из корневого `.env` через штатную запись: `pnpm run test:snapshot:record` с фильтром `-t 'agent-orchestration'`.
- [ ] Успех → закоммитить нормализованные `session.v4.jsonl`, `session.1.v4.jsonl`, `session.2.v4.jsonl` плюс sidecar-ы (`system-prompt.expected.md`, `tool-schemas.expected.json` и `.1`/`.2`), после первой записи убрать временный `input.task` (выбранный Session сам владеет задачей), добавить `snapshots/web/agent-orchestration/snapshot.yml` (`session.source: ../../session/agent-orchestration/session.v4.jsonl`, `ui.expected.md`) с `assertFixtureInventory` (заимствованный Session только для чтения).
- [ ] Провал (модель отклонилась / API недоступен) → удалить каталог `snapshots/session/agent-orchestration/`, не фабриковать фикстуру, отчитаться о непокрытом пункте; keyless REAL-composition e2e и Web e2e остаются доказательством поведения.

### C. Финальные гейты (пункт 6 плана, вариант Approach A)

- [ ] `pnpm run build` (build:artifacts + build:check) — после последней правки исходников/манифестов.
- [ ] `pnpm run doc-sync` — после правок документации/парных каталогов; сгенерированные каталоги остаются генераторными.
- [ ] Повторить: focused coverage-команду, keyless composition e2e, `pnpm run test:snapshot` (после B обязан быть зелёным), web e2e в replay-режиме.
- [ ] Approach A: `pnpm run verify-product-use` — зафиксировать существующие падения отдельно от проверок orchestration и **не заявлять этот гейт зелёным**.
- [ ] `git diff --check` и `git status --short`; удалить только артефакты, созданные этой работой (не пользовательские файлы).
- [ ] Коммит и push — только по отдельной просьбе пользователя.

---

## Verification (команды, которыми проверяется приведённое состояние)

```sh
export PATH="/c/Users/Lenovo/AppData/Local/Programs/nodejs-v24:$PWD/node_modules/.bin:$PATH"

# 1. Coverage (ожидается 100/100/100/100 по всем включённым исходникам)
pnpm exec vitest run packages/subagent/agent-orchestrator packages/subagent/tool-agent-orchestrator packages/preset/agent-preset-custom --coverage --testTimeout=30000 --coverage.include='packages/subagent/agent-orchestrator/src/**' --coverage.include='packages/subagent/tool-agent-orchestrator/src/**' --coverage.include='packages/preset/agent-preset-custom/src/**'

# 2. Keyless REAL-composition
pnpm run test:e2e packages/subagent/tool-agent-orchestrator/tests/loader-composition.e2e.ts

# 4. Web-карточка: сборка → прогон → golden → контрольный прогон
pnpm run build:artifacts
pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/agent-orchestration.e2e.ts
DSH_SNAPSHOT=refresh pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/agent-orchestration.e2e.ts
pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/agent-orchestration.e2e.ts

# 3. Snapshot- lane (после B)
pnpm run test:snapshot snapshots/session/headless.snapshot.ts -t 'agent-orchestration'
pnpm run test:snapshot

# 6. Финальные гейты
pnpm run build && pnpm run doc-sync && pnpm run verify-product-use
git diff --check && git status --short
```

Итоговый признак успеха: в браузере у строки `orchestrate_agents` видны objective, статус и «Rounds»; golden зафиксирован; `pnpm run test:snapshot` зелёный; coverage 100 %; в отчёте прямо названо всё, что не удалось записать или проверить.

---

## Assumptions (зафиксированы, чтобы не переспрашивать)

- Пункт §6 исходного плана выполняется в варианте **Approach A**: `scripts/product-package-policy.ts` и bundle-mounts не меняются, `verify-product-use` запускается и докладывается отдельно.
- Запись snapshot выполняется живым ключом из корневого `.env`; при недоступности API или отклонении модели fallback — удаление незаписанного каталога (не ручная правка фикстуры).
- Web e2e остаётся keyless (питается Session из REAL-composition прогона) даже при успешной записи снимка; snapshot-реплей добавляется только вместе с записью.
- Продуктовое поведение не меняется: правки ограничены клиентским чтением `presentationMeta`, тестами и документацией; публичные контракты `agent-orchestrator` / `tool-agent-orchestrator` / `agent-preset-custom` не переписываются.
- Конвенции репозитория (AGENTS.md) остаются в силе: регистрации — через `ctx.effect()`/`ctx.on()`, клиентский текст — через типизированные словари, README-пары — с перезаписью pairing, без ручной правки сгенерированных каталогов.
- GUI-GIF и подготовка PR не выполняются (запроса на PR нет).
