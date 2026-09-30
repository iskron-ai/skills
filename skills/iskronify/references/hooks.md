# Хуки Claude Code — точная форма для проекции и починки

Шаг 4 скилла называет хуки и когда каждый срабатывает; здесь — их форма в `.claude/settings.json`: конверт, фильтры и проверка перед записью. Другие харнессы — `harness-surfaces.md`.

## Конверт
Каждый хук запускает shell-`command`, эхающий конверт в stdout. Вложенность `event → массив → {"hooks":[{"type":"command","command":…}]}` легко перепутать:
```json
{ "hooks": { "SessionStart": [ { "hooks": [ { "type": "command",
  "command": "echo '{\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":\"<start reminder: read the iskron door's Start section first; realm, focus holon, agent karta, owner karta; standing only on watch, via iskron_stand; start ... case №N enters that case>\"}}'" } ] } ] } }
```

## Пуш и мерж — по исходу, не по форме
Записи `PostToolUse` с `"matcher": "Bash"`; гейт — `jq -e '<фильтр>' >/dev/null && echo '<envelope>' || true`.
- Команда ищется как **команда** (в начале строки или после `;`, `&&`, `|`, `(`, перевода строки; с `env` и присваиваниями перед ней; `-C <путь>` у git), не как подстрока: `echo`, `grep` по тексту хука, тело PR не будят.
- Справка (`-h`, `--help`) и у мержа `--auto`/`--disable-auto` не будят никогда; флаг ищется вне кавычек (`def a` проходит строку в кавычках целиком; `\"` внутри двойных и `don\'t` вне кавычек строки не открывают; `$(…)` и heredoc не разбираются).
- Код выхода говорит за команду, лишь когда она последняя в цепочке или стоит перед `&&`; после `|` или `;` будит только строка подтверждения в `tool_response`: у пуша — `To <remote>` со строкой обновлённой ссылки (флаг ` `, `*`, `+` или `-`; ` ! ` и ` = ` не будят; пуш последним в цепочке будит по коду 0 и при «Everything up-to-date» — принятый зазор; тихий пуш `-q`/`--quiet` судится по состоянию git, отдельным блоком ниже; его пределы: флаг в склейке вроде `-uq` не ловится; `<<` где угодно в команде глушит хук; пуш в другую ветку или remote, чем `@{push}` текущей ветки, пуш из другого каталога (`git -C`, `cd` в цепочке), пуш при `HEAD`, уже равном `@{push}` (нечего отправлять), и пуш из `main` — молчат или будят по этому равенству, а не по факту пуша; без upstream хук молчит; хук читает git каталога сессии); у `gh pr merge` — `Merged`/`Squashed and merged`/`Rebased and merged pull request` (вне терминала gh об успехе молчит — там исход только код выхода); у fj — `Merged PR #`.

Пуш:
```
def a: "(?:>&|\\\\.|\\x27[^\\x27]*\\x27|\\x22(?:[^\\x22\\\\]|\\\\.)*\\x22|[^;&|)\n\\x27\\x22\\\\])*"; def at(h; n): "(?:^|[;&|(\n] *)" + h + "(?=[ ;&|)\n]|$)(?!" + a + " (?:" + n + ")(?:[ ;&|)\n]|$))"; def ran(h; n; said): (.tool_input.command // "") as $c | (.tool_response | if type == "object" then "\(.stdout // "")\n\(.stderr // "")" else tostring end) as $o | ($c | test(at(h; n) + a + "[ \n]*(?:&&|$)")) or (($c | test(at(h; n))) and ($o | test(said))); ran("(?:env +)?(?:[A-Za-z_]+=[^ ]+ +)*git(?: -C [^ ]+)* push"; "-h|--help"; "To [^\n]+(?:\n [!=] [^\n]*)*\n [ *+-]")
```
Тихий пуш (`-q`/`--quiet`) строки `To <remote>` не печатает, и по выводу его не отличить от отказа при обрезке (`| tail -1`, `| head -1`) — судит состояние git, а не вывод: второй `jq` узнаёт форму команды (команда от начала строки через цельные кавычки, без `<<`), затем оболочка сверяет `git rev-parse HEAD` с `git rev-parse "@{push}"` (обе непусты и равны) и ветку — не `main`. Пуш, принятый remote'ом, двигает `@{push}` к `HEAD`; отказ не двигает. Хук собирается так: `p=$(cat); { printf %s "$p" | jq -e '<фильтр пуша>' >/dev/null || { printf %s "$p" | jq -e '<фильтр тихого пуша>' >/dev/null && h=$(git rev-parse HEAD 2>/dev/null) && [ -n "$h" ] && [ "$h" = "$(git rev-parse "@{push}" 2>/dev/null)" ] && [ "$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" != main ]; }; } && echo '<побудка>' || true`.
```
def a: "(?:>&|\\\\.|\\x27[^\\x27]*\\x27|\\x22(?:[^\\x22\\\\]|\\\\.)*\\x22|[^;&|)\n\\x27\\x22\\\\])*"; (.tool_input.command // "") | (test("^(?:" + a + "[;&|(\n] *)*(?:env +)?(?:[A-Za-z_]+=[^ ]+ +)*git(?: -C [^ ]+)* push(?=[ ;&|)\n]|$)(?!" + a + " (?:-h|--help)(?:[ ;&|)\n]|$))" + a + " (?:-q|--quiet)(?=[ ;&|)\n]|$)") and (test("<<") | not))
```
Мерж — те же три `def`, затем мерж форжи по исходу или подтяжка ствола: `checkout`/`switch` ствола командой, за ним через `&&`, `;` или перевод строки (и через промежуточные команды) `git pull`; не всякий `git pull` на ветке, не упоминание в `echo` или кавычках, не ветка с именем от ствола (`main-foo`). Подтяжка через `;` судится по форме: упавший перед `;` checkout будит — лишняя побудка дешевле молчания. Для fj — его команда и строка подтверждения.
```
def a: "(?:>&|\\\\.|\\x27[^\\x27]*\\x27|\\x22(?:[^\\x22\\\\]|\\\\.)*\\x22|[^;&|)\n\\x27\\x22\\\\])*"; def at(h; n): "(?:^|[;&|(\n] *)" + h + "(?=[ ;&|)\n]|$)(?!" + a + " (?:" + n + ")(?:[ ;&|)\n]|$))"; def ran(h; n; said): (.tool_input.command // "") as $c | (.tool_response | if type == "object" then "\(.stdout // "")\n\(.stderr // "")" else tostring end) as $o | ($c | test(at(h; n) + a + "[ \n]*(?:&&|$)")) or (($c | test(at(h; n))) and ($o | test(said))); ran("gh pr merge"; "-h|--help|--auto|--disable-auto"; "(?:Merged|Squashed and merged|Rebased and merged) pull request") or ((.tool_input.command // "") | test(at("(?:env +)?(?:[A-Za-z_]+=[^ ]+ +)*git(?: -C [^ ]+)* (?:checkout|switch)"; "-h|--help") + " (?:main|master)(?=[ ;&|)\n]|$)(?:" + a + "(?:&&|;|\n))+ *(?:env +)?(?:[A-Za-z_]+=[^ ]+ +)*git(?: -C [^ ]+)* pull(?=[ ;&|)\n]|$)"))
```
**Экранирование.** В JSON `settings.json` кавычки фильтра — `\"`, и **каждая** обратная косая удваивается (`\n` → `\\n`, `\\x27` → `\\\\x27`): недоудвоенная даст jq неизвестный escape, а `|| true` спрячет — хук замолчит навсегда.

