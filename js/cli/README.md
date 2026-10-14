# js/cli — подкоманды одного исполняемого файла поставки

Вход — `main.ts` (сборка: `skills/establish-mcp/scripts/iskron.mjs`, дом — `~/.iskron-bridge/iskron-bridge.mjs`); список подкоманд — `node iskron.mjs --help`.

- `doctor.ts`, `doctornode.ts`, `doctorpaths.ts`, `doctorskills.ts`, `codexcache.ts`, `opencode-config.ts`, `subagents.ts`, `subwords.ts`, `satform.ts`, `satprobe.ts`, `frontmatter.ts`, `installnames.ts` — `doctor`: какая сборка стоит и работает ли она.
- Слова подкоманд — в слое поставки (`js/delivery/words/`: `cli.ts`, `doctor.ts`, `doctorharness.ts`, `subagents.ts`, `satprobe.ts`, `rituals.ts`); ядро берёт их через `words()` (граф @nks/nks-dev, узел #6806).
- `update.ts` — `update`: свежий релиз в дом.
- `use.ts` — `use`: постоянный выбор адреса сервера.
- `status.ts`, `statusdisk.ts` — `status [--json]`: снимок сессий, их установленного набора скиллов и мест демона без открытия сессии; отдельно мосты мимо демона и записи диска без живого держателя. Слова — `js/delivery/words/machinestatus.ts`.
- `stop.ts` — `stop <место|id сессии> [--realm]`: человек снимает место агента машины — место (полный адрес `@handle:name` сверяется с адресом места в снимке; чужой владелец — отказ), его id, сервер и api сессии из снимка демона (api старого демона — из записи держания), ключ сервера места — личный токен, если его дом (переменная адреса или файл `server`) называет сервер места, иначе грант сервера места, освежённый как у моста, не освежился — «войди заново» (`stopapi.ts`); приказ останова (POST /standings/{id}/stop), на api без ручки (404) — снятие места (DELETE /standings/{id}) (граф @nks/nks-dev, узлы #7518, #5085). Слова — `js/delivery/words/stopcli.ts`; проба — `js/tests/stop-cli.test.mjs`.
- `rituals.ts` (слова и исход), `ritualprobe.ts` (подставной ctx OpenCode с двумя каталогами), `ritualcalls.ts` (вызовы тулов для хуков) — `check-rituals`: подписка плагинов ритуалов `.opencode/plugins/*` на поток событий не пишет в сессии чужих каталогов, хуки тулов не ломаются в своей (граф @nks/nks-dev, узлы #6686, #5048). Пробы — `js/tests/ritual-scope.test.mjs`; `scripts/check-ritual-scope.mjs` зовёт ту же подкоманду из dev-сборки.
