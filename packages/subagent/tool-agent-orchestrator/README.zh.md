---
description: "Инструмент оркестрации для модели: запускает делегатов и оценщика сохранённой записи кастомного агента одним автономным вызовом."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-agent-orchestrator

[English](README.md) | 中文

## 概述

Даёт сохранённой записи кастомного агента один инструмент `orchestrate_agents`, запускающий её делегатов и оценщика как автономную оркестрацию. Модель задаёт цель, необязательные обстоятельства и необязательное подмножество делегатов; пресеты делегатов, лимиты раундов и параллелизма, отчётность и границы результата принадлежат сохранённой записи. Вызов возвращает `complete`, `partial` или `budget-limited` с ограниченным резюме, раундами работников и явными пробелами. Провал и отмена — ошибки инструмента. Вопросы человеку запрещены на время прогона.

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Монтируйте один экземпляр в запись кастомного агента, которая уже включает движок оркестрации. Инструмент после этого открывает сохранённых делегатов записи как один вызов модели.

### 何时选择

Выбирайте этот инструмент, когда сохранённый кастомный агент должен предложить несколько экспертных проверок одним инструментом, а развёртывание решает, какие делегаты существуют и сколько раундов они могут выполнить. Выбирайте [`dsh-agent-orchestrator`](../agent-orchestrator/README.zh.md) напрямую, когда прогоном управляет код, а не сохранённая запись. Используйте [`dsh-tool-subagent`](../tool-subagent/README.zh.md), когда задача должна решаться одним делегатом напрямую.

### 最小配置

```yaml
plugins:
  - id: tool-agent-orchestrator
    plugin: '@deepseek-ai/dsh-tool-agent-orchestrator'
    config:
      delegates:
        - id: reviewer
          name: Reviewer
          description: Reviews the objective for correctness and missing evidence.
      maxIterations: 3
      maxParallel: 3
      autoReport: true
```

| Поле | По умолчанию | Значение |
|---|---|---|
| `delegates` | обязательное | От одного до десяти уникальных записей `{ id, name, description }`, которые пресет может запускать; каждый `id` называет сохранённый пресет делегата. |
| `evaluatorPreset` | нет | Пресет для дочернего оценщика; при отсутствии используется запись владеющего оркестратора. |
| `maxIterations` | `3` | Раунды работников и оценщика, включая первый, от 1 до 10. |
| `maxParallel` | `3` | Одновременно активные работники, от 1 до 10. |
| `autoReport` | `true` | Создаётся и доставляется ли PDF-отчёт при успешном доменном исходе. |
| `maxSummaryChars` | `4000` | Максимум символов резюме, возвращаемого модели. |
| `maxGapCount` | `32` | Максимум записей пробелов, возвращаемых модели. |
| `maxGapChars` | `500` | Максимум символов на одну возвращаемую запись пробела. |

Сгенерированный [каталог конфигурации](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-agent-orchestrator) — исчерпывающий источник всех принимаемых полей. Ни одно из этих полей не доступно модели на запись.

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

Плагин регистрирует один инструмент и больше ничего не владеет. При выполнении он разрешает движок оркестрации и сервис доставки файлов из пресета вызывающего, с откатом на глобальный сервис, затем запускает foreground-прогон и отображает его результат в ограниченный результат инструмента. Конфигурация проверяется при загрузке: пустые или повторяющиеся id и имена делегатов рушат монтирование плагина с `ORCHESTRATION_INVALID_REQUEST`, а не первый вызов.

| Файл | Роль |
|---|---|
| [`src/index.ts`](src/index.ts) | Схема конфигурации, выбор делегатов, определение инструмента, время жизни защиты, отображение результата |
| [`src/error.ts`](src/error.ts) | Кодированные ошибки инструмента: неверный запрос, провал прогона, отмена прогона |
| [`src/types.ts`](src/types.ts) | Безопасные для модели типы результата, работника, статуса и метаданных PDF |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [dsh-agent-orchestrator](../agent-orchestrator/README.zh.md) — движок, которым управляет этот инструмент.
- [dsh-tool-subagent](../tool-subagent/README.zh.md) — делегирование одному делегату с той же моделью уведомления о завершении.
- [dsh-agent-preset-registry](../../preset/agent-preset-registry/README.zh.md) — scoped-сервисы, разрешающие движок и поверхность доставки.
- [dsh-tool-pdf](../../document/tool-pdf/README.zh.md) — писатель отчётов, который использует движок.

-----

<a id="model-experience"></a>
## 模型体验

### 工具定义

#### 模型看到什么

Каждый запрос во владеющей Session несёт `orchestrate_agents` с его описанием и тремя параметрами ниже.

##### 工具描述

```markdown
Run the configured delegates and evaluator as one autonomous orchestration. The delegates work in parallel up to the stored limit, the evaluator can send targeted follow-ups on the same agent conversations, and the tool returns a consolidated result. Use this for a task that benefits from several specialist reviews; do not use it for a single delegate or a task you can complete directly.
```

##### 参数说明

```markdown
- `objective`: Complete user objective for the orchestration.
- `circumstances`: Optional facts and constraints available at the start. Missing facts belong in the resulting gaps, not in a question to the user.
- `assignments`: Optional subset of the configured delegates with a specific initial task for each. Omit to run every configured delegate.
```

#### Token 影响

Фиксировано: описание и три описания параметров на каждый запрос во владеющей Session.

#### KV Cache 效应

Стабильный префикс: определение входит в префикс инструментов, поэтому пишется один раз и переиспользуется каждым запросом в этой Session.

### 工具结果

#### 模型看到什么

Отрендеренный текст — `<status>: <summary>`, а при наличии отчёта дальше идёт `PDF: <path>`. Структурное значение также несёт id прогона, его раунды, id задания и число раундов каждого работника и ограниченный список пробелов.

#### Token 影响

`summary` обрезается до `maxSummaryChars`; список пробелов — до `maxGapCount` записей по `maxGapChars` каждая. Прогон без отчёта опускает строку PDF.

#### KV Cache 效应

Дописывается после сохранённой беседы; существующий префикс остаётся переиспользуемым.

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

Эти ограничения следуют из движка и модели владения сохранённой записью; ни одно из них не является общим бэклогом оркестрации.

- **Прогоны process-local и foreground** — перезапуск процесса их не возобновляет, а вызов занимает своё выполнение инструмента до очистки всех детей.
- **Отчёты несут текст и таблицы** — изображения из вложений детей не переносятся в родительскую Session.
- **Прогоном может владеть только точный живой корень** — вложенная оркестрация отклоняется движком.
- **Побеждают сохранённые решения** — аргументы модели не могут добавить делегата, сменить пресет, поднять лимит или отключить отчётность.
- **Автоматической отчётности нужен сервис доставки** — включённый `autoReport` без `fileDeliveries` рушит вызов с `ToolContextUnavailableError`, а не возвращает отчёт, который никто не откроет.

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

Инструмент намеренно не хранит состояния: каждый вызов разрешает свои сервисы, запускает один прогон и освобождает его в `finally`. При изменении исхода или лимита обновляйте блоки Model Experience и пункты Known Limitations в том же изменении; оба гейта читают эти заголовки. Id делегатов одновременно служат id пресетов, поэтому сохранённая запись и её каталог пресетов должны оставаться согласованными.

</details>