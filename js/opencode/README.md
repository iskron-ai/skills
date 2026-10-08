# js/opencode — плагин iskron для OpenCode 2: тулы через мост, канал, команды

Один плагин, три половины; у каждой корневой сессии свой мост, а значит своё стояние (граф @nks/nks-dev, узел #4266). Выход — `skills/establish-mcp/scripts/opencode-plugin.js`, ставится копией в `~/.config/opencode/plugins/iskron.js`.

- `plugin.ts` — дверь: половины, поток событий сервиса, хуки сессии.
- Половина «тулы»: `tools.ts` — мост на сессию; `half.ts` — её вход для `plugin.ts` и пустая форма; `slot.ts` — мост одной сессии; `bridge-io.ts` — поиск моста, кэш тулов, рукопожатие; `host.ts` — что OpenCode говорит о себе; `login.ts`, `devicewait.ts` — вход человека; `status.ts` — текст `iskron_bridge`; `skillread.ts` — чтение файлов скиллов поставки вне рабочей копии.
- Слух и места: `keep.ts` — слух переживает простой, перезапуск и вытеснение; `keepalive.ts` — место держит каталог загруженным; `marker.ts`, `records.ts`, `adopt.ts`, `procstart.ts` — маркер потери и возврат мест; `moves.ts`, `handoff.ts` — перенос сессии между папками; `twins.ts` — экземпляры на два написания одного каталога.
- Дочерние сессии: `satellite.ts` — спутник места корня; `children.ts` — мосты детей и возврат ведущего; `leads.ts`, `leaddoors.ts`, `leadwords.ts` — ведущий субагент (договор и двери к OpenCode, слова); `launch.ts` — строка запуска с делом; `runends.ts` — кончившиеся дети; `cascade.ts` — отмена хода родителя; `notice.ts` — родное уведомление о субагенте; `waits.ts` — ребёнок, которого родитель не слышит.
- Половина «канал»: `channel.ts` — кадры стояния в сессию промптом, пачки дела; `tacts.ts` — такт внимания ждёт конца занятого хода последним (#6569).
- `commands.ts` — скиллы поставки в палитре «/»; `usage.ts` — расход сессии в attrs места.

Пробы — `js/tests/opencode.test.mjs` (`make test-opencode`), наводка на старую сборку — `ISKRON_OPENCODE_PLUGIN`.
