# №4869 — кандидат к независимой приёмке 8.0.2

**Статус: partial — код и адресные пробы переданы, не полный выпуск/живая приёмка.**

Рабочее дерево: `/Users/dmitry/code/iskron/skills/.worktrees/fix-orchestra-defaults`; ветка `fix/orchestra-defaults`. База: `7582c1e4f2a38fb6ff4593a4aa4ad3e35edbce4e` (8.0.1). Первая независимая дельта defaults+SSH: `4aacbc07`. Окончательная голова — коммит, содержащий этот отчёт; полный SHA передан строкой дела №4869 и в ответе ведущему.

## Итоговая реализация

- Один in-memory resolver для dry-run/actual: отсутствующие/null launcher/harness/model дополняются только однозначно разрешённым предложением местной машины и автора. Явное неизвестное/запрещённое не заменяется. Неоднозначность, limit, host, repository и cover закрывают запуск. Приглашение и mind не меняются; выбранная строка идёт в реестр/clone/launch.
- SSH remote сопоставляется по единственному hostname настоящего `ssh -G`, через существующий execFile-runner с argv/таймаутом. Организация/репозиторий сохраняются, username не входит в ключ; HTTPS не использует SSH config. Неуспех/неоднозначность не дают совпадения; приватный вывод не печатается.
- До defaults — один GET `/nodes/{seq}` с `X-NKS-Realm` на рассматриваемый зов. Разбирается только плоский NodeView API 0.185.4: совпавшие seq, `node_type=karta`, `is_active===true`, `manifested_as=adhikarin`. Человек svatantra, прочие роды, отсутствие/неизвестность/отказ чтения не запускаются; не угадываются по имени/номеру/user.
- `step --only <UUID дела>/<положительный номер зова> --realm <один граф>`: одноразовый выбор из **полного** demands, не подмена снимка. Не вызывает fold/stop/expiry/cleanup и не пишет курсоры других зовов. Malformed/missing/duplicate/unknown/scope/incomplete — отказ без общего step. Dry-run фильтрует так же. При OFF нужен TTY или `ISKRON_ORCHESTRA=1` через штатную локальную дверь; флаг/consent/граница не записываются. Обычный step не изменил согласие.
- Источник Orca — только источник. Durable intent связывает UUID операции, realm/room/invite, собственный path, common-dir и один неизменный commit OID `refs/remotes/origin/main`. Read-back intent перед add и после await не даёт начать неучтённую операцию при замене записи. Создание — только `git worktree add --detach` внутри `.worktrees/orchestra-<UUID>`. Никаких Orca create/import/drop, checkout/reset/merge/pull или refresh main; Git routing environment не наследуется, checkout hooks выключены только для вызова.
- Run/prepare/brief/launch используют один собственный path. Обычный адаптер требует объявленный `--surface terminal` при прежних harness/model; binding — handle/runtime/incarnation/executionHostId/worktreePath. Chat/unknown остаются ambiguity с занятым лимитом, без ended/cleanup. Exec использует тот же собственный path без изменения своего выбора.
- Наблюдатель собственного клиента/raised/stop работает также при OFF. Для нового дерева timeout/410/один server ack не означают ended. Уборка — только после точного наблюдённого exit и stopped, проверки текущей записи, common-dir/git-dir/inode, detached HEAD=baseOID и полной чистоты, включая ignored. Новые коммиты сохраняются консервативно, даже если кто-то считает их уже слитыми. Удаление — точный `git worktree remove -- <path>`, без force. HEAD.lock защищает от нового detached commit между проверкой и удалением; чужой lock не снимается. Неизвестный ref backend (включая reftable) не полагается на files-backend lock и отказывает. Unknown add/remove не повторяются вслепую. Именованный остаток виден в status без приватного пути.

## Основание и интеграция

Прочитаны узлы и окрестность #5042, его `upadhi` #10096/#8202/#4951, `next` #7517, его `contains` #9968/#9969 (последний v6); уточнения владельца/CoS — №4603 [195,205,209,214,227,230]. Путь: #5042 —upadhi→ #10096 задаёт допуск предложения; #5042 —next→ #7517 —contains→ #9968/#9969 отделяет подготовку своего дерева, запуск и точный исход. Первоначальный проект Orca-create отменён; его незакоммиченная тестовая заготовка удалена, parser/Create Orсa в код не попали.

Ткачество, модусы и приёмка — ведущему. Новых узлов/стрелок нет: это механическая доля уже записанного проекта, не новое полномочие. REALITY.md: строка класса добавлена ведущим и включена по его явному разрешению.

## RED / GREEN и потолок

Все логи ниже локальны в `.scratch/`; команды воспроизводимы из этого дерева. Полный неизменный `make check` **не запускался** — один вызов ведущему параллельно холодному ревью на фиксированном HEAD.

