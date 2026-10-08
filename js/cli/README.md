# js/cli — подкоманды одного исполняемого файла поставки

Вход — `main.ts` (сборка: `skills/establish-mcp/scripts/iskron.mjs`, дом — `~/.iskron-bridge/iskron-bridge.mjs`); список подкоманд — `node iskron.mjs --help`.

- `doctor.ts`, `doctorwords.ts`, `doctornode.ts`, `doctorpaths.ts`, `doctorskills.ts`, `codexcache.ts`, `opencode-config.ts`, `subagents.ts`, `subwords.ts`, `satform.ts`, `satprobe.ts`, `frontmatter.ts`, `installnames.ts` — `doctor`: какая сборка стоит и работает ли она.
- `update.ts` — `update`: свежий релиз в дом.
- `use.ts` — `use`: постоянный выбор адреса сервера.
- `rituals.ts` (слова и исход), `ritualprobe.ts` (подставной ctx OpenCode с двумя каталогами), `ritualcalls.ts` (вызовы тулов для хуков) — `check-rituals`: подписка плагинов ритуалов `.opencode/plugins/*` на поток событий не пишет в сессии чужих каталогов, хуки тулов не ломаются в своей (граф @nks/nks-dev, узлы #6686, #5048). Пробы — `js/tests/ritual-scope.test.mjs`; `scripts/check-ritual-scope.mjs` зовёт ту же подкоманду из dev-сборки.
