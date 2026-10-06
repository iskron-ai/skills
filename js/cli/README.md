# js/cli — подкоманды одного исполняемого файла поставки

Вход — `iskron.ts` (сборка: `skills/establish-mcp/scripts/iskron.mjs`, дом — `~/.iskron-bridge/iskron-bridge.mjs`); список подкоманд — `node iskron.mjs --help`.

- `doctor.ts`, `doctorwords.ts`, `opencode-config.ts`, `subagents.ts`, `subwords.ts`, `satform.ts`, `satprobe.ts`, `frontmatter.ts` — `doctor`: какая сборка стоит и работает ли она.
- `update.ts` — `update`: свежий релиз в дом.
- `use.ts` — `use`: постоянный выбор адреса сервера.
- `rituals.ts` (слова и исход), `ritualprobe.ts` (подставной ctx OpenCode с двумя каталогами), `ritualcalls.ts` (вызовы тулов для хуков) — `check-rituals`: плагины ритуалов `.opencode/plugins/*` не трогают сессии чужих каталогов (граф @nks/nks-dev, узел #6686). Пробы — `js/tests/ritual-scope.test.mjs`; `scripts/check-ritual-scope.mjs` зовёт ту же подкоманду из dev-сборки.