**Проверка до записи** — подай хуку JSON с `tool_input.command` и `tool_response`. Срабатывают: пуш цепочкой после коммита, `git -C <путь> push`, `gh pr merge <N> --squash` последней командой, `gh pr merge <N> -t "fix -h parsing"`, `git push 2>&1 | tail` с ` + …(forced update)`, `git checkout main; git pull`. Не срабатывают: `gh pr merge --help | head`, `git push -h`, `gh pr merge <N> | tail` с пустым выводом, `git push 2>&1 | tail` с ` ! [rejected]`, `git checkout main-foo && git pull`, `echo "git checkout main && git pull --ff-only"`, `grep "git push"`, `echo git push`, голый `git pull` на ветке. Текст-матч никогда не повышай до гейта работы.

**Зазор хука мержа.** Где PR мержит человек на форже, а ствол подтягивается `git merge --ff-only origin/main`, события мержа в сессии нет, и хук молчит — ритуал держит проза AGENTS.md.

**Свежесть ветки** — предложи pre-push-хук (или тот же гейт): `git fetch -q origin main && git merge-base --is-ancestor origin/main HEAD || echo 'ветка отстала от main — перебазируй до пуша'`.

## Memory-guard
Под `"PreToolUse"` — собственный массив события. Блокирует (exit 2, сообщение в stderr); маршрут в личный граф стоит всегда:
```json
{ "matcher": "Write|Edit|MultiEdit", "hooks": [ { "type": "command",
  "command": "jq -r '.tool_input.file_path // \"\"' | grep -Eq '\\.claude/projects/.*/memory/' && { echo 'BLOCKED: local agent memory is forbidden entirely, not by category (AGENTS.md, Persistence rules). Route the fact: repo conventions / code facts → AGENTS.md; project state, this repo'\\''s servers and dated duties → the project realm; a user-scoped fact no project owns → the personal realm @<handle>/mind (minding skill). This dir stays frozen at its prohibition stub.' >&2; exit 2; } || exit 0" } ] }
```

## Spec-write (только interop `full`)
В тот же массив `PostToolUse`, соседним объектом; ложные позитивы безвредны — никогда не повышай до гейта работы:
```json
{ "matcher": "Write|Edit", "hooks": [ { "type": "command",
  "command": "jq -r '.tool_input.file_path // \"\"' | grep -qE '(^|/)specs/[^/]+\\.md$|(^|/)docs/.*design[^/]*\\.md$' && echo '{\"hookSpecificOutput\":{\"hookEventName\":\"PostToolUse\",\"additionalContext\":\"A design draft was written; per AGENTS.md this file is a draft view — the graph is the design record. Intake it (intake skill, then design skill) in this session — do not defer to a push.\"}}' || true" } ] }
```

Запись `.claude/settings.json` харнесс может пометить как само-модификацию — вынеси её на подтверждение.
