# №4540 · ограниченная правка stop: свидетельство исполнителя

Это передача кода и носителей родителю, **не холодная приёмка**, не закрытие дела
и не повышение модусов графа. Ось5 и исходная полная цель bare-TUI не объявляются
достигнутыми. Все реальные запросы провайдеру шли только в сценарный loopback HTTP;
ни LAB, ни бой, ни модель не использовались; обычные ключи моделей/API измеритель
не читал и не копировал.

## Основание и граница

Прочитан путь `#9256 —vimarsha_of→ #7439 —upadhi→ #9257`, а также
`#9256 —anga→ #7441`, поле #4057/#931 и #7519/#7517/#8203/#9966.
Постановки: №4540[5,8], CoS №4532[25,42], принятые уточнения №4540[23,30,33].
Изменения решений и сведение держит родитель. Узлы не менялись.

Снятие определяется отсутствием `stopped.order`: interrupt, сброс очередей и
постоянный запрет автоматического возврата, **без archive и kill**. Полный приказ
имеет иной исход. Исключение из зависимости от archive разрешено только для
своего Run/Orca handle+runtime; на обычный PID/`--session`/standalone без такого
Run оно не перенесено. Старые журналы `halt_confirmed` не переосмыслены.

## Где код

| Ось | Файлы | Существо |
|---|---|---|
| 4 | `js/opencode/{channel,halts,cuts}.ts` | Род операции сохраняется вместе со стопом; пассивное снятие не вызывает archive/client close; явное занятие отменяет лишь снятый стоп своего поколения, не собственный стоп ребёнка |
| 3, прямой путь | `js/opencode/{host,client,cuts}.ts` | Archive read-back, сериализация archive/unarchive между экземплярами, отмена pending close; однозначные UID/PID/argv/время рождения, наблюдение выхода; отказ `ps` не равен исчезновению |
| 3, свой Run | `js/bridge/{stoporder,order-client,orca-stop}.ts`, `js/shared/halt-phase.ts` | Текущая промежуточная квитанция interrupt/drop → собственный Run/standing/realm/handle/runtime → show/close/wait exit/show → terminal; runtime/handle/incarnation проверяются, поколение и Run перечитываются; настоящий отказ interrupt потомка старше архивного потолка |
| 5 | Runtime не менялся | Оценка передана ответом №4540[29], принята[31]; новый launch/exec/lifecycle-путь не реализовывался |

У собственного Run без archive успешный terminal имеет отдельную причину
`client_exited_archive_unconfirmed`, не ложное подтверждение сохранённого архива.
Произвольный failed-приказ, чужой Run, неизвестный runtime, старое поколение и
ненаблюдённый выход закрытия не разрешают. История не удаляется.

Нижние пробы находятся в `js/tests/opencode.test.mjs` и
`js/tests/stoporder-strength.test.mjs`, используются существующие подставные
контексты/Orca и настоящие дочерние процессы. Их потолок — имитация харнеса.

## Байты

| Носитель | SHA256 |
|---|---|
| Точный release7.39.0 bridge | `79df3f0cc5944255b124f2e4bcc9b8d712bc7eaa49b1f02c90b14d2db2cf79ad` |
| Точный release7.39.0 plugin | `eacc3500074529b6accc3174597c837cf7a6bbb5b8f9914a17c263a23dfdbd9f` |
| Канонический dev bridge | `eee6e6b6781ac48f645dca12fcb730926f0bcd73ab946188eb3ac5765de1735b` |
| Канонический dev plugin | `a30949deb5823194ac539be08bd843314eb94eb5063ad70dec33a023c8ffbdb2` |
| Неизменённый исходный checker №4532 | `c368356703b2ce0c5d16e744bca5e246fd7ba7344d5b1ae41e6a3e3b6c4eea30` |
| Узкий probe-wrapper, исходник = замороженная копия | `f4b74eb349d08fca9bc5b7992d062a004966ac290fa43cf2a6744dbe0a01bb54` |

Dev-файлы `dist/dev/skills/establish-mcp/scripts/{iskron.mjs,opencode-plugin.js}`
побайтно совпали с замороженными `/private/tmp/i4540g7/{iskron.mjs,opencode-plugin.js}`.
Версии и frozen release outputs не менялись. Настоящие OpenCode2.2.7 и Orca1.4.242.

## Повторяемые команды и коды выхода

Запуски приборов из этого дерева:

```sh
PROBE_ORCA_ADAPTER=1 ISKRON_BRIDGE_PATH="$PWD/skills/establish-mcp/scripts/iskron.mjs" ISKRON_OPENCODE_PLUGIN="$PWD/skills/establish-mcp/scripts/opencode-plugin.js" node scripts/probe-stop-lifecycle.mjs /private/tmp/i4540r7
PROBE_ORCA_ADAPTER=1 node scripts/probe-stop-lifecycle.mjs /private/tmp/i4540g7
```

Приборы живут для холодного повтора. Их контроллеры описаны в `control.json`;
подтверждение собственного serve/listener — в `ownership.json`.
Созданы `neighbour`, `axis4-explicit`, `axis3-orca` через `/create`; только последний
с `orca:true`. Для полного останова сохранён **реальный busy** до воздействия:
`axis3-orca-busy.raw.json` — user уже в истории, сценарный HTTP удержан.
DELETE своего standing оси4 вернул204, POST своего standing/stop оси3 —201.

