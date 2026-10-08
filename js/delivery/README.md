# js/delivery — слой поставки моста

Каталог того, чем поставка iskron отличается от соседней (граф @nks/nks-dev: проект #6806, контракт #6809, сосуществование #6815). Всё прочее в `js/{bridge,shared,opencode,extension,watchdog,cli}` — ядро, которое соседняя поставка копирует файлами; что из поставочного ещё стоит в ядре, говорит #6806.

- Ядро импортирует слой одним путём — `../delivery/index.ts`; alias и define сборки нет, копии различаются содержимым этого каталога. Набор экспортов `index.ts` и есть контракт: недостающий экспорт — ошибка `make typecheck` в ядре.
- Слой не импортирует исполняемое ядро; зависимость от типов ядра — `import type`.

Файлы:
- `version.ts` — `VERSION` (штампует release-please, `release-please-config.json`), `BUILD_MARK` и `CHANNEL_MARK`. Форма строки `export const CHANNEL_MARK: string = "<BUILD_MARK>:dev";` — часть контракта: `js/build.mjs` находит её регулярным выражением и в сборке выпуска заменяет `:dev` на `:release`.
- `product.ts` — `PRODUCT` и выводимое из него: переменные окружения (`ENV_PREFIX`, `envName`), имя моста и дом (`BRIDGE_NAME`, `HOME_DIR`, `HOME_BRIDGE_FILE`), префиксы сокетов, pipes и реестров процесса (`RUNTIME_PREFIX`, `GLOBAL_PREFIX`), раскладка набора (`BRIDGE_SKILL`, `BRIDGE_FILE`, `SKILL_STAMP_MASK` — маска отпечатка набора `*/<файл>` или `*/**`, `PLUGIN_FILE`, `PLUGIN_COPY_FILE`, `SKILL_SET`), распознавание установки (`PLUGIN_NAME`, `SUB_ENTRY_PREFIX`, `CONNECTOR_PATTERN`), имена клиентов MCP (`CLIENTS`), адреса сервера (`SERVER_URLS`, `DEFAULT_SERVER_URL`).
- `protocol.ts` — имена тулов (`TOOL_PREFIX`, `tool`), методы плагин↔мост (`method`), логгеры уведомлений (`LOGGERS`), префикс внутренних id (`ID_PREFIX`), ключ полей ответа (`STRUCTURED_CAPABILITY`, `<продукт>/structured`) — из имени продукта; ключ отказа api (`serverProtocol.refusal`) — своим значением, его подтверждает поверхность своего сервера.
