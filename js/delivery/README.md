# js/delivery — слой поставки моста

Каталог того, чем поставка iskron отличается от соседней (граф @nks/nks-dev: проект #6806, контракт #6809, сосуществование #6815). Всё прочее в `js/{bridge,shared,opencode,extension,watchdog,cli}` — ядро, которое соседняя поставка копирует файлами; что из поставочного ещё стоит в ядре, говорит #6806.

- Ядро импортирует слой одним путём — `../delivery/index.ts`; alias и define сборки нет, копии различаются содержимым этого каталога. Набор экспортов `index.ts` и есть контракт: недостающий экспорт — ошибка `make typecheck` в ядре.
- Слой не импортирует исполняемое ядро; зависимость от типов ядра — `import type`.

Файлы:
- `version.ts` — `VERSION` (штампует release-please, `release-please-config.json`), `BUILD_MARK` и `CHANNEL_MARK`. Форма строки `export const CHANNEL_MARK: string = "<BUILD_MARK>:dev";` — часть контракта: `js/build.mjs` находит её регулярным выражением и в сборке выпуска заменяет `:dev` на `:release`.
- `product.ts` — `PRODUCT` и выводимое из него: переменные окружения (`ENV_PREFIX`, `envName`), имя моста и дом (`BRIDGE_NAME`, `HOME_DIR`, `HOME_BRIDGE_FILE`), префиксы сокетов, pipes и реестров процесса (`RUNTIME_PREFIX`, `GLOBAL_PREFIX`), раскладка набора (`BRIDGE_SKILL`, `BRIDGE_FILE`, `SKILL_STAMP_FILE`, `PLUGIN_FILE`, `PLUGIN_COPY_FILE`, `SKILL_SET`), распознавание установки (`PLUGIN_NAME`, `SUB_ENTRY_PREFIX`, `CONNECTOR_PATTERN`), имена клиентов MCP (`CLIENTS`), адреса сервера (`SERVER_URLS`, `DEFAULT_SERVER_URL`).
- `lang.ts` — языки поставки (`LANGS`, `Lang`), умолчание (`DEFAULT_LANG`) и правило языка по адресу сервера (`langOfServer`); язык сессии и выбор слова (`words`) держит ядро `shared/lang.ts`.
- `words/rooms.ts` — слова родов комнаты и короткого кадра (`ROOM`), записи платформы auto по code (`ROOM_AUTO`), связи дел по rel (`ROOM_REL`), вердикта строки (`VERDICT`); аргументы — готовые строки (`need`, `opt` ядра `shared/room-fields.ts`).
- `words/asks.ts` — слова вопроса в деле (`ASK`): ask, answer, ack, снятие, зов роли платформой.
- `words/hold.ts` — слова держателя сокета (`HOLD`); совет о мёртвом токене приходит аргументом.
- `protocol.ts` — имена тулов (`TOOL_PREFIX`, `tool`), методы плагин↔мост (`method`), логгеры уведомлений (`LOGGERS`), префикс внутренних id (`ID_PREFIX`) — из имени продукта; ключи протокола сервера (`SERVER_PROTOCOL`: отказ api, поля ответа) — своим значением, его подтверждает поверхность своего сервера.
- `patterns/launch.ts` — строка запуска с делом (`LAUNCH_LINE`), русская и английская форма при любом языке сессии.
- `words/appserver.ts` — слова двери в тред Codex (`APPSERVER`).
- `words/bridge-client.ts` — отказы клиента MCP к дочернему мосту и пустой ответ (`BRIDGE_CLIENT`).
- `words/channel.ts` — слова держателя живого канала (`CHANNEL`): совет на мёртвом токене, подвисшее соединение, раскатка.
- `words/frame-text.ts` — строки счёта дела и указатель history (`FRAME_TEXT`), автор-платформа и кавычки ответа (`CASE_LINE`).
- `words/launch.ts` — слова входа в дело по строке запуска (`LAUNCH`).
- `words/stalebatch.ts` — шапка пачки лежалых кадров (`STALE`).
- `words/standings.ts` — отказы проверки личного каталога сокетов (`STANDINGS`).