| Команда | Exit |
|---|---:|
| `node ../probe-4532/scripts/check-4532.mjs 4 /private/tmp/i4540r7` | 1 |
| `node ../probe-4532/scripts/check-4532.mjs 4 /private/tmp/i4540g7` | 0 |
| `node scripts/check-stop-orca.mjs /private/tmp/i4540r7` | 1 |
| `node scripts/check-stop-orca.mjs /private/tmp/i4540g7` | 0 |
| Те же две dev-команды после собственного `POST /api/location/reload` | 0 / 0 |

Первый путь в таблице — соседнее дерево
`/Users/dmitry/code/iskron/skills/.worktrees/probe-4532/scripts/check-4532.mjs`;
сам файл не правился и не копировался с ослаблением.

У dev axis4 исходный TUI остался жив, история сохранила3 сообщения, hold не
вернулся после reload. После адресного late-send на уже отсутствующий listener
история и число provider HTTP остались3; это свидетельство отсутствующего пути
побудки, **не** приёмка фильтра nonce на доставленном кадре.

У dev scoped3 TUI PID59543 действительно исчез; session outcome=interrupted;
show/wait сохранили runtime/handle/incarnation, connected=false, writable=false,
satisfied=true/status=exited. История3 сообщения; сосед PID59317 и serve46631 живы.
Приказ ord-1: accepted → stopped/client_exited_archive_unconfirmed.
`archiveObserved=false` сохранено открыто, exitCode0 от Orca не назван graceful exit.

Нижняя команда:

```sh
node --test --test-name-pattern='scoped stop:|scoped Orca stop:' js/tests/opencode.test.mjs js/tests/stoporder-strength.test.mjs
```

Последний прогон: **exit0, 14/14**. Отдельные RED до патчей: первые seat/terminal-ack
пробы на точном release — exit1; Orca-стык на точном release — exit1;
межэкземплярный archive/stand и отказ наблюдателя PID на прежнем dev — exit1.
Логи сохраняются отдельно, не перекрыты поздним нулём.
Полные журналы команд — `/private/tmp/i4540-proof/` (каталог0700, файлы0600),
в частности `scoped-final-3.log`, `make-check-candidate.log` и `live-*-final.log`.

`make check` на кандидате: **exit0**; 3061 tests, 3059 pass, 0 fail, 1 skip, 1 TODO.
Вывод смешанный: диагностический `failing tests` относится к уже принятому TODO
`opencode-hook-stop.test.mjs:112` (#9890v1, vartamana/upeksha, прочитан), не к новому
успешному исходу. Этот остаток не исправлялся и не скрывался. Ранние вызовы гейта
имели exit2: лимит строк channel, сортировка imports, старые ожидания и windowsHide;
исправлены в этой пачке. Поздние успешные исходы — повтор тех же проверок.

## Ограничения и сохранённые неудачи

- Вердикты этой передачи — **provisional**: автор кода не принимает свою работу.
- NKS/provider сценарные. Run-запись в отдельном authdir связана с собственным
  настоящим terminal-create и известными session/standing; **обычный agent launch,
  реальный spawned_for claim/join и ось5 не доказаны**.
- `PROBE_ORCA_ADAPTER=1` — адаптация измерителя по №4540[33], не native изолированная
  Orca и не production-код: HOME восстанавливается только дочернему настоящему CLI
  для его обычного локального IPC. Wrapper допускает исключительно version и
  show/close/wait allowlisted handle с проверкой runtime/incarnation. Чужая цель и
  лишний environment-флаг дали **exit2**, настоящая команда не выполнялась.
  Аргументы, digest и собственность: `orca-probe-adapter.json`, `orca-owned.json`,
  `axis3-orca-bound.json`, `orca-wrapper.ndjson`; ключи/metadata не копировались.
- До этого `/private/tmp/i4540g4` честно отказал `orca_version_unverified`
  (в probe PATH не было Orca); `/private/tmp/i4540g6` —
  `terminal_binding_unconfirmed`/runtime_unavailable из-за изолированного HOME.
  Это не GREEN и не свидетельство работы native изолированной Orca.
- Независимый no-op plugin archive воспроизведён без TUI и модели:
  `/private/tmp/i4540s2/h/archive-surface.json`, диагностический prompt-hook
  намеренно отказал до dispatch. Объявленный flat archived не сохранился;
  прямой HTTP PATCH отдельной API-only session сохранился. #10351 остаётся.
- Ручной bare-TUI без доказанной связи не закрывается автоматически. Исходные
  RED №4532/№4537 и их носители не мутировались и не заменялись новой целью.
- Все свои промежуточные носители сохранены до cold: `/private/tmp/i4540r`,
  `i4540r2`, `i4540r3`, `i4540r4`, `i4540r5`, `i4540r7`, `i4540g`, `i4540g4`,
  `i4540g5`, `i4540g6`, `i4540g7`, `i4540s`, `i4540s2`. Для точного освобождения
  после приёмки — их собственные `control.json`, `ownership.json` и bound-файлы;
  общего prune/cleanup и изменения домашнего deployed bridge не было.

Ход, RAW-свидетельства и приёмка находятся в деле №4540 и названных каталогах;
пуш, PR, мерж, сведение графа и окончательная приёмка — родителю.
