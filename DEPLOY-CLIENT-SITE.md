# Клиентский сайт devBIM: деплой north-waterfront

Назначение: отдельный веб-деплой `dsh web` для передачи клиенту («Северный берег»),
изолированный от внутреннего `devbim.dev-bim.com`: свой порт (3081), свой
`DSH_HOME` (сессии, креды, настройки), свой пароль входа и урезанный UI —
клиенту доступны только чат и окно «Чертежи». Внутренний сайт продолжает
работать на 3080 без изменений.

## Состав

Файлы в репозитории (ветка `webUI`):

- `packages/bundle/web-app/client-north-waterfront.patch.yml` — оверлей
  клиентского сайта: NW-бренд (пакет `ui-brand-north-waterfront`: бейдж NW и
  «north-waterfront» в сайдбаре и герое), парольный гейт `devbim-auth` с NW-копией
  входа (`entryTitle` «NW — вход», вордмарк NW) и титулом вкладки
  (`indexTitle` «NW — Северный берег», переписывается на каждый запрос — сборка
  отдаёт общий дефолт), модель (openrouter, ключ из клиентских кредов),
  `trustedHosts` домена, отключения командных поверхностей UI, пресет агента
  «только чертежи» и режимы доступа, сжатые до одного `workspace-write`
  с закреплённым дефолтом (клиент работает в своей папке рабочей области,
  переключить режим нельзя);
- `dsh-web-north-waterfront.cmd` — лаунчер: порт 3081, `DSH_HOME=%USERPROFILE%\.dsh-north-waterfront`,
  env из `.env.north-waterfront`, туннель `config-north-waterfront`;
- `.env.north-waterfront` — секреты сайта (в `.gitignore`): пароль входа,
  `DRAWING5_API_KEY`, `DRAWING5_SERVER_URL`.

Машинные артефакты:

- `%USERPROFILE%\.dsh-north-waterfront` — home клиента; профиль `web` с
  плагином `dsh-plugin-drawing5`; `.credentials.yaml` — копия внутренней с
  удалённой записью `client-connection/browser-session` (секрет(cookie) сайта
  свой, создаётся при первом старте);
- `%USERPROFILE%\.cloudflared\config-north-waterfront.yml` — туннель
  `north-waterfront` → `http://127.0.0.1:3081` (service строго `127.0.0.1`,
  не `localhost`).

## Развертывание нового клиента

1. Лицензия drawing5: `python -X utf8 -m cloud.issue_license --company "<клиент>"`
   из репозитория drawing5; токен — в `.env.<клиент>` как `DRAWING5_API_KEY`.
2. Домен и туннель: `cloudflared tunnel create <имя>`,
   `cloudflared tunnel route dns <имя> <домен>`,
   `config-<имя>.yml` по образцу `config-devbim.yml` (ingress: домен →
   `http://127.0.0.1:<порт>`).
3. Оверлей: скопировать `client-north-waterfront.patch.yml`, заменить домен в
   `connection`; список отключений и пресет агента — по образцу.
4. Лаунчер: скопировать `dsh-web-north-waterfront.cmd`, заменить `PORT`,
   `DSHHOME`, `ENV_FILE`, имя туннеля и аргумент `--port`.
5. Home: скопировать структуру `%USERPROFILE%\.dsh-north-waterfront`
   (профиль `web` + плагин из `drawing5/plugin/dsh-plugin-drawing5/dist`,
   креды без `client-connection/browser-session`).

## Запуск и проверка

```sh
dsh-web-north-waterfront.cmd start    # сервер 3081 + туннель
dsh-web-north-waterfront.cmd stop
dsh-web-north-waterfront.cmd restart
```

Чек-лист: `http://127.0.0.1:3081/` даёт 303 → `/devbim/login`; неверный
пароль — 401; верный — вход. Страница входа: титул «NW — вход», вордмарк NW.
После входа: бейдж NW и «north-waterfront» в сайдбаре, титул вкладки
«NW — Северный берег»; devBIM нигде не виден (внутренний сайт на 3080
продолжает показывать devBIM). В UI: чат отвечает, «Чертежи» показывает дерево
клиента, нет настроек, Plugins, выбора модели, терминала и файлов; список
сессий пуст (изоляция от внутреннего сайта). Селектор режима возле «+» и
команда Permission внутри «+» показывают единственный режим «Запись в
рабочей области» (Workspace Write). Публично: тот же чек-лист через
домен туннеля.

## Ограничения

Ограничения — на уровне UI: RPC-поверхность вошедшего браузера не ограничена
по принципалу (remoteAccess считает соединение owner); пароль — единственный
барьер. Для выдачи наружу держите пароль одноразовым и меняйте при передаче.
Отключения UI и набор инструментов агента — список строк в оверлее, правится
за одну минуту.