| Проверка | Наблюдённый результат / носитель |
|---|---|
| До фикса: defaults/SSH против закоммиченных байтов 8.0.1 | exit 1, 3/3 падают на launcher_missing/harness_missing/no_checkout; `RED-4869.log` |
| Detached launch против первой дельты без изоляции | exit 1: actual worktree равен source; `TREE-RED-4869.log` |
| Role/only против 8.0.1 | exit 1; `ROLE-ONLY-RED-4869.log` |
| Полный адресный orchestra-raise проход в середине работы | 69/84; первый отказ — неканонический /var source, затем старые ожидания timeout/410/ack⇒ended. Не замаскированы: source нормализован, требования stop пересведены, все упавшие случаи перегнаны |
| Повтор соответствующих случаев | exit 0, 23/23; `STOPS-4869.log` |
| Остальная адресная группа | exit 0, 63/63; `RAISE-REST-4869.log` |
| После HEAD-lock/CAS/прочих последних содержательных защит | exit 0, 13/13 defaults/SSH/role/only/surface/tree/dry/stop; `FINAL-PATHS-4869.log` |
| Последняя сборка, включая выделенный status и уборку приватного source из плана | exit 0, 6/6 detached/only/OFF-consent/dry/exit→stop→cleanup; `FINAL-PLAN-4869.log` |
| Последняя сборка: настоящий локальный Git, HEAD-lock, CAS, commit/dirty/ignored/foreign/unknown/backend, status, stale registry, exec-пробы | exit 0, 49/49; `FINAL-TREE-EXEC-4869.log` |
| Полнота/границы demands и invites tact | exit 0, 16/16; `DEMANDS-4869.log` |
| `make typecheck check-core` | exit 0; `FINAL-TYPES-CORE-4869.log` |
| Адресный eslint всех staged TS/MJS | exit 0: 0 ошибок, 3 прежних non-null предупреждения (exec-client-exit, quench, raise) |
| Адресный prettier --check всех staged TS/MJS; git diff --check | exit 0 |

SHA256 закоммиченного выпуска 8.0.1: `499128160f5a475a3a9d2492e35dbd464c62c0052cf72a288ceed1cc9235fef4`.

SHA256 последнего dev-моста: `4dbeb7ff8728a447a2ceaa2a1287a55e8bbc128279e23520abca5a2da99d4420` (`dist/dev/skills/establish-mcp/scripts/iskron.mjs`). Ни build-release, ни VERSION/замороженные выходы не менялись.

Вердикт поведения — **provisional**: настоящий Git, dev-мост/демон/локальные сокеты, но API/mind/Orca/ssh в пробах подставные. Не настоящая модель, SSH config, spawned_for/joined на живом API и не выпускной путь. Живой носитель и каноническая приёмка — независимой доле ведущего/верификатора. Новый Git-путь на Windows отказывает; неподтверждённый ref backend отказывает. Dry-run не создаёт дерева и показывает условный собственный путь, а не готовность реального runtime.

## Изменённые файлы

Первая дельта: `js/bridge/orchestra-resolve.ts`, `orchestra-remote.ts`, `demand-rows.ts`, `orchestra-orca.ts`, `orchestra-plan.ts`, `orchestra-raise-gates.ts`, `orchestra-raise.ts`, `README.md`; `js/tests/orchestra-raise.test.mjs`.

Завершённая пачка (пути ниже от корня):

- `REALITY.md`, `.scratch/REPORT-4869.md`, `js/bridge/README.md`.
- `js/bridge/exec-client-exit.ts`, `exec-exit.ts`, `exec-raised.ts`, `order-client.ts`.
- `js/bridge/orchestra-door.ts`, `orchestra-foreign.ts`, `orchestra-lead.ts`, `orchestra-orca.ts`, `orchestra-plan.ts`, `orchestra-quench.ts`, `orchestra-raise.ts`, `orchestra-run-ends.ts`, `orchestra-run-types.ts`, `orchestra-runs-delta.ts`, `orchestra-runs.ts`, `orchestra-start.ts`, `orchestra.ts`.
- `js/bridge/orchestra-only.ts`, `orchestra-role.ts`, `orchestra-status.ts`, `orchestra-tree.ts`, `orchestra-tree-types.ts`, `orchestra-tree-check.ts`, `orchestra-tree-clean.ts`.
- `js/cli/orchestra.ts`, `js/delivery/words/orchestra.ts`.
- `js/tests/fake-nks.mjs`, `fake-orca.mjs`, `git-checkout.mjs`, `tree-fixture.mjs`, `orchestra-raise.test.mjs`, `orchestra-tree.test.mjs`, `orchestra-tree-guards.test.mjs`.

Самопроверка: исправлены stale-intent read-back, наследование exit при первой привязке/замене incarnation, commit/remove race, приватный source в плане и видимость остатков status при OFF. Новых инженерных направлений не оставлено. Старый большой orchestra-orca и интеграционный test-файл целиком не рефакторились; новая механика разделена на небольшие модули.

Пуша/мержа/релиза/установки в дом нет; live-носитель, общий runtime, mind и Orca не менялись. Своё дерево, dev-выходы и установленный локально тулчейн оставлены ведущему для полного гейта/проверки на этой же голове; временные деревья новых проб убираются адресно их fixture. Готовый отчёт и REALITY входят в коммит по указанию ведущего.
